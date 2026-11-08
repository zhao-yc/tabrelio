import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresRestoreTargetIssue, PostgresRestoreTargetPreview } from '../../shared/postgresSqlFile';
import type { PostgresConnection } from './connection';

const sampleLimit = 8;
const oid = z.string().regex(/^[1-9][0-9]*$/);
const factsSchema = z.object({
  database: z.string(), databaseOid: oid, ownerOid: oid, template: z.boolean(), encoding: z.string(),
  role: z.string(), roleOid: oid, canCreate: z.boolean(), readOnly: z.boolean(), fits: z.boolean(), exists: z.boolean(),
  server: z.string(), started: z.string(), address: z.string().nullable(), port: z.number().int().nullable(),
  relations: z.array(z.tuple([z.string(), z.string()])).max(sampleLimit + 1),
});

export interface PostgresRestoreTargetFacts {
  preview: Omit<PostgresRestoreTargetPreview, 'token'>;
  stamp: string;
  serverStamp: string;
  databaseOid: string;
  ownedByRole: boolean;
}

/** 只读目录确认连接到的库与角色。对象样本用于提示，身份校验时无需重复读取对象。 */
export async function readPostgresRestoreTarget(connection: PostgresConnection, database: string, newDatabase?: string,
  sample = false): Promise<PostgresRestoreTargetFacts> {
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object(
      'database', d.datname, 'databaseOid', d.oid::text, 'ownerOid', d.datdba::text,
      'template', d.datistemplate, 'encoding', pg_catalog.pg_encoding_to_char(d.encoding),
      'role', actor.rolname, 'roleOid', actor.oid::text, 'canCreate', actor.rolsuper OR actor.rolcreatedb,
      'readOnly', pg_catalog.pg_is_in_recovery() OR pg_catalog.current_setting('transaction_read_only') = 'on',
      'fits', COALESCE(pg_catalog.octet_length($1::text) <= pg_catalog.current_setting('max_identifier_length')::int, true),
      'exists', EXISTS (SELECT FROM pg_catalog.pg_database candidate WHERE candidate.datname::text COLLATE pg_catalog."C" = $1),
      'server', pg_catalog.current_setting('server_version'), 'started', extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
      'address', pg_catalog.host(pg_catalog.inet_server_addr()), 'port', pg_catalog.inet_server_port(),
      'relations', CASE WHEN $2::boolean THEN COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.ns, r.name) ORDER BY r.ns, r.name) FROM (
          SELECT n.nspname AS ns, c.relname AS name FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
            AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
          ORDER BY n.nspname, c.relname LIMIT ${sampleLimit + 1}
        ) r), '[]'::jsonb) ELSE '[]'::jsonb END
    )
    FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles actor
    WHERE d.datname = pg_catalog.current_database() AND actor.rolname = CURRENT_USER
  `, [newDatabase ?? null, sample && newDatabase === undefined], { rows: 2, bytes: 24 * 1024 });
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('无法完整读取 PostgreSQL 恢复目标');
  const facts = factsSchema.parse(JSON.parse(result.rows[0].c0));
  if (connection.database !== database || facts.database !== database) throw Error('PostgreSQL 恢复连接的实际数据库已变化');

  let issue: PostgresRestoreTargetIssue | undefined;
  if (facts.readOnly) issue = 'read-only';
  else if (facts.template) issue = 'template';
  else if (newDatabase !== undefined) {
    if (!facts.fits) issue = 'name-bytes';
    else if (facts.exists) issue = 'database-exists';
    else if (!facts.canCreate) issue = 'createdb';
  }
  const serverStamp = createHash('sha256').update(JSON.stringify([facts.started, facts.address, facts.port, facts.roleOid, facts.role])).digest('hex');
  const stamp = createHash('sha256').update(JSON.stringify([serverStamp, facts.databaseOid, facts.ownerOid, facts.encoding, database, newDatabase])).digest('hex');
  const address = facts.address && facts.port ? (facts.address.includes(':') ? '[' + facts.address + ']' : facts.address) + ':' + facts.port : undefined;
  return { stamp, serverStamp, databaseOid: facts.databaseOid, ownedByRole: facts.ownerOid === facts.roleOid, preview: {
    database, ...(newDatabase === undefined ? {} : { newDatabase }), ...(issue ? { issue } : {}),
    role: facts.role, server: facts.server, ...(address ? { address } : {}), encoding: facts.encoding,
    relations: facts.relations.slice(0, sampleLimit).map(([schema, name]) => postgresIdentifier(schema) + '.' + postgresIdentifier(name)),
    moreRelations: facts.relations.length > sampleLimit,
  } };
}
