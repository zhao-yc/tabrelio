import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { mysqlJoinPreviewSchema, type MysqlJoinPreviewInput } from '../../src/shared/mysqlJoinPreview';
import { buildMysqlSingleTableSelect, foreignKeyJoinMetadataKey, type MysqlSingleTableSelectOptions } from '../../src/shared/tableForeignKeyJoin';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { previewMysqlJoin } from '../../src/engine/mysqlJoinPreview';
import { tableInfo } from '../../src/engine/metadata';
import { consumeQueryFrames, type QueryFrameConsumer } from '../../src/engine/queryStreamProtocol';
import { structureTaskQuery } from '../../src/engine/structureDefinition';

vi.mock('../../src/engine/metadata', () => ({ tableInfo: vi.fn() }));
vi.mock('../../src/engine/queryStreamProtocol', () => ({ consumeQueryFrames: vi.fn() }));
vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: vi.fn() }));

function table(name: string): TableInfo {
  return { database: 'joined', name, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], primaryKey: [], editableKey: [], foreignKeys: [],
    columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '', comment: '', defaultValue: null }] };
}
const child = table('source'), parent = table('target');
child.columns.push({ ...child.columns[0], name: '编号/*!`列' });
const target = (info: TableInfo) => ({ database: info.database, table: info.name,
  digest: createHash('sha256').update(foreignKeyJoinMetadataKey(info)).digest('hex') });
const context = { managed: { broken: false, status: { dialect: 'mysql', version: '8.0.46' } }, checkCancelled: vi.fn() } as unknown as StructureTaskContext;
const input: MysqlJoinPreviewInput = { connectionId: 'joined', taskId: randomUUID(), source: target(child), parent: target(parent),
  relation: [{ child: 'id', parent: 'id' }], kind: 'LEFT', limit: 500,
  options: { childColumns: ['id'], parentColumns: [], sort: [{ side: 'child', column: 'id', direction: 'DESC' }] },
  steps: [{ target: target(parent), source: 0, kind: 'INNER', pairs: [{ child: 'id', parent: 'id' }], columns: ['id'] }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(tableInfo).mockImplementation(async (_connection, _database, name) => structuredClone(name === child.name ? child : parent));
  vi.mocked(consumeQueryFrames).mockImplementation(async (_connection, _sql, _wire, consumer) => {
    await resultFrames(consumer, 'id', 'c_1_id', 'BIGINT', '18446744073709551615');
  });
});

async function resultFrames(consumer: QueryFrameConsumer, key: string, name: string, type: string, value: string) {
  await consumer.consume({ kind: 'rows-start', resultOrdinal: 1, rowResultOrdinal: 1, statementOrdinal: 1,
    columns: [{ position: 0, key, name, exportName: name, type }] });
  await consumer.consume({ kind: 'row', resultOrdinal: 1, values: [value] });
  await consumer.consume({ kind: 'rows-end', resultOrdinal: 1 });
}

describe('手动 JOIN 独立预览', () => {
  it('只读事务内重读并去重结构，编译带原排序和限制的 SQL，采样保留精度', async () => {
    const stop = vi.fn(async () => {});
    const result = await previewMysqlJoin(context, mysqlJoinPreviewSchema.parse(input), stop);
    expect(result.results[0].rows).toEqual([{ id: '18446744073709551615' }]);
    expect(tableInfo).toHaveBeenCalledTimes(2);
    expect(vi.mocked(structureTaskQuery).mock.calls.map(call => call[1])).toEqual([
      'USE `joined`', 'SET SESSION lock_wait_timeout = 5', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE',
    ]);
    expect(consumeQueryFrames).toHaveBeenCalledWith(context.managed, expect.stringMatching(/INNER JOIN `joined`\.`target` AS t3[\s\S]*ORDER BY c\.`id` DESC\nLIMIT 500;$/), 'binary', expect.objectContaining({ stop }));
  });

  it.each([['explain', 'EXPLAIN FORMAT=JSON ', 'json'], ['explainText', 'EXPLAIN FORMAT=TRADITIONAL ', 'text']] as const)('模式 %s 只发送带完整 JOIN 设计的估算语句', async (mode, prefix, format) => {
    vi.mocked(consumeQueryFrames).mockImplementation(async (_connection, _sql, _wire, consumer) => {
      if (format === 'json') await resultFrames(consumer, 'plan', 'EXPLAIN', 'TEXT', '{"query_block":{"table":{"table_name":"c","access_type":"ALL","rows_examined_per_scan":125}}}');
      else await resultFrames(consumer, 'table', 'table', 'TEXT', 'c');
    });
    const result = await previewMysqlJoin(context, mysqlJoinPreviewSchema.parse({ ...input, mode,
      options: { childColumns: ['编号/*!`列'], parentColumns: [], sort: [{ side: 'child', column: 'id', direction: 'DESC' }] } }), async () => {});
    expect(consumeQueryFrames).toHaveBeenCalledTimes(1);
    const statement = vi.mocked(consumeQueryFrames).mock.calls[0][1];
    expect(statement.startsWith(prefix + 'SELECT\n')).toBe(true);
    expect(statement).toContain('c.`编号/*!``列`');
    expect(statement).toMatch(/LEFT JOIN `joined`\.`target` AS p[\s\S]*INNER JOIN `joined`\.`target` AS t3[\s\S]*ORDER BY c\.`id` DESC\nLIMIT 500;$/);
    expect(result.explain?.format).toBe(format);
    if (format === 'json') expect(result.explain?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'c', access: 'ALL' })]));
    else expect(result.results[0].rows).toEqual([{ table: 'c' }]);
    expect(structureTaskQuery).toHaveBeenLastCalledWith(context, 'ROLLBACK AND NO CHAIN NO RELEASE');
  });

  it('目录变更、未知列及注入表达式阻止 SQL 发送，并收尾事务', async () => {
    const changed = { ...input, mode: 'explain' as const, parent: { ...input.parent, digest: '0'.repeat(64) } };
    await expect(previewMysqlJoin(context, changed, async () => {})).rejects.toThrow('表结构已变化');
    const injected = { ...input, relation: [{ child: 'id', parent: 'id', operator: 'OR SLEEP(20)' }] };
    await expect(previewMysqlJoin(context, injected, async () => {})).rejects.toThrow();
    expect(consumeQueryFrames).not.toHaveBeenCalled();
    expect(vi.mocked(structureTaskQuery).mock.calls.filter(call => call[1] === 'ROLLBACK AND NO CHAIN NO RELEASE')).toHaveLength(2);
  });

  it('独立数据预览保留 LIMIT 和 OFFSET 的语义，并拒绝非法偏移', async () => {
    const request = mysqlJoinPreviewSchema.parse({ ...input, options: { ...input.options as object, limit: 3, offset: 5 } });
    await previewMysqlJoin(context, request, async () => {});
    expect(vi.mocked(consumeQueryFrames).mock.calls[0][1]).toMatch(/ORDER BY c\.`id` DESC\nLIMIT 3 OFFSET 5;$/);
    for (const offset of [-1, 1.5, '1', 1_000_000_001]) {
      expect(mysqlJoinPreviewSchema.safeParse({ ...input, options: { childColumns: ['id'], offset } }).success).toBe(false);
    }
    expect(buildMysqlSingleTableSelect(child, 3, { childColumns: ['id'], offset: 0 }).sql).toMatch(/LIMIT 3;$/);
  });

  it('合同拒绝渲染端提交 SQL、物理目录回包及超额步骤', () => {
    expect(mysqlJoinPreviewSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ sql: 'SELECT SLEEP(5)' }, { mode: 'analyze' }, { options: { additionalJoins: [] } }, { steps: Array(7).fill(input.steps[0]) },
      { source: { ...input.source, columns: child.columns } }]) {
      expect(mysqlJoinPreviewSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
});

describe('单表可视化查询', () => {
  const single = { connectionId: 'joined', taskId: randomUUID(), source: target(child), limit: 40, single: true } as const;
  const options: MysqlSingleTableSelectOptions = { childColumns: ['编号/*!`列'], limit: 3,
    filters: [{ side: 'child', column: 'id', operator: '>=', value: '9007199254740993' }],
    sort: [{ side: 'child', column: 'id', direction: 'DESC', nulls: 'LAST' }] };

  it('复用精确 WHERE 和未投影排序，保留明细列名并只核一张表', async () => {
    const request = mysqlJoinPreviewSchema.parse({ ...single, options });
    const outcome = await previewMysqlJoin(context, request, async () => {});
    const { sql, columns } = buildMysqlSingleTableSelect(child, single.limit, options);
    expect(outcome.results[0].statement).toBe(sql);
    expect(sql).toContain('  c.`编号/*!``列` AS `编号/*!``列`\nFROM `joined`.`source` AS c\nWHERE ');
    expect(sql).toContain("CAST(CAST(_utf8mb4 X'" + Buffer.from('9007199254740993').toString('hex') + "' AS DECIMAL(20,0)) AS UNSIGNED)");
    expect(sql).toMatch(/ORDER BY \(c\.`id` IS NULL\) ASC, c\.`id` DESC\nLIMIT 3;$/);
    expect(columns).toEqual([{ side: 'child', column: '编号/*!`列', alias: '编号/*!`列' }]);
    expect(tableInfo).toHaveBeenCalledTimes(1);
  });

  it('支持 WHERE、分组、HAVING 和估算计划，结构变化后拒绝发送查询', async () => {
    const summary: MysqlSingleTableSelectOptions = { ...options,
      summary: { groups: [{ side: 'child', column: 'id' }], aggregates: [{ fn: 'COUNT_ALL', alias: 'n' }] },
      having: { mode: 'all', filters: [{ column: 'n', operator: '>=', value: '2' }] },
      sort: [{ side: 'aggregate', column: 'n', direction: 'DESC' }] };
    const request = mysqlJoinPreviewSchema.parse({ ...single, mode: 'explain', options: summary });
    await expect(previewMysqlJoin(context, { ...request, source: { ...single.source, digest: '0'.repeat(64) } }, async () => {})).rejects.toThrow('表结构已变化');
    expect(consumeQueryFrames).not.toHaveBeenCalled();
    await previewMysqlJoin(context, request, async () => {});
    const statement = vi.mocked(consumeQueryFrames).mock.calls[0][1];
    expect(statement).toMatch(/^EXPLAIN FORMAT=JSON SELECT\n/);
    expect(statement).toMatch(/COUNT\(\*\) AS `n`[\s\S]*\nWHERE [^\n]+\nGROUP BY c\.`id`\nHAVING [^\n]+\nORDER BY [^\n]+\nLIMIT 3;$/);
    expect(statement).not.toContain(' JOIN ');
  });

  it('只对已选列去重，拒绝混用 JOIN 字段、外部表侧和未投影的 DISTINCT 排序', () => {
    expect(mysqlJoinPreviewSchema.safeParse({ ...single, options, parent: target(parent) }).success).toBe(false);
    expect(() => buildMysqlSingleTableSelect(child, single.limit, { ...options, parentColumns: [] } as MysqlSingleTableSelectOptions)).toThrow();
    expect(() => buildMysqlSingleTableSelect(child, single.limit, { ...options, filters: [{ side: 'parent', column: 'id', operator: 'IS NULL' }] })).toThrow();
    expect(() => buildMysqlSingleTableSelect(child, single.limit, { ...options, distinct: true })).toThrow();
    expect(buildMysqlSingleTableSelect(child, single.limit, { ...options, sort: [], distinct: true }).sql).toMatch(/^SELECT DISTINCT\n/);
  });
});
