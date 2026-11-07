import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { readPostgresTableManageFacts } from './tableManage';

type Original = Awaited<ReturnType<typeof readPostgresTableManageFacts>>;
const limit = 512;
const changed = '原表、随迁对象或目标 schema 已变化，请重新预览';

/** 只读取 PostgreSQL 原生 SET SCHEMA 会移动的直接对象，不递归移动分区、视图或外键引用表。 */
async function readMoveObjects(connection: PostgresConnection, table: string) {
  const result = await connection.query(`WITH related(kind,oid,name,namespace,file) AS (
    SELECT 'table',c.oid,c.relname,c.relnamespace,c.relfilenode FROM pg_catalog.pg_class c WHERE c.oid=$1::oid
    UNION ALL
    SELECT 'index',c.oid,c.relname,c.relnamespace,c.relfilenode
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1::oid
    UNION ALL
    SELECT 'constraint',c.oid,c.conname,c.connamespace,NULL::oid FROM pg_catalog.pg_constraint c WHERE c.conrelid=$1::oid
    UNION ALL
    SELECT 'sequence',c.oid,c.relname,c.relnamespace,c.relfilenode
    FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class c ON c.oid=d.objid AND c.relkind='S'
    WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objsubid=0 AND d.refclassid='pg_catalog.pg_class'::regclass
      AND d.refobjid=$1::oid AND d.refobjsubid>0 AND d.deptype IN ('a','i')
    UNION ALL
    SELECT 'type',t.oid,t.typname,t.typnamespace,NULL::oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_type t ON t.oid=c.reltype WHERE c.oid=$1::oid
  )
  SELECT kind,oid::text,name::text,namespace::text,file::text FROM related ORDER BY kind,oid LIMIT ${limit + 1}`,
  [table], { rows: limit + 1, bytes: 256 * 1024 });
  if (result.truncated || result.rows.length > limit) throw Error('随迁对象目录超过 512 项预算');
  const objects = result.rows.map(row => {
    const { c0: kind, c1: oid, c2: name, c3: namespace, c4: file } = row;
    if (typeof kind !== 'string' || typeof oid !== 'string' || typeof name !== 'string' || typeof namespace !== 'string')
      throw Error('随迁对象目录回包不完整');
    return { kind, oid, name, namespace, file };
  });
  if (!objects.some(item => item.kind === 'table' && item.oid === table) || !objects.some(item => item.kind === 'type'))
    throw Error('未确认原表与行类型');
  return objects;
}

async function destinationNamespace(connection: PostgresConnection, schema: string, objects: Awaited<ReturnType<typeof readMoveObjects>>) {
  const relations = objects.filter(object => ['table', 'index', 'sequence'].includes(object.kind)).map(object => object.name);
  const type = objects.find(object => object.kind === 'type')!.name;
  const result = await connection.query(`SELECT n.oid::text,
    (SELECT c.relname::text FROM pg_catalog.pg_class c
      JOIN pg_catalog.jsonb_array_elements_text($2::jsonb) names(name) ON c.relname::text COLLATE pg_catalog."C"=names.name
      WHERE c.relnamespace=n.oid ORDER BY c.oid LIMIT 1),
    EXISTS(SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace=n.oid AND t.typname::text COLLATE pg_catalog."C"=$3)
    FROM pg_catalog.pg_namespace n WHERE n.nspname::text COLLATE pg_catalog."C"=$1
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid,'USAGE') AND pg_catalog.has_schema_privilege(n.oid,'CREATE')`,
  [schema, JSON.stringify(relations), type], { rows: 2, bytes: 8192 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string') throw Error('目标 schema 不存在或缺少 USAGE 和 CREATE 权限');
  if (typeof row.c1 === 'string') throw Error('目标 schema 已存在同名关系 ' + postgresIdentifier(row.c1));
  if (row.c2 !== 'f') throw Error('目标 schema 已存在同名类型 ' + postgresIdentifier(type));
  return row.c0;
}

/** 预览绑定两个 schema 的目录身份，提交前回读原 OID 与随迁对象的目标位置。 */
export async function postgresTableMovePlan(connection: PostgresConnection, original: Original,
  draft: Extract<PostgresTableManageInput, { action: 'move' }>) {
  const { schema, name } = postgresRelationName(draft.table);
  if (schema === draft.schema) throw Error('请选择不同的目标 schema');
  const objects = await readMoveObjects(connection, original.oid);
  if (objects.some(object => object.namespace !== original.namespace)) throw Error('原表的随迁对象与来源 schema 不一致');
  const namespace = await destinationNamespace(connection, draft.schema, objects);
  if (namespace === original.namespace) throw Error('请选择不同的目标 schema');
  const snapshot = JSON.stringify(objects);
  const expected = JSON.stringify(objects.map(object => ({ ...object, namespace })));
  const source = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const destination = postgresIdentifier(draft.schema);
  const names = (kind: string) => objects.filter(object => object.kind === kind).map(object => postgresIdentifier(object.name));
  return {
    table: destination + '.' + postgresIdentifier(name), protocol: 'extended' as const, success: 'PostgreSQL 表已确认移动',
    statements: ['ALTER TABLE ' + source + ' SET SCHEMA ' + destination],
    moveScope: { indexes: names('index'), constraints: names('constraint'), sequences: names('sequence') },
    async preflight(current: PostgresConnection) {
      const actual = await readPostgresTableManageFacts(current, schema, name);
      if (actual.stamp !== original.stamp || JSON.stringify(await readMoveObjects(current, original.oid)) !== snapshot ||
          await destinationNamespace(current, draft.schema, objects) !== namespace) throw Error(changed);
      return actual.stamp;
    },
    async verify(current: PostgresConnection) {
      const actual = await readPostgresTableManageFacts(current, draft.schema, name);
      if (actual.oid !== original.oid || actual.namespace !== namespace ||
          JSON.stringify(await readMoveObjects(current, original.oid)) !== expected)
        throw Error('未确认原表及随迁对象已移动到预览中的 schema');
    },
  };
}
