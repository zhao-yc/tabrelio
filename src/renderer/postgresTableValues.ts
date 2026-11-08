import type { DataRow, FilterGroup, FilterRule } from '../shared/contracts';
import { FILTER_LIMITS } from '../shared/filtering';
import { postgresAdvancedTableFilterSchema, type PostgresAdvancedTableFilter, type PostgresTableColumn } from '../shared/postgresTable';
import { tableSelectedFilterZh as text } from './locales/tableSelectedFilter.zh-CN';

/** 只取勾选行的原值，按服务器可原生比较的字段准入。任一值无效时拒绝整组。 */
export function postgresSelectedTableValues(column: PostgresTableColumn, rows: readonly DataRow[], selected: ReadonlySet<number>) {
  if (!column.valueOptions || column.binary || !selected.size || selected.size > rows.length) throw Error(text.unavailable);
  const values = new Set<string | null>();
  for (const index of [...selected].sort((left, right) => left - right)) {
    const row = rows[index];
    const value: unknown = Number.isSafeInteger(index) && row ? Object.getOwnPropertyDescriptor(row, column.key)?.value : undefined;
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' &&
        !(typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))))
      throw Error(text.unavailable);
    const literal = value === null ? null : String(value);
    if (literal !== null && literal.length > FILTER_LIMITS.valueLength) throw Error(text.budget);
    values.add(literal);
    if (values.size - Number(values.has(null)) > FILTER_LIMITS.setValues) throw Error(text.budget);
  }
  const result = [...values];
  appendPostgresValueFilter({ rules: [], mode: 'all' }, column.name, result, false);
  return result;
}

/** 将包含／排除的完整 NULL 补集与当前草稿相交，保留原 OR 条件及子组。 */
export function appendPostgresValueFilter(
  current: PostgresAdvancedTableFilter, column: string, values: readonly (string | null)[], exclude: boolean,
): PostgresAdvancedTableFilter {
  if (!values.length) throw Error('请选择至少一个不同值');
  const present = values.includes(null);
  const nonNull = values.filter((value): value is string => value !== null);
  const added: FilterRule[] = [];
  if (nonNull.length) added.push({ column, operator: exclude ? 'NOT IN' : 'IN', values: nonNull });
  if (present || exclude) added.push({ column, operator: present && exclude ? 'IS NOT NULL' : 'IS NULL' });
  const indices = added.map((_, index) => current.rules.length + index);
  const mode = exclude && present ? 'all' : 'any';
  const tail: number | FilterGroup = indices.length === 1 ? indices[0] : { mode, children: indices };
  const original = current.group ?? { mode: current.mode, children: current.rules.map((_, index) => index) };
  const head = current.mode === 'all' ? original.children : current.rules.length ? [original] : [];
  return postgresAdvancedTableFilterSchema.parse({
    rules: [...current.rules, ...added], mode: 'all', group: { mode: 'all', children: [...head, tail] },
  });
}
