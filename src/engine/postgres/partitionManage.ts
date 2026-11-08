import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresPartitionBoundSql, validatePostgresPartitionBound } from '../../shared/postgresCreateTable';
import type { PostgresPartitionCatalog, PostgresPartitionManagePreview } from '../../shared/postgresPartitionManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import type { PostgresConnection } from './connection';
import { postgresTableOwnerLockSql } from './tableManage';

const oid = z.string().regex(/^\d+$/);
const childSchema = z.object({ oid, schema: z.string(), name: z.string(), kind: z.enum(['r', 'p', 'f']),
  bound: z.string(), pending: z.boolean() });
const parentSchema = z.object({ oid, namespace: oid, owner: oid, database: oid, actor: z.string(),
  started: z.string(), version: z.number().int(), keyDefinition: z.string(), strategy: z.enum(['r', 'l', 'h']),
  keys: z.array(z.string().nullable()).min(1).max(32), manageable: z.boolean(), maxName: z.number().int().positive(),
  children: z.array(childSchema).max(2000), schemas: z.array(z.string()).max(2000) });
const relationSchema = z.object({ oid, namespace: oid, owner: oid, kind: z.string(), persistence: z.string(),
  attached: z.boolean(), manageable: z.boolean(), inherits: z.boolean(), descendants: z.boolean() });
const strategies = { r: 'range', l: 'list', h: 'hash' } as const;
const changed = '原分区父表、子分区边界或目标表身份已变化，请刷新后重新预览';
const qualify = (schema: string, name: string) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 将父表身份、键定义和直接子分区读入同一目录快照。 */
async function parentFacts(connection: PostgresConnection, target: PostgresStructureInput, includeSchemas = false) {
  const { schema, name } = postgresRelationName(target.table);
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('oid', c.oid::text, 'namespace', n.oid::text, 'owner', c.relowner::text,
      'database', d.oid::text, 'actor', CURRENT_USER, 'started', pg_catalog.pg_postmaster_start_time()::text,
      'version', pg_catalog.current_setting('server_version_num')::int, 'maxName', pg_catalog.current_setting('max_identifier_length')::int,
      'manageable', ${postgresTableOwnerLockSql}, 'keyDefinition', pg_catalog.pg_get_partkeydef(c.oid), 'strategy', p.partstrat,
      'keys', (SELECT pg_catalog.jsonb_agg(a.attname ORDER BY k.position)
        FROM pg_catalog.unnest(p.partattrs) WITH ORDINALITY k(attnum, position)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum),
      'children', COALESCE((SELECT pg_catalog.jsonb_agg(item ORDER BY child_oid) FROM (
        SELECT ch.oid AS child_oid, pg_catalog.jsonb_build_object('oid', ch.oid::text, 'schema', ns.nspname, 'name', ch.relname,
          'kind', ch.relkind, 'bound', pg_catalog.pg_get_expr(ch.relpartbound, ch.oid),
          'pending', COALESCE((pg_catalog.to_jsonb(i)->>'inhdetachpending')::bool, false)) AS item
        FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class ch ON ch.oid=i.inhrelid
        JOIN pg_catalog.pg_namespace ns ON ns.oid=ch.relnamespace WHERE i.inhparent=c.oid ORDER BY ch.oid LIMIT 2001
      ) children), '[]'::jsonb),
      'schemas', COALESCE((SELECT pg_catalog.jsonb_agg(s.name ORDER BY s.name COLLATE pg_catalog."C") FROM (
        SELECT s.nspname::text AS name FROM pg_catalog.pg_namespace s WHERE $3::bool AND s.nspname !~ '^pg_'
          AND s.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(s.oid, 'USAGE')
          AND pg_catalog.has_schema_privilege(s.oid, 'CREATE') ORDER BY s.nspname::text COLLATE pg_catalog."C" LIMIT 2001
      ) s), '[]'::jsonb))
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_partitioned_table p ON p.partrelid=c.oid
    JOIN pg_catalog.pg_database d ON d.datname=pg_catalog.current_database()
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2 AND c.relkind='p'
      AND c.relpersistence IN ('p','u') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  `, [schema, name, includeSchemas], { rows: 2, bytes: 4 * 1024 * 1024 });
  const raw = result.rows[0]?.c0;
  if (connection.database !== target.database || result.truncated || result.rows.length !== 1 || typeof raw !== 'string')
    throw Error('分区父表不存在、目录超出预算或当前角色无法读取');
  return parentSchema.parse(JSON.parse(raw));
}

function stamp(facts: z.infer<typeof parentSchema>) {
  const { schemas: _schemas, ...identity } = facts;
  return digest(identity);
}

export async function postgresPartitionCatalog(connection: PostgresConnection, input: PostgresStructureInput): Promise<PostgresPartitionCatalog> {
  const facts = await parentFacts(connection, input, true);
  const { keyDefinition, keys, manageable, schemas, children } = facts;
  return { stamp: stamp(facts), strategy: strategies[facts.strategy], keyDefinition, keys, manageable, schemas,
    children: children.map(({ oid: _oid, ...child }) => child) };
}

async function relationFacts(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('oid', c.oid::text, 'namespace', n.oid::text, 'owner', c.relowner::text,
      'kind', c.relkind, 'persistence', c.relpersistence, 'attached', c.relispartition,
      'manageable', ${postgresTableOwnerLockSql},
      'inherits', EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid),
      'descendants', EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhparent=c.oid))
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
  `, [schema, name], { rows: 2, bytes: 128 * 1024 });
  if (result.truncated || result.rows.length > 1) throw Error('目标表目录回包不完整');
  const raw = result.rows[0]?.c0;
  return typeof raw === 'string' ? relationSchema.parse(JSON.parse(raw)) : undefined;
}

async function targetNamespace(connection: PostgresConnection, schema: string, creating: boolean) {
  const result = await connection.query(`SELECT n.oid::text FROM pg_catalog.pg_namespace n
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND (NOT $2::bool OR pg_catalog.has_schema_privilege(n.oid, 'CREATE'))
  `, [schema, creating], { rows: 2, bytes: 8192 });
  const value = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof value !== 'string') throw Error('目标 Schema 不存在或当前角色缺少权限');
  return value;
}

/** 锁住父表及已有目标表后复核目录，DETACH 保留独立关系及 OID。 */
export async function postgresPartitionManagePlan(connection: PostgresConnection, input: PostgresPartitionManagePreview) {
  const original = await parentFacts(connection, input);
  if (!original.manageable || stamp(original) !== input.stamp) throw Error(changed);
  if (original.children.some(child => child.pending)) throw Error('存在待完成的并发分离，请先处理后刷新目录');
  const creating = input.action === 'create', detaching = input.action === 'detach';
  const name = creating ? input.child.name : input.existingName;
  const { schema, name: parentName } = postgresRelationName(input.table);
  const parent = qualify(schema, parentName), child = qualify(input.schema, name);
  if (parent === child) throw Error('目标子分区不能是父表自身');
  if (Buffer.byteLength(name) > original.maxName) throw Error('子分区名称超过服务器标识符长度');
  const namespace = await targetNamespace(connection, input.schema, creating);
  const previous = await relationFacts(connection, input.schema, name);
  if (creating) {
    if (previous) throw Error('目标 Schema 已存在同名关系');
  } else {
    if (!previous?.manageable || (previous.kind !== 'r' && previous.kind !== 'p') ||
        (previous.persistence !== 'p' && previous.persistence !== 'u')) throw Error('目标表不存在、类型不受支持或当前角色无权管理');
    const direct = original.children.find(item => item.oid === previous.oid);
    if (detaching ? !direct || !previous.attached : previous.attached || previous.inherits || previous.kind === 'r' && previous.descendants)
      throw Error(detaching ? '目标表不是该父表的直接子分区' : '目标表已分区挂接或参与普通继承');
  }
  const bound = input.action === 'create' ? input.child : input.action === 'attach' ? input.bound : undefined;
  if (bound) {
    if (bound.kind === 'default' && (original.version < 110000 || original.children.some(item => item.bound === 'DEFAULT')))
      throw Error('默认分区已存在或目标 PostgreSQL 版本不支持');
    const bytes = validatePostgresPartitionBound(bound, strategies[original.strategy], original.keys.length, message => { throw Error(message); });
    if (bytes > 128 * 1024) throw Error('分区边界超过请求预算');
  }
  const sql = detaching ? 'ALTER TABLE ' + parent + ' DETACH PARTITION ' + child :
    (creating ? 'CREATE TABLE ' + child + ' PARTITION OF ' + parent : 'ALTER TABLE ' + parent + ' ATTACH PARTITION ' + child) +
      ' ' + postgresPartitionBoundSql(bound!);
  return {
    table: child, statements: [sql], protocol: 'extended' as const, readCommitted: true as const, statementTimeout: '120s' as const,
    lock: 'LOCK TABLE ONLY ' + parent + (previous ? ', ONLY ' + child : '') + ' IN ACCESS EXCLUSIVE MODE',
    success: detaching ? '子分区已分离，原独立表及数据保留' : '子分区已确认加入原父表',
    async preflight(current: PostgresConnection) {
      const actual = await parentFacts(current, input);
      if (stamp(actual) !== input.stamp || await targetNamespace(current, input.schema, creating) !== namespace ||
        digest(await relationFacts(current, input.schema, name) ?? null) !== digest(previous ?? null)) throw Error(changed);
      return input.stamp;
    },
    async verify(current: PostgresConnection) {
      const after = await parentFacts(current, input);
      const actual = await relationFacts(current, input.schema, name);
      if (after.oid !== original.oid || after.namespace !== original.namespace || after.keyDefinition !== original.keyDefinition ||
        !actual || actual.namespace !== namespace || (previous && actual.oid !== previous.oid))
        throw Error('父表或目标表的实际身份与预览不同');
      const direct = after.children.find(item => item.oid === actual.oid);
      if (detaching ? direct || actual.attached || actual.inherits :
        !direct || direct.pending || !actual.attached || (direct.bound === 'DEFAULT') !== (bound?.kind === 'default'))
        throw Error('实际分区挂接状态与预览不同');
    },
  };
}
