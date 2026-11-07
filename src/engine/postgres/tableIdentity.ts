import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresSequenceInteger, postgresSequenceLimits } from '../../shared/postgresSequence';
import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { readPostgresSequenceAllocation } from './sequence';
import { postgresTableOwnerLockSql } from './tableManage';

// PostgreSQL 17 起由分区父表管理整个分区树的标识属性。
export const postgresTableIdentityFactsSql = `CASE WHEN NOT c.relispartition AND c.relpersistence IN ('p','u')
  AND (c.relkind='r' OR c.relkind='p' AND pg_catalog.current_setting('server_version_num')::int>=170000)
  AND ${postgresTableOwnerLockSql} THEN pg_catalog.jsonb_build_object(
    'target', pg_catalog.jsonb_build_array(c.oid::text,n.oid::text,c.relowner::text,c.relkind,current_user,session_user,
      extract(epoch FROM pg_catalog.pg_postmaster_start_time()),pg_catalog.current_database())::text,
    'columns', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'position',a.attnum,'name',a.attname,'type',a.atttypid::text,'notNull',a.attnotnull,
      'hasDefault',a.atthasdef,'generated',a.attgenerated<>'','mode',a.attidentity,'sequences',COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'oid',s.oid::text,'schema',ns.nspname,'name',s.relname,'file',s.relfilenode::text,
          'start',q.seqstart::text,'minimum',q.seqmin::text,'maximum',q.seqmax::text,
          'settings',pg_catalog.jsonb_build_array(s.relowner::text,s.relacl::text,q.seqtypid::text,
            q.seqstart::text,q.seqmin::text,q.seqmax::text,q.seqincrement::text,q.seqcache::text,q.seqcycle)::text) ORDER BY s.oid)
        FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class s ON s.oid=d.objid AND s.relkind='S'
        JOIN pg_catalog.pg_namespace ns ON ns.oid=s.relnamespace JOIN pg_catalog.pg_sequence q ON q.seqrelid=s.oid
        WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objsubid=0 AND d.refclassid='pg_catalog.pg_class'::regclass
          AND d.refobjid=a.attrelid AND d.refobjsubid=a.attnum AND d.deptype='i'
      ),'[]'::jsonb)) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb)
  )::text END`;

const oid = z.string().regex(/^\d+$/);
const factsSchema = z.object({ target: z.string(), columns: z.array(z.object({
  position: z.number().int().positive(), name: z.string(), type: oid, notNull: z.boolean(),
  hasDefault: z.boolean(), generated: z.boolean(), mode: z.enum(['', 'a', 'd']),
  sequences: z.array(z.object({
    oid, schema: z.string(), name: z.string(), file: oid, settings: z.string(),
    start: postgresSequenceInteger, minimum: postgresSequenceInteger, maximum: postgresSequenceInteger,
  })).max(1),
})).max(2000) });
const types = { '21': 'smallint', '23': 'integer', '20': 'bigint' } as const;
const budget = () => ({ rows: 2, bytes: 4 * 1024 * 1024 });

export function postgresIdentityStamp(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

async function readIdentity(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`SELECT ${postgresTableIdentityFactsSql} FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid,'USAGE')`,
  [schema, name], budget());
  const raw = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof raw !== 'string')
    throw Error('原表已变化或不具备标识列管理权限');
  return { ...factsSchema.parse(JSON.parse(raw)), stamp: postgresIdentityStamp(raw) };
}

/** 锁后绑定表、列和关联序列，重启用精确整数并核对实际下一次分配状态。 */
export async function postgresTableIdentityPlan(connection: PostgresConnection,
  draft: Extract<PostgresTableManageInput, { action: 'identity' }>) {
  const { schema, name } = postgresRelationName(draft.table);
  const original = await readIdentity(connection, schema, name);
  const changed = '原表、字段或标识序列已变化，请刷新结构后重试';
  const matches = (column: { position: number; name: string }) => column.position === draft.position && column.name === draft.name;
  const column = original.columns.find(matches);
  if (connection.database !== draft.database || original.stamp !== draft.stamp || !column) throw Error(changed);
  const sequence = column.sequences[0], { change } = draft;
  const type = types[column.type as keyof typeof types];
  if (!type || column.generated || !column.notNull) throw Error('标识列需要非空的普通整数列');
  if (change.kind === 'add' ? column.mode || sequence || column.hasDefault : !column.mode || !sequence)
    throw Error(change.kind === 'add' ? '字段已有默认值或标识属性' : '未确认原标识列与关联序列');
  const mode = change.kind === 'add' || change.kind === 'mode' ? change.mode === 'always' ? 'a' : 'd' :
    change.kind === 'drop' ? '' : column.mode;
  const generation = mode === 'a' ? 'ALWAYS' : 'BY DEFAULT';
  if (change.kind === 'mode' && mode === column.mode) throw Error('生成模式没有变化');
  const next = change.kind === 'add' ? change.start : change.kind === 'restart' ? change.value ?? sequence!.start : undefined;
  if (next !== undefined) {
    const [min, max] = change.kind === 'add' ? [1n, postgresSequenceLimits[type][1]] :
      [BigInt(sequence!.minimum), BigInt(sequence!.maximum)];
    if (BigInt(next) < min || BigInt(next) > max) throw Error('起始值或重启值超出序列范围');
  }
  const value = next === undefined ? undefined : BigInt(next).toString();
  const operation = change.kind === 'add' ? 'ADD GENERATED ' + generation + ' AS IDENTITY (START WITH ' + value + ')' :
    change.kind === 'mode' ? 'SET GENERATED ' + generation :
      change.kind === 'restart' ? 'RESTART WITH ' + value : 'DROP IDENTITY';
  const table = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  return {
    table, statements: ['ALTER TABLE ' + table + ' ALTER COLUMN ' + postgresIdentifier(column.name) + ' ' + operation],
    protocol: 'extended' as const, readCommitted: true as const, lock: 'LOCK TABLE ONLY ' + table + ' IN ACCESS EXCLUSIVE MODE',
    success: 'PostgreSQL 标识列操作已确认提交',
    async preflight(current: PostgresConnection) {
      if ((await readIdentity(current, schema, name)).stamp !== original.stamp) throw Error(changed);
      return original.stamp;
    },
    async verify(current: PostgresConnection) {
      const actual = await readIdentity(current, schema, name);
      const field = actual.columns.find(matches), associated = field?.sequences[0];
      if (actual.target !== original.target || !field || field.type !== column.type || !field.notNull || field.generated || field.mode !== mode)
        throw Error('未确认原字段的标识属性');
      if (change.kind === 'drop') {
        const state = await current.query('SELECT EXISTS(SELECT FROM pg_catalog.pg_class WHERE oid=$1::oid)', [sequence!.oid], budget());
        if (associated || state.truncated || state.rows.length !== 1 || state.rows[0].c0 !== 'f') throw Error('未确认关联序列已移除');
        return;
      }
      if (!associated || (sequence && (associated.oid !== sequence.oid || associated.settings !== sequence.settings)) ||
          (change.kind === 'add' && associated.start !== value) ||
          (change.kind === 'restart' && associated.file === sequence!.file)) throw Error('未确认原字段关联的序列状态');
      if (value !== undefined) {
        const allocation = await readPostgresSequenceAllocation(current, postgresIdentifier(associated.schema) + '.' + postgresIdentifier(associated.name));
        if (allocation.called || allocation.value !== value) throw Error('实际序列分配状态与预览不同');
      }
    },
  };
}
