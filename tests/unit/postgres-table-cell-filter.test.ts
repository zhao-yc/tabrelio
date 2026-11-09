import { describe, expect, it } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { postgresTableCellFilterDraft, postgresTableRangeFilterDraft } from '../../src/renderer/postgresTableCellFilter';
import { filterRuleFromDraft } from '../../src/renderer/tableFilters';

const column: ResultColumn = { key: 'c0', name: '列"名', type: 'text' };

function rule(value: DataRow[string], exclude = false) {
  const row = { c0: value };
  const draft = postgresTableCellFilterDraft({ index: 0, row, column }, [column], [row], exclude);
  return filterRuleFromDraft(draft, [column.name]);
}

describe('PostgreSQL 表页单元格筛选', () => {
  it('带字段范围与精度的 INTERVAL 列按微秒确定上下界，保留两端原文', () => {
    const interval = { ...column, type: 'interval day to second(6)' };
    const rows = [{ c0: '1 day' }, { c0: '23:59:59.999999' }];
    const cell = (index: number) => ({ index, row: rows[index], column: interval });
    expect(postgresTableRangeFilterDraft(cell(0), cell(1), [interval], rows)).toMatchObject({
      operator: 'BETWEEN', value: '23:59:59.999999', upperValue: '1 day',
    });
  });
  it('INET 表页区间先比较公共前缀和掩码长度，再比较完整地址', () => {
    const address = { ...column, type: 'inet' };
    const rows = [{ c0: '10.0.0.1/24' }, { c0: '10.0.0.250/8' }];
    const cell = (index: number) => ({ index, row: rows[index], column: address });
    expect(postgresTableRangeFilterDraft(cell(0), cell(1), [address], rows)).toMatchObject({
      operator: 'BETWEEN', value: '10.0.0.250/8', upperValue: '10.0.0.1/24',
    });
  });
  it.each(['9007199254740993', '1.230000000000000001', '', 'NULL', 'a\r\nb', " O'Brien "])('保留协议原值 %j', value => {
    expect(rule(value)).toEqual({ column: column.name, operator: '=', value });
    expect(rule(value, true)).toEqual({ column: column.name, operator: '!=', value });
  });

  it('为空值使用独立运算符', () => {
    expect(rule(null)).toEqual({ column: column.name, operator: 'IS NULL' });
    expect(rule(null, true)).toEqual({ column: column.name, operator: 'IS NOT NULL' });
  });

  it('拒绝超限字符串、不可传输字符和有精度风险的数字', () => {
    for (const value of ['x'.repeat(100_000), 'a\0b', '\ud800', 2 ** 53, NaN, Infinity]) {
      expect(() => rule(value)).toThrow();
    }
  });

  it('拒绝过期行、过期列及访问器，且不触发访问器', () => {
    const row = { c0: '值' };
    expect(() => postgresTableCellFilterDraft({ index: 0, row, column }, [column], [{ ...row }])).toThrow();
    expect(() => postgresTableCellFilterDraft({ index: 0, row, column }, [{ ...column }], [row])).toThrow();
    let accessed = false;
    const accessor = { get c0() { accessed = true; return '值'; } };
    expect(() => postgresTableCellFilterDraft({ index: 0, row: accessor, column }, [column], [accessor])).toThrow();
    expect(accessed).toBe(false);
  });
});
