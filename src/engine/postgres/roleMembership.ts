import { randomUUID } from 'node:crypto';
import type { DataRow } from '../../shared/contracts';
import type { PostgresMembershipApply, PostgresMembershipDraft, PostgresMembershipOptions, PostgresMembershipOutcome, PostgresMembershipPreview, PostgresRoleRef } from '../../shared/postgresRoles';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';

type Scoped<T> = T & {owner: string; connectionRevision: number};
type Connect = (work: (connection: PostgresConnection) => Promise<void>, writing?: boolean) => Promise<void>;
type Edge = PostgresMembershipOptions & {oid: string; grantor: string};
const budget = (rows = 0) => ({rows, bytes: 64 * 1024});
const changed = () => Error('角色身份或直接授权已变化，请重新预览');
const flag = (value: unknown) => {
  if (value !== 't' && value !== 'f') throw Error('PostgreSQL 未确认成员关系选项');
  return value === 't';
};
const ref = (row: DataRow | undefined): PostgresRoleRef => {
  if (!row || typeof row.c0 !== 'string' || typeof row.c1 !== 'string') throw changed();
  return {oid: row.c0, name: row.c1};
};

async function readActor(connection: PostgresConnection) {
  const {rows: [row]} = await connection.query(`SELECT a.oid::text,a.rolname::text,a.rolsuper,session_user::text,
    d.oid::text,d.datname::text,extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
    pg_catalog.current_setting('server_version_num')::int>=160000
    FROM pg_catalog.pg_roles a CROSS JOIN pg_catalog.pg_database d
    WHERE a.rolname=current_user AND d.datname=pg_catalog.current_database()`, undefined, budget(1));
  const actor = ref(row);
  if (!flag(row.c7)) throw Error('成员授权需要 PostgreSQL 16 或以上版本');
  return {actor, superuser: flag(row.c2), login: String(row.c3), database: String(row.c5), server: [row.c4, row.c6]};
}

async function findRole(connection: PostgresConnection, name: string, oid?: string) {
  const result = await connection.query(`SELECT oid::text,rolname::text FROM pg_catalog.pg_roles
    WHERE rolname::text COLLATE pg_catalog."C"=$1::text AND ($2::oid IS NULL OR oid=$2::oid)`, [name, oid ?? null], budget(1));
  return ref(result.rows[0]);
}

/** 比较全部同向授权来源，避免把其他授权者的成员记录当成本次目标。 */
async function readState(connection: PostgresConnection, draft: PostgresMembershipDraft) {
  const context = await readActor(connection);
  const member = await findRole(connection, draft.member.name, draft.member.oid);
  const role = draft.action === 'grant' ? await findRole(connection, draft.roleName) : await findRole(connection, draft.role.name, draft.role.oid);
  if (member.oid === role.oid || [member.name, role.name].some(name => name === context.login || name === context.actor.name))
    throw Error('不能修改登录角色、当前角色或角色自身的成员关系');
  const grantor = draft.action === 'revoke'
    ? await findRole(connection, draft.grantor.name, draft.grantor.oid)
    : context.superuser
      ? ref((await connection.query('SELECT oid::text,rolname::text FROM pg_catalog.pg_roles WHERE oid=10', undefined, budget(1))).rows[0])
      : context.actor;
  const authorization = await connection.query(`SELECT r.rolsuper,
    EXISTS(SELECT FROM pg_catalog.pg_auth_members WHERE roleid=$1::oid AND member=$2::oid AND admin_option),
    pg_catalog.pg_has_role($3::oid,$2::oid,'USAGE')
    FROM pg_catalog.pg_roles r WHERE r.oid=$1::oid`, [role.oid, grantor.oid, context.actor.oid], budget(1));
  const rights = authorization.rows[0];
  if (!rights || !context.superuser && (flag(rights.c0) || !flag(rights.c2)) ||
      grantor.oid !== '10' && !flag(rights.c1)) throw Error('当前角色或所选授权者缺少所需 ADMIN 权限');
  const result = await connection.query(`SELECT oid::text,grantor::text,admin_option,inherit_option,set_option
    FROM pg_catalog.pg_auth_members WHERE roleid=$1::oid AND member=$2::oid ORDER BY grantor LIMIT 201`,
    [role.oid, member.oid], budget(201));
  if (result.truncated || result.rows.length > 200) throw Error('同一成员关系的授权来源超过处理上限');
  const edges: Edge[] = result.rows.map(row => ({oid: String(row.c0), grantor: String(row.c1), admin: flag(row.c2), inherit: flag(row.c3), set: flag(row.c4)}));
  return {...context, member, role, grantor, edges};
}
type State = Awaited<ReturnType<typeof readState>>;
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const optionsOf = ({admin, inherit, set}: PostgresMembershipOptions) => ({admin, inherit, set});

function prepare(draft: PostgresMembershipDraft, state: State) {
  const edge = state.edges.find(item => item.grantor === state.grantor.oid);
  const role = postgresIdentifier(state.role.name), member = postgresIdentifier(state.member.name), grantor = postgresIdentifier(state.grantor.name);
  if (draft.action === 'revoke') {
    if (!edge) throw changed();
    return {options: optionsOf(edge), sql: `REVOKE ${role} FROM ${member} GRANTED BY ${grantor} RESTRICT`};
  }
  if (edge) throw Error('此授权者已存在直接授权，请从对应成员记录查看或撤销');
  const options = optionsOf(draft.options);
  const sql = `GRANT ${role} TO ${member} WITH ADMIN ${options.admin}, INHERIT ${options.inherit}, SET ${options.set} GRANTED BY ${grantor}`;
  return {options, sql};
}

async function finish(connection: PostgresConnection, sql: 'COMMIT' | 'ROLLBACK') {
  const result = await connection.query(sql, undefined, budget());
  return result.postgresCommand === sql && connection.state().transactionKnown && !connection.state().transactionOpen;
}

/** 单次预览绑定文档、连接修订、实际后端和直接授权事实，确认不接受渲染进程提供的 SQL。 */
export class PostgresRoleMembership {
  private readonly plans = new Map<string, {draft: Scoped<PostgresMembershipDraft>; state: State; preview: PostgresMembershipPreview; expires: number}>();
  private readonly pending = new Set<string>();

  async preview(draft: Scoped<PostgresMembershipDraft>, connect: Connect): Promise<PostgresMembershipPreview> {
    const key = JSON.stringify([draft.owner, draft.connectionId]);
    if (this.pending.has(key)) throw Error('该连接已有成员关系操作');
    this.plans.delete(key);
    this.pending.add(key);
    try {
      let plan: {state: State; preview: PostgresMembershipPreview} | undefined;
      await connect(async connection => {
        await startPostgresDdl(connection, true);
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined, budget());
        const state = await readState(connection, draft), statement = prepare(draft, state);
        if (!await finish(connection, 'COMMIT')) throw Error('未确认预览只读事务结束');
        plan = {state, preview: {token: randomUUID(), database: state.database, actor: state.actor.name,
          action: draft.action, role: state.role, member: state.member, grantor: state.grantor, ...statement}};
      });
      const now = Date.now();
      for (const [id, item] of this.plans) if (item.expires <= now) this.plans.delete(id);
      if (!plan || this.plans.size >= 128) throw Error('成员关系预览暂不可用，请重试');
      this.plans.set(key, {draft, ...plan, expires: now + 300_000});
      return plan.preview;
    } finally { this.pending.delete(key); }
  }

  async apply(input: Scoped<PostgresMembershipApply>, connect: Connect): Promise<PostgresMembershipOutcome> {
    const key = JSON.stringify([input.owner, input.connectionId]), plan = this.plans.get(key);
    if (this.pending.has(key) || !plan || input.confirmed !== true || plan.preview.token !== input.token ||
        plan.expires <= Date.now() || plan.draft.database !== input.database || plan.draft.connectionRevision !== input.connectionRevision)
      return {outcome: 'notSent', message: '成员关系预览已失效，请重新预览'};
    this.plans.delete(key);
    this.pending.add(key);
    let receipt: PostgresMembershipOutcome | undefined;
    try {
      await connect(async connection => { receipt = await this.execute(connection, plan.draft, plan.state, plan.preview); }, true);
      return receipt!;
    } catch {
      return receipt ? {...receipt, message: receipt.message + '，连接收尾异常'} : {outcome: 'notSent', message: '连接未就绪，成员授权未发送'};
    } finally { this.pending.delete(key); }
  }

  private async execute(connection: PostgresConnection, draft: PostgresMembershipDraft, original: State, preview: PostgresMembershipPreview): Promise<PostgresMembershipOutcome> {
    let sent = false, committing = false;
    try {
      await startPostgresDdl(connection, false);
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
      if (original.superuser) {
        // 超级用户可用短目录锁防并发替换。普通 ADMIN 授权者沿服务器原生授权，并复核执行前后的目录。
        for (const sql of ['LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE', 'LOCK TABLE pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE'])
          if ((await connection.query(sql, undefined, budget())).postgresCommand !== 'LOCK') throw changed();
      }
      const current = await readState(connection, draft);
      if (!same(current, original) || prepare(draft, current).sql !== preview.sql) throw changed();
      sent = true;
      const result = await connection.query(preview.sql, undefined, budget(), undefined, 'extended');
      if (result.postgresCommand !== (draft.action === 'grant' ? 'GRANT' : 'REVOKE')) throw Error('服务器未返回预期的授权回执');
      const after = await readState(connection, draft);
      const untouched = (state: State) => state.edges.filter(item => item.grantor !== state.grantor.oid);
      if (!same({...after, edges: untouched(after)}, {...original, edges: untouched(original)})) throw changed();
      const edge = after.edges.find(item => item.grantor === after.grantor.oid);
      if (draft.action === 'grant' ? !edge || !same(optionsOf(edge), preview.options) : !!edge) throw changed();
      committing = true;
      const committed = await connection.query('COMMIT', undefined, budget());
      if (connection.state().transactionKnown && !connection.state().transactionOpen && committed.postgresCommand === 'ROLLBACK')
        return {outcome: 'rolledBack', message: '服务器已回滚成员关系变更'};
      if (committed.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('成员关系提交未确认');
      return {outcome: 'committed', message: '服务器已确认成员关系变更'};
    } catch (reason) {
      const message = connection.error(reason).message;
      try {
        if (connection.state().transactionOpen && await finish(connection, 'ROLLBACK'))
          return {outcome: sent ? 'rolledBack' : 'notSent', message};
      } catch { /* 无原事务终态时不重放授权。 */ }
      return {outcome: !sent ? 'notSent' : !committing && connection.state().transactionKnown && !connection.state().transactionOpen
        ? 'rolledBack' : 'unknown', message};
    }
  }

  clear(connectionId: string) {
    for (const [key, plan] of this.plans) if (plan.draft.connectionId === connectionId) this.plans.delete(key);
  }
  connectionIds() { return [...this.plans.values()].map(plan => plan.draft.connectionId); }
}
