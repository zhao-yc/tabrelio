import { describe, expect, it } from 'vitest';
import { applySchemaCompareResultsSelection as apply, defaultSchemaCompareResultsFilter as defaults, projectSchemaCompareResults as project, schemaCompareResultsId as id } from '../../src/renderer/schemaCompareResults';
import { schemaCompareResultsFixture } from './schemaCompareResults.fixtures';

describe('结构差异筛选及选择意图', () => {
  it('默认隐藏相同项，类别、状态、名称取交集并保留报告顺序', () => {
    const report = schemaCompareResultsFixture();
    expect(project(report, defaults, []).rows).toHaveLength(5);
    expect(project(report, { category: 'columns', status: 'changed', name: 'null' }, []).rows.map(row => row.name)).toEqual(['NULL']);
    expect(project(report, { category: 'all', status: 'all', name: '' }, []).rows).toEqual(report.rows);
    expect(project(report, { category: 'indexes', status: 'removed', name: '' }, []).rows).toEqual([]);
  });
  it('名称保留空白、引号及正则字符，NULL 是普通名称；不改变原报告', () => {
    const report = schemaCompareResultsFixture(), before = JSON.stringify(report);
    expect(project(report, { ...defaults, name: '.*"`<img>' }, []).rows.map(row => row.name)).toEqual([' x.*"`<img> ']);
    expect(project(report, { ...defaults, name: 'IX.mIXED' }, []).rows.map(row => row.name)).toEqual(['ix.Mixed']);
    expect(project(report, { ...defaults, name: '^NULL$' }, []).rows).toEqual([]);
    expect(JSON.stringify(report)).toBe(before);
  });
  it('按类别与精确名称绑定选择，筛选只计算隐藏集合，重复输入不放大计数', () => {
    const report = schemaCompareResultsFixture(), selected = [id(report.rows[0]), id(report.rows[1])];
    const view = project(report, { ...defaults, category: 'columns' }, [...selected, selected[1]]);
    expect(view.hiddenSelectedIds).toEqual([selected[1]]); expect(selected).toHaveLength(2); expect(view.total).toBe(6);
    expect(id({ category: 'indexes', name: 'NULL' })).not.toBe(selected[0]);
  });
  it('仅允许当前快照内可选择项，拒绝相同、未知、伪造及旧报告选择', () => {
    const report = schemaCompareResultsFixture(), previous = [id(report.rows[0])];
    for (const row of [report.rows[3], report.rows[5], { category: 'columns' as const, name: '伪造' }]) {
      expect(apply(report, previous, { snapshotId: report.snapshotId, kind: 'toggle', id: id(row), checked: true })).toBe(previous);
    }
    expect(apply(report, previous, { snapshotId: '旧快照', kind: 'clearHidden', ids: previous })).toBe(previous);
    expect(apply(report, previous, { snapshotId: '旧快照', kind: 'toggle', id: id(report.rows[1]), checked: true })).toBe(previous);
  });
  it('增量选择及清除仅作用于指定项目，不用旧的整份选择覆盖后来选择', () => {
    const report = schemaCompareResultsFixture(), a = id(report.rows[0]), b = id(report.rows[1]), c = id(report.rows[2]);
    expect(apply(report, [a, c], { snapshotId: report.snapshotId, kind: 'toggle', id: b, checked: true })).toEqual([a, c, b]);
    expect(apply(report, [a, c, b], { snapshotId: report.snapshotId, kind: 'clearHidden', ids: [b] })).toEqual([a, c]);
    expect(apply(report, [a, b], { snapshotId: report.snapshotId, kind: 'toggle', id: b, checked: false })).toEqual([a]);
  });
  it('选择当前筛选项保留隐藏选择，并在超过预览上限时整批拒绝', () => {
    const report = schemaCompareResultsFixture(), a = id(report.rows[0]), b = id(report.rows[1]), c = id(report.rows[2]);
    expect(apply(report, [a], { snapshotId: report.snapshotId, kind: 'selectVisible', ids: [a, b, c] })).toEqual([a, b, c]);
    const many = Array.from({ length: 100 }, (_, index) => JSON.stringify(['columns', `existing-${index}`]));
    expect(apply(report, many, { snapshotId: report.snapshotId, kind: 'selectVisible', ids: [a] })).toBe(many);
  });
  it('单项勾选达到上限后不再悄悄扩大预览范围', () => {
    const report = schemaCompareResultsFixture(), selected = Array.from({ length: 100 }, (_, index) => JSON.stringify(['columns', `existing-${index}`]));
    expect(apply(report, selected, { snapshotId: report.snapshotId, kind: 'toggle', id: id(report.rows[0]), checked: true })).toBe(selected);
  });
  it('清除当前筛选项只移除可见选择，隐藏选择保持不变', () => {
    const report = schemaCompareResultsFixture(), visible = id(report.rows[0]), hidden = id(report.rows[1]), other = id(report.rows[2]);
    expect(apply(report, [visible, hidden, other], { snapshotId: report.snapshotId, kind: 'clearVisible', ids: [visible, other] })).toEqual([hidden]);
  });
});
