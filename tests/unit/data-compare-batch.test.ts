import { describe, expect, it } from 'vitest';
import { reverseComparePair } from '../../src/shared/dataCompareBatch';
import { filterBatchPreview, indexBatchPreview, suggestComparePairs } from '../../src/renderer/dataCompareBatch';
import { validateCommand } from '../../src/shared/validation';

describe('多表数据比较', () => {
  it('预览组合筛选按显示键文本匹配，保留原表与原序号', () => {
    const counts = { insert: 0, update: 0, delete: 0 };
    const tables = indexBatchPreview([
      { table: 'main.a', confirmation: 'main.a', counts, rows: [
        { action: 'update', key: ['"项目A"', '18446744073709551615'], cells: [], writeBytes: 12 },
        { action: 'insert', key: ['"项目A"', '18446744073709551615'], cells: [], writeBytes: 12 },
      ] },
      { table: 'main.b', confirmation: 'main.b', counts, rows: [
        { action: 'insert', key: ['"项目A"', '18446744073709551614'], cells: [], writeBytes: 12 },
        { action: 'insert', key: ['"项目A"', '18446744073709551615'], cells: [], writeBytes: 12 },
      ] },
    ]);
    const match = filterBatchPreview(tables, { table: 'main.b', action: 'insert', key: ' 项目a" / 18446744073709551615 ' });
    expect(match.map(table => [table.table, table.rows.map(row => row.ordinal)])).toEqual([['main.b', [3]]]);
    expect(filterBatchPreview(tables, { table: 'main.b', action: 'update', key: '项目' })).toEqual([]);
    expect(filterBatchPreview(tables, { table: '', action: '', key: '  ' })).toEqual(tables);
  });

  it('严格匹配同名对象，跳过相同连接同库的自比较', () => {
    expect(suggestComparePairs(['a', 'B', 'c'], ['b', 'c', 'a'], false, false))
      .toEqual([{ source: 'a', target: 'a' }, { source: 'c', target: 'c' }]);
    expect(suggestComparePairs(['a'], ['a'], false, true)).toEqual([]);
  });

  it('PostgreSQL 只为两侧唯一的短名建议跨 Schema 映射，保留准确全名优先级', () => {
    expect(suggestComparePairs(
      ['"a"."dup"', '"b"."dup"', '"a"."quoted""name"', '"a"."exact"'],
      ['"b"."dup"', '"c"."dup"', '"b"."quoted""name"', '"a"."exact"'], true, false,
    )).toEqual([
      { source: '"b"."dup"', target: '"b"."dup"' }, { source: '"a"."exact"', target: '"a"."exact"' },
      { source: '"a"."quoted""name"', target: '"b"."quoted""name"' },
    ]);
  });

  it('换向保留联合键、映射顺序及默认表对，两次换向恢复原方案', () => {
    const pair = { source: '订单', target: '归档', mapping: [
      { source: '租户', target: '组织', key: true }, { source: '编号', target: '业务键', key: true },
      { source: '备注', target: '说明', key: false },
    ] };
    expect(reverseComparePair(pair)).toEqual({ source: '归档', target: '订单', mapping: [
      { source: '组织', target: '租户', key: true }, { source: '业务键', target: '编号', key: true },
      { source: '说明', target: '备注', key: false },
    ] });
    expect(reverseComparePair(reverseComparePair(pair))).toEqual(pair);
    expect(reverseComparePair({ source: 'a', target: 'b' })).toEqual({ source: 'b', target: 'a' });
  });

  it('只接受显式摘要模式，已有逐行请求仍有效，模式不能进入已保存方案', () => {
    const source = { connectionId: 'left', database: 'main', table: 'ledger' };
    const target = { ...source, connectionId: 'right' };
    const taskId = '31f0759b-9e09-4eb3-ac92-a1b50f6000d3';
    for (const [command, request] of [
      ['mysql.compareData', { source, target, taskId }],
      ['postgres.compareData', { source, target, taskId }],
      ['sqlite.compareData', { source, target, taskId, filters: [], mode: 'and' }],
    ] as const) {
      expect(() => validateCommand(command, request)).not.toThrow();
      expect(() => validateCommand(command, { ...request, summaryOnly: true })).not.toThrow();
      expect(() => validateCommand(command, { ...request, summaryOnly: false })).toThrow();
    }
    expect(() => validateCommand('dataCompareProfiles.mutate', { family: 'mysql', kind: 'add',
      profile: { name: '库存', configuration: { family: 'mysql', source, target, summaryOnly: true } },
    })).toThrow();
  });
});
