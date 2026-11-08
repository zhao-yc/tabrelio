import { createHash } from 'node:crypto';
import { postgresBackupRelationName, postgresNativeBackupRelationKinds, type PostgresNativeBackupRelation,
  type PostgresNativeBackupRelationSelection } from '../../shared/postgresDatabaseBackup';
import type { PostgresConnection } from './connection';

const catalogueLimit = 10_000;
const decimal = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);

type RelationKind = PostgresNativeBackupRelation['kind'];
const isRelationKind = (value: unknown): value is RelationKind => postgresNativeBackupRelationKinds.some(kind => kind === value);

/** 执行复核按完整名称读取同一批对象，使用数据库、角色、Schema 和关系身份生成目录签名。 */
export async function readPostgresNativeBackupCatalogue(connection: PostgresConnection, database: string,
  selected?: readonly PostgresNativeBackupRelationSelection[]): Promise<PostgresNativeBackupRelation[]> {
  const limit = selected?.length ?? catalogueLimit;
  const result = await connection.query(`
    SELECT n.nspname, c.relname, c.relkind, c.relispartition, c.oid::text, n.oid::text, db.oid::text, actor.oid::text,
      extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text, c.relpersistence
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_database db ON db.datname = pg_catalog.current_database()
    JOIN pg_catalog.pg_roles actor ON actor.rolname = CURRENT_USER
    WHERE c.relkind IN ('r','p','v','m','f','S') AND c.relpersistence IN ('p','u')
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege(c.oid, 'SELECT')
               ELSE pg_catalog.has_table_privilege(c.oid, 'SELECT') END
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend dep
        WHERE dep.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND dep.objid = c.oid AND dep.deptype = 'e')
      AND ($1::jsonb IS NULL OR EXISTS (SELECT FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS s(schema_name text, relation_name text)
        WHERE n.nspname::text COLLATE pg_catalog."C" = s.schema_name AND c.relname::text COLLATE pg_catalog."C" = s.relation_name))
    ORDER BY n.nspname::text COLLATE pg_catalog."C", c.relname::text COLLATE pg_catalog."C"
    LIMIT $2::int
  `, [selected ? JSON.stringify(selected.map(item => ({ schema_name: item.schema, relation_name: item.name }))) : null, limit + 1],
  { rows: limit + 1, bytes: 4 * 1024 * 1024 });
  if (connection.database !== database || result.truncated || result.rows.length > limit)
    throw Error('PostgreSQL 原生备份对象目录超过预算或数据库已变化');
  return result.rows.map(row => {
    const { c0: schema, c1: name, c2: kind, c3: partition, c4: relationOid, c5: schemaOid, c6: databaseOid,
      c7: roleOid, c8: started, c9: persistence } = row;
    if (typeof schema !== 'string' || typeof name !== 'string' || !isRelationKind(kind) ||
        (partition !== 't' && partition !== 'f') || ![relationOid, schemaOid, databaseOid, roleOid].every(decimal) ||
        typeof started !== 'string' || !/^\d+(?:\.\d+)?$/.test(started) || (persistence !== 'p' && persistence !== 'u'))
      throw Error('PostgreSQL 原生备份对象目录回包不完整');
    const stamp = createHash('sha256').update(JSON.stringify([database, databaseOid, roleOid, started,
      schema, schemaOid, name, relationOid, kind, partition, persistence])).digest('hex');
    return { schema, name, stamp, kind, partition: partition === 't' };
  });
}

export function matchPostgresNativeBackupSelection(catalogue: readonly PostgresNativeBackupRelation[],
  selected: readonly PostgresNativeBackupRelationSelection[]) {
  const byName = new Map(catalogue.map(item => [postgresBackupRelationName(item), item]));
  return selected.map(choice => {
    const actual = byName.get(postgresBackupRelationName(choice));
    if (!actual || actual.stamp !== choice.stamp) throw Error('备份对象的身份或读取权限已变化，请重新读取并选择');
    return actual;
  });
}
