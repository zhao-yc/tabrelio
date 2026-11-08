import { describe, expect, it, vi } from 'vitest';
import { readMysqlViewDependencies } from '../../src/engine/mysqlViewDependencies';
import { structureTaskQuery, type StructureTaskContext } from '../../src/engine/structureDefinition';

vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: vi.fn() }));
const query = vi.mocked(structureTaskQuery);
const target = { connectionId: 'test', database: '库', name: '视图' };
const targetRow = { database: '库', name: '视图', definition: 'SELECT x FROM `源`.`表`', fingerprint: 'before' };
const response = (rows: unknown[]) => ({ rows, fields: [] });
function context(dialect: 'mysql' | 'mariadb') {
  return { managed: { status: { dialect } }, checkCancelled: vi.fn() } as unknown as StructureTaskContext;
}

describe('MySQL 和 MariaDB 视图依赖读取', () => {
  it('原生目录分别绑定两个方向，拒绝读取期间变化的原定义', async () => {
    query.mockReset().mockResolvedValueOnce(response([targetRow])).mockResolvedValueOnce(response([{ database: '源', name: '表' }]))
      .mockResolvedValueOnce(response([{ database: '目标', name: '下游' }])).mockResolvedValueOnce(response([{ ...targetRow, fingerprint: 'after' }]));
    await expect(readMysqlViewDependencies(context('mysql'), target)).rejects.toThrow('读取期间原视图定义已变化');
    expect(query.mock.calls[1][1]).toMatch(/SELECT TABLE_SCHEMA.*WHERE CAST\(VIEW_SCHEMA AS BINARY\)/s);
    expect(query.mock.calls[2][1]).toMatch(/SELECT VIEW_SCHEMA.*WHERE CAST\(TABLE_SCHEMA AS BINARY\)/s);
  });

  it('定义解析匹配直接关系，单条不可解析时保留已确认结果并标出缺口', async () => {
    query.mockReset().mockResolvedValueOnce(response([targetRow])).mockResolvedValueOnce(response([{ mode: 0 }]))
      .mockResolvedValueOnce(response([
        { database: '目标', name: '上层', definition: 'SELECT x FROM `库`.`视图`' },
        { database: '目标', name: '间接', definition: 'SELECT x FROM `目标`.`上层`' },
        { database: '目标', name: '不可读', definition: null },
      ])).mockResolvedValueOnce(response([targetRow]));
    await expect(readMysqlViewDependencies(context('mariadb'), target)).resolves.toEqual({
      source: 'definitions', referenced: [{ database: '源', name: '表' }], referencing: [{ database: '目标', name: '上层' }],
      skipped: 1, referencedUnknown: false, truncated: false,
    });
  });
});
