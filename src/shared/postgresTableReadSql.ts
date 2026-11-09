import type { FilterGroup, FilterRule } from './contracts';
import { isTableRangeOperator, isTableTextFilterOperator, tableTextFilterMatch, validateFilterGroup } from './filtering';
import { postgresTableSortRules, type PostgresTableFilter, type PostgresTablePage, type PostgresTablePageInput } from './postgresTable';

/** 浏览、游标和 COPY 共用条件树，参数或字面量的生成由协议入口决定。 */
export function postgresTableCondition(filter: PostgresTableFilter | undefined, column: (name: string) => string,
  bind: (value: string) => string): string {
  if (!filter) return '';
  if ('text' in filter) return filter.text ? 'pg_catalog.strpos(' + column(filter.column) + '::text, ' + bind(filter.text) + ') > 0' : '';
  const { rules, mode } = filter;
  const tree = validateFilterGroup(rules, mode, filter.group) ?? { mode, children: rules.map((_, index) => index) };

  function leaf(rule: FilterRule): string {
    if (rule.enabled === false) return '';
    const name = column(rule.column), operator = rule.operator;
    if (operator === 'IS NULL' || operator === 'IS NOT NULL') return name + ' ' + operator;
    if (isTableTextFilterOperator(operator)) {
      const { comparison, reverse } = tableTextFilterMatch[operator];
      const input = bind(rule.value ?? '');
      const source = reverse ? `pg_catalog.reverse(${name}::text)` : `${name}::text`;
      if (operator === 'TEXT EQUALS') return `${source} COLLATE pg_catalog."C" = ${input}`;
      return `pg_catalog.strpos(${source} COLLATE pg_catalog."C", ${reverse ? `pg_catalog.reverse(${input})` : input}) ${comparison}`;
    }
    if (operator === 'IN' || operator === 'NOT IN')
      return name + ' ' + operator + ' (' + rule.values!.map(bind).join(', ') + ')';
    if (isTableRangeOperator(operator))
      return name + ' ' + operator + ' ' + bind(rule.values![0]) + ' AND ' + bind(rule.values![1]);
    const left = operator === 'LIKE' || operator === 'NOT LIKE' ? name + '::text' : name;
    return left + ' ' + operator + ' ' + bind(rule.value ?? '');
  }

  function visit(group: FilterGroup): string {
    const children = group.children.map(child => typeof child === 'number' ? leaf(rules[child]) : visit(child)).filter(Boolean);
    return children.length < 2 ? children[0] ?? '' : '(' + children.join(group.mode === 'all' ? ' AND ' : ' OR ') + ')';
  }
  return visit(tree);
}

/** 显式排序保留 NULL 位置。普通表和分区表补相同的主键或物理排序键。 */
export function postgresTableReadOrder(sort: PostgresTablePageInput['sort'], kind: PostgresTablePage['relationKind'],
  primaryKey: readonly string[], column: (name: string) => string): string[] {
  const rules = postgresTableSortRules(sort).map(rule => ({ ...rule, column: column(rule.column) }));
  const tie = primaryKey.length ? primaryKey.map(column) : kind === 'r' ? ['ctid'] : kind === 'p' ? ['tableoid', 'ctid'] : [];
  return [
    ...rules.map(rule => `${rule.column} ${rule.direction}${rule.nulls ? ` NULLS ${rule.nulls}` : ''}`),
    ...tie.filter(key => !rules.some(rule => rule.column === key)),
  ];
}
