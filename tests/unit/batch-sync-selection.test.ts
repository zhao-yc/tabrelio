import { describe, expect, it } from 'vitest';
import { batchSyncPreviewRow, resolveBatchSyncSelection, type BatchSyncPreview } from '../../src/shared/dataCompareBatchSync';
import { validateCommand } from '../../src/shared/validation';

const tables: BatchSyncPreview<string>['tables'] = [
  { table: 'a', confirmation: 'main.a', counts: { insert: 1, update: 0, delete: 1 },
    rows: [{ action: 'insert', key: ['1'], cells: [] }, { action: 'delete', key: ['2'], cells: [] }] },
  { table: 'b', confirmation: 'main.b', counts: { insert: 0, update: 1, delete: 1 },
    rows: [{ action: 'delete', key: ['3'], cells: [] }, { action: 'update', key: ['4'], cells: [] }] },
];

describe('多表预览的差异选择', () => {
  it('保留原顺序，按实选目标重新生成确认文字和操作计数', () => {
    expect(resolveBatchSyncSelection(tables, [3, 0])).toEqual({
      groups: [{ tableIndex: 0, rows: [0], counts: { insert: 1, update: 0, delete: 0 } },
        { tableIndex: 1, rows: [1], counts: { insert: 0, update: 1, delete: 0 } }],
      counts: { insert: 1, update: 1, delete: 0 }, confirmation: 'main.a 等 2 张表',
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
      expect(validateCommand(command, { ...base, selected: [3] })).toEqual({ ...base, selected: [3] });
      for (const selected of [[], [0, 0], [-1], [100], ['1'], [{ key: '4' }]])
        expect(() => validateCommand(command, { ...base, selected })).toThrow();
    }
    expect(() => validateCommand('sqlite.compareSync.apply', { ...base, selected: [3] })).toThrow();
  });

  it('字段详情保留两侧的异名字段、空值与缺行', () => {
    const detail = batchSyncPreviewRow('insert', { key: ['1'], cells: [{ column: 0, source: '1' }, { column: 1, source: null }] },
      ['id', 'value'], [{ source: 'id', target: '编号', key: true }, { source: 'value', target: '载荷', key: false }]);
    expect(detail.cells).toEqual([
      { sourceColumn: 'id', targetColumn: '编号', source: '1', target: undefined },
      { sourceColumn: 'value', targetColumn: '载荷', source: null, target: undefined },
    ]);
  });
});
