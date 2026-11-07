import { z } from 'zod';
import {
  acceptsPostgresDefaultPreset, matchesPostgresDefaultPreset, postgresColumnDefinition, postgresColumnTypeSchema,
  postgresColumnTypeSql, postgresCreateColumnSchema, postgresDdlLiteral, postgresDdlText,
  postgresDefaultPresetSchema, postgresDefaultPresetSql, postgresGenerationExpressionSchema,
  postgresGenerationMinimum, postgresNewIdentifier, type PostgresDefaultPreset,
} from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const from = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const changes = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), field: postgresCreateColumnSchema.refine(field => !field.primary, '请在主键管理中修改主键') }).strict(),
  z.object({ kind: z.literal('rename'), from, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('type'), from, dataType: postgresColumnTypeSchema }).strict(),
  z.object({ kind: z.literal('nullable'), from, nullable: z.boolean() }).strict(),
  z.object({ kind: z.literal('default'), from, value: postgresDdlText.nullable() }).strict(),
  z.object({ kind: z.literal('defaultPreset'), from, preset: postgresDefaultPresetSchema }).strict(),
  z.object({ kind: z.literal('generation'), from, expression: postgresGenerationExpressionSchema.nullable() }).strict(),
  z.object({ kind: z.literal('comment'), from, value: postgresDdlText.nullable() }).strict(),
  z.object({ kind: z.literal('drop'), from }).strict(),
])).min(1).max(16);

export const postgresColumnPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: z.string().regex(/^[a-f0-9]{64}$/), changes,
}).strict();
export const postgresColumnApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export type PostgresColumnPreviewInput = z.infer<typeof postgresColumnPreviewSchema>;
export type PostgresColumnApplyInput = z.infer<typeof postgresColumnApplySchema>;
export type PostgresColumnChange = PostgresColumnPreviewInput['changes'][number];
type Column = PostgresStructureResult['columns'][number];
type PlannedColumn = { name: string; position?: number; expected?: {
  type?: string; nullable?: boolean; comment?: string | null; hasDefault?: boolean; collation?: string;
  defaultPreset?: PostgresDefaultPreset;
  generation?: Column['generation'];
} };
type ColumnState = {
  result: PlannedColumn; type: string; collation: Column['collation']; identity: boolean;
  defaultExpression: string | null; generation: Column['generation']; generationExpression: string | null;
};

/** 将白名单类型转成目录 format_type 返回的拼写，用于校验事务中的实际结果。 */
function catalogType(type: string) {
  if (type.startsWith('varchar')) return type.replace('varchar', 'character varying');
  if (type.startsWith('numeric')) return type.replace(', ', ',');
  if (type === 'timestamp') return 'timestamp without time zone';
  if (type === 'timestamptz') return 'timestamp with time zone';
  return type;
}

/** 根据原列及同批前序操作编译 ALTER，并记录提交前必须核对的目录事实。 */
export function postgresColumnPlan(source: PostgresStructureResult, input: PostgresColumnPreviewInput) {
  const { changes, editStamp } = postgresColumnPreviewSchema.parse(input);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const table = postgresIdentifier(source.schema) + '.' + postgresIdentifier(source.name);
  const alter = 'ALTER TABLE ONLY ' + table;
  const columns = new Map<string, ColumnState>(source.columns.map(field => [field.name, {
    result: { name: field.name, position: field.position }, type: field.type,
    collation: field.collation, identity: !!field.identity, generation: field.generation,
    generationExpression: field.generationExpression, defaultExpression: field.defaultExpression,
  }]));
  const order = [...columns.values()];
  const statements: string[] = [];
  const checks: NonNullable<ReturnType<typeof postgresColumnDefinition>['check']>[] = [];
  const presets = new Set<PostgresDefaultPreset>();
  const version = source.serverVersion ?? 0;
  let usesGeneration = false;
  for (const change of changes) {
    if (change.kind === 'add') {
      const { field } = change;
      if (columns.has(field.name)) throw Error('字段名称已存在：' + field.name);
      if (field.generation) {
        const minimum = postgresGenerationMinimum(field.generation.mode);
        if (version < minimum) throw Error('当前生成列模式需要 PostgreSQL ' + minimum / 10000 + ' 或更新版本');
        usesGeneration = true;
      }
      const { sql, check } = postgresColumnDefinition(field);
      statements.push(alter + ' ADD COLUMN ' + sql);
      if (field.comment) statements.push('COMMENT ON COLUMN ' + table + '.' + postgresIdentifier(field.name) + ' IS ' + postgresDdlLiteral(field.comment));
      if (check) checks.push(check);
      const mode = field.default.mode;
      const added: ColumnState = { result: { name: field.name, position: undefined }, type: catalogType(postgresColumnTypeSql(field)),
        collation: null, identity: field.identity !== 'none',
        generation: field.generation ? field.generation.mode === 'stored' ? 's' : 'v' : '',
        generationExpression: field.generation?.expression ?? null,
        defaultExpression: field.default.mode === 'literal' ? postgresDdlLiteral(field.default.value) : null };
      if (added.generation) added.result.expected = { generation: added.generation };
      if (mode !== 'none' && mode !== 'literal') {
        presets.add(mode);
        added.result.expected = { defaultPreset: mode };
        added.defaultExpression = postgresDefaultPresetSql[mode];
      }
      columns.set(field.name, added);
      order.push(added);
      continue;
    }

    const column = columns.get(change.from);
    if (!column) throw Error('原字段不存在：' + change.from);
    const identifier = postgresIdentifier(change.from);
    if (change.kind === 'rename') {
      if (columns.has(change.name)) throw Error('字段名称已存在：' + change.name);
      statements.push(alter + ' RENAME COLUMN ' + identifier + ' TO ' + postgresIdentifier(change.name));
      columns.delete(change.from);
      columns.set(change.name, column);
      column.result.name = change.name;
      continue;
    }
    if (change.kind === 'drop') {
      statements.push(alter + ' DROP COLUMN ' + identifier + ' RESTRICT');
      columns.delete(change.from);
      order.splice(order.indexOf(column), 1);
      continue;
    }

    const changeColumn = alter + ' ALTER COLUMN ' + identifier;
    const expected = column.result.expected ??= {};
    if (change.kind === 'type') {
      const sql = postgresColumnTypeSql(change.dataType);
      if (expected.defaultPreset && !acceptsPostgresDefaultPreset(sql, expected.defaultPreset))
        throw Error('请先清除同批已设置的服务器默认值，再修改字段类型');
      const collation = ['text', 'varchar'].includes(change.dataType.type) ? column.collation : null;
      // 排序规则来自原目录经 pg_catalog.format('%I.%I', ...) 转义的限定名。
      statements.push(changeColumn + ' TYPE ' + sql + (collation ? ' COLLATE ' + collation : ''));
      column.type = expected.type = catalogType(sql);
      column.collation = collation;
      expected.collation = collation ?? undefined;
    } else if (change.kind === 'nullable') {
      statements.push(changeColumn + (change.nullable ? ' DROP NOT NULL' : ' SET NOT NULL'));
      expected.nullable = change.nullable;
    } else if (change.kind === 'generation') {
      if (!column.generation) throw Error('所选字段不是生成列');
      if (change.expression === null) {
        if (column.generation !== 's' || version < 130000) throw Error('转为普通列需要 PostgreSQL 13 或更新版本的存储生成列');
        statements.push(changeColumn + ' DROP EXPRESSION');
        column.generation = '';
        expected.hasDefault = false;
      } else {
        if (version < 170000) throw Error('修改生成表达式需要 PostgreSQL 17 或更新版本');
        statements.push(changeColumn + ' SET EXPRESSION AS (\n' + change.expression + '\n)');
      }
      usesGeneration = true;
      expected.generation = column.generation;
      column.generationExpression = change.expression;
    } else if (change.kind === 'defaultPreset') {
      if (column.identity || column.generation) throw Error('标识列和生成列不能修改普通默认值');
      if (!acceptsPostgresDefaultPreset(column.type, change.preset)) throw Error('服务器默认值与字段类型不兼容');
      presets.add(change.preset);
      column.defaultExpression = postgresDefaultPresetSql[change.preset];
      statements.push(changeColumn + ' SET DEFAULT ' + column.defaultExpression);
      expected.defaultPreset = change.preset;
      expected.hasDefault = true;
    } else if (change.kind === 'default') {
      if (column.identity || column.generation) throw Error('标识列和生成列不能修改普通默认值');
      const length = /^character varying\((\d+)\)$/.exec(column.type);
      if (change.value !== null && length && [...change.value].length > Number(length[1])) throw Error('默认值超过字段长度');
      statements.push(changeColumn + (change.value === null ? ' DROP DEFAULT' : ' SET DEFAULT ' + postgresDdlLiteral(change.value)));
      column.defaultExpression = change.value === null ? null : postgresDdlLiteral(change.value);
      delete expected.defaultPreset;
      expected.hasDefault = change.value !== null;
    } else {
      statements.push('COMMENT ON COLUMN ' + table + '.' + identifier + ' IS ' +
        (change.value === null ? 'NULL' : postgresDdlLiteral(change.value)));
      expected.comment = change.value || null;
    }
  }
  return {
    table, columns: order.map(column => column.result), statements, checks, presets: [...presets], usesGeneration,
    fields: order.map(({ result, type, identity, generation, generationExpression, defaultExpression }) =>
      ({ name: result.name, type, identity, generation, generationExpression, defaultExpression })),
  };
}

/** 写入事务中回读类型、约束、默认值状态、注释和保留字段的序号。 */
export function matchesPostgresColumnPlan(actual: Column[], planned: PlannedColumn[]) {
  return actual.length === planned.length && actual.every((field, index) => {
    const { name, position, expected } = planned[index];
    return field.name === name && (position === undefined || field.position === position) && (!expected ||
      (expected.type === undefined || field.type === expected.type) &&
      (expected.nullable === undefined || field.nullable === expected.nullable) &&
      (expected.hasDefault === undefined || (field.defaultExpression !== null) === expected.hasDefault) &&
      (expected.generation === undefined || (field.generation === expected.generation &&
        !!field.generationExpression === !!expected.generation)) &&
      (expected.defaultPreset === undefined || matchesPostgresDefaultPreset(field.defaultExpression, expected.defaultPreset)) &&
      (expected.comment === undefined || field.comment === expected.comment) &&
      (expected.collation === undefined || field.collation === expected.collation));
  });
}
