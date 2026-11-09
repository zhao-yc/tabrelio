import { describe, expect, it } from 'vitest';
import type { PostgresTableChange, PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { capturePostgresCheckedFill, planPostgresCheckedFill } from '../../src/renderer/postgresCheckedFill';
import { retainPostgresCheckedPages, postgresCheckedPagePins } from '../../src/renderer/postgresCheckedPages';
import type { PostgresDraftEntry } from '../../src/shared/postgresTableDraft';
import { postgresBatchFillChanges, postgresRangeFillAcross, postgresRangeFillChanges, postgresRangeFillFromRow } from '../../src/renderer/postgresBatchFill';

const column = (key: string, options: Partial<PostgresTableColumn> = {}): PostgresTableColumn => ({
  key, name: key, type: 'text', primary: false, generated: false, binary: false, nullable: true, defaultValue: false, ...options,
});
const columns = [column('c0', { primary: true }), column('c1'), column('c2', { binary: true }), column('c3', { generated: true })];
const page: PostgresTablePage = {
  columns, rows: [
    { c0: '9007199254740993', c1: '甲', c2: { type: 'binary', base64: 'AP8=' }, c3: '自动' },
    { c0: '9007199254740995', c1: '乙', c2: null, c3: '自动' },
  ],
  rowKeys: ['一', '二'], pageToken: '页能力', capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 勾选记录批量填充', () => {
  it('横向填充从原行及已有草稿取值，并拒绝类型转换', () => {
    const mirror = column('mirror');
    const draftPage = { ...page, columns: [...columns, mirror], rows: page.rows.map(row => ({ ...row, mirror: '原目标' })) };
    const range = { startRow: 0, rows: draftPage.rows, keys: ['c1', 'mirror'] };
    const prior = (key: string): PostgresTableChange | undefined => key === '二' ? {
      kind: 'update', row: 1, fields: [{ column: 'c1', value: { mode: 'null' } }],
    } : undefined;
    expect(postgresRangeFillAcross(draftPage, [columns[1], mirror], range, 'right', prior)).toEqual([
      { kind: 'update', row: 0, fields: [{ column: 'mirror', value: { mode: 'text', value: '甲' } }] },
      { kind: 'update', row: 1, fields: [{ column: 'c1', value: { mode: 'null' } }, { column: 'mirror', value: { mode: 'null' } }] },
    ]);
    expect(() => postgresRangeFillAcross(draftPage, [columns[1], columns[2]], { ...range, keys: ['c1', 'c2'] }, 'right', prior)).toThrow(/c2/);
  });
  it('首尾行分别作为来源，保留原二进制和草稿 NULL，拒绝 DEFAULT 或待删除行', () => {
    const range = { startRow: 0, rows: page.rows, keys: ['c1', 'c2'] };
    const visible = [columns[1], columns[2]];
    const prior = (key: string): PostgresTableChange | undefined => key === '一' ? {
      kind: 'update', row: 0, fields: [{ column: 'c1', value: { mode: 'null' } }],
    } : undefined;
    expect(postgresRangeFillFromRow(page, visible, range, 'down', prior)).toEqual([{
      kind: 'update', row: 1, fields: [{ column: 'c1', value: { mode: 'null' } }, { column: 'c2', value: { mode: 'binary', value: '00ff' } }],
    }]);
    expect(postgresRangeFillFromRow(page, visible, range, 'up', prior)).toEqual([{
      kind: 'update', row: 0, fields: [{ column: 'c1', value: { mode: 'text', value: '乙' } }, { column: 'c2', value: { mode: 'null' } }],
    }]);
    expect(() => postgresRangeFillFromRow(page, visible, range, 'down', key => key === '一' ? {
      kind: 'update', row: 0, fields: [{ column: 'c1', value: { mode: 'default' } }],
    } : undefined)).toThrow('DEFAULT');
    expect(() => postgresRangeFillFromRow(page, visible, range, 'up', key => key === '一' ? { kind: 'delete', row: 0 } : undefined)).toThrow();
  });
  it('矩形填充保留字面 NULL 和原草稿其它字段，拒绝受保护字段或待删除记录', () => {
    const prior: PostgresTableChange = { kind: 'update', row: 1, fields: [{ column: 'c2', value: { mode: 'default' } }] };
    const changes = postgresRangeFillChanges(page, [columns[1]], 1, 1, 'NULL', () => prior);
    expect(changes).toEqual([{ kind: 'update', row: 1, fields: [...prior.fields, { column: 'c1', value: { mode: 'text', value: 'NULL' } }] }]);
    expect(postgresRangeFillChanges(page, [columns[1]], 0, 2, null, () => undefined)).toEqual([0, 1].map(row =>
      ({ kind: 'update', row, fields: [{ column: 'c1', value: { mode: 'null' } }] })));
    const restricted = { ...columns[2], nullable: false };
    expect(() => postgresRangeFillChanges({ ...page, columns: [...columns.slice(0, 2), restricted, columns[3]] },
      [columns[1], restricted], 0, 2, null, () => undefined)).toThrow();
    for (const index of [0, 2, 3]) expect(() => postgresRangeFillChanges(page, [columns[1], columns[index]], 0, 2, '值', () => undefined)).toThrow();
    expect(() => postgresRangeFillChanges(page, [columns[1]], 0, 2, '值', key =>
      key === '二' ? { kind: 'delete', row: 1 } : undefined)).toThrow();
  });
  it('只构造有变化的勾选行，保留该行其他草稿字段', () => {
    const previous: PostgresTableChange = { kind: 'update', row: 7, fields: [{ column: 'c2', value: { mode: 'default' } }] };
    const rows = postgresBatchFillChanges(page, columns, new Set([1, 0]), [{ column: 'c1', value: { mode: 'text', value: '甲' } }],
      key => key === '二' ? previous : undefined);
    expect(rows).toEqual([{ kind: 'update', row: 1, fields: [...previous.fields, { column: 'c1', value: { mode: 'text', value: '甲' } }] }]);
    expect(postgresBatchFillChanges(page, columns, new Set([0]), [{ column: 'c2', value: { mode: 'binary', value: '00FF' } }],
      () => undefined)).toEqual([]);
  });

  it('原页、列、值和任一所选行无效时拒绝整批', () => {
    const selected = new Set([0, 1]);
    const plan = (field: string, prior: (key: string) => PostgresTableChange | undefined = () => undefined) =>
      postgresBatchFillChanges(page, columns, selected, [{ column: field, value: { mode: 'text', value: '' } }], prior);
    expect(() => plan('c0')).toThrow('字段');
    expect(() => plan('c3')).toThrow('字段');
    expect(() => plan('c1', key => key === '二' ? { kind: 'delete', row: 1 } : undefined)).toThrow('已有记录');
    expect(() => postgresBatchFillChanges(page, columns, selected, [{ column: 'c2', value: { mode: 'binary', value: 'x' } }],
      () => undefined)).toThrow('填充值');
  });
});

describe('PostgreSQL 跨页勾选填充', () => {
  const expires = () => Date.now() + 60000;
  const first = () => capturePostgresCheckedFill({ ...page, writeExpiresAt: expires() }, 0, columns, new Set([0]), []);
  const second = () => capturePostgresCheckedFill({ ...page, pageToken: '第二页', writeExpiresAt: expires() }, 2, columns, new Set([1]), []);
  const fields = [{ column: 'c1', value: { mode: 'text' as const, value: '甲' } }];

  it('原页同值跳过，已有更新保留未填字段、首次定位和快照令牌', () => {
    const previous: PostgresDraftEntry = { rowKey: '二', offset: 6, change: { kind: 'update', row: 7,
      pageToken: '首次版本', fields: [{ column: 'c2', value: { mode: 'default' } }] } };
    const draft = [previous];
    const result = planPostgresCheckedFill([second(), first()], columns, fields, draft);
    expect(result).toEqual({ count: 1, entries: [{ ...previous, change: { ...previous.change,
      fields: [{ column: 'c2', value: { mode: 'default' } }, ...fields] } }] });
    expect(planPostgresCheckedFill([first(), second()], columns, fields, result.entries).entries).toBe(result.entries);
    expect(draft).toEqual([previous]);
  });

  it('不同页的原主键重复、来源被释放、字段未共同收集或预算不足时拒绝整批', () => {
    const a = first(), b = second(), released = retainPostgresCheckedPages([a, b], new Set([a.token]));
    expect(() => planPostgresCheckedFill([a, { ...a, token: '重叠', offset: 4 }], columns, fields, [])).toThrow(/同一主键/);
    expect(() => planPostgresCheckedFill(released, columns, fields, [])).toThrow(/失效/);
    expect(() => planPostgresCheckedFill([a, { ...b, columns: new Set(['c2']) }], columns, fields, [])).toThrow(/普通字段/);
    expect(() => capturePostgresCheckedFill({ ...page, writeExpiresAt: expires() }, 0, columns, new Set([0]), [], 10)).toThrow(/4 MiB/);
    expect(postgresCheckedPagePins({ retainPageTokens: ['已编辑'], retainHistoryPageTokens: ['旧历史'] }, [a, b, a]))
      .toEqual({ retainPageTokens: ['已编辑'], retainHistoryPageTokens: [a.token, b.token, '旧历史'] });
  });
});
