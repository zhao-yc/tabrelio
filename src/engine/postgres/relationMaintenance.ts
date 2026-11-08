import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  postgresRelationMaintenanceSql, type PostgresRelationMaintenanceCatalog, type PostgresRelationMaintenancePreview,
} from '../../shared/postgresRelationMaintenance';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import type { PostgresConnection } from './connection';

const oid = z.string().regex(/^\d+$/);
const indexSchema = z.object({ oid, name: z.string(), file: oid, valid: z.boolean(), ready: z.boolean(), live: z.boolean() });
const factsSchema = z.object({
  oid, namespace: oid, file: oid, owner: oid, database: oid, actor: z.string(), started: z.string(), version: z.number().int(),
  kind: z.enum(['r', 'm']), populated: z.boolean(), hasChildren: z.boolean(), maintain: z.boolean(), databaseOwner: z.boolean(),
  lockable: z.boolean(), vacuumGuard: z.boolean(), indexes: z.array(indexSchema).max(2000),
});
const statsSchema = z.object({
  lastVacuum: z.string().nullable(), lastAnalyze: z.string().nullable(), vacuumCount: oid, analyzeCount: oid,
});
type Facts = z.infer<typeof factsSchema>;
const stamp = (value: Facts) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed = '原关系、索引或维护权限已变化，请刷新后重新预览';

function actions(facts: Facts): PostgresRelationMaintenanceCatalog['actions'] {
  const physical = facts.populated && !facts.hasChildren;
  const statistics = physical && (facts.maintain || facts.databaseOwner);
  const vacuum = statistics && facts.vacuumGuard && facts.version >= 120000;
  return { analyze: statistics && facts.lockable, vacuum, vacuumAnalyze: vacuum,
    reindex: physical && facts.maintain && facts.lockable && facts.indexes.length > 0 && facts.indexes.every(index => index.live) };
}

/** 维护资格、对象身份、索引文件和统计快照在同一条只读目录查询中取回。 */
async function readFacts(connection: PostgresConnection, input: PostgresStructureInput) {
  const { schema, name } = postgresRelationName(input.table);
  const result = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('oid', c.oid::text, 'namespace', n.oid::text,
      'file', pg_catalog.pg_relation_filenode(c.oid)::text, 'owner', c.relowner::text, 'database', d.oid::text,
      'actor', CURRENT_USER, 'started', pg_catalog.pg_postmaster_start_time()::text, 'version', v.number,
      'kind', c.relkind, 'populated', c.relispopulated, 'hasChildren', EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhparent=c.oid),
      'maintain', capability.maintain, 'databaseOwner', pg_catalog.pg_has_role(d.datdba, 'USAGE'),
      'lockable', CASE WHEN c.relkind='m' THEN pg_catalog.has_table_privilege(c.oid,'SELECT') ELSE
        capability.maintain AND v.number >= 170000 OR pg_catalog.has_table_privilege(c.oid,'UPDATE, DELETE, TRUNCATE') END,
      'vacuumGuard', pg_catalog.has_table_privilege(c.oid,'SELECT') OR (c.relkind='r' AND
        (capability.maintain AND v.number >= 170000 OR pg_catalog.has_table_privilege(c.oid,'INSERT, UPDATE, DELETE, TRUNCATE'))),
      'indexes', COALESCE((SELECT pg_catalog.jsonb_agg(i.item ORDER BY i.oid) FROM (
        SELECT ic.oid, pg_catalog.jsonb_build_object('oid', ic.oid::text, 'name', ic.relname,
          'file', pg_catalog.pg_relation_filenode(ic.oid)::text, 'valid', idx.indisvalid,
          'ready', idx.indisready, 'live', idx.indislive) AS item
        FROM pg_catalog.pg_index idx JOIN pg_catalog.pg_class ic ON ic.oid=idx.indexrelid
        WHERE idx.indrelid=c.oid AND ic.relkind='i' ORDER BY ic.oid LIMIT 2001
      ) i), '[]'::jsonb)),
      pg_catalog.jsonb_build_object('lastVacuum', pg_catalog.pg_stat_get_last_vacuum_time(c.oid)::text,
        'lastAnalyze', pg_catalog.pg_stat_get_last_analyze_time(c.oid)::text,
        'vacuumCount', pg_catalog.pg_stat_get_vacuum_count(c.oid)::text,
        'analyzeCount', pg_catalog.pg_stat_get_analyze_count(c.oid)::text)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_database d ON d.datname=pg_catalog.current_database()
    CROSS JOIN LATERAL (SELECT pg_catalog.current_setting('server_version_num')::int AS number) v
    CROSS JOIN LATERAL (SELECT CASE WHEN v.number >= 170000 THEN pg_catalog.has_table_privilege(c.oid,'MAINTAIN')
      ELSE pg_catalog.pg_has_role(c.relowner,'USAGE') END AS maintain) capability
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
      AND c.relkind IN ('r','m') AND c.relpersistence IN ('p','u')
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid,'USAGE')
      AND (capability.maintain OR pg_catalog.pg_has_role(d.datdba,'USAGE') OR pg_catalog.has_table_privilege(c.oid,'SELECT'))
  `, [schema, name], { rows: 2, bytes: 2 * 1024 * 1024 });
  const row = result.rows[0];
  if (connection.database !== input.database || result.truncated || result.rows.length !== 1 ||
      typeof row.c0 !== 'string' || typeof row.c1 !== 'string') throw Error('原关系不存在、权限变化或维护目录超出预算');
  return { facts: factsSchema.parse(JSON.parse(row.c0)), stats: statsSchema.parse(JSON.parse(row.c1)) };
}

export async function postgresRelationMaintenanceCatalog(connection: PostgresConnection, input: PostgresStructureInput): Promise<PostgresRelationMaintenanceCatalog> {
  const { facts, stats } = await readFacts(connection, input);
  return { ...stats, stamp: stamp(facts), actions: actions(facts), indexes: facts.indexes.map(({ name, valid }) => ({ name, valid })) };
}

/** 分析与重建先锁定原物理关系，VACUUM 必须在事务外发送并复核对象身份。 */
export async function postgresRelationMaintenancePlan(connection: PostgresConnection, input: PostgresRelationMaintenancePreview) {
  const { schema, name } = postgresRelationName(input.table), { action } = input;
  const table = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const { facts } = await readFacts(connection, input);
  if (!actions(facts)[action] || stamp(facts) !== input.stamp) throw Error(changed);
  const vacuum = action === 'vacuum' || action === 'vacuumAnalyze';
  return {
    table, statements: [postgresRelationMaintenanceSql(schema, name, facts.version, action)],
    protocol: 'extended' as const, readCommitted: true as const, statementTimeout: '120s' as const, requireNoWarnings: true as const,
    ...(vacuum ? { autocommit: { tag: 'VACUUM' as const, partial: true as const,
      guard: facts.kind === 'm' ? { sql: 'SELECT 1 FROM ONLY ' + table + ' WHERE FALSE', parseOnly: true as const } :
        { sql: 'LOCK TABLE ONLY ' + table + ' IN ACCESS SHARE MODE' } } } :
      facts.kind === 'm' ? { guard: { sql: 'SELECT 1 FROM ONLY ' + table + ' WHERE FALSE', stamp: input.stamp, parseOnly: true as const } } :
        { lock: 'LOCK TABLE ONLY ' + table + (action === 'reindex' ? ' IN SHARE ROW EXCLUSIVE MODE' : ' IN SHARE UPDATE EXCLUSIVE MODE') }),
    success: 'PostgreSQL 已确认完成维护命令',
    async preflight(current: PostgresConnection) {
      const { facts: actual } = await readFacts(current, input);
      if (!actions(actual)[action] || stamp(actual) !== input.stamp) throw Error(changed);
      return input.stamp;
    },
    async verify(current: PostgresConnection) {
      const { facts: actual } = await readFacts(current, input);
      if (action !== 'reindex') {
        if (stamp(actual) !== input.stamp) throw Error('维护后原关系身份待核对');
        return;
      }
      const { indexes: before, ...priorTable } = facts;
      const { indexes: after, ...resultTable } = actual;
      if (stamp(facts) === stamp(actual) || JSON.stringify(priorTable) !== JSON.stringify(resultTable) ||
        before.length !== after.length || before.some((index, i) => index.oid !== after[i].oid || index.name !== after[i].name ||
          index.file === after[i].file || !after[i].valid || !after[i].ready || !after[i].live))
        throw Error('实际索引文件或有效状态与维护计划不符');
    },
  };
}
