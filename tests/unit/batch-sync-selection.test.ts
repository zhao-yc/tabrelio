import { describe, expect, it } from 'vitest';
import { batchSyncLimits, batchSyncPreviewRow, createBatchSyncPreviewBudget, requireBatchSyncSelection, resolveBatchSyncSelection,
  type BatchSyncPreview } from '../../src/shared/dataCompareBatchSync';
import { validateCommand } from '../../src/shared/validation';

const tables: BatchSyncPreview<string>['tables'] = [
  { table: 'a', confirmation: 'main.a', counts: { insert: 1, update: 0, delete: 1 },
    rows: [{ action: 'insert', key: ['1'], cells: [], writeBytes: 10 }, { action: 'delete', key: ['2'], cells: [], writeBytes: 12 }] },
  { table: 'b', confirmation: 'main.b', counts: { insert: 0, update: 1, delete: 1 },
    rows: [{ action: 'delete', key: ['3'], cells: [], writeBytes: 14 }, { action: 'update', key: ['4'], cells: [], writeBytes: 16 }] },
];

describe('多表预览的差异选择', () => {
  it('保留原顺序，按实选目标重新生成确认文字和操作计数', () => {
    expect(resolveBatchSyncSelection(tables, [3, 0])).toEqual({
      groups: [{ tableIndex: 0, rows: [0], counts: { insert: 1, update: 0, delete: 0 } },
        { tableIndex: 1, rows: [1], counts: { insert: 0, update: 1, delete: 0 } }],
      counts: { insert: 1, update: 1, delete: 0 }, rowCount: 2, writeBytes: 27, confirmation: 'main.a 等 2 张表',
    });
    expect(resolveBatchSyncSelection(tables, [3]).confirmation).toBe('main.b');
    expect(resolveBatchSyncSelection(tables, []).confirmation).toBe('');
    expect(resolveBatchSyncSelection(tables).counts).toEqual({ insert: 1, update: 1, delete: 2 });
    expect(() => resolveBatchSyncSelection(tables, [4])).toThrow('已失效');
    expect(() => resolveBatchSyncSelection(tables, [1, 1])).toThrow('重复');
  });

  it('各驱动只接受预览序号，原单表合同不接受批次选择', () => {
    const id = '31f0759b-9e09-4eb3-ac92-a1b50f6000d3';
    const base = { previewId: id, taskId: id, confirmation: 'main.b' };
    for (const command of ['sqlite.compareSync.batchApply', 'postgres.compareData.batchApply', 'mysql.compareData.batchApply'] as const) {
      expect(validateCommand(command, { ...base, selected: [1999] })).toEqual({ ...base, selected: [1999] });
      for (const selected of [[], [0, 0], [-1], [2000], ['1'], [{ key: '4' }], Array.from({ length: 101 }, (_, index) => index)])
        expect(() => validateCommand(command, { ...base, selected })).toThrow();
    }
    expect(() => validateCommand('sqlite.compareSync.apply', { ...base, selected: [3] })).toThrow();
  });

  it('字段详情保留两侧的异名字段、空值与缺行', () => {
    const detail = batchSyncPreviewRow('insert', { key: ['1'], cells: [{ column: 0, source: '1' }, { column: 1, source: null }] },
      ['id', 'value'], { after: ['1', '中文'] },
      [{ source: 'id', target: '编号', key: true }, { source: 'value', target: '载荷', key: false }]);
    expect(detail.writeBytes).toBe(Buffer.byteLength(JSON.stringify({ after: ['1', '中文'] })) + 1);
    expect(detail.cells).toEqual([
      { sourceColumn: 'id', targetColumn: '编号', source: '1', target: undefined },
      { sourceColumn: 'value', targetColumn: '载荷', source: null, target: undefined },
    ]);
  });

  it('候选和提交分别计量，超过 100 行时仍可领取原预览靠后的少量记录', () => {
    const row = tables[0].rows[0];
    const large = [{ ...tables[0], rows: Array.from({ length: 125 }, () => row) }];
    expect(requireBatchSyncSelection(large, [124]).groups[0].rows).toEqual([124]);
    expect(() => requireBatchSyncSelection(large)).toThrow('100 条');
    expect(() => requireBatchSyncSelection(large, [125])).toThrow('已失效');
    const heavy = [{ ...tables[0], rows: [{ ...row, writeBytes: batchSyncLimits.writeBytes }, row] }];
    expect(() => requireBatchSyncSelection(heavy, [0])).toThrow('1 MiB');
    expect(requireBatchSyncSelection(heavy, [1]).rowCount).toBe(1);
    const reserve = createBatchSyncPreviewBudget();
    for (let index = 0; index < batchSyncLimits.candidates; index++) reserve(row);
    expect(() => reserve(row)).toThrow('2,000');
    expect(() => createBatchSyncPreviewBudget()({ ...row, writeBytes: batchSyncLimits.previewBytes })).toThrow('8 MiB');
  });
});
