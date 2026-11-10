import type { ColumnInfo, FilterGroup, FilterMode, FilterRule, TableInfo } from './contracts';
import { FILTER_LIMITS, copyFilterRules, validateFilterGroup } from './filtering';
import { assertTableReadUnicode, buildTableFilterSql, tableReadIdentifier, tableReadTextLiteral } from './tableReadSql';
import { tableForeignKeyJoinFilterZh as text } from './tableForeignKeyJoinFilter.zh-CN';
import { foreignKeyJoinSide, foreignKeyJoinSqlAlias, type ForeignKeyJoinSide } from './tableForeignKeyJoinSources';

export interface ForeignKeyJoinFilter extends FilterRule { side: ForeignKeyJoinSide; }
type Source = { columns: readonly Pick<ColumnInfo, 'name' | 'type'>[] };

/** 在复制前拒绝未知属性、访问器和空洞；side以外的形状、原值和总量仍由既有筛选合同核验。 */
function copy(raw: unknown, sources: ReadonlyMap<ForeignKeyJoinSide, Source>): { side: ForeignKeyJoinSide; rule: FilterRule }[] {
  if (!Array.isArray(raw)) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > FILTER_LIMITS.conditions || Reflect.ownKeys(raw).length !== length + 1) throw Error(text.invalid);
  const sides: (ForeignKeyJoinSide)[] = [], rules: FilterRule[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index)); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(text.invalid);
    const value = descriptor.value; if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.invalid);
    const keys = Reflect.ownKeys(value); if (keys.length > 6 || keys.some(key => typeof key !== 'string' || !['side','column','operator','value','values','enabled'].includes(key))) throw Error(text.invalid);
    const fields = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>; let side: unknown;
    for (const key of keys as string[]) { const property = Object.getOwnPropertyDescriptor(value, key); if (!property || !('value' in property) || !property.enumerable) throw Error(text.invalid); if (key === 'side') side = property.value; else Object.defineProperty(fields, key, property); }
    const owner = foreignKeyJoinSide(sources, side); if (!owner) throw Error(text.invalid); sides.push(owner); rules.push(fields as unknown as FilterRule);
  }
  return copyFilterRules(rules).map((rule,index) => ({ side: sides[index], rule }));
}

/** 精确转换、LIKE和集合均复用表页编译；按原表别名限定字段，不文本替换SQL或把值转成JS数值。 */
export function buildForeignKeyJoinWhere(sources: ReadonlyMap<ForeignKeyJoinSide, Source>, raw: unknown, mode: FilterMode, sqlUnits: number, rawGroup?: FilterGroup): string | undefined {
  const filters = copy(raw, sources), group = validateFilterGroup(filters.map(filter => filter.rule), mode, rawGroup);
  let literalUnits = 0;
  const clauses = filters.map(({side,rule}) => {
    const source = sources.get(side)!;
    const original = source.columns.find(column => column.name === rule.column); if (!original) throw Error(text.invalid);
    // 停用条件同样校Unicode；再次启用不能悄悄替换原值或原列名。
    assertTableReadUnicode(rule.column); for (const value of rule.values ?? (rule.value === undefined ? [] : [rule.value])) assertTableReadUnicode(value);
    const columns: ColumnInfo[] = [{ name: original.name, type: original.type, nullable: true, generated: false, extra: '', comment: '', defaultValue: null }];
    const info = { columns } as TableInfo;
    return buildTableFilterSql(info, [rule], 'all', undefined, value => {
      const literal = tableReadTextLiteral(value); literalUnits += literal.length; if (literalUnits > sqlUnits) throw Error(text.budget); return literal;
    }, column => (foreignKeyJoinSqlAlias(side) + '.') + tableReadIdentifier(column)).where;
  });
  /** 保留原条件下标；全停用子组省略，不用真谓词改变OR/AND语义或重编号后取错字段。 */
  function grouped(node: FilterGroup): string | undefined {
    const children = node.children.map(child => typeof child === 'number' ? clauses[child] : grouped(child)).filter((clause): clause is string => clause !== undefined);
    return children.length ? '(' + children.join(node.mode === 'all' ? ' AND ' : ' OR ') + ')' : undefined;
  }
  const active = clauses.filter((clause): clause is string => clause !== undefined);
  const where = group ? grouped(group) : active.length ? '(' + active.join(mode === 'all' ? ' AND ' : ' OR ') + ')' : undefined;
  if (where && where.length > sqlUnits) throw Error(text.budget); return where;
}
