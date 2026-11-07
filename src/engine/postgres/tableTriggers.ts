import type { PostgresStructureTrigger } from '../../shared/postgresStructure';
import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import type { PostgresTriggerChange, PostgresTriggerMode } from '../../shared/postgresTrigger';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { readPostgresStructureFacts } from './relationStructure';

const budget = () => ({ rows: 2, bytes: 1024 * 1024 });
const modeSql: Record<PostgresTriggerMode, string> = {
  O: 'ENABLE TRIGGER ', D: 'DISABLE TRIGGER ', R: 'ENABLE REPLICA TRIGGER ', A: 'ENABLE ALWAYS TRIGGER ',
};
// 位掩码与 PostgreSQL pg_trigger.h 中的事件、时机和级别一致。
const eventBits = { INSERT: 4, DELETE: 8, UPDATE: 16, TRUNCATE: 32 } as const;

type Create = Extract<PostgresTriggerChange, { kind: 'create' }>;
type Binding = { oid: string; argsHex: string };

/** 只解析已存在的零声明参数触发器函数。调用参数始终以 TG_ARGV 字符串传入。 */
async function bindTriggerFunction(connection: PostgresConnection, change: Create): Promise<Binding> {
  const args = change.args.map((_, index) =>
    "pg_catalog.encode(pg_catalog.convert_to($" + (index + 3) + "::text, pg_catalog.getdatabaseencoding()), 'hex') || '00'");
  const result = await connection.query(`
    SELECT p.oid::text, ${args.length ? args.join(' || ') : "''"}
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname::text COLLATE pg_catalog."C" = $1 AND p.proname::text COLLATE pg_catalog."C" = $2
      AND p.pronargs = 0 AND p.prokind = 'f' AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')
  `, [change.functionSchema, change.functionName, ...change.args], budget());
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row?.c0 !== 'string' || typeof row.c1 !== 'string')
    throw Error('未找到可执行的零声明参数函数，或该函数未返回 trigger');
  return { oid: row.c0, argsHex: row.c1 };
}

function createTriggerSql(table: string, change: Create) {
  const events = change.events.map(event => event === 'UPDATE' && change.updateOf.length
    ? 'UPDATE OF ' + change.updateOf.map(postgresIdentifier).join(', ') : event);
  const routine = postgresIdentifier(change.functionSchema) + '.' + postgresIdentifier(change.functionName);
  // 换行隔开尾部注释，函数名与触发参数使用各自的引用规则。
  return 'CREATE TRIGGER ' + postgresIdentifier(change.name) + ' ' + change.timing + ' ' + events.join(' OR ') +
    ' ON ' + table + ' FOR EACH ' + change.level + (change.condition ? ' WHEN (\n' + change.condition + '\n)' : '') +
    ' EXECUTE FUNCTION ' + routine + '(' + change.args.map(postgresDdlLiteral).join(', ') + ')';
}

/** 单表修改绑定原表与触发器目录，锁后重新核对，再比较实际目录与预期变化。 */
export async function postgresTableTriggerPlan(connection: PostgresConnection,
  draft: Extract<PostgresTableManageInput, { action: 'trigger' }>) {
  const original = await readPostgresStructureFacts(connection, draft.table);
  const { output } = original, { change } = draft;
  const changed = '原表或触发器已变化，请刷新结构后重试';
  if (output.kind !== 'r' || !output.triggers || output.database !== draft.database || output.editStamp !== draft.stamp) throw Error(changed);
  const table = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
  const target = change.kind === 'create' ? undefined : output.triggers.find(item => item.name === change.from);
  if (change.kind !== 'create' && (!target || target.internal || target.inherited || target.constraint))
    throw Error('所选触发器不存在或由约束、分区或 PostgreSQL 内部管理');
  if ('name' in change && output.triggers.some(item => item.name === change.name))
    throw Error('表中已有同名触发器');
  const positions = change.kind === 'create' ? change.updateOf.map(name => {
    const field = output.columns.find(column => column.name === name);
    if (!field) throw Error('UPDATE 字段不存在：' + name);
    return field.position;
  }) : [];
  const binding = change.kind === 'create' ? await bindTriggerFunction(connection, change) : undefined;
  let sql: string;
  switch (change.kind) {
    case 'create': sql = createTriggerSql(table, change); break;
    case 'rename': sql = 'ALTER TRIGGER ' + postgresIdentifier(change.from) + ' ON ' + table + ' RENAME TO ' + postgresIdentifier(change.name); break;
    case 'drop': sql = 'DROP TRIGGER ' + postgresIdentifier(change.from) + ' ON ' + table + ' RESTRICT'; break;
    case 'mode':
      if (target?.mode === change.mode) throw Error('触发模式没有变化');
      sql = 'ALTER TABLE ONLY ' + table + ' ' + modeSql[change.mode] + postgresIdentifier(change.from);
      break;
  }
  if (!connection.standardStrings) throw Error('触发器字符串模式未确认');
  await connection.query(sql, undefined, budget(), undefined, 'parse');

  function matchesCreated(trigger: PostgresStructureTrigger) {
    if (change.kind !== 'create' || !binding) return false;
    const bits = change.events.reduce((mask, event) => mask | eventBits[event],
      (change.timing === 'BEFORE' ? 2 : 0) | (change.level === 'ROW' ? 1 : 0));
    return trigger.name === change.name && trigger.mode === 'O' && trigger.functionOid === binding.oid &&
      !trigger.internal && !trigger.inherited && !trigger.constraint && trigger.eventBits === bits &&
      trigger.argsHex === binding.argsHex && trigger.conditional === !!change.condition &&
      trigger.updatePositions.length === positions.length && trigger.updatePositions.every((position, index) => position === positions[index]);
  }

  return {
    table, statements: [sql], protocol: 'extended' as const, readCommitted: true as const,
    lock: 'LOCK TABLE ONLY ' + table + ' IN ACCESS EXCLUSIVE MODE',
    success: 'PostgreSQL 触发器操作已确认提交',
    async preflight(current: PostgresConnection) {
      const actual = await readPostgresStructureFacts(current, table);
      if (actual.oid !== original.oid || actual.output.editStamp !== draft.stamp) throw Error(changed);
      if (change.kind === 'create') {
        const actualBinding = await bindTriggerFunction(current, change);
        if (actualBinding.oid !== binding?.oid || actualBinding.argsHex !== binding.argsHex)
          throw Error('触发器函数身份或参数编码已变化，请重新预览');
      }
      return draft.stamp;
    },
    async verify(current: PostgresConnection) {
      const actual = await readPostgresStructureFacts(current, table);
      const expected = new Map(output.triggers!.map(item => [item.oid, item]));
      if (change.kind === 'drop') expected.delete(target!.oid);
      if (change.kind === 'rename') expected.set(target!.oid, { ...target!, name: change.name });
      if (change.kind === 'mode') expected.set(target!.oid, { ...target!, mode: change.mode });
      const triggers = actual.output.triggers;
      if (actual.oid !== original.oid || !actual.output.editStamp || !triggers ||
          triggers.length !== expected.size + (change.kind === 'create' ? 1 : 0) ||
          !triggers.every(item => {
            const previous = expected.get(item.oid);
            return previous ? previous.name === item.name && previous.mode === item.mode && previous.signature === item.signature
              : matchesCreated(item);
          })) throw Error('实际触发器目录与预览不同，未提交');
    },
  };
}
