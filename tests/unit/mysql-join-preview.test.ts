import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { mysqlJoinPreviewSchema, type MysqlJoinPreviewInput } from '../../src/shared/mysqlJoinPreview';
import { foreignKeyJoinMetadataKey } from '../../src/shared/tableForeignKeyJoin';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { previewMysqlJoin } from '../../src/engine/mysqlJoinPreview';
import { tableInfo } from '../../src/engine/metadata';
import { readMysqlPreviewRows } from '../../src/engine/mysqlViewQueryInspect';
import { structureTaskQuery } from '../../src/engine/structureDefinition';

vi.mock('../../src/engine/metadata', () => ({ tableInfo: vi.fn() }));
vi.mock('../../src/engine/mysqlViewQueryInspect', () => ({ readMysqlPreviewRows: vi.fn() }));
vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: vi.fn() }));

function table(name: string): TableInfo {
  return { database: 'joined', name, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], primaryKey: [], editableKey: [], foreignKeys: [],
    columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '', comment: '', defaultValue: null }] };
}
const child = table('source'), parent = table('target');
const target = (info: TableInfo) => ({ database: info.database, table: info.name,
  digest: createHash('sha256').update(foreignKeyJoinMetadataKey(info)).digest('hex') });
const context = { managed: { broken: false }, checkCancelled: vi.fn() } as unknown as StructureTaskContext;
const input: MysqlJoinPreviewInput = { connectionId: 'joined', taskId: randomUUID(), source: target(child), parent: target(parent),
  relation: [{ child: 'id', parent: 'id' }], kind: 'LEFT', limit: 500,
  options: { childColumns: ['id'], parentColumns: [], sort: [{ side: 'child', column: 'id', direction: 'DESC' }] },
  steps: [{ target: target(parent), source: 0, kind: 'INNER', pairs: [{ child: 'id', parent: 'id' }], columns: ['id'] }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(tableInfo).mockImplementation(async (_connection, _database, name) => structuredClone(name === child.name ? child : parent));
  vi.mocked(readMysqlPreviewRows).mockResolvedValue({ columns: [{ key: 'id', name: 'c_1_id', type: 'BIGINT' }], rows: [{ id: '18446744073709551615' }], truncated: true, elapsedMs: 3, statement: 'SELECT 1' });
});

describe('手动 JOIN 独立预览', () => {
  it('只读事务内重读并去重结构，编译带原排序和限制的 SQL，采样保留精度', async () => {
    const stop = vi.fn(async () => {});
    const result = await previewMysqlJoin(context, mysqlJoinPreviewSchema.parse(input), stop);
    expect(result.results[0].rows).toEqual([{ id: '18446744073709551615' }]);
    expect(tableInfo).toHaveBeenCalledTimes(2);
    expect(vi.mocked(structureTaskQuery).mock.calls.map(call => call[1])).toEqual([
      'USE `joined`', 'SET SESSION lock_wait_timeout = 5', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE',
    ]);
    expect(readMysqlPreviewRows).toHaveBeenCalledWith(context, expect.stringMatching(/INNER JOIN `joined`\.`target` AS t3[\s\S]*ORDER BY c\.`id` DESC\nLIMIT 500;$/), 100, 512 * 1024, stop);
  });

  it('目录变更、未知列及注入表达式阻止 SQL 发送，并收尾事务', async () => {
    const changed = { ...input, parent: { ...input.parent, digest: '0'.repeat(64) } };
    await expect(previewMysqlJoin(context, changed, async () => {})).rejects.toThrow('表结构已变化');
    const injected = { ...input, relation: [{ child: 'id', parent: 'id', operator: 'OR SLEEP(20)' }] };
    await expect(previewMysqlJoin(context, injected, async () => {})).rejects.toThrow();
    expect(readMysqlPreviewRows).not.toHaveBeenCalled();
    expect(vi.mocked(structureTaskQuery).mock.calls.filter(call => call[1] === 'ROLLBACK AND NO CHAIN NO RELEASE')).toHaveLength(2);
  });

  it('合同拒绝渲染端提交 SQL、物理目录回包及超额步骤', () => {
    expect(mysqlJoinPreviewSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ sql: 'SELECT SLEEP(5)' }, { options: { additionalJoins: [] } }, { steps: Array(7).fill(input.steps[0]) },
      { source: { ...input.source, columns: child.columns } }]) {
      expect(mysqlJoinPreviewSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
});
