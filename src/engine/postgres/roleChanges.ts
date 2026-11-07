import { createHash, createHmac, pbkdf2, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import saslprep from '@mongodb-js/saslprep';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresRoleAttributesDraft, PostgresRoleCreateApply, PostgresRoleCreateDraft, PostgresRoleChangeOutcome, PostgresRoleChangePreview,
  PostgresRolePasswordDraft, PostgresRoleRenameDraft } from '../../shared/postgresRoles';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';
import { prepareRoleAttributes, prepareRoleRename, verifyRoleAttributes } from './roleAttributes';

type Scoped<T> = T & {owner: string; connectionRevision: number};
type Connect = (work: (connection: PostgresConnection) => Promise<void>, writing?: boolean) => Promise<void>;
type CredentialChange = (PostgresRoleCreateDraft & {kind: 'create'}) | (PostgresRolePasswordDraft & {kind: 'password'});
type RoleChange = CredentialChange | (PostgresRoleAttributesDraft & {kind: 'attributes'}) | (PostgresRoleRenameDraft & {kind: 'rename'});
type Target = {actor: string; database: string; iterations: number; stamp: string; managed?: Awaited<ReturnType<typeof prepareRoleAttributes | typeof prepareRoleRename>>};
const derive = promisify(pbkdf2);
const budget = (rows = 0) => ({rows, bytes: 16 * 1024});
const scramPlaceholder = '<客户端生成的 SCRAM 验证值>';

/** 使用 PostgreSQL 的 SASLprep 规则。服务器只接收带随机盐的验证值。 */
export async function postgresRoleScramVerifier(password: string, iterations: number): Promise<string> {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100000) throw Error('服务器的 SCRAM 迭代次数超出客户端预算');
  let prepared: string;
  try { prepared = saslprep(password); }
  catch { prepared = password; } // PostgreSQL 对无法通过 SASLprep 的合法 UTF-8 使用原字节。
  if (!prepared) throw Error('密码规范化后为空');
  const salt = randomBytes(16);
  const input = Buffer.from(prepared, 'utf8');
  let salted: Buffer | undefined, clientKey: Buffer | undefined, storedKey: Buffer | undefined, serverKey: Buffer | undefined;
  try {
    salted = await derive(input, salt, iterations, 32, 'sha256');
    clientKey = createHmac('sha256', salted).update('Client Key').digest();
    storedKey = createHash('sha256').update(clientKey).digest();
    serverKey = createHmac('sha256', salted).update('Server Key').digest();
    return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
  } finally {
    for (const bytes of [input, salted, clientKey, storedKey, serverKey]) bytes?.fill(0);
  }
}

function roleSql(draft: CredentialChange, verifier?: string): string {
  const password = verifier ? postgresDdlLiteral(verifier) : scramPlaceholder;
  if (draft.kind === 'password') return 'ALTER ROLE CURRENT_USER PASSWORD ' + password;
  const flags = [draft.auth === 'group' ? 'NOLOGIN' : 'LOGIN', draft.inherit ? 'INHERIT' : 'NOINHERIT',
    draft.createDatabase ? 'CREATEDB' : 'NOCREATEDB', draft.createRole ? 'CREATEROLE' : 'NOCREATEROLE',
    draft.superuser ? 'SUPERUSER' : 'NOSUPERUSER', draft.replication ? 'REPLICATION' : 'NOREPLICATION',
    draft.bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS', 'CONNECTION LIMIT ' + draft.connectionLimit];
  flags.push(draft.auth === 'password' ? 'PASSWORD ' + password : 'PASSWORD NULL');
  if (draft.validUntil) flags.push('VALID UNTIL ' + postgresDdlLiteral(draft.validUntil));
  return 'CREATE ROLE ' + postgresIdentifier(draft.name) + ' WITH\n  ' + flags.join('\n  ');
}

function scramIterations(value: unknown) {
  const iterations = value === null ? 4096 : Number(value);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100000)
    throw Error('服务器的 SCRAM 迭代次数超出客户端预算');
  return iterations;
}

/** 使用会话身份而非角色名执行轮换，避免同名角色替换后误改另一角色。 */
async function readPasswordTarget(connection: PostgresConnection, draft: PostgresRolePasswordDraft) {
  const result = await connection.query(`SELECT a.oid::text,a.rolname::text,d.oid::text,d.datname::text,
    extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
    pg_catalog.current_setting('scram_iterations',true),a.rolvaliduntil::text
    FROM pg_catalog.pg_roles a CROSS JOIN pg_catalog.pg_database d
    WHERE a.rolname=current_user AND a.rolname=session_user AND a.rolcanlogin AND d.datname=pg_catalog.current_database()`,
    undefined, budget(1));
  const row = result.rows[0];
  if (!row || result.truncated || row.c0 !== draft.role.oid || row.c1 !== draft.role.name || typeof row.c3 !== 'string')
    throw Error('角色已变化，或目标不是本连接的登录角色');
  return {actor: row.c1, database: row.c3, iterations: scramIterations(row.c5), stamp: JSON.stringify(row)};
}

async function readChangeTarget(connection: PostgresConnection, draft: RoleChange): Promise<Target> {
  if (draft.kind === 'attributes' || draft.kind === 'rename') {
    const managed = draft.kind === 'attributes' ? await prepareRoleAttributes(connection, draft) : await prepareRoleRename(connection, draft);
    return {actor: managed.actor, database: managed.database, iterations: 0, stamp: managed.stamp, managed};
  }
  if (draft.kind === 'password') return readPasswordTarget(connection, draft);
  const result = await connection.query(`SELECT a.oid::text,a.rolname::text,a.rolsuper,a.rolcreaterole,a.rolcreatedb,
    d.oid::text,d.datname::text,extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
    pg_catalog.current_setting('server_version_num')::int>=160000,
    pg_catalog.current_setting('scram_iterations',true),
    EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname::text COLLATE pg_catalog."C"=$1::text)
    FROM pg_catalog.pg_roles a CROSS JOIN pg_catalog.pg_database d
    WHERE a.rolname=current_user AND d.datname=pg_catalog.current_database()`, [draft.name], budget(1));
  const row = result.rows[0];
  if (!row || result.truncated || typeof row.c1 !== 'string' || typeof row.c6 !== 'string') throw Error('未确认 PostgreSQL 角色创建目标');
  if (row.c8 !== 't') throw Error('图形化角色创建需要 PostgreSQL 16 或以上版本');
  if (row.c10 !== 'f') throw Error('角色名称已存在，请重新选择');
  const superuser = row.c2 === 't';
  if (!superuser && row.c3 !== 't') throw Error('当前执行角色需要 CREATEROLE 权限');
  if (!superuser && (draft.superuser || draft.replication || draft.bypassRls)) throw Error('所选角色属性需要超级用户权限');
  if (!superuser && draft.createDatabase && row.c4 !== 't') throw Error('当前执行角色缺少 CREATEDB 权限');
  const iterations = draft.auth === 'password' ? scramIterations(row.c9) : 0;
  return {actor: row.c1, database: row.c6, iterations, stamp: JSON.stringify(row)};
}

async function verifyCreatedRole(connection: PostgresConnection, draft: PostgresRoleCreateDraft) {
  const result = await connection.query(`SELECT oid::text,rolcanlogin,rolinherit,rolcreatedb,rolcreaterole,rolsuper,
    rolreplication,rolbypassrls,rolconnlimit::text,extract(epoch FROM rolvaliduntil)::text
    FROM pg_catalog.pg_roles WHERE rolname::text COLLATE pg_catalog."C"=$1::text`, [draft.name], budget(1));
  const row = result.rows[0], flags = [draft.auth !== 'group', draft.inherit, draft.createDatabase, draft.createRole,
    draft.superuser, draft.replication, draft.bypassRls];
  if (!row || result.truncated || typeof row.c0 !== 'string' ||
      flags.some((flag, index) => row['c' + (index + 1)] !== (flag ? 't' : 'f')) || row.c8 !== String(draft.connectionLimit) ||
      (draft.validUntil ? row.c9 === null || Number(row.c9) !== Date.parse(draft.validUntil) / 1000 : row.c9 !== null))
    throw Error('服务器未返回预期角色属性');
  return {oid: row.c0, name: draft.name};
}

function changeSql(draft: RoleChange, target: Target, verifier?: string) {
  if (draft.kind === 'create' || draft.kind === 'password') return roleSql(draft, verifier);
  if (!target.managed) throw Error('未确认角色变更预览');
  return target.managed.sql;
}

/** 预览只保留非秘密属性。单次提交消费令牌并复核实际服务器与目录。 */
export class PostgresRoleChanges {
  private readonly plans = new Map<string, {draft: Scoped<RoleChange>; target: Awaited<ReturnType<typeof readChangeTarget>>; token: string; expires: number}>();
  private readonly pending = new Set<string>();

  async preview(draft: Scoped<RoleChange>, connect: Connect): Promise<PostgresRoleChangePreview> {
    const key = JSON.stringify([draft.owner, draft.connectionId]);
    if (this.pending.has(key)) throw Error('该连接已有角色变更操作');
    this.pending.add(key); this.plans.delete(key);
    try {
      let target: Awaited<ReturnType<typeof readChangeTarget>> | undefined;
      await connect(async connection => {
        await startPostgresDdl(connection, true);
        if (draft.kind === 'attributes' || draft.kind === 'rename') await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined, budget());
        target = await readChangeTarget(connection, draft);
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT')
          throw Error('未确认角色变更预览事务结束');
      });
      const now = Date.now();
      for (const [id, plan] of this.plans) if (plan.expires <= now) this.plans.delete(id);
      if (!target || this.plans.size >= 128) throw Error('角色变更预览暂不可用，请重试');
      const token = randomUUID();
      this.plans.set(key, {draft, target, token, expires: now + 300_000});
      return {token, actor: target.actor, database: target.database, sql: changeSql(draft, target)};
    } finally { this.pending.delete(key); }
  }

  async apply(kind: RoleChange['kind'], input: Scoped<PostgresRoleCreateApply>, connect: Connect): Promise<PostgresRoleChangeOutcome> {
    const key = JSON.stringify([input.owner, input.connectionId]), plan = this.plans.get(key);
    const operation = {password: '密码轮换', create: '角色创建', attributes: '角色属性修改', rename: '角色重命名'}[kind];
    if (this.pending.has(key) || !plan || plan.draft.kind !== kind || input.confirmed !== true || plan.token !== input.token || plan.expires <= Date.now() ||
        plan.draft.connectionRevision !== input.connectionRevision || plan.draft.database !== input.database)
      return {outcome: 'notSent', message: operation + '预览已失效，请重新预览'};
    this.plans.delete(key);
    if ((plan.draft.kind === 'password' || plan.draft.kind === 'create' && plan.draft.auth === 'password') !== (input.password !== undefined))
      return {outcome: 'notSent', message: '密码输入与预览中的认证方式不一致'};
    this.pending.add(key);
    let receipt: PostgresRoleChangeOutcome | undefined;
    try {
      await connect(async connection => {
        let sent = false, committing = false;
        try {
          await startPostgresDdl(connection, false);
          if (kind === 'attributes' || kind === 'rename') await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined, budget());
          const current = await readChangeTarget(connection, plan.draft);
          if (current.stamp !== plan.target.stamp) throw Error('服务器、角色权限或认证配置已变化，请重新预览');
          const verifier = input.password === undefined ? undefined : await postgresRoleScramVerifier(input.password, current.iterations);
          sent = true;
          const resultTag = kind === 'create' ? 'CREATE' : 'ALTER';
          if ((await connection.query(changeSql(plan.draft, current, verifier), undefined, budget(), undefined, 'extended')).postgresCommand !== resultTag)
            throw Error('服务器未确认' + operation);
          let role;
          if (plan.draft.kind === 'password') {
            if ((await readPasswordTarget(connection, plan.draft)).stamp !== current.stamp)
              throw Error('服务器未确认轮换目标保持一致');
            role = plan.draft.role;
          } else if (plan.draft.kind === 'create') role = await verifyCreatedRole(connection, plan.draft);
          else {
            if (!current.managed) throw Error('未确认角色变更预览');
            role = await verifyRoleAttributes(connection, current.managed);
          }
          committing = true;
          const result = await connection.query('COMMIT', undefined, budget()), state = connection.state();
          if (state.transactionKnown && !state.transactionOpen && result.postgresCommand === 'ROLLBACK') {
            receipt = {outcome: 'rolledBack', message: '服务器已回滚' + operation};
          } else {
            if (result.postgresCommand !== 'COMMIT' || !state.transactionKnown || state.transactionOpen) throw Error('服务器未确认角色提交');
            receipt = {outcome: 'committed', message: '服务器已确认' + operation, role};
          }
        } catch (reason) {
          // 角色变更的诊断可能携带验证值。发送后只交付固定消息和真实事务结果。
          const message = sent && (kind === 'create' || kind === 'password') ? '服务器未确认' + operation + '，请核对角色目录与执行权限' : connection.error(reason).message;
          let rolledBack = false;
          try {
            if (connection.state().transactionOpen)
              rolledBack = (await connection.query('ROLLBACK', undefined, budget())).postgresCommand === 'ROLLBACK' &&
                connection.state().transactionKnown && !connection.state().transactionOpen;
          } catch { /* 终态未知时保留原结果，禁止重放。 */ }
          receipt = {outcome: !sent ? 'notSent' : rolledBack || !committing && connection.state().transactionKnown &&
            !connection.state().transactionOpen ? 'rolledBack' : 'unknown', message};
        }
      }, true);
      return receipt!;
    } catch {
      return receipt ? {...receipt, message: receipt.message + '，连接收尾异常'} : {outcome: 'notSent', message: '连接未就绪，' + operation + '未发送'};
    } finally { this.pending.delete(key); }
  }

  clear(connectionId: string) {
    for (const [key, plan] of this.plans) if (plan.draft.connectionId === connectionId) this.plans.delete(key);
  }
  connectionIds() { return [...this.plans.values()].map(plan => plan.draft.connectionId); }
}
