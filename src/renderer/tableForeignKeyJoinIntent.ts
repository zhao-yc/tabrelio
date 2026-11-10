import type { TableInfo } from '../shared/contracts';
import type { IncomingReferenceRelation } from '../shared/incomingReferences';
import { buildForeignKeyJoin, buildMysqlSingleTableSelect, foreignKeyJoinChoices, foreignKeyJoinMetadataKey, type ForeignKeyJoinColumn, type ForeignKeyJoinKind, type ForeignKeyJoinOptions, type ForeignKeyJoinRelation, type MysqlSingleTableSelectOptions } from './tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from './locales/tableForeignKeyJoin.zh-CN';

export interface ForeignKeyJoinTarget { connectionId: string; database: string; table: string; }
export type ForeignKeyJoinRead = (target: ForeignKeyJoinTarget) => Promise<TableInfo>;
export interface FixedForeignKeyJoinStart { foreignKey: string; parent: TableInfo; kind: 'LEFT' | 'RIGHT' }
interface QueryBuilderPreview {
  readonly childKey: string; readonly sql: string; readonly columns: readonly ForeignKeyJoinColumn[];
}
export interface ForeignKeyJoinPreview extends QueryBuilderPreview {
  readonly parent: TableInfo; readonly parentKey: string; readonly relation: ForeignKeyJoinRelation;
  readonly additionalKeys?: readonly string[];
  readonly kind: ForeignKeyJoinKind; readonly options: ForeignKeyJoinOptions;
}
interface SingleTablePreview extends QueryBuilderPreview { readonly options: MysqlSingleTableSelectOptions; }
export type MysqlQueryBuilderPreview = ForeignKeyJoinPreview | SingleTablePreview;

/** 目录只负责定位，生成器仍使用新读到的真实子表外键。按原顺序核对每个映射字段。 */
export function fixedForeignKeyJoinStart(parent: TableInfo, relation: Pick<IncomingReferenceRelation, 'database' | 'table' | 'foreignKey'>, child: TableInfo, kind: FixedForeignKeyJoinStart['kind']): FixedForeignKeyJoinStart {
  const key = relation.foreignKey;
  const actual = foreignKeyJoinChoices(child).find(value => value.name === key.name);
  const actions = child.foreignKeys.find(value => value.name === key.name);
  if (!actual || child.database !== relation.database || child.name !== relation.table ||
      actual.referencedDatabase !== key.referencedDatabase || actual.referencedTable !== key.referencedTable ||
      actions?.onDelete !== key.onDelete || actions?.onUpdate !== key.onUpdate ||
      JSON.stringify([actual.columns, actual.referencedColumns]) !== JSON.stringify([key.columns, key.referencedColumns])) throw Error(text.stale);
  buildForeignKeyJoin(child, parent, actual.name, kind, 1, { childColumns: [], parentColumns: [parent.columns[0]?.name] });
  return { foreignKey: actual.name, parent, kind };
}

/** 只保留结构和来源身份，不持有行、选中记录或服务器筛选，也不修改父页草稿。 */
export class TableForeignKeyJoinIntent {
  readonly source: TableInfo; readonly metadataKey: string;
  private readonly values: readonly unknown[]; private dead = false; private consumed = false;
  private readonly listeners = new Set<() => void>();
  constructor(source: TableInfo, readonly connectionId: string, readonly limit: number, values: readonly unknown[], private readonly guard: () => boolean) {
    this.metadataKey = foreignKeyJoinMetadataKey(source); foreignKeyJoinChoices(source);
    this.source = immutable(structuredClone(source)); this.values = [...values];
  }
  /** 所见来源离开过一次即永久失效，A→B→A和相同SQL不能重新授予打开权限。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  current(): boolean {
    if (!this.dead && !this.consumed) { try { if (!this.guard() || foreignKeyJoinMetadataKey(this.source) !== this.metadataKey) this.invalidate(); } catch { this.invalidate(); } }
    return !this.dead && !this.consumed;
  }
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 打开只消费一次；确认SQL仍由同一结构和选列生成，不信任旧按钮携带的字符串。 */
  consume(preview: MysqlQueryBuilderPreview): string {
    if (!this.current() || preview.childKey !== this.metadataKey) throw Error(text.stale);
    const sql = 'parent' in preview ? checkedJoinSql(this, preview) : buildMysqlSingleTableSelect(this.source, this.limit, preview.options).sql;
    if (sql !== preview.sql) throw Error(text.stale);
    this.consumed = true; return preview.sql;
  }
}

/** 原目录回包需满足真实父目标；helper同时检查对应FK字段存在且关系方向匹配。 */
export function foreignKeyJoinPreview(intent: TableForeignKeyJoinIntent, parent: TableInfo, relation: ForeignKeyJoinRelation, kind: ForeignKeyJoinKind, options: ForeignKeyJoinOptions): ForeignKeyJoinPreview {
  if (!intent.current()) throw Error(text.stale);
  // 在structuredClone之前检查新排序及上限的自有数据属性，不能先执行输入访问器。
  buildForeignKeyJoin(intent.source, parent, relation, kind, intent.limit, options);
  const target = immutable(structuredClone(parent)), selection = immutable(structuredClone(options));
  const mapping = immutable(structuredClone(relation));
  const result = buildForeignKeyJoin(intent.source, target, mapping, kind, intent.limit, selection);
  return Object.freeze({ parent: target, parentKey: foreignKeyJoinMetadataKey(target), childKey: intent.metadataKey, relation: mapping, kind, options: selection, sql: result.sql, columns: immutable(result.columns),
    ...(selection.additionalJoins ? { additionalKeys: Object.freeze(selection.additionalJoins.map(step => foreignKeyJoinMetadataKey(step.target))) } : {}) });
}

/** 单表与 JOIN 使用相同的不可变回执和单次消费，选列与条件仍在克隆前验证。 */
export function mysqlSingleTablePreview(intent: TableForeignKeyJoinIntent, options: MysqlSingleTableSelectOptions): SingleTablePreview {
  if (!intent.current()) throw Error(text.stale);
  const { sql, columns } = buildMysqlSingleTableSelect(intent.source, intent.limit, options);
  return Object.freeze({ childKey: intent.metadataKey, options: immutable(structuredClone(options)), sql, columns: immutable(columns) });
}

function checkedJoinSql(intent: TableForeignKeyJoinIntent, preview: ForeignKeyJoinPreview): string {
  const steps = preview.options.additionalJoins ?? [], keys = preview.additionalKeys ?? [];
  if (foreignKeyJoinMetadataKey(preview.parent) !== preview.parentKey || steps.length !== keys.length ||
      steps.some((step, index) => foreignKeyJoinMetadataKey(step.target) !== keys[index])) throw Error(text.stale);
  return buildForeignKeyJoin(intent.source, preview.parent, preview.relation, preview.kind, intent.limit, preview.options).sql;
}

/** 按顺序重读各真实目标。同一物理表在一次核验中只读取一次，仍按各别名核对签名。 */
export async function revalidateForeignKeyJoin(intent: TableForeignKeyJoinIntent, preview: MysqlQueryBuilderPreview, read: ForeignKeyJoinRead, current: () => boolean): Promise<void> {
  const assert = () => { if (!intent.current() || !current()) throw Error(text.stale); };
  const reject = () => { intent.invalidate(); throw Error(text.stale); };
  const checked = new Map<string, TableInfo>();
  async function check(target: TableInfo, expected: string | undefined): Promise<TableInfo> {
    assert();
    const key = JSON.stringify([target.database, target.name]);
    const info = checked.get(key) ?? await read({ connectionId: intent.connectionId, database: target.database, table: target.name });
    assert();
    if (foreignKeyJoinMetadataKey(info) !== expected) reject();
    checked.set(key, info);
    return info;
  }
  const child = await check(intent.source, preview.childKey);
  if (!('parent' in preview)) {
    if (buildMysqlSingleTableSelect(child, intent.limit, preview.options).sql !== preview.sql) reject();
    return;
  }
  const parent = await check(preview.parent, preview.parentKey);
  const options = { ...preview.options };
  if (options.additionalJoins) {
    const steps = [];
    for (const [index, step] of options.additionalJoins.entries()) {
      steps.push({ ...step, target: await check(step.target, preview.additionalKeys?.[index]) });
    }
    options.additionalJoins = steps;
  }
  assert();
  if (buildForeignKeyJoin(child, parent, preview.relation, preview.kind, intent.limit, options).sql !== preview.sql) reject();
}

/** 冻结仅用于本地只读结构快照，不改变正式metadata回包或原表页对象。 */
function immutable<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value)) immutable(item); Object.freeze(value); } return value; }
