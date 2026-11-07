import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { readPostgresTableManageFacts } from './tableManage';

type Original = Awaited<ReturnType<typeof readPostgresTableManageFacts>>;
const maxObjects = 128;
const budget = () => ({ rows: maxObjects + 1, bytes: 128 * 1024 });
const changed = '清空范围或权限已变化，请重新预览';

/** 记录确切关系、物理存储和序列归属。目录读取不要求数据或序列 SELECT 权限。 */
async function truncateState(connection: PostgresConnection, original: Original, restart: boolean) {
  const members = original.kind === 'p' ?
    'SELECT relid::oid AS oid,parentrelid::oid AS parent,level FROM pg_catalog.pg_partition_tree($1::oid::regclass)' :
    'SELECT $1::oid AS oid,NULL::oid AS parent,0 AS level';
  const result = await connection.query(`SELECT c.oid::text,c.relfilenode::text,c.relkind,c.relpersistence,
    n.nspname::text,c.relname::text,pg_catalog.has_table_privilege(c.oid,'TRUNCATE'),m.parent::text
    FROM (${members}) m JOIN pg_catalog.pg_class c ON c.oid=m.oid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace ORDER BY m.level,c.oid LIMIT ${maxObjects + 1}`,
  [original.oid], budget());
  if (result.truncated || result.rows.length > maxObjects) throw Error('清空范围最多包含 128 张表');
  if (result.rows[0]?.c0 !== original.oid || !result.rows.some(row => row.c2 === 'r')) throw Error('清空范围内没有可核验的表存储');
  const tables = result.rows.map(row => {
    const { c0: oid, c1: file, c2: kind, c3: persistence, c4: schema, c5: name, c6: allowed, c7: parent } = row;
    if (typeof oid !== 'string' || !/^\d+$/.test(oid) || typeof file !== 'string' ||
        typeof schema !== 'string' || typeof name !== 'string' || kind !== 'r' && kind !== 'p' ||
        persistence !== 'p' && persistence !== 'u' || kind === 'r' && !/^[1-9]\d*$/.test(file))
      throw Error('清空范围包含不支持的关系或目录不完整');
    if (allowed !== 't') throw Error('当前角色缺少清空范围内的 TRUNCATE 权限');
    return { oid, file, kind, persistence, schema, name, parent };
  });
  const sequences = restart ? await ownedSequences(connection, tables.map(table => table.oid)) : [];
  const snapshot = JSON.stringify([
    tables.map(({ file: _file, ...table }) => table), sequences.map(({ file: _file, ...sequence }) => sequence),
  ]);
  const files = [...tables.filter(table => table.kind === 'r'), ...sequences].map(item => item.file);
  return { tables, sequences, snapshot, files };
}

async function ownedSequences(connection: PostgresConnection, tableIds: string[]) {
  const result = await connection.query(`SELECT s.oid::text,s.relfilenode::text,n.nspname::text,s.relname::text,
    d.refobjid::text,d.refobjsubid::text,p.seqstart::text,pg_catalog.pg_has_role(s.relowner,'USAGE')
    FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class s ON s.oid=d.objid AND s.relkind='S'
    JOIN pg_catalog.pg_namespace n ON n.oid=s.relnamespace JOIN pg_catalog.pg_sequence p ON p.seqrelid=s.oid
    WHERE d.refobjid=ANY($1::oid[]) AND d.classid='pg_catalog.pg_class'::regclass AND d.objsubid=0
      AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjsubid>0 AND d.deptype IN ('a','i')
    ORDER BY s.oid LIMIT ${maxObjects + 1}`, ['{' + tableIds.join(',') + '}'], budget());
  if (result.truncated || result.rows.length > maxObjects) throw Error('清空范围最多重置 128 个拥有的序列');
  return result.rows.map(row => {
    const { c0: oid, c1: file, c2: schema, c3: name, c4: table, c5: column, c6: start, c7: allowed } = row;
    if (typeof oid !== 'string' || typeof file !== 'string' || !/^[1-9]\d*$/.test(file) ||
        typeof schema !== 'string' || typeof name !== 'string') throw Error('拥有的序列目录不完整');
    if (allowed !== 't') throw Error('重置序列需要拥有清空范围内关联的序列');
    return { oid, file, schema, name, table, column, start };
  });
}

/** 分区表按完整子树清空。锁定后核对范围，提交前确认原表和序列的存储均已替换。 */
export async function postgresTableTruncatePlan(connection: PostgresConnection, original: Original,
  draft: Extract<PostgresTableManageInput, { action: 'truncate' }>) {
  const { schema, name } = postgresRelationName(draft.table);
  const qualify = ({ schema, name }: { schema: string; name: string }) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const table = qualify({ schema, name }), target = (original.kind === 'r' ? 'ONLY ' : '') + table;
  const restart = draft.identity === 'restart';
  const reviewed = await truncateState(connection, original, restart);
  let lockedFiles: string[] = [];
  return {
    table, protocol: 'extended' as const, success: 'PostgreSQL 清空数据已确认提交',
    lock: 'LOCK TABLE ' + target + ' IN ACCESS EXCLUSIVE MODE',
    statements: ['TRUNCATE TABLE ' + target + (restart ? ' RESTART IDENTITY' : ' CONTINUE IDENTITY') + ' RESTRICT'],
    truncateScope: { tables: reviewed.tables.map(qualify), sequences: reviewed.sequences.map(qualify) },
    async preflight(current: PostgresConnection) {
      const actual = await readPostgresTableManageFacts(current, schema, name);
      if (actual.stamp !== original.stamp) throw Error(changed);
      const state = await truncateState(current, original, restart);
      if (state.snapshot !== reviewed.snapshot) throw Error(changed);
      lockedFiles = state.files;
      return actual.stamp;
    },
    async verify(current: PostgresConnection) {
      const actual = await readPostgresTableManageFacts(current, schema, name);
      const state = await truncateState(current, original, restart);
      if (actual.stamp !== original.stamp || state.snapshot !== reviewed.snapshot ||
          state.files.length !== lockedFiles.length || state.files.some((file, index) => file === lockedFiles[index]))
        throw Error('未确认清空命中原表和预览中的序列');
    },
  };
}
