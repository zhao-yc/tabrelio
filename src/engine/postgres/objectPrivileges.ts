import { randomUUID } from 'node:crypto';
import { postgresDatabasePrivileges, postgresSchemaPrivileges, postgresTablePrivileges, type PostgresMembershipApply,
  type PostgresMembershipOutcome, type PostgresScopedPrivilegeDraft, type PostgresTablePrivilegeDraft, type PostgresTablePrivilegePreview } from '../../shared/postgresRoles';
import type { DataRow } from '../../shared/contracts';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';

type Scoped<T> = T & {owner: string; connectionRevision: number};
type Connect = <T>(work: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Draft = PostgresTablePrivilegeDraft | PostgresScopedPrivilegeDraft;
type Edge = {column: string | null; grantor: string; grantee: string; privilege: string; grantable: boolean};
const limit = 2048;
const budget = (rows = 0) => ({rows, bytes: 512 * 1024});
const changed = () => Error('对象、角色或原授权已变化，请重新检查对象权限');
const forbidden = () => Error('只有对象所有者或超级用户可以管理此对象的直接授权，所有者自身的权限不在此修改');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = ({column, grantor, grantee, privilege}: Edge) => JSON.stringify([column, grantor, grantee, privilege]);

async function readTableState(connection: PostgresConnection, draft: PostgresTablePrivilegeDraft) {
  const {role, table} = draft;
  const result = await connection.query(`SELECT actor.rolname::text,owner.rolname::text,owner.oid::text,actor.oid::text,
    d.oid::text,n.oid::text,c.relkind,c.relpersistence,extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
    pg_catalog.current_setting('server_version_num')::int>=170000,actor.rolsuper
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner
    JOIN pg_catalog.pg_roles actor ON actor.rolname=current_user
    JOIN pg_catalog.pg_roles recipient ON recipient.oid=$4::oid AND recipient.rolname::text COLLATE pg_catalog."C"=$5
    CROSS JOIN pg_catalog.pg_database d
    WHERE c.oid=$1::oid AND n.nspname::text COLLATE pg_catalog."C"=$2 AND c.relname::text COLLATE pg_catalog."C"=$3
      AND d.datname=pg_catalog.current_database() AND d.datname::text COLLATE pg_catalog."C"=$6
      AND c.relkind IN ('r','p','v') AND c.relpersistence<>'t' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`,
  [table.oid, table.schema, table.name, role.oid, role.name, draft.database], budget(1));
  const identity = result.rows[0];
  if (!identity || result.truncated || typeof identity.c0 !== 'string' || typeof identity.c1 !== 'string' || typeof identity.c2 !== 'string')
    throw changed();
  if (identity.c2 === role.oid || identity.c2 !== identity.c3 && identity.c10 !== 't')
    throw forbidden();
  if (draft.privileges.includes('MAINTAIN') && identity.c9 !== 't') throw Error('MAINTAIN 权限需要 PostgreSQL 17 或以上版本');
  const acl = await connection.query(`SELECT NULL::text,a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    WHERE c.oid=$1::oid
    UNION ALL
    SELECT col.attname::text,a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_attribute col CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE col.attrelid=$1::oid AND NOT col.attisdropped LIMIT ${limit + 1}`, [table.oid], budget(limit + 1));
  if (acl.truncated || acl.rows.length > limit) throw Error('该对象的授权记录超出预览上限');
  return {identity, actor: identity.c0, grantor: identity.c1, grantorOid: identity.c2, databaseOid: identity.c4,
    edges: readEdges(acl.rows), rowVersion: null, writtenHere: false};
}

function readEdges(rows: DataRow[]) {
  const edges = new Map<string, Edge>();
  for (const row of rows) {
    if (!(row.c0 === null || typeof row.c0 === 'string') || typeof row.c1 !== 'string' || typeof row.c2 !== 'string' ||
        typeof row.c3 !== 'string' || (row.c4 !== 't' && row.c4 !== 'f')) throw changed();
    const edge = {column: row.c0, grantor: row.c1, grantee: row.c2, privilege: row.c3, grantable: row.c4 === 't'};
    edges.set(keyOf(edge), edge);
  }
  if (edges.size !== rows.length) throw changed();
  return edges;
}

/** 数据库与 Schema 无法用 LOCK TABLE 锁定。用系统目录行版本验证实际写入来自本事务。 */
async function readScopedState(connection: PostgresConnection, draft: PostgresScopedPrivilegeDraft) {
  const {object, role} = draft;
  const database = object.kind === 'database';
  const target = database
    ? `SELECT d.oid,d.datname AS name,d.datdba AS owner,d.datacl AS acl,d.xmin
       FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database() AND NOT d.datistemplate`
    : `SELECT n.oid,n.nspname AS name,n.nspowner AS owner,n.nspacl AS acl,n.xmin
       FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`;
  const result = await connection.query(`WITH object AS (${target})
    SELECT NULL::text,acl.grantor::text,acl.grantee::text,acl.privilege_type,acl.is_grantable,
      actor.rolname::text,owner.rolname::text,owner.oid::text,actor.oid::text,d.oid::text,d.datdba::text,
      extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,actor.rolsuper,
      obj.xmin::text,obj.xmin=pg_catalog.pg_current_xact_id_if_assigned()::xid
    FROM object obj JOIN pg_catalog.pg_roles owner ON owner.oid=obj.owner
    JOIN pg_catalog.pg_roles actor ON actor.rolname=current_user
    JOIN pg_catalog.pg_roles recipient ON recipient.oid=$3::oid AND recipient.rolname::text COLLATE pg_catalog."C"=$4
    CROSS JOIN pg_catalog.pg_database d
    LEFT JOIN LATERAL pg_catalog.aclexplode(COALESCE(obj.acl,pg_catalog.acldefault(${database ? "'d'" : "'n'"},obj.owner))) acl ON true
    WHERE obj.oid=$1::oid AND obj.name::text COLLATE pg_catalog."C"=$2
      AND d.datname=pg_catalog.current_database() AND d.datname::text COLLATE pg_catalog."C"=$5
    LIMIT ${limit + 1}`, [object.oid, object.name, role.oid, role.name, draft.database], budget(limit + 1));
  if (result.truncated || result.rows.length > limit) throw Error('该对象的授权记录超出预览上限');
  const row = result.rows[0];
  if (!row || typeof row.c5 !== 'string' || typeof row.c6 !== 'string' || typeof row.c7 !== 'string' || typeof row.c13 !== 'string')
    throw changed();
  const implicitOwner = !database && row.c6 === 'pg_database_owner' && row.c8 === row.c10;
  if (row.c7 === role.oid || row.c7 !== row.c8 && row.c12 !== 't' && !implicitOwner) throw forbidden();
  return {identity: [row.c5, row.c6, row.c7, row.c8, row.c9, row.c10, row.c11, row.c12],
    actor: row.c5, grantor: row.c6, grantorOid: row.c7, databaseOid: row.c9, rowVersion: row.c13, writtenHere: row.c14 === 't',
    edges: readEdges(result.rows.filter(entry => entry.c1 !== null))};
}

function readState(connection: PostgresConnection, draft: Draft) {
  return 'table' in draft ? readTableState(connection, draft) : readScopedState(connection, draft);
}
type State = Awaited<ReturnType<typeof readState>>;
const edgeStamp = (edges: State['edges']) => [...edges.keys()].sort().map(key => [key, edges.get(key)!.grantable]);
const qualified = (table: PostgresTablePrivilegeDraft['table']) => postgresIdentifier(table.schema) + '.' + postgresIdentifier(table.name);

function prepare(draft: Draft, state: State) {
  const granting = draft.action === 'grant' || draft.action === 'grantOption';
  const available = 'table' in draft ? postgresTablePrivileges : draft.object.kind === 'database' ? postgresDatabasePrivileges : postgresSchemaPrivileges;
  const selection = new Set<string>(draft.privileges);
  const privileges = available.filter(value => selection.has(value));
  const target = 'table' in draft ? 'TABLE ' + qualified(draft.table) :
    draft.object.kind.toUpperCase() + ' ' + postgresIdentifier(draft.object.name);
  const expected = new Map(state.edges), columns: PostgresTablePrivilegePreview['columns'] = [];
  for (const privilege of privileges) {
    const edge = {column: null, grantor: state.grantorOid, grantee: draft.role.oid, privilege, grantable: draft.action === 'grantOption'};
    const key = keyOf(edge), original = state.edges.get(key);
    if (granting ? !!original && (original.grantable || !edge.grantable) : !original || draft.action === 'revokeOption' && !original.grantable)
      throw Error('所选权限没有对应的直接授权变化，请重新检查对象权限');
    if (granting) expected.set(key, edge);
    else {
      // PostgreSQL 的表级撤销也处理同来源的对应列权限，预览必须显示实际影响。
      for (const [key, item] of state.edges) {
        if (item.grantor !== edge.grantor || item.grantee !== edge.grantee || item.privilege !== privilege) continue;
        if (draft.action === 'revokeOption' && !item.grantable) continue;
        if (item.column !== null) columns.push({name: item.column, privilege});
        if (draft.action === 'revokeOption') expected.set(key, {...item, grantable: false});
        else expected.delete(key);
      }
    }
  }
  const recipient = postgresIdentifier(draft.role.name);
  const sql = granting
    ? `GRANT ${privileges.join(', ')} ON ${target} TO ${recipient}${draft.action === 'grantOption' ? ' WITH GRANT OPTION' : ''}`
    : `REVOKE ${draft.action === 'revokeOption' ? 'GRANT OPTION FOR ' : ''}${privileges.join(', ')} ON ${target} FROM ${recipient} RESTRICT`;
  return {expected, sql, columns};
}

async function finish(connection: PostgresConnection, command: 'COMMIT' | 'ROLLBACK') {
  const result = await connection.query(command, undefined, budget()), state = connection.state();
  return state.transactionKnown && !state.transactionOpen ? result.postgresCommand : undefined;
}

type Plan = {draft: Scoped<Draft>; state: State; expected: State['edges']; preview: PostgresTablePrivilegePreview; expires: number};
/** 预览绑定文档与原对象 OID。事务内锁定原对象并核验完整授权差异后才提交。 */
export class PostgresObjectPrivilegeChanges {
  private readonly plans = new Map<string, Plan>();
  private readonly pending = new Set<string>();

  async preview(draft: Scoped<Draft>, connect: Connect): Promise<PostgresTablePrivilegePreview> {
    const key = JSON.stringify([draft.owner, draft.connectionId]);
    if (this.pending.has(key)) throw Error('此连接已有对象权限操作');
    this.pending.add(key); this.plans.delete(key);
    try {
      const plan = await connect(async connection => {
        await startPostgresDdl(connection, true);
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined, budget());
        const state = await readState(connection, draft);
        const {expected, sql, columns} = prepare(draft, state);
        if (await finish(connection, 'COMMIT') !== 'COMMIT') throw Error('未确认权限预览只读事务结束');
        return {draft, state, expected, preview: {token: randomUUID(), sql, columns, actor: state.actor, grantor: state.grantor}, expires: Date.now() + 300_000};
      });
      for (const [id, item] of this.plans) if (item.expires <= Date.now()) this.plans.delete(id);
      if (this.plans.size >= 128) throw Error('对象权限预览已满，请重试');
      this.plans.set(key, plan);
      return plan.preview;
    } finally { this.pending.delete(key); }
  }

  async apply(target: 'table' | 'scope', input: Scoped<PostgresMembershipApply>, connect: Connect): Promise<PostgresMembershipOutcome> {
    const key = JSON.stringify([input.owner, input.connectionId]), plan = this.plans.get(key);
    if (this.pending.has(key) || !plan || plan.preview.token !== input.token || ('table' in plan.draft) !== (target === 'table') || !input.confirmed || plan.expires <= Date.now() ||
        plan.draft.database !== input.database || plan.draft.connectionRevision !== input.connectionRevision)
      return {outcome: 'notSent', message: '对象权限预览已失效，请重新预览'};
    this.plans.delete(key); this.pending.add(key);
    let receipt: PostgresMembershipOutcome | undefined;
    try {
      await connect(async connection => {receipt = await this.execute(connection, plan);}, true);
      return receipt!;
    } catch {
      return receipt ? {...receipt, message: receipt.message + '，连接收尾异常'} : {outcome: 'notSent', message: '连接未就绪，对象权限变更未发送'};
    } finally { this.pending.delete(key); }
  }

  private async execute(connection: PostgresConnection, {draft, state, expected, preview}: Plan): Promise<PostgresMembershipOutcome> {
    let sent = false, committing = false;
    try {
      await startPostgresDdl(connection, false);
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
      const before = await readState(connection, draft);
      if (!same(before.identity, state.identity) || before.rowVersion !== state.rowVersion ||
          !same(edgeStamp(before.edges), edgeStamp(state.edges))) throw changed();
      if ('table' in draft) {
        // ACCESS EXCLUSIVE 同时挡住并发授权及改名。普通视图遵循 PostgreSQL 的递归锁定。
        const lock = await connection.query('LOCK TABLE ONLY ' + qualified(draft.table) + ' IN ACCESS EXCLUSIVE MODE', undefined, budget());
        if (lock.postgresCommand !== 'LOCK') throw changed();
        const locked = await readTableState(connection, draft);
        const confirmedLock = await connection.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid()
          AND locktype='relation' AND database=$1::oid AND relation=$2::oid AND mode='AccessExclusiveLock' AND granted)`,
        [state.databaseOid, draft.table.oid], budget(1));
        if (confirmedLock.rows[0]?.c0 !== 't' || !same(locked.identity, state.identity) ||
            !same(edgeStamp(locked.edges), edgeStamp(state.edges))) throw changed();
      }
      sent = true;
      const result = await connection.query(preview.sql, undefined, budget(), undefined, 'extended');
      if (result.postgresCommand !== preview.sql.split(' ', 1)[0]) throw changed();
      const after = await readState(connection, draft);
      // 如果授权语句遇到同名替换，即使另一事务碰巧生成了相同 ACL，也不能冒充本次写入。
      if (!same(after.identity, state.identity) || !('table' in draft) && !after.writtenHere ||
          !same(edgeStamp(after.edges), edgeStamp(expected))) throw changed();
      committing = true;
      const tag = await finish(connection, 'COMMIT');
      if (tag === 'ROLLBACK') return {outcome: 'rolledBack', message: '服务器已回滚对象权限变更'};
      if (tag !== 'COMMIT') throw Error('对象权限提交未确认');
      return {outcome: 'committed', message: '服务器已确认对象权限变更'};
    } catch (reason) {
      const message = connection.error(reason).message;
      try {
        if (connection.state().transactionOpen && await finish(connection, 'ROLLBACK') === 'ROLLBACK')
          return {outcome: sent ? 'rolledBack' : 'notSent', message};
      } catch { /* 未确认原事务终态时禁止重放。 */ }
      return {outcome: !sent ? 'notSent' : !committing && connection.state().transactionKnown && !connection.state().transactionOpen
        ? 'rolledBack' : 'unknown', message};
    }
  }

  clear(connectionId: string) {
    for (const [key, plan] of this.plans) if (plan.draft.connectionId === connectionId) this.plans.delete(key);
  }
  connectionIds() { return [...this.plans.values()].map(plan => plan.draft.connectionId); }
}
