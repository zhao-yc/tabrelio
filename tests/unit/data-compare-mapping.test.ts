import { describe, expect, it } from 'vitest';
import { compareMappedTableData, type TableDataSnapshot } from '../../src/engine/tableDataDifferences';
import { dataCompareMappingSchema, mappedColumns, mappedKeyNames } from '../../src/shared/dataCompareMapping';
import { validateCommand } from '../../src/shared/validation';

const mapping = [{ source: 'id', target: '编号', key: true }, { source: 'value', target: '载荷', key: false }];
const left: TableDataSnapshot = {
  keys: ['id'], columns: [{ name: 'id', type: 'bigint' }, { name: 'value', type: 'bytea' }],
  rows: [['9223372036854775807', { type: 'binary', base64: 'AP+A' }]],
};
const right: TableDataSnapshot = {
  keys: ['编号'], columns: [{ name: '编号', type: 'bigint' }, { name: '载荷', type: 'bytea' }],
  rows: [['9223372036854775807', { type: 'binary', base64: 'AP+B' }]],
};

describe('数据比较的键与字段映射', () => {
  it('按准确列名领取字段，按映射顺序投影并保留高精度键和原始字节', () => {
    expect(mappedColumns([...right.columns].reverse(), mapping, 'target')).toEqual(right.columns);
    expect(mappedKeyNames(mapping, 'target')).toEqual(['编号']);
    const result = compareMappedTableData(left, right, false, 'PostgreSQL', mapping);
    expect(result.differences).toEqual([{ kind: 'different', key: ['9223372036854775807'],
      cells: [{ column: 1, source: { type: 'binary', base64: 'AP+A' }, target: { type: 'binary', base64: 'AP+B' } }] }]);
    expect(result.syncSnapshotId).toBeUndefined();
    expect(() => mappedColumns(left.columns.slice(0, 1), mapping, 'source')).toThrow('映射字段不存在');
  });

  it('拒绝重复、空键或不兼容类型，无法形成有歧义的行匹配', () => {
    expect(() => compareMappedTableData(left, { ...right, rows: [...right.rows, right.rows[0]] }, false, 'PostgreSQL', mapping)).toThrow('重复');
    expect(() => compareMappedTableData(left, { ...right, rows: [[null, '值']] }, false, 'PostgreSQL', mapping)).toThrow('空主键');
    expect(() => compareMappedTableData(left, { ...right, columns: right.columns.map(column => ({ ...column, type: 'text' })) },
      false, 'PostgreSQL', mapping)).toThrow('声明类型须一致');
  });

  it('匹配键的小数尾零不产生重复同步，但业务字段仍按原值比较', () => {
    const a = { ...left, columns: [{ ...left.columns[0], type: 'numeric' }, left.columns[1]],
      rows: [['9007199254740993.0', '原值']] };
    const b = { ...right, columns: [{ ...right.columns[0], type: 'numeric' }, right.columns[1]],
      rows: [['9007199254740993.00', '原值']] };
    expect(compareMappedTableData(a, b, false, 'PostgreSQL', mapping)).toMatchObject({ equal: 1, differences: [] });
    expect(compareMappedTableData(a, { ...b, rows: [[b.rows[0][0], '另一值']] }, false, 'PostgreSQL', mapping).differences)
      .toEqual([{ kind: 'different', key: ['9007199254740993.0'], cells: [{ column: 1, source: '原值', target: '另一值' }] }]);
  });

  it('IPC 拒绝无键、重复映射和非目录标识数据，已有配置仍可读取', () => {
    expect(dataCompareMappingSchema.safeParse(mapping).success).toBe(true);
    for (const value of [
      [], [{ ...mapping[0], key: false }], [mapping[0], { ...mapping[1], target: mapping[0].target }],
      [{ ...mapping[0], source: 'a\0b' }], [{ ...mapping[0], sql: 'SELECT 1' }],
    ]) expect(dataCompareMappingSchema.safeParse(value).success).toBe(false);
    const source = { connectionId: 'left', database: 'main', table: 'a' }, target = { ...source, table: 'b' };
    const taskId = '31f0759b-9e09-4eb3-ac92-a1b50f6000d3';
    for (const command of ['postgres.compareData', 'mysql.compareData', 'sqlite.compareData'] as const) {
      const request = { source, target, taskId, ...(command === 'sqlite.compareData' ? { filters: [], mode: 'and' } : {}) };
      expect(() => validateCommand(command, request)).not.toThrow();
      expect(() => validateCommand(command, { ...request, mapping })).not.toThrow();
      expect(() => validateCommand(command, { ...request, mapping: [{ ...mapping[0], key: false }] })).toThrow();
    }
  });
});
