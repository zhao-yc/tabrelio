import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresSchemaCatalog, PostgresSchemaPreviewInput } from '../../shared/postgresSchemaManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

const small = () => ({ rows: 2, bytes: 128 * 1024 });
const oid = z.string().regex(/^\d+$/);
const factsSchema = z.object({
  oid, name: z.string(), owner: z.string(), ownerOid: oid,
  comment: z.string().nullable(), acl: z.string().nullable(), usage: z.boolean(), create: z.boolean(), manageable: z.boolean(),
});
const contextSchema = z.object({ database: z.string(), oid, started: z.string(), actor: oid,
  canCreate: z.boolean(), maxNameBytes: z.number().int().positive(), schemas: z.array(factsSchema).max(2000) });
type Context = z.infer<typeof contextSchema>;
type SchemaFacts = z.infer<typeof factsSchema>;

/** 一条目录查询固定数据库与 Schema 身份，列表不泄露当前角色不可访问的用户 Schema。 */
async function readSchemaFacts(connection: PostgresConnection, database: string, name?: string): Promise<Context> {
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('database', db.datname, 'oid', db.oid::text,
      'started', pg_catalog.pg_postmaster_start_time()::text, 'actor', actor.oid::text,
      'canCreate', pg_catalog.has_database_privilege(db.oid, 'CREATE'),
      'maxNameBytes', pg_catalog.current_setting('max_identifier_length')::int,
      'schemas', COALESCE((SELECT pg_catalog.jsonb_agg(s.entry ORDER BY s.name COLLATE pg_catalog."C") FROM (
        SELECT n.nspname::text AS name, pg_catalog.jsonb_build_object(
          'oid', n.oid::text, 'name', n.nspname, 'owner', owner.rolname, 'ownerOid', n.nspowner::text,
          'comment', pg_catalog.obj_description(n.oid, 'pg_namespace'), 'acl', n.nspacl::text,
          'usage', pg_catalog.has_schema_privilege(n.oid, 'USAGE'), 'create', pg_catalog.has_schema_privilege(n.oid, 'CREATE'),
          'manageable', pg_catalog.pg_has_role(n.nspowner, 'USAGE')
        ) AS entry FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles owner ON owner.oid = n.nspowner
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND
          (CASE WHEN $1::text IS NULL THEN pg_catalog.has_schema_privilege(n.oid, 'USAGE, CREATE')
             OR pg_catalog.pg_has_role(n.nspowner, 'USAGE') ELSE n.nspname::text COLLATE pg_catalog."C" = $1 END)
        ORDER BY n.nspname::text COLLATE pg_catalog."C" LIMIT 2001
      ) s), '[]'::jsonb))
    FROM pg_catalog.pg_database db CROSS JOIN pg_catalog.pg_roles actor
    WHERE db.datname = pg_catalog.current_database() AND actor.rolname = CURRENT_USER
  `, [name ?? null], { rows: 2, bytes: 4 * 1024 * 1024 });
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('PostgreSQL Schema 目录超过预算或回包不完整');
  const parsed = contextSchema.safeParse(JSON.parse(result.rows[0].c0));
  if (!parsed.success || parsed.data.database !== database || connection.database !== database)
    throw Error('PostgreSQL Schema 目录不完整或数据库已变化');
  return parsed.data;
}

function schemaStamp(context: Context, schema: SchemaFacts | undefined) {
  return createHash('sha256').update(JSON.stringify([context.oid, context.started, context.actor, context.canCreate, schema])).digest('hex');
}

export async function postgresSchemaCatalog(connection: PostgresConnection, database: string): Promise<PostgresSchemaCatalog> {
  const context = await readSchemaFacts(connection, database);
  return { database, canCreate: context.canCreate, schemas: context.schemas.map(schema => ({
    name: schema.name, owner: schema.owner, comment: schema.comment, usage: schema.usage, create: schema.create,
    manageable: schema.manageable, stamp: schemaStamp(context, schema),
  })) };
}

async function schemaOwner(connection: PostgresConnection, name: string) {
  const result = await connection.query('SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname::text COLLATE pg_catalog."C" = $1', [name], small());
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string') throw Error('指定的 Schema 所有者不存在');
  return result.rows[0].c0;
}

/** 用服务器对象锁保护原 OID，再核对目录。改名与删除还在提交前复核原 OID 和名称。 */
export async function postgresSchemaPlan(connection: PostgresConnection, input: PostgresSchemaPreviewInput) {
  const { database, action } = input;
  const source = input.action === 'create' ? undefined : input.schema;
  const original = await readSchemaFacts(connection, database, input.action === 'create' ? input.name : input.schema);
  const schema = original.schemas[0];
  const changed = '原 Schema、所有者或授权已变化，请刷新目录后重试';
  const destination = 'name' in input ? input.name : undefined;
  const name = destination ?? source!;
  if (source && (!schema?.manageable || !('stamp' in input) || schemaStamp(original, schema) !== input.stamp)) throw Error(changed);
  if (source === 'public' && (action === 'rename' || action === 'drop')) throw Error('public Schema 禁止改名或删除');
  if (action === 'create' || action === 'rename' || action === 'owner') {
    if (!original.canCreate) throw Error('当前角色缺少此数据库的 CREATE 权限');
  }
  if (destination && Buffer.byteLength(destination) > original.maxNameBytes) throw Error('Schema 名称超过服务器标识符长度');
  const comment = 'comment' in input ? input.comment || null : schema?.comment ?? null;
  const ownerName = 'newOwner' in input ? input.newOwner : undefined;
  const owner = ownerName ? await schemaOwner(connection, ownerName) : source ? schema.ownerOid : original.actor;
  if (action === 'owner' && owner === schema.ownerOid || action === 'comment' && comment === schema.comment) throw Error('Schema 属性没有变化');
  const identifier = postgresIdentifier(source ?? name);
  const commentSql = 'COMMENT ON SCHEMA ' + identifier + ' IS ' + (comment === null ? 'NULL' : postgresDdlLiteral(comment));
  const statements = input.action === 'create'
    ? ['CREATE SCHEMA ' + identifier + (ownerName ? ' AUTHORIZATION ' + postgresIdentifier(ownerName) : ''), ...(comment === null ? [] : [commentSql])]
    : input.action === 'rename' ? ['ALTER SCHEMA ' + identifier + ' RENAME TO ' + postgresIdentifier(input.name)]
      : input.action === 'owner' ? ['ALTER SCHEMA ' + identifier + ' OWNER TO ' + postgresIdentifier(input.newOwner)]
        : input.action === 'drop' ? ['DROP SCHEMA ' + identifier + ' RESTRICT'] : [commentSql];
  const stamp = schemaStamp(original, source ? schema : undefined);
  return {
    table: name, statements, protocol: 'extended' as const, readCommitted: true as const,
    success: 'PostgreSQL Schema 操作已确认提交',
    async preflight(current: PostgresConnection) {
      if (source) {
        // pg_get_object_address 持有原 Schema 的对象锁，阻止其在同一事务内被并发删除。
        const address = await current.query(`
          SELECT objid::text FROM pg_catalog.pg_get_object_address('schema', ARRAY[$1::text], ARRAY[]::text[])
        `, [source], small());
        if (address.truncated || address.rows.length !== 1 || address.rows[0].c0 !== schema.oid) throw Error(changed);
      }
      const actual = await readSchemaFacts(current, database, source ?? name);
      if (schemaStamp(actual, source ? actual.schemas[0] : undefined) !== stamp) throw Error(changed);
      if (destination && (source ? (await readSchemaFacts(current, database, destination)).schemas : actual.schemas).length)
        throw Error('目标名称已有同名 Schema');
      if (ownerName && await schemaOwner(current, ownerName) !== owner) throw Error('指定角色身份已变化，请重新预览');
      return stamp;
    },
    async verify(current: PostgresConnection) {
      if (action === 'drop') {
        const result = await current.query(`
          SELECT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE oid = $1::oid OR nspname::text COLLATE pg_catalog."C" = $2)
        `, [schema.oid, source!], small());
        if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f') throw Error('未确认原 Schema 已删除');
        return;
      }
      const actual = (await readSchemaFacts(current, database, name)).schemas[0];
      if (!actual || (source && actual.oid !== schema.oid) || actual.ownerOid !== owner || actual.comment !== comment ||
          (source && action !== 'owner' && actual.acl !== schema.acl)) throw Error('实际 Schema 身份或属性与预览不同');
    },
  };
}
