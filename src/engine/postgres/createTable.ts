import { postgresSequenceEditPlan, postgresSequenceManageSchema, postgresSequencePlan, type PostgresSequenceCreateInput,
  type PostgresSequenceManageInput } from '../../shared/postgresSequence';
import { postgresSequenceTargets, readPostgresSequence, readPostgresSequenceAllocation } from './sequence';
import { createHash, randomUUID } from 'node:crypto';
import {
  matchesPostgresDefaultPreset, postgresCreateTablePlan, postgresDefaultPresetSql, postgresGenerationMinimum, type PostgresDefaultPreset,
  type PostgresCreateTableApply, type PostgresCreateTableInput,
  type PostgresCreateTableOutcome, type PostgresCreateTablePreview, type PostgresCreateTableTarget, type PostgresTruncateScope, type PostgresTableMoveScope,
} from '../../shared/postgresCreateTable';
import type { PostgresConnection } from './connection';
import { postgresCreateViewPlan, postgresEditViewPreviewSchema, postgresViewManagePreviewSchema, postgresViewQuery, postgresViewColumnsSql, postgresViewOptionsSql,
  type PostgresCreateViewInput, type PostgresEditViewInput, type PostgresViewManageInput } from '../../shared/postgresCreateView';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import { postgresMaterializedRefreshSchema, type PostgresMaterializedRefreshInput } from '../../shared/postgresMaterializedView';
import { readPostgresMaterializedFacts } from './materializedView';
import { readPostgresViewFacts, postgresViewColumnRenames } from './viewDefinition';
import { compilePostgresRoutine } from './createRoutine';
import { postgresRoutineCreateSchema, postgresRoutineManageSchema, type PostgresRoutineCreateInput,
  type PostgresRoutineManageInput } from '../../shared/postgresRoutine';
import { compilePostgresRoutineManage } from './routine';
import { postgresTableCopyPreviewSchema, type PostgresTableCopyInput } from '../../shared/postgresTableCopy';
import { postgresTableCopySql, readPostgresCopyColumns, readPostgresCopySource } from './tableCopy';
import { postgresTableManagePreviewSchema, type PostgresTableManageInput } from '../../shared/postgresTableManage';
import { readPostgresTableManageFacts } from './tableManage';
import { postgresTableTruncatePlan } from './tableTruncate';
import { postgresTableMovePlan } from './tableMove';
import { postgresTableCommentPlan } from './tableComments';
import { postgresTableIdentityPlan } from './tableIdentity';
import { postgresTableTriggerPlan } from './tableTriggers';
import { postgresTablePolicyPlan } from './tablePolicies';
import { postgresSchemaPlan } from './schemaManage';
import { postgresSchemaPreviewSchema, type PostgresSchemaPreviewInput } from '../../shared/postgresSchemaManage';
import { postgresRelationMaintenancePlan } from './relationMaintenance';
import { postgresRelationMaintenancePreviewSchema, type PostgresRelationMaintenancePreview } from '../../shared/postgresRelationMaintenance';
import { postgresPartitionManagePlan } from './partitionManage';
import { postgresPartitionManagePreviewSchema, type PostgresPartitionManagePreview } from '../../shared/postgresPartitionManage';
import { postgresExtensionPlan } from './extensionManage';
import { postgresExtensionPreviewSchema, type PostgresExtensionPreviewInput } from '../../shared/postgresExtensionManage';
import { postgresDatabasePlan } from './databaseManage';
import { postgresDatabaseManagePreviewSchema, type PostgresDatabaseManageInput } from '../../shared/postgresDatabaseManage';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type RelationKind = 'relationMaintenance' | 'partitionManage' | 'extensionManage' | 'databaseManage' | 'schemaManage' | 'table' | 'tableCopy' | 'tableManage' | 'view' | 'viewEdit' | 'viewManage' | 'materializedRefresh' | 'sequence' | 'sequenceManage' | 'routineCreate' | 'routineManage';
interface Plan {
  table: string;
  statements: string[];
  autocommit?: { tag: 'CREATE' | 'VACUUM'; partial?: true; guard?: { sql: string; parseOnly?: true } };
  requireNoWarnings?: true;
  dropConfirmation?: string;
  preflight(connection: PostgresConnection): Promise<string>;
  validate?(connection: PostgresConnection): Promise<void>;
  verify(connection: PostgresConnection, schemaOid: string, insertedRows?: number): Promise<void>;
  protocol?: 'extended';
  success: string;
  guard?: { sql: string; stamp: string; parseOnly?: true; changed?: string };
  identity?: string;
  truncateScope?: PostgresTruncateScope;
  moveScope?: PostgresTableMoveScope;
  readCommitted?: true;
  statementTimeout?: '120s';
  firstCommand?: 'SELECT';
  lock?: string;
  commands?: { tag: string; rows?: number }[];
}
interface Prepared {
  input: Scoped<PostgresCreateTableTarget>;
  token: string;
  expires: number;
  targetStamp: string;
  plan: Plan;
}

const budget = () => ({ rows: 2, bytes: 16 * 1024 });

/** 读取当前身份可建表的普通 schema，并保持实际搜索路径优先。 */
export async function postgresCreateSchemas(connection: PostgresConnection): Promise<string[]> {
  const result = await connection.query(`
    SELECT nspname FROM pg_catalog.pg_namespace
    WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(oid, 'USAGE')
      AND pg_catalog.has_schema_privilege(oid, 'CREATE')
    ORDER BY pg_catalog.array_position(pg_catalog.current_schemas(false), nspname) NULLS LAST, nspname
    LIMIT 1001
  `, undefined, { rows: 1001, bytes: 256 * 1024 });
  if (result.truncated || result.rows.length > 1000 || result.rows.some(row => typeof row.c0 !== 'string')) {
    throw Error('PostgreSQL 可建表 schema 超过预算或回包不完整');
  }
  return result.rows.map(row => String(row.c0));
}

/** 设置本次事务边界，只有内置类型能参与默认值校验与建表。 */
export async function startPostgresDdl(connection: PostgresConnection, readOnly: boolean): Promise<void> {
  await connection.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN', undefined, budget());
  for (const sql of [
    'SET LOCAL search_path = pg_catalog', 'SET LOCAL standard_conforming_strings = on', "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '20s'",
  ]) await connection.query(sql, undefined, budget());
}

/** 通过服务器真实目录验证 schema、权限及名称，保留 OID 识别同名替换。 */
async function preflight(connection: PostgresConnection, input: PostgresCreateTableTarget & { schema: string }, name: string,
  fields: string[], label: string, children: string[] = []): Promise<string> {
  if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
  const result = await connection.query(`
    SELECT n.oid,
      (SELECT c.relname::text FROM pg_catalog.pg_class c WHERE c.relnamespace = n.oid
        AND c.relname::text COLLATE pg_catalog."C" = ANY($2::text[]) LIMIT 1),
      pg_catalog.current_setting('max_identifier_length')::int
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname::text = $1 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')
  `, [input.schema, [name, ...children]], budget());
  const schema = result.rows[0];
  if (typeof schema?.c0 !== 'string') throw Error('PostgreSQL schema 不存在或缺少建' + label + '权限');
  if (schema.c1 !== null) throw Error('目标 schema 已存在同名关系' +
    (children.length && typeof schema.c1 === 'string' ? ' ' + postgresIdentifier(schema.c1) : ''));
  const max = Number(schema.c2);
  if (!Number.isInteger(max) || [name, ...fields, ...children].some(identifier => Buffer.byteLength(identifier) > max)) {
    throw Error(label + '名或字段名超过目标服务器标识符长度');
  }
  return schema.c0;
}

/** 同 schema 的操作仅锁原视图，避免 LOCK TABLE 递归锁底层关系。 */
function viewGuard(schema: string, name: string, table: string, stamp: string, kind: 'v' | 'm' = 'v'): Pick<Plan, 'guard' | 'preflight' | 'protocol'> {
  return {
    guard: { sql: 'ALTER ' + (kind === 'm' ? 'MATERIALIZED VIEW ' : 'VIEW ') + table +
      ' SET SCHEMA ' + postgresIdentifier(schema), stamp },
    preflight: async connection => (await readPostgresViewFacts(connection, schema, name, kind)).stamp,
    protocol: 'extended',
  };
}

/** 校验服务器真实类型转换，同时拒绝 varchar 显式转换可能造成的默认文字截断。 */
export async function validatePostgresDefaults(connection: PostgresConnection, checks: { type: string; value: string; length?: number }[]): Promise<void> {
  if (!checks.length) return;
  const values = checks.map(field => field.value);
  const expressions = checks.map((field, index) => {
    const arg = '$' + (index + 1), length = field.length;
    const cast = '((' + arg + '::text)::' + field.type + ' IS NOT NULL)';
    return length === undefined ? cast : '(' + cast + ' AND pg_catalog.char_length(' + arg + '::text) <= ' + length + ')';
  });
  const result = await connection.query('SELECT ' + expressions.join(', '), values, budget());
  if (!result.rows[0] || Object.values(result.rows[0]).some(value => value !== 't')) throw Error('默认值与字段类型或长度不符');
}

/** 检查目标库是否提供并授权使用选定的内置函数，预览不执行默认值函数。 */
export async function validatePostgresDefaultPresets(connection: PostgresConnection, presets: Iterable<PostgresDefaultPreset>): Promise<void> {
  for (const preset of new Set(presets)) {
    const sql = postgresDefaultPresetSql[preset];
    if (!sql.startsWith('pg_catalog.')) continue;
    // uuidv7() 省略的是可选 interval 参数，目录身份仍包含该参数。
    const signature = preset === 'timeOrderedUuid' ? 'pg_catalog.uuidv7(interval)' : sql;
    const result = await connection.query(`
      SELECT pg_catalog.has_function_privilege(pg_catalog.to_regprocedure($1)::oid, 'EXECUTE')
    `, [signature], budget());
    if (result.rows[0]?.c0 !== 't') {
      const minimum = preset === 'timeOrderedUuid' ? '18' : '13';
      throw Error('无法使用 ' + sql + '。需要 PostgreSQL ' + minimum + ' 或更高版本，以及内置函数的执行权限。');
    }
  }
}

/** 在同一事务核对实际 schema 和字段顺序，禁止标识符截断或目标替换后仍提交。 */
async function verify(connection: PostgresConnection, input: PostgresCreateTableInput, schemaOid: string): Promise<void> {
  const generated = input.columns.some(field => field.generation);
  const result = await connection.query(`
    SELECT a.attname, pg_catalog.left(pg_catalog.pg_get_expr(d.adbin, d.adrelid), 128)
      ${generated ? ', a.attgenerated' : ''}
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.oid = $1::oid AND n.nspname::text = $2 AND c.relname::text = $3 AND c.relkind = $4::pg_catalog."char"
      AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
  `, [schemaOid, input.schema, input.table, input.partition ? 'p' : 'r'], { rows: input.columns.length + 1, bytes: 128 * 1024 });
  if (result.truncated || result.rows.length !== input.columns.length ||
      result.rows.some((row, i) => row.c0 !== input.columns[i].name)) {
    throw Error('新表的实际 schema 或字段与预览不同，未提交');
  }
  if (input.columns.some(({ default: { mode } }, index) =>
    mode !== 'none' && mode !== 'literal' && !matchesPostgresDefaultPreset(result.rows[index].c1, mode)))
    throw Error('新表的实际服务器默认值与预览不同，未提交');
  if (generated && input.columns.some((field, index) => field.generation &&
    (result.rows[index].c2 !== (field.generation.mode === 'stored' ? 's' : 'v') || !result.rows[index].c1)))
    throw Error('新表的实际生成列与预览不同，未提交');
  if (input.partition) await verifyPartitions(connection, input.partition, schemaOid, input.table);
}

/** 通过键列序号、父子 OID 关联和默认分区标志核对服务器创建的实际分区拓扑。 */
async function verifyPartitions(connection: PostgresConnection, partition: NonNullable<PostgresCreateTableInput['partition']>,
  schemaOid: string, table: string) {
  const result = await connection.query(`
    SELECT p.partstrat::text,
      (SELECT pg_catalog.jsonb_agg(a.attname::text ORDER BY k.ordinality)::text
       FROM pg_catalog.unnest(p.partattrs) WITH ORDINALITY AS k(attnum, ordinality)
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum),
      COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(ch.relname,
        COALESCE((pg_catalog.to_jsonb(p)->>'partdefid')::oid, 0::oid) = ch.oid))::text
       FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class ch ON ch.oid = i.inhrelid
       WHERE i.inhparent = c.oid AND ch.relispartition AND ch.relkind = 'r' AND ch.relnamespace = c.relnamespace
         AND ch.relpartbound IS NOT NULL), '[]')
    FROM pg_catalog.pg_partitioned_table p JOIN pg_catalog.pg_class c ON c.oid = p.partrelid
    WHERE c.relnamespace = $1::oid AND c.relname::text COLLATE pg_catalog."C" = $2
  `, [schemaOid, table], budget());
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || row.c0 !== partition.strategy[0] ||
      typeof row.c1 !== 'string' || typeof row.c2 !== 'string' ||
      JSON.stringify(JSON.parse(row.c1)) !== JSON.stringify(partition.keys))
    throw Error('新表的实际分区策略或分区键与预览不同，未提交');
  const children = new Map<string, boolean>(JSON.parse(row.c2));
  if (children.size !== partition.children.length ||
    partition.children.some(child => children.get(child.name) !== (child.kind === 'default')))
    throw Error('新表的实际子分区与预览不同，未提交');
}

/** 先确认表达式使用的字符串模式，再用服务器 Parse 检查完整 DDL，预览不执行表达式。 */
export async function parsePostgresColumnStatements(connection: PostgresConnection, statements: string[]): Promise<void> {
  if (!connection.standardStrings) throw Error('生成列表达式的字符串模式未确认');
  for (const sql of statements) await connection.query(sql, undefined, budget(), undefined, 'parse');
}

/** 原文档、目标数据库、关系类别及连接修订共同约束一次性创建预览。 */
export class PostgresCreateTableWorkspace {
  private readonly plans = new Map<string, Prepared>();
  private readonly pending = new Set<string>();

  /** 同文档与目标库只保留最新预览，避免关闭弹窗后积累能力。 */
  private key(input: Scoped<PostgresCreateTableTarget>, kind: RelationKind): string {
    return JSON.stringify([input.owner, input.connectionId, input.database, kind]);
  }

  /** 预览只进行目录和内置类型校验，返回与实际执行相同的 SQL。 */
  async prepare(input: Scoped<PostgresCreateTableInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'table', connect, () => {
      const draft = { connectionId: input.connectionId, database: input.database, schema: input.schema,
        table: input.table, columns: input.columns, comment: input.comment, partition: input.partition, primaryKeyOrder: input.primaryKeyOrder };
      const plan = postgresCreateTablePlan(draft);
      const presets = draft.columns.flatMap(({ default: { mode } }) => mode === 'none' || mode === 'literal' ? [] : [mode]);
      const minimum = Math.max(0, ...draft.columns.map(field => field.generation ? postgresGenerationMinimum(field.generation.mode) : 0));
      const partition = draft.partition;
      const partitionMinimum = !partition ? 0 : draft.columns.some(field => field.identity !== 'none') ? 170000 :
        partition.strategy === 'hash' || partition.children.some(child => child.kind === 'default') ||
        draft.columns.some(field => field.primary || field.unique) ? 110000 : 100000;
      const extended = minimum > 0 || !!partition;
      return { ...plan, success: 'PostgreSQL 新表已确认创建',
        protocol: extended ? 'extended' : undefined,
        async preflight(connection) {
          const oid = await preflight(connection, draft, draft.table, draft.columns.map(column => column.name), '表',
            partition?.children.map(child => child.name));
          await validatePostgresDefaultPresets(connection, presets);
          if (minimum || partitionMinimum) {
            const server = await connection.query("SELECT pg_catalog.current_setting('server_version_num')", undefined, budget());
            const version = Number(server.rows[0]?.c0);
            if (minimum && !(version >= minimum))
              throw Error('当前生成列模式需要 PostgreSQL ' + minimum / 10000 + ' 或更新版本');
            if (partitionMinimum && !(version >= partitionMinimum))
              throw Error('当前分区设计需要 PostgreSQL ' + partitionMinimum / 10000 + ' 或更新版本');
          }
          return oid;
        },
        async validate(connection) {
          await validatePostgresDefaults(connection, plan.checks.map(check => ({
            ...check, length: draft.columns.find(column => column.name === check.name)?.length,
          })));
          if (extended) await parsePostgresColumnStatements(connection, plan.statements);
        },
        verify: (connection, oid) => verify(connection, draft, oid),
      };
    });
  }

  /** Schema 管理复用按文档绑定的一次性预览和事务回执。 */
  async prepareSchema(input: Scoped<PostgresSchemaPreviewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresSchemaPreviewSchema.parse(raw);
    return this.prepareRelation(input, 'schemaManage', connect, () => connection => postgresSchemaPlan(connection, draft));
  }

  /** 物理关系维护保留独占连接、原文档能力和一次性执行边界。 */
  async prepareMaintenance(input: Scoped<PostgresRelationMaintenancePreview>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresRelationMaintenancePreviewSchema.parse(raw);
    return this.prepareRelation(input, 'relationMaintenance', connect, () => connection => postgresRelationMaintenancePlan(connection, draft));
  }

  /** 分区维护复用按文档绑定的事务和一次性预览。 */
  async preparePartition(input: Scoped<PostgresPartitionManagePreview>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresPartitionManagePreviewSchema.parse(raw);
    return this.prepareRelation(input, 'partitionManage', connect, () => connection => postgresPartitionManagePlan(connection, draft));
  }

  /** 扩展目录和安装、升级、迁移、卸载计划绑定原文档和数据库。 */
  async prepareExtension(input: Scoped<PostgresExtensionPreviewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresExtensionPreviewSchema.parse(raw);
    return this.prepareRelation(input, 'extensionManage', connect, () => connection => postgresExtensionPlan(connection, draft));
  }

  /** 维护库能力绑定原文档、连接修订和模板或目标库。 */
  async prepareDatabase(input: Scoped<PostgresDatabaseManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresDatabaseManagePreviewSchema.parse(raw);
    return this.prepareRelation(input, 'databaseManage', connect, () => connection => postgresDatabasePlan(connection, draft));
  }

  /** 来源表结构与目标 schema 绑定预览，确认后只复制事务内可见的已提交行。 */
  async prepareTableCopy(input: Scoped<PostgresTableCopyInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresTableCopyPreviewSchema.parse(raw);
    return this.prepareRelation(input, 'tableCopy', connect, () => async connection => {
      const original = await readPostgresCopySource(connection, draft);
      const sql = postgresTableCopySql(draft, original.columns, original.comment);
      return {
        ...sql, protocol: 'extended', statementTimeout: '120s', success: 'PostgreSQL 表副本已确认创建',
        commands: sql.statements.map(statement => statement.startsWith('WITH ') ? { tag: 'SELECT', rows: 1 } : { tag: statement.split(' ', 1)[0] }),
        async preflight(current) {
          const actual = await readPostgresCopySource(current, draft);
          if (actual.stamp !== original.stamp) throw Error('来源表结构已变化，请重新预览');
          return preflight(current, draft, draft.name, [], '表');
        },
        async verify(current, schemaOid, insertedRows) {
          const result = await current.query(`
            SELECT c.oid::text, pg_catalog.obj_description(c.oid, 'pg_class') FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.oid = $1::oid AND n.nspname::text = $2 AND c.relname::text = $3 AND c.relkind = 'r' AND c.relpersistence = 'p'
          `, [schemaOid, draft.schema, draft.name], budget());
          const row = result.rows[0];
          if (result.truncated || result.rows.length !== 1 || typeof row?.c0 !== 'string' || row.c0 === original.oid || row.c1 !== original.comment)
            throw Error('未确认新表的独立身份或注释');
          const columns = await readPostgresCopyColumns(current, row.c0);
          if (JSON.stringify(columns.map(column => column.signature)) !== JSON.stringify(original.columns.map(column => column.signature)))
            throw Error('实际副本字段与来源结构不同，未提交');
          if (draft.mode === 'data') {
            const count = await current.query('SELECT pg_catalog.count(*)::text FROM ONLY ' + sql.table, undefined, budget());
            if (!Number.isSafeInteger(insertedRows) || count.rows[0]?.c0 !== String(insertedRows))
              throw Error('实际副本行数与服务器插入回执不同，未提交');
          }
          if ((await readPostgresCopySource(current, draft)).stamp !== original.stamp) throw Error('来源表结构在复制期间变化，未提交');
        },
      };
    });
  }

  /** 新序列在同一事务核对类型、范围、缓存和注释，且保持未分配状态。 */
  async prepareSequence(input: Scoped<PostgresSequenceCreateInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'sequence', connect, () => {
      const { connectionId, database, schema, name, dataType, start, increment, minimum, maximum, cache, cycle, comment } = input;
      const draft = { connectionId, database, schema, name, dataType, start, increment, minimum, maximum, cache, cycle, comment };
      const { table, statements, expected } = postgresSequencePlan(draft);
      return { table, statements, success: 'PostgreSQL 新序列已确认创建',
        preflight: connection => preflight(connection, draft, name, [], '序列'),
        async verify(connection, oid) {
          const { info, schemaOid } = await readPostgresSequence(connection, table);
          if (schemaOid !== oid || info.lastValue !== null || info.ownedBy !== null ||
              Object.entries(expected).some(([key, value]) => info[key as keyof typeof expected] !== value))
            throw Error('实际序列参数与预览不同，未提交');
        },
      };
    });
  }

  /** 确认时先取得序列写锁，再复核原 OID、权限及参数，防止同名替换或覆盖外部修改。 */
  async prepareSequenceManage(input: Scoped<PostgresSequenceManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'sequenceManage', connect, () => {
      const { owner: _owner, connectionRevision: _revision, ...draft } = input;
      const action = postgresSequenceManageSchema.parse(draft);
      const { schema, name } = postgresRelationName(action.table);
      const prefix = postgresIdentifier(schema) + '.';
      const table = prefix + postgresIdentifier(name);
      return async connection => {
        const original = await readPostgresSequence(connection, table);
        if (!original.info.canManage) throw Error('当前角色没有序列管理权限');
        if (original.info.stamp !== action.stamp) throw Error('原序列已变化，请刷新详情后继续');
        const guard: Pick<Plan, 'guard' | 'preflight' | 'protocol'> = {
          // PostgreSQL 对同一所有者取得排他锁且不改目录，实际改写会被 xmin 复核拦截。
          guard: { sql: 'ALTER SEQUENCE ' + table + ' OWNER TO ' + postgresIdentifier(original.ownerName), stamp: original.info.stamp },
          protocol: 'extended',
          async preflight(current) {
            const actual = await readPostgresSequence(current, table);
            if (actual.info.stamp !== original.info.stamp) throw Error('原序列已变化，请刷新详情后继续');
            if (action.action === 'rename') await preflight(current, { ...action, schema }, action.name, [], '序列');
            return actual.info.stamp;
          },
        };
        if (action.action === 'rename') {
          if (action.name === name) throw Error('请输入不同的序列名称');
          await preflight(connection, { ...action, schema }, action.name, [], '序列');
          const identifier = postgresIdentifier(action.name);
          return { ...guard, table: prefix + identifier, success: 'PostgreSQL 序列已确认重命名',
            statements: ['ALTER SEQUENCE ' + table + ' RENAME TO ' + identifier],
            async verify(current) {
              const actual = await readPostgresSequence(current, prefix + identifier);
              const { lastValue: _value, stamp: _stamp, ...expected } = original.info;
              if (actual.preserved !== original.preserved || Object.entries({ ...expected, name: action.name })
                .some(([key, value]) => key !== 'ownedBy' && actual.info[key as keyof typeof expected] !== value))
                throw Error('重命名后的序列身份或参数与原序列不同，未提交');
            },
          };
        }
        if (action.action === 'drop') {
          if (original.info.ownedBy?.identity) throw Error('标识列序列须随所属字段管理');
          return { ...guard, table, success: 'PostgreSQL 序列已确认删除', statements: ['DROP SEQUENCE ' + table + ' RESTRICT'],
            async verify(current) {
              const result = await current.query('SELECT EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.oid = $1::oid OR ' +
                '(c.relnamespace = $2::oid AND c.relname::text = $3))', [original.oid, original.schemaOid, name], budget());
              if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f')
                throw Error('未确认原序列已从目录删除');
            },
          };
        }
        if (action.action === 'bind' || action.action === 'detach' || action.action === 'owner') {
          const transfer = action.action === 'owner';
          if (original.info.ownedBy?.identity) throw Error('标识列序列须随所属字段管理');
          if (action.action === 'detach' && !original.info.ownedBy) throw Error('原序列没有所属字段');
          if (action.action === 'bind' && action.key === original.associationKey) throw Error('序列已绑定该字段');
          const find = async (current: PostgresConnection) => {
            if (action.action === 'detach') return 'NONE';
            const { choices } = await postgresSequenceTargets(current, original, transfer ? 'role' : 'column', '', action.key);
            if (!choices[0]) throw Error('目标字段或角色已变化，或当前角色没有所需权限');
            return choices[0].label;
          };
          const destination = await find(connection);
          return { ...guard, table,
            success: transfer ? 'PostgreSQL 序列所有者已确认更新' : 'PostgreSQL 序列所属字段已确认更新',
            statements: ['ALTER SEQUENCE ' + table + (transfer ? ' OWNER TO ' + postgresIdentifier(destination) : ' OWNED BY ' + destination)],
            async preflight(current) {
              const stamp = await guard.preflight!(current);
              if (await find(current) !== destination) throw Error('目标字段或角色名称已变化，请重新预览');
              return stamp;
            },
            async verify(current) {
              // 转移后原角色可能失去读取权限，仅用已锁定的序列 OID 回读本次事务结果。
              const actual = await readPostgresSequence(current, table, transfer ? original.oid : undefined);
              const association = action.action === 'bind' ? action.key : null;
              const identityMatches = transfer ? actual.oid === original.oid && actual.schemaOid === original.schemaOid &&
                actual.ownerOid === action.key && actual.persistence === original.persistence : actual.objectIdentity === original.objectIdentity;
              if (!identityMatches || actual.definition !== original.definition || actual.associationKey !== association || actual.info.ownedBy?.identity)
                throw Error('实际序列身份或归属与预览不同，未提交');
            },
          };
        }
        const { statements, expected, restart } = postgresSequenceEditPlan(action, original.info, table);
        return { ...guard, table, success: 'PostgreSQL 序列参数已确认更新', statements,
          async verify(current) {
            const actual = await readPostgresSequence(current, table);
            if (actual.preserved !== original.preserved || Object.entries(expected)
              .some(([key, value]) => actual.info[key as keyof typeof expected] !== value))
              throw Error('实际序列身份或参数与预览不同，未提交');
            if (restart !== undefined) {
              const allocation = await readPostgresSequenceAllocation(current, table);
              if (allocation.called || allocation.value !== restart) throw Error('实际序列重启状态与预览不同，未提交');
            }
          },
        };
      };
    });
  }

  /** 预览只解析原目录类型，确认后由 PostgreSQL 校验例程正文。 */
  async prepareRoutine(input: Scoped<PostgresRoutineCreateInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'routineCreate', connect, () => {
      const { owner: _owner, connectionRevision: _revision, ...raw } = input;
      const draft = postgresRoutineCreateSchema.parse(raw);
      return connection => compilePostgresRoutine(connection, draft);
    });
  }

  /** 维护令牌和创建令牌分别绑定，确认只能消费原动作预览。 */
  async prepareRoutineManage(input: Scoped<PostgresRoutineManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'routineManage', connect, () => {
      const { owner: _owner, connectionRevision: _revision, ...raw } = input;
      const draft = postgresRoutineManageSchema.parse(raw);
      return connection => compilePostgresRoutineManage(connection, draft);
    });
  }

  /** 预览仅读取目标目录；视图定义由服务器在确认后的扩展协议 DDL 中校验。 */
  async prepareView(input: Scoped<PostgresCreateViewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'view', connect, () => {
      const { connectionId, database, schema, view, definition, comment, materialized, columnNames, options } = input;
      const draft = { connectionId, database, schema, view, definition, comment, materialized, columnNames, options };
      const plan = postgresCreateViewPlan(draft);
      const label = materialized ? '物化视图' : '视图';
      return { ...plan, success: 'PostgreSQL 新' + label + '已确认创建', protocol: 'extended',
        // 立即填充的原生命令回执为 SELECT 行数，仍须回读新建对象后才能提交。
        ...(materialized?.populate ? { statementTimeout: '120s' as const, firstCommand: 'SELECT' as const } : {}),
        preflight: connection => preflight(connection, draft, view, columnNames ?? [], label),
        async verify(connection, oid) {
          const result = await connection.query(`
            SELECT pg_catalog.obj_description(c.oid, 'pg_class'), c.relispopulated, c.oid::text,
              COALESCE(c.reloptions, ARRAY[]::text[]) @> $5::text[] AND COALESCE(c.reloptions, ARRAY[]::text[]) <@ $5::text[]
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.oid = $1::oid AND n.nspname::text = $2 AND c.relname::text = $3
              AND c.relkind = $4::pg_catalog."char" AND c.relpersistence = 'p'
          `, [oid, schema, view, materialized ? 'm' : 'v', options ?? []], budget());
          const row = result.rows[0];
          if (result.truncated || result.rows.length !== 1 || row.c0 !== (comment || null) ||
              materialized && row.c1 !== (materialized.populate ? 't' : 'f'))
            throw Error('新视图的实际 schema、类别、注释或填充状态与预览不同，未提交');
          if (options && row.c3 !== 't') throw Error('新视图的实际选项与预览不同，未提交');
          if (columnNames?.length) {
            const actual = await connection.query(`
              SELECT a.attname::text FROM pg_catalog.pg_attribute a WHERE a.attrelid = $1::oid
                AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT $2::integer
            `, [String(row.c2), String(columnNames.length)], { rows: columnNames.length, bytes: 512 * 1024 });
            if (actual.truncated || actual.rows.length !== columnNames.length ||
                actual.rows.some((column, index) => column.c0 !== columnNames[index]))
              throw Error('新视图的实际列名与预览不同，未提交');
          }
        },
      };
    });
  }

  /** 将定义和原选项编成同一预览，提交前锁住原视图并再次核对目录。 */
  async prepareViewEdit(input: Scoped<PostgresEditViewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'viewEdit', connect, () => {
      const { connectionId, database, table, definition, stamp, columnNames } = input;
      const draft = postgresEditViewPreviewSchema.parse({ connectionId, database, table, definition, stamp, columnNames });
      const { schema, name } = postgresRelationName(draft.table);
      const qualified = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
      const query = postgresViewQuery(draft.definition);
      return async connection => {
        const original = await readPostgresViewFacts(connection, schema, name);
        if (original.stamp !== draft.stamp) throw Error('原视图已变化，请刷新结构后编辑');
        const names = draft.columnNames ?? [];
        const renames = postgresViewColumnRenames(qualified, original.columns, names);
        const replacement = 'CREATE OR REPLACE VIEW ' + qualified + postgresViewColumnsSql(names) +
          postgresViewOptionsSql(original.options) + ' AS\n' + query;
        const renameOnly = renames.length && names.length <= original.columns.length && definition.trim() === original.definition.trim();
        const statements = renameOnly ? renames : [...renames, replacement];
        return {
          ...viewGuard(schema, name, qualified, original.stamp),
          table: qualified, success: 'PostgreSQL 视图定义已确认更新',
          statements,
          async verify(current) {
            const actual = await readPostgresViewFacts(current, schema, name);
            if (actual.preserved !== original.preserved) throw Error('视图身份、所有者、授权、注释或选项已变化，未提交');
            if (names.some((column, index) => actual.columns[index] !== column))
              throw Error('视图输出列名与预览不同，未提交');
          },
        };
      };
    });
  }

  /** 解析只读语句固定原表，服务端 DDL 再获取写锁，提交前核对原 OID。 */
  async prepareTableManage(input: Scoped<PostgresTableManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const { owner: _owner, connectionRevision: _revision, ...raw } = input;
    const draft = postgresTableManagePreviewSchema.parse(raw);
    if (draft.action === 'comment')
      return this.prepareRelation(input, 'tableManage', connect, () => connection => postgresTableCommentPlan(connection, draft));
    if (draft.action === 'identity')
      return this.prepareRelation(input, 'tableManage', connect, () => connection => postgresTableIdentityPlan(connection, draft));
    if (draft.action === 'trigger')
      return this.prepareRelation(input, 'tableManage', connect, () => connection => postgresTableTriggerPlan(connection, draft));
    if (draft.action === 'policy')
      return this.prepareRelation(input, 'tableManage', connect, () => connection => postgresTablePolicyPlan(connection, draft));
    const { schema, name } = postgresRelationName(draft.table);
    const prefix = postgresIdentifier(schema) + '.', originalTable = prefix + postgresIdentifier(name);
    const changed = '原表或管理权限已变化，请刷新结构后继续';
    const checkDestination = (connection: PostgresConnection, newName: string) =>
      preflight(connection, { ...draft, schema }, newName, [], '表');
    return this.prepareRelation(input, 'tableManage', connect, () => async connection => {
      const original = await readPostgresTableManageFacts(connection, schema, name);
      if (connection.database !== draft.database || original.stamp !== draft.stamp || !original[draft.action]) throw Error(changed);
      if (draft.action === 'truncate') return postgresTableTruncatePlan(connection, original, draft);
      // 同一表移动 schema 或改名时，工作台继续使用相同的物理身份。
      const identity = createHash('sha256').update(JSON.stringify([draft.database, original.oid, original.startedAt])).digest('hex');
      // Parse / Sync 持有原关系的共享锁，既不读数据，也不要求 schema 所有者拥有表的 SELECT。
      const guard = { sql: 'SELECT 1 FROM ONLY ' + originalTable + ' WHERE FALSE', stamp: original.stamp, parseOnly: true as const, changed };
      if (draft.action === 'move') return { ...await postgresTableMovePlan(connection, original, draft), guard, identity };
      const base = {
        guard,
        protocol: 'extended' as const,
        async preflight(current: PostgresConnection) {
          const actual = await readPostgresTableManageFacts(current, schema, name);
          if (actual.stamp !== original.stamp) throw Error(changed);
          if (draft.action === 'rename' && await checkDestination(current, draft.name) !== original.namespace) throw Error(changed);
          return actual.stamp;
        },
      };
      if (draft.action === 'rename') {
        if (draft.name === name) throw Error('请输入不同的表名');
        if (await checkDestination(connection, draft.name) !== original.namespace) throw Error(changed);
        const identifier = postgresIdentifier(draft.name);
        return {
          ...base, table: prefix + identifier, success: 'PostgreSQL 表已确认重命名',
          identity,
          statements: ['ALTER TABLE ' + originalTable + ' RENAME TO ' + identifier],
          async verify(current) {
            if ((await readPostgresTableManageFacts(current, schema, draft.name)).stamp !== original.stamp)
              throw Error('未确认重命名后的关系为原表');
          },
        };
      }
      return {
        ...base, table: originalTable, success: 'PostgreSQL 表已确认删除',
        statements: ['DROP TABLE ' + originalTable + ' RESTRICT'],
        async verify(current) {
          const result = await current.query(`SELECT EXISTS (SELECT FROM pg_catalog.pg_class c
            WHERE c.oid=$1::oid OR (c.relnamespace=$2::oid AND c.relname::text COLLATE pg_catalog."C"=$3))`,
          [original.oid, original.namespace, name], budget());
          if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f')
            throw Error('未确认原表已从目录删除');
        },
      };
    });
  }

  /** 重命名与受限删除绑定原视图身份，并在提交前复核实际目录。 */
  async prepareViewManage(input: Scoped<PostgresViewManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'viewManage', connect, () => {
      const { connectionId, database, table, stamp, action, relationKind } = input;
      const target = { connectionId, database, table, stamp, action, relationKind };
      const draft = postgresViewManagePreviewSchema.parse(input.action === 'rename' ? { ...target, name: input.name } :
        input.action === 'renameColumns' ? { ...target, columnNames: input.columnNames } : target);
      const { schema, name } = postgresRelationName(draft.table);
      const prefix = postgresIdentifier(schema) + '.';
      const qualified = prefix + postgresIdentifier(name);
      const kind = draft.relationKind === 'materialized' ? 'm' : 'v';
      const sqlType = kind === 'm' ? 'MATERIALIZED VIEW ' : 'VIEW ';
      const label = kind === 'm' ? '物化视图' : '视图';
      return async connection => {
        const original = await readPostgresViewFacts(connection, schema, name, kind);
        if (original.stamp !== draft.stamp) throw Error('原视图已变化，请刷新结构后继续');
        const guard = viewGuard(schema, name, qualified, original.stamp, kind);
        if (draft.action === 'rename') {
          if (draft.name === name) throw Error('请输入不同的视图名称');
          await preflight(connection, { connectionId, database, schema }, draft.name, [], label);
          const identifier = postgresIdentifier(draft.name);
          return {
            ...guard, table: prefix + identifier, success: 'PostgreSQL ' + label + '已确认重命名',
            statements: ['ALTER ' + sqlType + qualified + ' RENAME TO ' + identifier],
            async verify(current) {
              const actual = await readPostgresViewFacts(current, schema, draft.name, kind);
              if (actual.preserved !== original.preserved || actual.revision !== original.revision)
                throw Error('重命名后的视图身份、定义或属性与原视图不同，未提交');
            },
          };
        }
        if (draft.action === 'renameColumns') {
          const { columnNames } = draft;
          if (columnNames.length !== original.columns.length) throw Error('物化视图列名必须与现有列一一对应');
          const statements = postgresViewColumnRenames(qualified, original.columns, columnNames, 'm');
          if (!statements.length) throw Error('物化视图列名未改变');
          return {
            ...guard, table: qualified, success: 'PostgreSQL 物化视图列名已确认更新', statements,
            async verify(current) {
              const actual = await readPostgresViewFacts(current, schema, name, 'm');
              // preserved 包含原存储节点、填充状态、索引目录及对象身份，规则版本保持原定义。
              if (actual.preserved !== original.preserved || actual.revision !== original.revision ||
                  actual.columns.length !== columnNames.length || actual.columns.some((column, index) => column !== columnNames[index]))
                throw Error('物化视图列名、定义或存储身份与预览不同，未提交');
            },
          };
        }
        return {
          ...guard, table: qualified, success: 'PostgreSQL ' + label + '已确认删除',
          statements: ['DROP ' + sqlType + qualified + ' RESTRICT'],
          async verify(current) {
            const result = await current.query(`SELECT EXISTS (
              SELECT FROM pg_catalog.pg_class c
              WHERE c.oid = $1::oid OR (c.relnamespace = $2::oid AND c.relname::text = $3)
            )`, [original.oid, original.namespace, name], budget());
            if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f')
              throw Error('未确认原视图已从目录删除');
          },
        };
      };
    });
  }

  /** 用仅解析的语句固定物化视图关系，确认后交给 PostgreSQL 的原生刷新。 */
  async prepareMaterializedRefresh(input: Scoped<PostgresMaterializedRefreshInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'materializedRefresh', connect, () => {
      const { connectionId, database, table, stamp, mode } = input;
      const draft = postgresMaterializedRefreshSchema.parse({ connectionId, database, table, stamp, mode });
      const { schema, name } = postgresRelationName(draft.table);
      const qualified = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
      return async connection => {
        const original = await readPostgresMaterializedFacts(connection, schema, name);
        if (!original.state.stamp || original.state.stamp !== draft.stamp)
          throw Error('物化视图或刷新权限已变化，请刷新结构后继续');
        if (mode === 'concurrent' && !(original.state.populated && original.state.uniqueIndex))
          throw Error('并发刷新要求已填充数据并具有有效的全行唯一列索引');
        const populate = mode !== 'empty';
        return {
          table: qualified, protocol: 'extended', statementTimeout: '120s',
          success: populate ? 'PostgreSQL 物化视图已确认刷新' : 'PostgreSQL 物化视图已确认清除填充数据',
          // 只发送 Parse / Sync，保留关系共享锁，无需 SELECT 权限，也不执行查询。
          guard: { sql: 'SELECT 1 FROM ONLY ' + qualified + ' WHERE FALSE', stamp: original.state.stamp, parseOnly: true },
          statements: ['REFRESH MATERIALIZED VIEW ' + (mode === 'concurrent' ? 'CONCURRENTLY ' : '') +
            qualified + (populate ? ' WITH DATA' : ' WITH NO DATA')],
          preflight: async current => (await readPostgresMaterializedFacts(current, schema, name)).state.stamp ?? '',
          async verify(current) {
            const actual = await readPostgresMaterializedFacts(current, schema, name);
            if (actual.identity !== original.identity || actual.state.populated !== populate)
              throw Error('未确认原物化视图身份或填充状态');
          },
        };
      };
    });
  }

  /** 关系创建及视图维护共用预检、令牌、预算和事务回执。 */
  private async prepareRelation(input: Scoped<PostgresCreateTableTarget>, kind: RelationKind, connect: Connect, compile: () => Plan | ((connection: PostgresConnection) => Promise<Plan>)) {
    const key = this.key(input, kind);
    if (this.pending.has(key)) throw Error('目标已有关系创建操作');
    this.pending.add(key);
    this.plans.delete(key);
    try {
      const { owner, connectionRevision, connectionId, database } = input;
      const compiled = compile();
      const { plan, targetStamp } = await connect(async connection => {
        await startPostgresDdl(connection, true);
        const plan = typeof compiled === 'function' ? await compiled(connection) : compiled;
        const targetStamp = plan.guard?.stamp ?? await plan.preflight(connection);
        await plan.validate?.(connection);
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT') throw Error('预览读取未完成');
        return { plan, targetStamp };
      });
      const now = Date.now();
      for (const [id, old] of this.plans) if (old.expires <= now) this.plans.delete(id);
      if (this.plans.size >= 128) throw Error('PostgreSQL 关系创建预览已满，请稍后重试');
      const token = randomUUID();
      this.plans.set(key, { input: { connectionId, database, owner, connectionRevision }, token, targetStamp, plan, expires: now + 300_000 });
      const autocommitGuard = plan.autocommit?.guard;
      const first = plan.lock ?? (plan.guard && !plan.guard.parseOnly ? plan.guard.sql : undefined) ??
        (autocommitGuard && !autocommitGuard.parseOnly ? autocommitGuard.sql : undefined);
      return { token, statements: first ? [first, ...plan.statements] : plan.statements,
        ...(plan.truncateScope ? { truncateScope: plan.truncateScope } : {}), ...(plan.moveScope ? { moveScope: plan.moveScope } : {}) };
    } finally { this.pending.delete(key); }
  }

  /** 只消费一次原预览，真实提交结果优先于后续连接关闭。 */
  async apply(input: Scoped<PostgresCreateTableApply> & { dropName?: string }, connect: Connect, kind: RelationKind = 'table'): Promise<PostgresCreateTableOutcome> {
    const key = this.key(input, kind), prepared = this.plans.get(key);
    if (this.pending.has(key)) throw Error('目标已有关系创建操作');
    if (!prepared || prepared.token !== input.token || prepared.expires <= Date.now() ||
        input.connectionRevision !== prepared.input.connectionRevision) throw Error('PostgreSQL 创建预览已失效，请重新预览');
    if (kind === 'extensionManage' && prepared.plan.dropConfirmation !== input.dropName)
      throw Error('请逐字输入将要卸载的扩展名称');
    this.plans.delete(key);
    this.pending.add(key);
    let receipt: PostgresCreateTableOutcome | undefined;
    try {
      const guard = prepared.plan.autocommit?.guard;
      if (guard) {
        // ACCESS SHARE 与普通 VACUUM 的锁兼容，同时阻止并发改名或删除原关系。
        await connect(async pinned => {
          await startPostgresDdl(pinned, true);
          await pinned.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
          await pinned.query("SET LOCAL idle_in_transaction_session_timeout = '150s'", undefined, budget());
          const locked = await pinned.query(guard.sql, undefined, budget(), undefined, guard.parseOnly ? 'parse' : 'extended');
          if (!guard.parseOnly && locked.postgresCommand !== 'LOCK' || !pinned.state().transactionKnown || !pinned.state().transactionOpen)
            throw Error('未确认锁定原维护关系');
          if (await prepared.plan.preflight(pinned) !== prepared.targetStamp) throw Error('原维护关系已变化');
          await connect(async connection => { receipt = await this.execute(connection, prepared); }, true);
          try {
            const released = await pinned.query('ROLLBACK', undefined, budget());
            if (released.postgresCommand !== 'ROLLBACK' || !pinned.state().transactionKnown || pinned.state().transactionOpen)
              throw Error('维护对象锁的收尾未确认');
          } catch (reason) {
            if (receipt?.outcome === 'committed') receipt = { outcome: 'unknown', message: pinned.error(reason).message };
            else throw reason;
          }
        }, true);
      } else await connect(async connection => { receipt = await this.execute(connection, prepared); }, true);
      return receipt!;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      return receipt ? { ...receipt, message: receipt.message + '；连接收尾异常：' + message } : { outcome: 'notSent', message };
    } finally { this.pending.delete(key); }
  }

  /** 创建、注释和核对属于同一事务，断线且终态无法确认时保留未知。 */
  private async execute(connection: PostgresConnection, prepared: Prepared): Promise<PostgresCreateTableOutcome> {
    if (prepared.plan.autocommit) return this.executeAutocommit(connection, prepared, prepared.plan.autocommit);
    let sent = false, committing = false;
    try {
      await startPostgresDdl(connection, false);
      const { plan, targetStamp } = prepared;
      if (plan.guard || plan.truncateScope || plan.readCommitted)
        await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
      if (plan.lock && (await connection.query(plan.lock, undefined, budget(), undefined, 'extended')).postgresCommand !== 'LOCK')
        throw Error('服务器未确认锁定来源表');
      if (plan.guard) {
        // 先取目标锁，再读取会取得共享锁的反编译定义，避免并发替换时先阻塞在读路径。
        if (plan.guard.parseOnly) {
          await connection.query(plan.guard.sql, undefined, budget(), undefined, 'parse');
        } else {
          sent = true;
          if ((await connection.query(plan.guard.sql, undefined, budget(), undefined, 'extended')).postgresCommand !== 'ALTER')
            throw Error('服务器未确认锁定原关系');
        }
      }
      if (await plan.preflight(connection) !== targetStamp)
        throw Error(plan.guard ? plan.guard.changed ?? '原视图已变化，请刷新结构后继续' : '原 schema 已被替换，请重新预览');
      if (plan.statementTimeout) await connection.query(
        "SELECT pg_catalog.set_config('statement_timeout', $1, true)", [plan.statementTimeout], budget());
      if (plan.requireNoWarnings) await connection.query('SET LOCAL client_min_messages = warning', undefined, budget());
      let insertedRows: number | undefined;
      for (const [index, statement] of plan.statements.entries()) {
        sent = true;
        let warned = false;
        const result = await connection.query(statement, undefined, budget(), undefined, plan.protocol,
          plan.requireNoWarnings ? () => { warned = true; } : undefined);
        if (warned) throw Error('服务器发出维护警告，未确认完成');
        const expected = plan.commands?.[index];
        const command = expected?.tag ?? (index === 0 && plan.firstCommand || statement.slice(0, statement.indexOf(' ')));
        if (result.postgresCommand !== command || expected?.rows !== undefined && (result.truncated || result.rows.length !== expected.rows)) {
          throw Error('PostgreSQL 未返回预期的结构回执');
        }
        if (command === 'INSERT') insertedRows = result.affectedRows;
      }
      await prepared.plan.verify(connection, prepared.targetStamp, insertedRows);
      committing = true;
      const result = await connection.query('COMMIT', undefined, budget());
      if (result.postgresCommand === 'ROLLBACK') return { outcome: 'rolledBack', message: '服务器已回滚结构操作' };
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) {
        throw Error('PostgreSQL 结构提交未确认');
      }
      return { outcome: 'committed', table: prepared.plan.table, message: prepared.plan.success,
        ...(plan.identity ? { identity: plan.identity } : {}),
        ...(insertedRows === undefined ? {} : { copiedRows: String(insertedRows) }) };
    } catch (reason) {
      const message = connection.error(reason).message;
      if (!sent) return { outcome: 'notSent', message };
      if (!connection.state().transactionKnown) return { outcome: 'unknown', message };
      try {
        if (connection.state().transactionOpen) {
          const rollback = await connection.query('ROLLBACK', undefined, budget());
          if (rollback.postgresCommand === 'ROLLBACK' && connection.state().transactionKnown && !connection.state().transactionOpen)
            return { outcome: 'rolledBack', message };
        }
        if (!committing && connection.state().transactionKnown && !connection.state().transactionOpen) return { outcome: 'rolledBack', message };
      } catch { /* 连接异常由原回执保留，禁止重放。 */ }
      return { outcome: 'unknown', message };
    }
  }

  /** 事务外命令由独立物理会话发送一次。可分阶段生效的维护失败保留未知。 */
  private async executeAutocommit(connection: PostgresConnection, prepared: Prepared,
    operation: NonNullable<Plan['autocommit']>): Promise<PostgresCreateTableOutcome> {
    let sent = false, acknowledged = false;
    try {
      const { plan, targetStamp } = prepared;
      if (plan.statements.length !== 1 || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('此操作需要独立的事务外会话');
      await connection.query("SET statement_timeout = '120s'", undefined, budget());
      await connection.query("SET lock_timeout = '5s'", undefined, budget());
      if (plan.requireNoWarnings) await connection.query('SET client_min_messages = warning', undefined, budget());
      if (await plan.preflight(connection) !== targetStamp) throw Error('原操作预览已变化');
      sent = true;
      let warned = false;
      const reply = await connection.query(plan.statements[0], undefined, budget(), undefined, 'extended',
        plan.requireNoWarnings ? () => { warned = true; } : undefined);
      if (warned || reply.postgresCommand !== operation.tag || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('PostgreSQL 未确认完整操作回执');
      acknowledged = true;
      await plan.verify(connection, targetStamp);
      return { outcome: 'committed', table: plan.table, message: plan.success };
    } catch (reason) {
      const error = connection.error(reason) as Error & { postgresSqlState?: string };
      if (!sent) return { outcome: 'notSent', message: error.message };
      if (!operation.partial && !acknowledged && error.postgresSqlState && connection.state().transactionKnown && !connection.state().transactionOpen)
        return { outcome: 'rolledBack', message: error.message };
      return { outcome: 'unknown', message: error.message };
    }
  }

  /** 原连接断开或换目标后不再允许消费已签发预览。 */
  clear(connectionId: string): void {
    for (const [id, value] of this.plans) if (value.input.connectionId === connectionId) this.plans.delete(id);
  }

  /** 冷打开的建表预览也要参与连接关闭路由。 */
  connectionIds(): string[] {
    return [...new Set([...this.plans.values()].map(value => value.input.connectionId))];
  }
}
