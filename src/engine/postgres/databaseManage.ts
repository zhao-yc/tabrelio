import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresDatabaseCatalog, PostgresDatabaseManageInput } from '../../shared/postgresDatabaseManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

const small = () => ({ rows: 2, bytes: 128 * 1024 });
const oid = z.string().regex(/^\d+$/);
const entry = z.object({
  oid, name: z.string(), owner: z.string(), ownerOid: oid, comment: z.string().nullable(), acl: z.string().nullable(),
  encoding: z.string(), collation: z.string(), ctype: z.string(), provider: z.string(), locale: z.string().nullable(),
  tablespace: oid, allowConnections: z.boolean(), connectionLimit: z.number().int(), template: z.boolean(), manageable: z.boolean(),
});
const context = z.object({ database: z.string(), oid, actor: oid, started: z.string(), canCreate: z.boolean(),
  maxNameBytes: z.number().int().positive(), entries: z.array(entry).max(2000) });
type Context = z.infer<typeof context>;
type Entry = z.infer<typeof entry>;

/** 在同一目录快照中读取维护库身份、连接角色和目标库可核对的属性。 */
async function databaseFacts(connection: PostgresConnection, maintenance: string, name?: string): Promise<Context> {
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('database', m.datname, 'oid', m.oid::text, 'actor', actor.oid::text,
      'started', pg_catalog.pg_postmaster_start_time()::text, 'canCreate', actor.rolsuper OR actor.rolcreatedb,
      'maxNameBytes', pg_catalog.current_setting('max_identifier_length')::int,
      'entries', COALESCE((SELECT pg_catalog.jsonb_agg(x.fact ORDER BY x.name COLLATE pg_catalog."C") FROM (
        SELECT d.datname::text AS name, pg_catalog.jsonb_build_object(
          'oid', d.oid::text, 'name', d.datname, 'owner', owner.rolname, 'ownerOid', d.datdba::text,
          'comment', pg_catalog.shobj_description(d.oid, 'pg_database'), 'acl', d.datacl::text,
          'encoding', pg_catalog.pg_encoding_to_char(d.encoding), 'collation', d.datcollate, 'ctype', d.datctype,
          'provider', COALESCE(pg_catalog.to_jsonb(d)->>'datlocprovider', 'c'),
          'locale', COALESCE(pg_catalog.to_jsonb(d)->>'datlocale', pg_catalog.to_jsonb(d)->>'daticulocale'),
          'tablespace', d.dattablespace::text, 'allowConnections', d.datallowconn, 'connectionLimit', d.datconnlimit,
          'template', d.datistemplate, 'manageable', pg_catalog.pg_has_role(d.datdba, 'USAGE')
        ) AS fact FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles owner ON owner.oid = d.datdba
        WHERE CASE WHEN $1::text IS NOT NULL THEN d.datname::text COLLATE pg_catalog."C" = $1
          ELSE d.datname IN ('template0', 'template1') OR pg_catalog.pg_has_role(d.datdba, 'USAGE')
            OR (d.datallowconn AND pg_catalog.has_database_privilege(d.oid, 'CONNECT')) END
        ORDER BY d.datname::text COLLATE pg_catalog."C" LIMIT 2001
      ) x), '[]'::jsonb))
    FROM pg_catalog.pg_database m CROSS JOIN pg_catalog.pg_roles actor
    WHERE m.datname = pg_catalog.current_database() AND actor.rolname = CURRENT_USER
  `, [name ?? null], { rows: 2, bytes: 4 * 1024 * 1024 });
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('PostgreSQL 数据库目录超过预算或回包不完整');
  const parsed = context.safeParse(JSON.parse(result.rows[0].c0));
  if (!parsed.success || parsed.data.database !== maintenance || connection.database !== maintenance)
    throw Error('PostgreSQL 数据库目录不完整或维护库已变化');
  return parsed.data;
}

function stamp(value: Context, selected?: Entry) {
  return createHash('sha256').update(JSON.stringify([value.oid, value.actor, value.started, value.canCreate, selected])).digest('hex');
}

export async function postgresDatabaseCatalog(connection: PostgresConnection, maintenance: string): Promise<PostgresDatabaseCatalog> {
  const data = await databaseFacts(connection, maintenance);
  return { database: maintenance, canCreate: data.canCreate, templates: data.entries.flatMap(item =>
    item.template && (item.name === 'template0' || item.name === 'template1')
      ? [{ name: item.name, encoding: item.encoding, collation: item.collation }] : []),
  databases: data.entries.filter(item => item.name !== 'template0' && item.name !== 'template1').map(item => ({
    name: item.name, owner: item.owner, comment: item.comment, encoding: item.encoding, collation: item.collation,
    allowConnections: item.allowConnections, connectionLimit: item.connectionLimit, template: item.template,
    manageable: item.manageable && !item.template, stamp: stamp(data, item),
  })) };
}

async function ownerOid(connection: PostgresConnection, owner: string) {
  const result = await connection.query('SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname::text COLLATE pg_catalog."C" = $1', [owner], small());
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string') throw Error('指定的数据库所有者不存在');
  return result.rows[0].c0;
}

/** 创建只有单条事务外 SQL。已有库操作先锁定共享对象，再在事务内核验身份和实际属性。 */
export async function postgresDatabasePlan(connection: PostgresConnection, input: PostgresDatabaseManageInput) {
  const { action, database } = input;
  const creating = input.action === 'create';
  const source = creating ? undefined : input.targetName;
  const name = input.action === 'create' || input.action === 'rename' ? input.name : input.targetName;
  const original = await databaseFacts(connection, database, creating ? input.template : input.targetName);
  const target = original.entries[0];
  const changed = '原数据库、模板或管理权限已变化，请重新读取目录';
  if (!target || (creating ? !target.template : !target.manageable || target.template || stamp(original, target) !== input.stamp)) throw Error(changed);
  if ((creating || action === 'owner' || action === 'rename') && !original.canCreate)
    throw Error('当前角色缺少 PostgreSQL CREATEDB 权限');
  const protectedName = source === 'postgres' || source === database || source === (connection.profile.database || 'postgres');
  if (input.action === 'rename' && protectedName) throw Error('维护库、默认连接库和 postgres 禁止在此处改名');
  if (input.action === 'settings' && !input.allowConnections && protectedName)
    throw Error('维护库、默认连接库和 postgres 必须允许连接');
  if (Buffer.byteLength(name) > original.maxNameBytes) throw Error('数据库名称超过服务器标识符长度');
  const newOwner = 'newOwner' in input ? input.newOwner : undefined;
  const owner = newOwner ? await ownerOid(connection, newOwner) : creating ? original.actor : target.ownerOid;
  const comment = input.action === 'comment' ? input.comment || null : target.comment;
  const allow = input.action === 'settings' ? input.allowConnections : creating ? true : target.allowConnections;
  const limit = input.action === 'settings' || input.action === 'create' ? input.connectionLimit : target.connectionLimit;
  if (action === 'owner' && owner === target.ownerOid || action === 'comment' && comment === target.comment ||
      action === 'settings' && allow === target.allowConnections && limit === target.connectionLimit) throw Error('数据库属性没有变化');
  const identifier = postgresIdentifier(source ?? name);
  // 只写用户改动的连接设置，避免覆盖预检后由其他会话修改的字段。
  const settings = [
    ...(allow !== target.allowConnections ? ['ALLOW_CONNECTIONS ' + (allow ? 'true' : 'false')] : []),
    ...(limit !== target.connectionLimit ? ['CONNECTION LIMIT ' + limit] : []),
  ];
  const sql = input.action === 'create' ? 'CREATE DATABASE ' + identifier + ' WITH TEMPLATE ' + postgresIdentifier(input.template) +
    (newOwner ? ' OWNER ' + postgresIdentifier(newOwner) : '') + ' CONNECTION LIMIT ' + limit
    : input.action === 'rename' ? 'ALTER DATABASE ' + identifier + ' RENAME TO ' + postgresIdentifier(name)
      : input.action === 'owner' ? 'ALTER DATABASE ' + identifier + ' OWNER TO ' + postgresIdentifier(input.newOwner)
        : input.action === 'settings' ? 'ALTER DATABASE ' + identifier + ' WITH ' + settings.join(' ')
          : 'COMMENT ON DATABASE ' + identifier + ' IS ' + (comment === null ? 'NULL' : postgresDdlLiteral(comment));
  const expected = stamp(original, target);
  return {
    table: name, statements: [sql], autocommit: creating, protocol: 'extended' as const, readCommitted: true as const,
    success: creating ? 'PostgreSQL 数据库已确认创建' : 'PostgreSQL 数据库属性已确认提交',
    async preflight(current: PostgresConnection) {
      if (source) {
        const locked = await current.query(`
          SELECT objid::text FROM pg_catalog.pg_get_object_address('database', ARRAY[$1::text], ARRAY[]::text[])
        `, [source], small());
        if (locked.truncated || locked.rows.length !== 1 || locked.rows[0].c0 !== target.oid) throw Error(changed);
      }
      const currentFacts = await databaseFacts(current, database, target.name);
      if (stamp(currentFacts, currentFacts.entries[0]) !== expected) throw Error(changed);
      if ((creating || action === 'rename') && (await databaseFacts(current, database, name)).entries.length)
        throw Error('目标名称已有同名数据库');
      if (newOwner && await ownerOid(current, newOwner) !== owner) throw Error('指定角色身份已变化，请重新预览');
      return expected;
    },
    async verify(current: PostgresConnection) {
      const actual = (await databaseFacts(current, database, name)).entries[0];
      if (!actual || (source && actual.oid !== target.oid) || actual.ownerOid !== owner ||
          actual.allowConnections !== allow || actual.connectionLimit !== limit ||
          actual.encoding !== target.encoding || actual.collation !== target.collation || actual.ctype !== target.ctype ||
          actual.provider !== target.provider || actual.locale !== target.locale || actual.tablespace !== target.tablespace ||
          actual.template !== (creating ? false : target.template) || (!creating && actual.comment !== comment) ||
          (!creating && action !== 'owner' && actual.acl !== target.acl))
        throw Error('实际数据库身份或属性与预览不同');
      if (creating) {
        const template = await databaseFacts(current, database, target.name);
        if (stamp(template, template.entries[0]) !== expected) throw Error('建库后模板身份待核对');
      }
    },
  };
}
