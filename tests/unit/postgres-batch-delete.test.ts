import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresBatchDeletePlan } from '../../src/renderer/postgresBatchDelete';
import { capturePostgresCheckedDelete, planPostgresCheckedDelete } from '../../src/renderer/postgresCheckedDelete';
import { postgresCheckedPagePins } from '../../src/renderer/postgresCheckedPages';
import type { PostgresDraftEntry } from '../../src/shared/postgresTableDraft';

const page: PostgresTablePage = {
  columns: ['c0', 'c1'].map((key, index) => ({
    key, name: index ? '分组' : '编号', type: index ? 'text' : 'bigint',
    primary: true, nullable: false, defaultValue: false, generated: false, binary: false,
  })),
  rows: [{ c0: '9007199254740993', c1: '' }, { c0: '9007199254740995', c1: '分组乙' }],
  rowKeys: ['原一', '原二'], pageToken: '原页', capabilities: { insert: false, update: false, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 删除勾选记录', () => {
  it('允许仅有删除权限的表，展示复合键原值及待替换更新的数量', () => {
    const plan = postgresBatchDeletePlan(page, new Set([1, 0]), key =>
      key === '原二' ? { kind: 'update', row: 9, fields: [{ column: 'c1', value: { mode: 'text', value: '暂存' } }] } : undefined);
    expect(plan).toEqual({
      updates: 1, changes: [{ kind: 'delete', row: 0 }, { kind: 'delete', row: 1 }],
      rows: [
        { index: 0, key: [{ name: '编号', value: '9007199254740993' }, { name: '分组', value: '""' }] },
        { index: 1, key: [{ name: '编号', value: '9007199254740995' }, { name: '分组', value: '分组乙' }] },
      ],
    });
  });

  it('已暂存删除、重复原行、越界及只读来源均拒绝整组', () => {
    const selected = new Set([0, 1]);
    expect(() => postgresBatchDeletePlan(page, selected, key => key === '原二' ? { kind: 'delete', row: 1 } : undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan({ ...page, rowKeys: ['原一', '原一'] }, selected, () => undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan(page, new Set([0, 5]), () => undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan({ ...page, capabilities: { ...page.capabilities, delete: false } }, selected, () => undefined)).toThrow('变化');
  });
});

describe('PostgreSQL 跨页勾选删除', () => {
  const expires = Number.MAX_SAFE_INTEGER;
  const first = () => capturePostgresCheckedDelete({ ...page, writeExpiresAt: expires }, 0, new Set([1]), []);
  const second = () => capturePostgresCheckedDelete({ ...page, writeExpiresAt: expires, pageToken: '第二页', rowKeys: ['原三', '原四'] }, 2, new Set([0]), []);

  it('跨页保持原定位和既有更新的首次原令牌，确认预览按页序', () => {
    const prior: PostgresDraftEntry = { change: { kind: 'update', row: 3, pageToken: '最初原页',
      fields: [{ column: 'c1', value: { mode: 'text', value: '草稿' } }] }, rowKey: '原二', offset: 8 };
    const next = planPostgresCheckedDelete([second(), first()], [prior]);
    expect(next.plan.rows.map(row => row.index)).toEqual([1, 2]);
    expect(next.plan.updates).toBe(1);
    expect(next.entries).toEqual([
      { change: { kind: 'delete', row: 3, pageToken: '最初原页' }, rowKey: '原二', offset: 8 },
      { change: { kind: 'delete', row: 0, pageToken: '第二页' }, rowKey: '原三', offset: 2 },
    ]);
  });

  it('任何重复、缺失或过期原页拒绝整批', () => {
    expect(() => planPostgresCheckedDelete([first(), first()], [])).toThrow('同一主键');
    expect(() => planPostgresCheckedDelete([first(), { ...second(), valid: false }], [])).toThrow('已失效');
    expect(() => planPostgresCheckedDelete([first(), { ...second(), expiresAt: 1 }], [])).toThrow('已失效');
    expect(() => capturePostgresCheckedDelete(page, 0, new Set([1]), [])).toThrow('已失效');
  });

  it('勾选保留令牌优先于普通撤销历史，且不会突破原页预算', () => {
    const retainPageTokens = Array.from({ length: 15 }, (_, index) => '草稿' + index);
    const pins = { retainPageTokens, retainHistoryPageTokens: ['其它历史', '原页'] };
    expect(postgresCheckedPagePins(pins, [first()])).toEqual({ retainPageTokens, retainHistoryPageTokens: ['原页'] });
    expect(() => postgresCheckedPagePins(pins, [first(), second()])).toThrow('16 个原页');
  });
});
