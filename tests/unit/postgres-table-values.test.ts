import { describe, expect, it } from 'vitest';
import { assertPostgresValueDistribution, postgresTableValuesSchema, type PostgresTableColumn } from '../../src/shared/postgresTable';
import { appendPostgresValueFilter, postgresSelectedTableValues } from '../../src/renderer/postgresTableValues';
import { filterDraftFromRule, filterRuleFromDraft } from '../../src/renderer/tableFilters';

describe('PostgreSQL 不同值筛选草稿', () => {
  const field: PostgresTableColumn = {
    key: 'c0', name: '值', type: 'text', nullable: true, generated: false, valueOptions: true,
    defaultValue: false, primary: false, binary: false,
  };

  it('按显示顺序读取勾选原值并去重，保留精确数字、空串、文字 NULL 与真正空值', () => {
    const rows = ['9007199254740993', '', 'NULL', null, '', '未勾选'].map(c0 => ({ c0 }));
    expect(postgresSelectedTableValues(field, rows, new Set([4, 3, 1, 0, 2])))
      .toEqual(['9007199254740993', '', 'NULL', null]);
  });

  it('拒绝整份失效选择、不可比较字段和超预算值', () => {
    const take = new Set([0]);
    expect(() => postgresSelectedTableValues(field, [{ c0: '' }], new Set([1]))).toThrow();
    expect(() => postgresSelectedTableValues({ ...field, valueOptions: undefined }, [{ c0: '' }], take)).toThrow();
    expect(() => postgresSelectedTableValues(field, [{ c0: 'a'.repeat(4097) }], take)).toThrow();
    expect(() => postgresSelectedTableValues(field, [{ c0: 'a\u0000b' }], take)).toThrow();
    expect(() => postgresSelectedTableValues(field, [{ c0: 9007199254740992 }], take)).toThrow();
  });
  it('保留旧的任一满足分组并与新候选相交，空串和多行值保持原文', () => {
    const rules = [{ column: 'id', operator: '=' as const, value: '1' }, { column: 'id', operator: '=' as const, value: '2' }];
    const selected = ['','a\r\nb', null];
    const next = appendPostgresValueFilter({ rules, mode: 'any' }, 'note', selected, false);
    expect(next.group).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: 'any', children: [2, 3] }] });
    expect(next.rules).toEqual([...rules, { column: 'note', operator: 'IN', values: selected.slice(0, 2) },
      { column: 'note', operator: 'IS NULL' }]);
    const draft = filterDraftFromRule(next.rules[2], true);
    expect(draft.valuesJson).toBe(true);
    expect(filterRuleFromDraft(draft, ['note'])).toEqual(next.rules[2]);
  });

  it('排除非空候选保留 NULL，同时排除 NULL 时明确增加非空约束', () => {
    const empty = { rules: [], mode: 'all' as const };
    expect(appendPostgresValueFilter(empty, 'note', [''], true).group?.children).toEqual([{ mode: 'any', children: [0, 1] }]);
    const both = appendPostgresValueFilter(empty, 'note', ['', null], true);
    expect(both.group?.children).toEqual([{ mode: 'all', children: [0, 1] }]);
    expect(both.rules.map(rule => rule.operator)).toEqual(['NOT IN', 'IS NOT NULL']);
    expect(appendPostgresValueFilter(empty, 'note', [null], true).rules).toEqual([{ column: 'note', operator: 'IS NOT NULL' }]);
  });

  it('候选查询只允许原页能力、目录列编号、文本搜索与固定排序', () => {
    const input = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1', search: '_%😀' };
    expect(postgresTableValuesSchema.safeParse(input).success).toBe(true);
    for (const order of ['value', 'count-desc', 'count-asc'])
      expect(postgresTableValuesSchema.parse({ ...input, order }).order).toBe(order);
    expect(postgresTableValuesSchema.safeParse({ ...input, order: 'frequency DESC' }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, filter: {} }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, search: '\0' }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, column: '字段名' }).success).toBe(false);
    expect(postgresTableValuesSchema.parse({ ...input, distribution: true }).distribution).toBe(true);
    expect(postgresTableValuesSchema.safeParse({ ...input, distribution: 'true' }).success).toBe(false);
  });

  it('普通候选保持原回包，类别分布必须守恒并对应读取请求', () => {
    const plain = { options: [{ value: null, count: '8', clipped: false }], truncated: false };
    const result = { ...plain, distribution: { rows: '8', groups: '1' } };
    expect(assertPostgresValueDistribution(plain)).toEqual(plain);
    expect(assertPostgresValueDistribution(result, true)).toEqual(result);
    expect(() => assertPostgresValueDistribution(plain, true)).toThrow();
    expect(() => assertPostgresValueDistribution(result)).toThrow();
    expect(() => assertPostgresValueDistribution({ ...result, truncated: true }, true)).toThrow();
  });
});
