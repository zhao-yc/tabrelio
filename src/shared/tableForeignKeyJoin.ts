import { queryBuilderOffsetError, queryBuilderOffsetSchema } from './queryBuilderOffset';
import { assertMysqlQueryProjection, mysqlQueryOutputKey, mysqlQueryProjectionLimit, mysqlQueryProjectionSchema,
  type MysqlQueryProjection } from './mysqlQueryProjection';
import { queryBuilderOutputAliases } from './queryBuilderProjection';
import { foreignKeyJoinSide, foreignKeyJoinSqlAlias, type ForeignKeyJoinSide } from './tableForeignKeyJoinSources';
import type { FilterGroup, FilterMode, TableInfo } from './contracts';
import { buildForeignKeyJoinWhere, type ForeignKeyJoinFilter } from './tableForeignKeyJoinFilters';
import { buildForeignKeyJoinSummary, type ForeignKeyJoinSummary } from './tableForeignKeyJoinSummary';
import { tableForeignKeyJoinSummaryZh as summaryText } from './tableForeignKeyJoinSummary.zh-CN';
import { buildForeignKeyJoinHaving, type ForeignKeyJoinHaving } from './tableForeignKeyJoinHaving';
import { tableForeignKeyJoinHavingZh as havingText } from './tableForeignKeyJoinHaving.zh-CN';
import { tableForeignKeyJoinZh as text } from './tableForeignKeyJoin.zh-CN';

export const foreignKeyJoinLimits = { columns: 4096, foreignKeys: 512, mappingColumns: 4096, manualPairs: 64, additionalJoins: 6, metadataUnits: 2 * 1024 * 1024, outputColumns: mysqlQueryProjectionLimit, sorts: 20, rows: 100000, sqlUnits: 256 * 1024 } as const;
export type ForeignKeyJoinKind = 'LEFT' | 'RIGHT' | 'INNER';
export { manualJoinOperators } from './manualJoinDesigns';
import { manualJoinOnGroup, manualJoinOperators, type ManualJoinOn } from './manualJoinDesigns';
export type ManualJoinOperator = typeof manualJoinOperators[number];
export interface ManualJoinPair { child: string; parent: string; operator?: ManualJoinOperator }
export interface AdditionalJoinPair extends ManualJoinPair { source?: number }

/** 只允许已知比较符；界面和生成器共用校验，避免任意表达式进入 ON。 */
export function isManualJoinOperator(value: unknown): value is ManualJoinOperator {
  return manualJoinOperators.some(operator => operator === value);
}
export type ForeignKeyJoinRelation = string | readonly ManualJoinPair[];
export interface ManualJoinStep {
  source: number;
  target: TableInfo;
  kind: 'INNER' | 'LEFT';
  pairs: readonly AdditionalJoinPair[];
  on?: ManualJoinOn;
  columns: readonly string[];
}

/** 序号固定生成 SQL 别名，重复加入同一物理表时仍是不同来源。 */
export function manualJoinAlias(index: number): 'c' | 'p' | `t${number}` {
  return index === 0 ? 'c' : index === 1 ? 'p' : `t${index + 1}`;
}
export interface ForeignKeyJoinChoice { name: string; columns: string[]; referencedDatabase: string; referencedTable: string; referencedColumns: string[] }
export interface ForeignKeyJoinColumn { side: ForeignKeyJoinSide | 'aggregate'; column: string; alias: string }
export interface ForeignKeyJoinSort { side: ForeignKeyJoinSide | 'aggregate'; column: string; direction: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST'; }
export interface MysqlSingleTableSelectOptions { childColumns: readonly string[]; projection?: MysqlQueryProjection; distinct?: boolean; sort?: readonly ForeignKeyJoinSort[]; limit?: number; offset?: number; filters?: readonly ForeignKeyJoinFilter[]; filterMode?: FilterMode; filterGroup?: FilterGroup; summary?: ForeignKeyJoinSummary; having?: ForeignKeyJoinHaving; }
export interface ForeignKeyJoinOptions extends MysqlSingleTableSelectOptions { parentColumns: readonly string[]; unmatchedOnly?: boolean; manualOn?: ManualJoinOn; additionalJoins?: readonly ManualJoinStep[]; }
type Budget = { units: number };

/** 只读自有数据属性；不会为了生成SELECT访问DDL、默认值、注释或调用访问器。 */
function own(value: unknown, key: string, optional = false): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (optional && !(key in value)) return undefined; throw Error(text.invalid); }
  if (!descriptor.enumerable || !('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}

/** 数量在枚举前检查，拒绝稀疏数组和附加字段，不执行自定义迭代器。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) throw Error(text.invalid);
  if (length > maximum) throw Error(text.budget);
  if (Reflect.ownKeys(value).length !== length + 1) throw Error(text.invalid);
  const copy: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !('value' in item)) throw Error(text.invalid);
    copy.push(item.value);
  }
  return copy;
}

/** 按JSON转义后的UTF16长度计入整体预算，拒绝孤立代理项且不先序列化超大字符串。 */
function string(value: unknown, maximum: number, budget: Budget, empty = true): string {
  if (typeof value !== 'string' || !empty && !value.length) throw Error(text.invalid);
  if (value.length > maximum) throw Error(text.budget);
  let size = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error(text.invalid);
      size += 2;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw Error(text.invalid);
    else size += code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 ? 6 : 1;
  }
  budget.units += size;
  if (budget.units > foreignKeyJoinLimits.metadataUnits) throw Error(text.budget);
  return value;
}
function identifier(value: unknown, budget: Budget): string {
  const result = string(value, 64, budget, false);
  if (result.includes('\0')) throw Error(text.invalid);
  return result;
}
function flag(value: unknown): boolean { if (typeof value !== 'boolean') throw Error(text.invalid); return value; }
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';

/** 快照只包括SELECT及关联身份有关的属性；完整外键目录参与失效检查。 */
function snapshot(info: TableInfo) {
  const budget = { units: 0 };
  if (own(info, 'objectKind', true) !== 'table') throw Error(text.ordinary);
  const database = identifier(own(info, 'database'), budget), name = identifier(own(info, 'name'), budget);
  const engine = string(own(info, 'engine'), 128, budget);
  const optional = (record: unknown, key: string) => { const value = own(record, key, true); return value == null ? null : string(value, 255, budget); };
  const columns = array(own(info, 'columns'), foreignKeyJoinLimits.columns).map(value => {
    budget.units += 128;
    return { name: identifier(own(value, 'name'), budget), type: string(own(value, 'type'), 4096, budget, false), nullable: flag(own(value, 'nullable')), generated: flag(own(value, 'generated')), extra: string(own(value, 'extra'), 4096, budget), characterSet: optional(value, 'characterSet') };
  });
  const names = new Set(columns.map(column => column.name));
  if (!columns.length || names.size !== columns.length) throw Error(text.columns);
  const list = (value: unknown) => array(value, foreignKeyJoinLimits.mappingColumns).map(item => identifier(item, budget));
  const foreignKeys = array(own(info, 'foreignKeys'), foreignKeyJoinLimits.foreignKeys).map(value => {
    budget.units += 128;
    const key = { name: identifier(own(value, 'name'), budget), columns: list(own(value, 'columns')), referencedDatabase: identifier(own(value, 'referencedDatabase'), budget), referencedTable: identifier(own(value, 'referencedTable'), budget), referencedColumns: list(own(value, 'referencedColumns')), onUpdate: string(own(value, 'onUpdate'), 64, budget, false), onDelete: string(own(value, 'onDelete'), 64, budget, false) };
    if (!key.columns.length || key.columns.length !== key.referencedColumns.length || new Set(key.columns).size !== key.columns.length || new Set(key.referencedColumns).size !== key.referencedColumns.length || key.columns.some(column => !names.has(column))) throw Error(text.relation);
    return key;
  });
  if (new Set(foreignKeys.map(key => key.name)).size !== foreignKeys.length) throw Error(text.relation);
  const result = { database, name, kind: 'table' as const, engine, charset: optional(info, 'charset'), collation: optional(info, 'collation'), columns, foreignKeys };
  if (JSON.stringify(result).length > foreignKeyJoinLimits.metadataUnits) throw Error(text.budget);
  return result;
}

/** 结构签名不持有原对象引用；列重排、类型及任一外键变化都会使旧预览失效。 */
export function foreignKeyJoinMetadataKey(info: TableInfo): string { return JSON.stringify(snapshot(info)); }

/** 仅返回真实、完整的出向外键；返回副本不能改写原表元数据。 */
export function foreignKeyJoinChoices(child: TableInfo): ForeignKeyJoinChoice[] {
  return snapshot(child).foreignKeys.map(key => ({ name: key.name, columns: [...key.columns], referencedDatabase: key.referencedDatabase, referencedTable: key.referencedTable, referencedColumns: [...key.referencedColumns] }));
}

/** 显式选列整份校验且保持请求顺序，不能把错列静默过滤为另一条查询。 */
function selected(value: unknown, columns: { name: string }[]): string[] {
  const supplied = array(value, foreignKeyJoinLimits.columns);
  const names = new Set(columns.map(column => column.name)), seen = new Set<string>();
  return supplied.map(item => {
    if (typeof item !== 'string' || !names.has(item) || seen.has(item)) throw Error(text.columns);
    seen.add(item); return item;
  });
}

/** 从选中字段的可信目录创建结果列，用户别名仅影响最终列名。 */
function arrangeProjection(columns: (ForeignKeyJoinColumn & { side: ForeignKeyJoinSide })[], raw: unknown): ForeignKeyJoinColumn[] {
  if (raw === undefined) return columns;
  const projection = mysqlQueryProjectionSchema.parse(array(raw, mysqlQueryProjectionLimit).map(item => {
    const column = own(item, 'column'), alias = own(item, 'alias', true);
    if (Reflect.ownKeys(item as object).some(key => key !== 'column' && key !== 'alias')) throw Error(text.invalid);
    return { column, alias };
  }));
  const byKey = new Map(columns.map(column => [mysqlQueryOutputKey(column.side, column.column), column]));
  assertMysqlQueryProjection(projection, [...byKey.keys()]);
  const keys = projection.map(item => item.column);
  const aliases = queryBuilderOutputAliases(keys, projection.flatMap(item => item.alias === undefined ? [] : [{ column: item.column, alias: item.alias }]),
    key => byKey.get(key)!.alias, name => name.toLowerCase());
  return keys.map(key => ({ ...byKey.get(key)!, alias: aliases.get(key) ?? byKey.get(key)!.alias }));
}

/** 别名绑定原列序号而非选中顺序；截断按Unicode字符进行，不切坏代理对。 */
export function foreignKeyJoinColumnAlias(side: ForeignKeyJoinSide, ordinal: number, name: string): string {
  const prefix = foreignKeyJoinSqlAlias(side) + '_' + ordinal + '_';
  let suffix = '';
  for (const character of name) { if (prefix.length + suffix.length + character.length > 64) break; suffix += character; }
  return prefix + suffix;
}

/** 输入期间保留原文本；只接受完整十进制整数，不将空值、指数或小数默默改成默认上限。 */
export function foreignKeyJoinResultLimit(value: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) throw Error(text.limitInvalid);
  const limit = Number(value); if (limit > foreignKeyJoinLimits.rows) throw Error(text.limitInvalid); return limit;
}

/** 排序按各表真实目录独立定位；普通明细允许未输出列，去重只接受完整投影内的列，不猜测补键。 */
function order(raw: unknown, sources: ReadonlyMap<ForeignKeyJoinSide, ReturnType<typeof snapshot>>, summary?: ReturnType<typeof buildForeignKeyJoinSummary>, projected?: ReadonlySet<string>): string {
  if (raw === undefined) return '';
  const seen = new Set<string>();
  return array(raw, foreignKeyJoinLimits.sorts).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(key => !['side', 'column', 'direction', 'nulls'].includes(key as string))) throw Error(text.sortInvalid);
    const rawSide = own(value, 'side'), side = rawSide === 'aggregate' ? rawSide : foreignKeyJoinSide(sources, rawSide), column = own(value, 'column'), direction = own(value, 'direction'), nulls = own(value, 'nulls', true);
    if (!side || typeof column !== 'string' || direction !== 'ASC' && direction !== 'DESC' || nulls !== undefined && nulls !== 'FIRST' && nulls !== 'LAST') throw Error(text.sortInvalid);
    if (side === 'aggregate' ? !summary?.aggregateAliases.has(column) : !sources.get(side)!.columns.some(item => item.name === column)) throw Error(text.sortInvalid);
    if (summary && side !== 'aggregate' && !summary.keys.has(JSON.stringify([side,column]))) throw Error(summaryText.sort);
    // DISTINCT按完整输出去重；不能偷偷追加排序字段，否则会改变去重集合及结果行数。
    if (projected && !projected.has(JSON.stringify([side, column]))) throw Error(text.distinctSort);
    const key = JSON.stringify([side, column]); if (seen.has(key)) throw Error(text.sortInvalid); seen.add(key);
    // 聚合排序绑定原表达式，避免别名与输入列同名或在NULL分桶表达式中被服务器另作解析。
    const reference = side === 'aggregate' ? summary!.aggregateReferences.get(column)! : foreignKeyJoinSqlAlias(side) + '.' + quote(column), term = reference + ' ' + direction;
    return nulls === undefined ? [term] : ['(' + reference + ' IS NULL) ' + (nulls === 'FIRST' ? 'DESC' : 'ASC'), term];
  }).join(', ');
}

type JoinCondition = Required<AdditionalJoinPair>;

/** 追加表逐条件解析左侧来源。旧设计未指定来源时沿用该步骤的原表。 */
function joinConditions(sources: readonly ReturnType<typeof snapshot>[], defaultSource: number, right: ReturnType<typeof snapshot>, input: ForeignKeyJoinRelation): JoinCondition[] {
  const parentNames = new Set(right.columns.map(column => column.name));
  if (typeof input !== 'string') {
    const childNames = sources.map(table => new Set(table.columns.map(column => column.name)));
    const seen = new Set<string>();
    const conditions = array(input, foreignKeyJoinLimits.manualPairs).map(value => {
      const child = own(value, 'child'), parent = own(value, 'parent'), suppliedOperator = own(value, 'operator', true);
      const suppliedSource = own(value, 'source', true);
      const source = suppliedSource === undefined ? defaultSource : suppliedSource;
      const operator = suppliedOperator === undefined ? '=' : suppliedOperator;
      if (Reflect.ownKeys(value as object).some(key => key !== 'child' && key !== 'parent' && key !== 'operator' && (key !== 'source' || sources.length === 1)) ||
          typeof source !== 'number' || !Number.isInteger(source) || source < 0 || source >= sources.length ||
          typeof child !== 'string' || typeof parent !== 'string' || !childNames[source].has(child) || !parentNames.has(parent) ||
          !isManualJoinOperator(operator)) throw Error(text.manualInvalid);
      const identity = JSON.stringify([source, child, operator, parent]);
      if (seen.has(identity)) throw Error(text.manualInvalid);
      seen.add(identity);
      return { source, child, operator, parent };
    });
    if (!conditions.length) throw Error(text.manualInvalid);
    return conditions;
  }
  const relation = sources[0].foreignKeys.find(key => key.name === input);
  if (!relation) throw Error(text.relation);
  if (right.database !== relation.referencedDatabase || right.name !== relation.referencedTable) throw Error(text.target);
  if (relation.referencedColumns.some(column => !parentNames.has(column))) throw Error(text.relation);
  return relation.columns.map((child, index) => ({ source: 0, child, operator: '=', parent: relation.referencedColumns[index] }));
}

/** 扁平 AND 沿用原字节布局；分组仅组合经过目录校验的 ON 叶子。 */
function compileOn(raw: unknown, conditions: readonly JoinCondition[], alias: string) {
  let mode: FilterMode = 'all', group: FilterGroup | undefined;
  if (raw !== undefined) {
    const suppliedMode = own(raw, 'mode');
    if (suppliedMode !== 'all' && suppliedMode !== 'any' ||
        Reflect.ownKeys(raw as object).some(key => key !== 'mode' && key !== 'group')) throw Error(text.manualOnInvalid);
    mode = suppliedMode;
    const suppliedGroup = own(raw, 'group', true);
    try { group = manualJoinOnGroup({ mode, group: suppliedGroup as FilterGroup | undefined }, conditions.length); }
    catch { throw Error(text.manualOnInvalid); }
  }
  const leaves = conditions.map(({ source, child, operator, parent }) => `${manualJoinAlias(source)}.${quote(child)} ${operator} ${alias}.${quote(parent)}`);
  function grouped(node: FilterGroup): string {
    return '(' + node.children.map(child => typeof child === 'number' ? leaves[child] : grouped(child)).join(node.mode === 'all' ? ' AND ' : ' OR ') + ')';
  }
  return { sql: group ? '  ' + grouped(group) + '\n' : '  ' + leaves.join(mode === 'all' ? '\n  AND ' : '\n  OR ') + '\n',
    needsAllMarkers: !!group || mode === 'any' };
}

/** 追加步骤按原顺序验证，仅能连接到已出现的别名。 */
function additionalJoins(raw: unknown, left: ReturnType<typeof snapshot>, right: ReturnType<typeof snapshot>) {
  const sources = [left, right];
  return array(raw, foreignKeyJoinLimits.additionalJoins).map((step, index) => {
    const source = own(step, 'source'), kind = own(step, 'kind'), target = own(step, 'target'), pairs = own(step, 'pairs');
    if (typeof source !== 'number' || !Number.isInteger(source) || source < 0 || source >= sources.length ||
        kind !== 'INNER' && kind !== 'LEFT' || !Array.isArray(pairs) ||
        Reflect.ownKeys(step as object).some(key => !['source', 'kind', 'target', 'pairs', 'columns', 'on'].includes(key as string))) throw Error(text.manualInvalid);
    const metadata = snapshot(target as TableInfo), conditions = joinConditions(sources, source, metadata, pairs);
    const columns = selected(own(step, 'columns'), metadata.columns);
    sources.push(metadata);
    const alias = `t${index + 3}` as const;
    return { metadata, kind, on: compileOn(own(step, 'on', true), conditions, alias), columns, alias };
  });
}

/** 生成MySQL/MariaDB独立只读单语句；不猜测主键、不继承父页条件，也不执行SQL。 */
export function buildForeignKeyJoin(child: TableInfo, parent: TableInfo, input: ForeignKeyJoinRelation, kind: ForeignKeyJoinKind, limit: number, options?: ForeignKeyJoinOptions): { sql: string; columns: ForeignKeyJoinColumn[] } {
  if (kind !== 'LEFT' && kind !== 'RIGHT' && kind !== 'INNER') throw Error(text.invalid);
  return buildSelect(child, limit, options, { parent, input, kind });
}

/** 单表设计只接收一张表的字段和读取选项，不接受任何 JOIN 配置。 */
export function buildMysqlSingleTableSelect(source: TableInfo, limit: number, options: MysqlSingleTableSelectOptions): { sql: string; columns: ForeignKeyJoinColumn[] } {
  return buildSelect(source, limit, options);
}

function buildSelect(child: TableInfo, limit: number, options?: MysqlSingleTableSelectOptions,
  join?: { parent: TableInfo; input: ForeignKeyJoinRelation; kind: ForeignKeyJoinKind }): { sql: string; columns: ForeignKeyJoinColumn[] } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > foreignKeyJoinLimits.rows) throw Error(text.invalid);
  const left = snapshot(child), right = join && snapshot(join.parent);
  const conditions = join && right ? joinConditions([left], 0, right, join.input) : [];
  let childColumns: string[], parentColumns: string[] = [], rawSort: unknown, rawSummary: unknown, rawHaving: unknown, unmatchedOnly = false, distinct = false, resultLimit = limit, where: string | undefined;
  let extra: ReturnType<typeof additionalJoins> = [], resultOffset = 0, rawProjection: unknown;
  let firstOn = right ? compileOn(undefined, conditions, 'p') : undefined;
  const sources = new Map<ForeignKeyJoinSide, ReturnType<typeof snapshot>>([['child', left]]);
  if (right) sources.set('parent', right);
  if (options === undefined) { childColumns = left.columns.map(column => column.name); parentColumns = right?.columns.map(column => column.name) ?? []; }
  else {
    const keys = ['childColumns', 'projection', 'distinct', 'sort', 'limit', 'offset', 'filters', 'filterMode', 'filterGroup', 'summary', 'having'];
    if (right) keys.push('parentColumns', 'unmatchedOnly', 'manualOn', 'additionalJoins');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).some(key => !keys.includes(key as string))) throw Error(text.invalid);
    childColumns = selected(own(options, 'childColumns'), left.columns);
    rawProjection = own(options, 'projection', true);
    if (join && right) {
      parentColumns = selected(own(options, 'parentColumns'), right.columns);
      const manualOn = own(options, 'manualOn', true);
      if (manualOn !== undefined) {
        if (typeof join.input === 'string') throw Error(text.manualOnInvalid);
        firstOn = compileOn(manualOn, conditions, 'p');
      }
      const rawJoins = own(options, 'additionalJoins', true);
      if (rawJoins !== undefined) {
        if (typeof join.input === 'string') throw Error(text.manualInvalid);
        extra = additionalJoins(rawJoins, left, right);
        for (const step of extra) sources.set(step.alias, step.metadata);
      }
      const suppliedUnmatched = own(options, 'unmatchedOnly', true);
      if (suppliedUnmatched !== undefined) unmatchedOnly = flag(suppliedUnmatched);
    }
    rawSort = own(options, 'sort', true); rawSummary = own(options, 'summary', true); rawHaving = own(options, 'having', true);
    const suppliedDistinct = own(options, 'distinct', true);
    if (suppliedDistinct !== undefined) distinct = flag(suppliedDistinct);
    const filters = own(options, 'filters', true), mode = own(options, 'filterMode', true), group = own(options, 'filterGroup', true);
    if (filters !== undefined || mode !== undefined || group !== undefined) { if (mode !== undefined && mode !== 'all' && mode !== 'any') throw Error(text.invalid); where = buildForeignKeyJoinWhere(sources, filters === undefined ? [] : filters, mode === undefined ? 'all' : mode, foreignKeyJoinLimits.sqlUnits, group as FilterGroup | undefined); }
    const suppliedLimit = own(options, 'limit', true);
    if (suppliedLimit !== undefined) { if (typeof suppliedLimit !== 'number' || !Number.isSafeInteger(suppliedLimit) || suppliedLimit < 1 || suppliedLimit > foreignKeyJoinLimits.rows) throw Error(text.limitInvalid); resultLimit = suppliedLimit; }
    const suppliedOffset = own(options, 'offset', true);
    if (suppliedOffset !== undefined) {
      const checked = queryBuilderOffsetSchema.safeParse(suppliedOffset);
      if (!checked.success) throw Error(queryBuilderOffsetError);
      resultOffset = checked.data;
    }
  }
  if (join && firstOn && unmatchedOnly) {
    if (join.kind === 'INNER') throw Error(text.unmatchedInvalid);
    // 带 OR 时任一比较都可能单独匹配。只有候选列全部为 NULL 才能认定是外连接补空行。
    const markers = firstOn.needsAllMarkers ? conditions : conditions.slice(0, 1);
    const missing = [...new Set(markers.map(condition => (join.kind === 'LEFT' ? 'p.' + quote(condition.parent) : 'c.' + quote(condition.child)) + ' IS NULL'))].join(' AND ');
    // 用户条件编译器已为整个分组加括号，顶层 OR 也不能绕过未匹配限制。
    where = where ? missing + ' AND ' + where : missing;
  }
  if (distinct && rawSummary !== undefined) throw Error(text.distinctMode);
  const projected = distinct ? new Set([...childColumns.map(column => JSON.stringify(['child', column])), ...parentColumns.map(column => JSON.stringify(['parent', column])),
    ...extra.flatMap(step => step.columns.map(column => JSON.stringify([step.alias, column])))]) : undefined;
  const summary = rawSummary === undefined ? undefined : buildForeignKeyJoinSummary(sources, rawSummary, foreignKeyJoinColumnAlias), ordering = order(rawSort, sources, summary, projected);
  if(rawHaving!==undefined&&!summary)throw Error(havingText.requiresSummary);
  const having=rawHaving===undefined?undefined:buildForeignKeyJoinHaving(summary!.outputs,rawHaving,foreignKeyJoinLimits.sqlUnits);
  const count = childColumns.length + parentColumns.length + extra.reduce((total, step) => total + step.columns.length, 0);
  const needsDetail = !summary || rawProjection !== undefined;
  if (needsDetail && !count) throw Error(text.columns);
  if (needsDetail && count > foreignKeyJoinLimits.outputColumns) throw Error(text.budget);
  const detailColumns: (ForeignKeyJoinColumn & { side: ForeignKeyJoinSide })[] = [];
  if (needsDetail) for (const [side, selectedColumns, metadata] of [['child', childColumns, left], ['parent', parentColumns, right]] as const) {
    if (!metadata) continue;
    const ordinals = new Map(metadata.columns.map((column, index) => [column.name, index + 1]));
    for (const column of selectedColumns) detailColumns.push({ side, column, alias: join ? foreignKeyJoinColumnAlias(side, ordinals.get(column)!, column) : column });
  }
  if (needsDetail) for (const step of extra) {
    const ordinals = new Map(step.metadata.columns.map((column, index) => [column.name, index + 1]));
    for (const column of step.columns) detailColumns.push({ side: step.alias, column, alias: foreignKeyJoinColumnAlias(step.alias, ordinals.get(column)!, column) });
  }
  const orderedDetail = arrangeProjection(detailColumns, rawProjection);
  const columns = summary?.columns ?? orderedDetail;
  let sql = distinct ? 'SELECT DISTINCT\n' : 'SELECT\n';
  const append = (part: string) => { if (sql.length + part.length > foreignKeyJoinLimits.sqlUnits) throw Error(text.budget); sql += part; };
  columns.forEach((column, index) => append(`  ${summary ? summary.expressions[index] : (column.side === 'aggregate' ? column.side : foreignKeyJoinSqlAlias(column.side))+'.'+quote(column.column)+' AS '+quote(column.alias)}${index + 1 === columns.length ? '\n' : ',\n'}`));
  append(`FROM ${quote(left.database)}.${quote(left.name)} AS c\n`);
  if (join && right && firstOn) {
    append(`${join.kind} JOIN ${quote(right.database)}.${quote(right.name)} AS p\nON\n`);
    append(firstOn.sql);
  }
  for (const step of extra) {
    append(`${step.kind} JOIN ${quote(step.metadata.database)}.${quote(step.metadata.name)} AS ${step.alias}\nON\n`);
    append(step.on.sql);
  }
  if (where) append('WHERE ' + where + '\n');
  if (summary?.grouping.length) append('GROUP BY '+summary.grouping.join(', ')+'\n');
  if(having)append('HAVING '+having+'\n');
  if (ordering) append('ORDER BY ' + ordering + '\n');
  append(`LIMIT ${resultLimit}${resultOffset ? ' OFFSET ' + resultOffset : ''};`);
  return { sql, columns };
}
