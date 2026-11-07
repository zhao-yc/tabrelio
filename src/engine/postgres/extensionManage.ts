import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresExtensionCatalog, PostgresExtensionPreviewInput } from '../../shared/postgresExtensionManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

const small = () => ({ rows: 2, bytes: 128 * 1024 });
const oid = z.string().regex(/^\d+$/);
const nullableText = z.string().nullable();
const versionSchema = z.object({ version: z.string(), schema: nullableText, requires: z.array(z.string()),
  installable: z.boolean(), relocatable: z.boolean() });
const entrySchema = z.object({
  name: z.string(), description: nullableText, defaultVersion: nullableText,
  installed: z.object({ oid, ownerOid: oid, schemaOid: oid, version: z.string(), schema: z.string(),
    owner: z.string(), manageable: z.boolean(), relocatable: z.boolean() }).nullable(),
  versions: z.array(versionSchema).max(500),
  updates: z.array(z.object({ version: z.string(), path: z.string() })).max(500),
});
const schemaFacts = z.object({ oid, name: z.string() });
const contextSchema = z.object({
  database: z.string(), oid, actor: oid, started: z.string(),
  schemas: z.array(schemaFacts).max(2000), extensions: z.array(entrySchema).max(1000),
});
type Context = z.infer<typeof contextSchema>;
type Entry = z.infer<typeof entrySchema>;

const changed = '原扩展、版本文件目录或管理权限已变化，请刷新目录后重试';

/** 用一份目录快照合并已安装扩展和服务器提供的版本，保留已安装但缺少控制文件的扩展。 */
async function readFacts(connection: PostgresConnection, database: string, name?: string): Promise<Context> {
  const result = await connection.query(`
    WITH available AS (
      SELECT a.name, a.default_version, a.comment FROM pg_catalog.pg_available_extensions a
      WHERE $1::text IS NULL OR a.name::text COLLATE pg_catalog."C" = $1
    ), installed AS (
      SELECT e.*, n.nspname, r.rolname FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace JOIN pg_catalog.pg_roles r ON r.oid = e.extowner
      WHERE $1::text IS NULL OR e.extname::text COLLATE pg_catalog."C" = $1
    ), versions AS (
      SELECT v.* FROM pg_catalog.pg_available_extension_versions v
      WHERE $1::text IS NULL OR v.name::text COLLATE pg_catalog."C" = $1
    ), db AS (
      SELECT d.oid, d.datname, r.oid AS actor, r.rolsuper,
        pg_catalog.has_database_privilege(d.oid, 'CREATE') AS can_create
      FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles r
      WHERE d.datname = pg_catalog.current_database() AND r.rolname = CURRENT_USER
    )
    SELECT pg_catalog.jsonb_build_object(
      'database', db.datname, 'oid', db.oid::text, 'actor', db.actor::text,
      'started', pg_catalog.pg_postmaster_start_time()::text,
      'schemas', COALESCE((SELECT pg_catalog.jsonb_agg(n.item ORDER BY n.name COLLATE pg_catalog."C") FROM (
        SELECT s.nspname::text AS name, pg_catalog.jsonb_build_object('name', s.nspname, 'oid', s.oid::text) AS item
        FROM pg_catalog.pg_namespace s WHERE $1::text IS NULL AND s.nspname !~ '^pg_' AND s.nspname <> 'information_schema'
          AND pg_catalog.has_schema_privilege(s.oid, 'CREATE')
        ORDER BY s.nspname::text COLLATE pg_catalog."C" LIMIT 2001
      ) n), '[]'::jsonb),
      'extensions', COALESCE((SELECT pg_catalog.jsonb_agg(x.item ORDER BY x.name COLLATE pg_catalog."C") FROM (
        SELECT COALESCE(a.name, e.extname)::text AS name, pg_catalog.jsonb_build_object(
          'name', COALESCE(a.name, e.extname), 'defaultVersion', a.default_version, 'description', a.comment,
          'installed', CASE WHEN e.oid IS NOT NULL THEN pg_catalog.jsonb_build_object(
            'oid', e.oid::text, 'ownerOid', e.extowner::text, 'schemaOid', e.extnamespace::text,
            'owner', e.rolname, 'schema', e.nspname, 'version', e.extversion, 'relocatable', e.extrelocatable,
            'manageable', e.extname <> 'plpgsql' AND pg_catalog.pg_has_role(e.extowner, 'USAGE')) END,
          'versions', COALESCE((SELECT pg_catalog.jsonb_agg(y.item ORDER BY y.version COLLATE pg_catalog."C") FROM (
            SELECT v.version, pg_catalog.jsonb_build_object(
              'version', v.version, 'schema', v.schema, 'requires', COALESCE(pg_catalog.to_jsonb(v.requires), '[]'::jsonb),
              'relocatable', v.relocatable, 'installable', v.name <> 'plpgsql' AND (db.rolsuper OR
                (db.can_create AND (NOT v.superuser OR COALESCE((pg_catalog.to_jsonb(v)->>'trusted')::bool, false))))) AS item
            FROM versions v WHERE v.name = a.name ORDER BY v.version COLLATE pg_catalog."C" LIMIT 501
          ) y), '[]'::jsonb),
          'updates', CASE WHEN e.oid IS NOT NULL AND a.name IS NOT NULL THEN
            COALESCE((SELECT pg_catalog.jsonb_agg(p.item ORDER BY p.target COLLATE pg_catalog."C") FROM (
              SELECT p.target, pg_catalog.jsonb_build_object('version', p.target, 'path', p.path) AS item
              FROM pg_catalog.pg_extension_update_paths(a.name) p
              WHERE p.source COLLATE pg_catalog."C" = e.extversion AND p.path IS NOT NULL
              ORDER BY p.target COLLATE pg_catalog."C" LIMIT 501
            ) p), '[]'::jsonb) ELSE '[]'::jsonb END
        ) AS item FROM available a FULL JOIN installed e ON a.name = e.extname
        ORDER BY COALESCE(a.name, e.extname)::text COLLATE pg_catalog."C" LIMIT 1001
      ) x), '[]'::jsonb)) FROM db
  `, [name ?? null], { rows: 2, bytes: 4 * 1024 * 1024 });
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('PostgreSQL 扩展目录超过预算或回包不完整');
  const parsed = contextSchema.safeParse(JSON.parse(result.rows[0].c0));
  if (!parsed.success || parsed.data.database !== database || connection.database !== database)
    throw Error('PostgreSQL 扩展目录不完整或数据库已变化');
  return parsed.data;
}

function stamp(context: Context, entry: Entry) {
  return createHash('sha256').update(JSON.stringify([context.oid, context.actor, context.started, entry])).digest('hex');
}

export async function postgresExtensionCatalog(connection: PostgresConnection, database: string): Promise<PostgresExtensionCatalog> {
  const context = await readFacts(connection, database);
  return {
    schemas: context.schemas.map(item => item.name),
    extensions: context.extensions.map(entry => {
      const { name, description, defaultVersion, installed, versions, updates } = entry;
      return { name, description, defaultVersion, versions, updates, stamp: stamp(context, entry), installed: installed && {
        version: installed.version, schema: installed.schema, owner: installed.owner, manageable: installed.manageable,
        relocatable: installed.relocatable,
      } };
    }),
  };
}

async function schemaOid(connection: PostgresConnection, schema: string) {
  const result = await connection.query(`SELECT oid::text FROM pg_catalog.pg_namespace
    WHERE nspname::text COLLATE pg_catalog."C" = $1 AND pg_catalog.has_schema_privilege(oid, 'CREATE')`, [schema], small());
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('目标 Schema 不存在或当前角色缺少 CREATE 权限');
  return result.rows[0].c0;
}

async function lockObject(connection: PostgresConnection, type: 'extension' | 'schema', name: string, identity: string) {
  const result = await connection.query(`SELECT objid::text
    FROM pg_catalog.pg_get_object_address($1::text, ARRAY[$2::text], ARRAY[]::text[])`, [type, name], small());
  if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== identity) throw Error(changed);
}

/** 原生 RESTRICT 仍会移除显式依赖扩展的例程。此处保守地拒绝存在自动依赖的卸载。 */
async function dropMembers(connection: PostgresConnection, id: string) {
  const result = await connection.query(`
    SELECT classid::text, objid::text, objsubid::text, deptype::text FROM pg_catalog.pg_depend
    WHERE refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND refobjid = $1::oid
      AND deptype IN ('e', 'x')
    ORDER BY classid, objid, objsubid, deptype LIMIT 10001
  `, [id], { rows: 10001, bytes: 2 * 1024 * 1024 });
  if (result.truncated || result.rows.length > 10000) throw Error('扩展成员超过可安全核对的预算');
  if (result.rows.some(row => row.c3 === 'x')) throw Error('存在显式依赖扩展的对象，卸载可能同时删除这些对象');
  return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
}

/** 在同一事务中锁定原扩展或目标 Schema，核对版本路径并验证提交前的目录终态。 */
export async function postgresExtensionPlan(connection: PostgresConnection, input: PostgresExtensionPreviewInput) {
  const { action, name, database } = input;
  const original = await readFacts(connection, database, name);
  const selected = original.extensions[0], previous = selected?.installed;
  if (!selected || stamp(original, selected) !== input.stamp || name === 'plpgsql') throw Error(changed);
  if (action === 'install' ? !!previous : !previous?.manageable) throw Error('扩展已安装或当前角色无权管理');
  const version = 'version' in input ? selected.versions.find(item => item.version === input.version) : undefined;
  const path = input.action === 'update' ? selected.updates.find(item => item.version === input.version) : undefined;
  if (input.action === 'install' && (!version?.installable || version.schema && version.schema !== input.schema))
    throw Error('扩展版本、安装权限或固定 Schema 与服务器目录不符');
  if (input.action === 'update' && !path) throw Error('服务器没有从当前版本到目标版本的更新路径');
  if (input.action === 'move' && (!previous?.relocatable || previous.schema === input.schema))
    throw Error('扩展无法移动到所选 Schema');
  const destination = 'schema' in input ? await schemaOid(connection, input.schema) : previous?.schemaOid;
  const members = action === 'drop' ? await dropMembers(connection, previous!.oid) : undefined;
  const id = postgresIdentifier(name);
  const sql = input.action === 'install' ? 'CREATE EXTENSION ' + id + ' WITH SCHEMA ' + postgresIdentifier(input.schema) +
    ' VERSION ' + postgresDdlLiteral(input.version)
    : input.action === 'update' ? 'ALTER EXTENSION ' + id + ' UPDATE TO ' + postgresDdlLiteral(input.version)
      : input.action === 'move' ? 'ALTER EXTENSION ' + id + ' SET SCHEMA ' + postgresIdentifier(input.schema)
        : 'DROP EXTENSION ' + id + ' RESTRICT';
  return {
    table: name, statements: [sql], protocol: 'extended' as const, readCommitted: true as const,
    success: 'PostgreSQL 扩展操作已确认提交',
    ...(action === 'drop' ? { dropConfirmation: name } : {}),
    async preflight(current: PostgresConnection) {
      if (previous) await lockObject(current, 'extension', name, previous.oid);
      if ('schema' in input) {
        await lockObject(current, 'schema', input.schema, destination!);
        if (await schemaOid(current, input.schema) !== destination) throw Error(changed);
      }
      const facts = await readFacts(current, database, name);
      const actual = facts.extensions[0];
      if (!actual || stamp(facts, actual) !== input.stamp ||
        (members && await dropMembers(current, previous!.oid) !== members)) throw Error(changed);
      return input.stamp;
    },
    async verify(current: PostgresConnection) {
      const result = await current.query(`
        SELECT oid::text, extnamespace::text, extowner::text, extversion
        FROM pg_catalog.pg_extension WHERE extname::text COLLATE pg_catalog."C" = $1 OR oid = $2::oid
      `, [name, previous?.oid ?? null], small());
      if (result.truncated) throw Error('扩展终态不完整');
      if (action === 'drop' && result.rows.length === 0) return;
      const actual = result.rows[0];
      if (action === 'drop' || result.rows.length !== 1 || !actual ||
          (previous && actual.c0 !== previous.oid) || actual.c1 !== destination ||
          actual.c2 !== (previous?.ownerOid ?? original.actor) ||
          actual.c3 !== ('version' in input ? input.version : previous?.version))
        throw Error('实际扩展身份、Schema 或版本与预览不同');
    },
  };
}
