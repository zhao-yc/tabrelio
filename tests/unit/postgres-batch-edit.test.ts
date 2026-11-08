import { describe, expect, it } from 'vitest';
import type { PostgresTableChange, PostgresTablePage } from '../../src/shared/postgresTable';
import type { PostgresDraftEntry } from '../../src/shared/postgresTableDraft';
import { postgresBatchEditPlan, type PostgresBatchEditValues } from '../../src/renderer/postgresBatchEdit';
import { postgresBatchRows } from '../../src/renderer/postgresBatchSelection';
import { planPostgresCheckedEdit } from '../../src/renderer/postgresCheckedEdit';
import { capturePostgresCheckedFill } from '../../src/renderer/postgresCheckedFill';

const page: PostgresTablePage = {
  columns: ['c0', 'c1', 'c2'].map((key, index) => ({
    key, name: key, type: index ? 'text' : 'bigint', primary: index === 0, nullable: index > 0,
    defaultValue: false, generated: false, binary: false,
  })),
  rows: [{ c0: '9007199254740993', c1: '甲', c2: '原' }, { c0: '9007199254740995', c1: '乙', c2: null }],
  rowKeys: ['一', '二'], pageToken: '原页', capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};
const selected = new Set([0, 1]);
const prior: Extract<PostgresTableChange, { kind: 'update' }> = { kind: 'update', row: 8, fields: [
  { column: 'c0', value: { mode: 'text', value: '9007199254740994' } },
  { column: 'c1', value: { mode: 'text', value: '旧草稿' } },
] };

describe('PostgreSQL 逐条编辑勾选记录', () => {
  it('分别生成不同值，保留不开放编辑的既有字段和未修改值', () => {
    const rows = postgresBatchRows(page, selected, key => key === '一' ? prior : undefined);
    const input = new Map<number, PostgresBatchEditValues>([
      [1, new Map([['c1', { mode: 'null' }], ['c2', { mode: 'null' }]])],
      [0, new Map([['c1', { mode: 'text', value: '新草稿' }]])],
    ]);
    expect(postgresBatchEditPlan(page, rows, input)).toEqual({ remove: new Set(), changes: [
      { kind: 'update', row: 0, fields: [prior.fields[0], { column: 'c1', value: { mode: 'text', value: '新草稿' } }] },
      { kind: 'update', row: 1, fields: [{ column: 'c1', value: { mode: 'null' } }] },
    ] });
  });

  it('恢复原值可清除整行旧草稿，未修改的行保持', () => {
    const rows = postgresBatchRows(page, selected, key => key === '一' ? { ...prior, fields: [prior.fields[1]] } : undefined);
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map()]]))).toEqual({ changes: [], remove: new Set(['一']) });
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c1', { mode: 'text', value: '甲' }]])]])))
      .toEqual({ changes: [], remove: new Set(['一']) });
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c1', prior.fields[1].value]])]])))
      .toEqual({ changes: [], remove: new Set() });
  });

  it('拒绝旧行身份、未勾选行和不可编辑字段', () => {
    const rows = postgresBatchRows(page, new Set([0]), () => undefined);
    expect(() => postgresBatchEditPlan(page, rows, new Map([[1, new Map()]]))).toThrow('变化');
    expect(() => postgresBatchEditPlan({ ...page, rowKeys: ['新一', '二'] }, rows, new Map([[0, new Map()]]))).toThrow('变化');
    expect(() => postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c0', { mode: 'null' }]])]]))).toThrow('无效');
  });
});

describe('PostgreSQL 跨页逐条编辑', () => {
  function capture(offset: number, index: number, writable = page.columns.slice(1, 2)) {
    return capturePostgresCheckedFill({ ...page, rows: [page.rows[index]], rowKeys: [page.rowKeys![index]],
      pageToken: '原页' + offset, writeExpiresAt: Date.now() + 60000 }, offset, writable, new Set([0]), []);
  }
  const textValue = (value: string): PostgresBatchEditValues => new Map([['c1', { mode: 'text', value }]]);

  it('区分页内同号行，保留首次原页版本、主键原值及未开放字段', () => {
    const first = capture(0, 0), second = capture(2, 1);
    const existing: PostgresDraftEntry = { rowKey: '二', offset: 6, change: { ...prior,
      pageToken: '首次版本', fields: [{ column: 'c2', value: { mode: 'default' } }, prior.fields[1]] } };
    const draft = [existing], plan = planPostgresCheckedEdit([second, first], page.columns, draft, 2);
    expect(plan.positions).toEqual([{ page: 1, row: 1 }, { page: 2, row: 1 }]);
    expect(plan.rows.map(row => [row.index, row.original.c0])).toEqual([[0, '9007199254740993'], [1, '9007199254740995']]);
    expect(() => plan.entries(new Map([[0, textValue('第一页')], [1, new Map([['c2', { mode: 'null' }]])]]))).toThrow('无效');
    expect(draft).toEqual([existing]);
    expect(plan.entries(new Map([[0, textValue('第一页')], [1, textValue('第二页')]]))).toEqual({ count: 2, entries: [
      { rowKey: '一', offset: 0, change: { kind: 'update', row: 0, pageToken: first.token,
        fields: [{ column: 'c1', value: { mode: 'text', value: '第一页' } }] } },
      { ...existing, change: { ...existing.change,
        fields: [{ column: 'c2', value: { mode: 'default' } }, { column: 'c1', value: { mode: 'text', value: '第二页' } }] } },
    ] });
  });

  it('未触碰原值不建历史，可恢复原值撤回旧草稿，拒绝重叠或失效来源', () => {
    const first = capture(0, 0), second = capture(2, 1);
    const draft: PostgresDraftEntry[] = [{ rowKey: '二', offset: 2,
      change: { ...prior, pageToken: second.token, fields: [prior.fields[1]] } }];
    const plan = planPostgresCheckedEdit([first, second], page.columns, draft, 2);
    expect(plan.entries(new Map([[0, textValue('甲')]])).entries).toBe(draft);
    expect(plan.entries(new Map([[1, textValue('乙')]]))).toEqual({ count: 1, entries: [] });
    expect(() => plan.entries(new Map([[2, textValue('越界')]]))).toThrow('变化');
    expect(() => planPostgresCheckedEdit([first, capture(2, 0)], page.columns, draft, 2)).toThrow('同一主键');
    expect(() => planPostgresCheckedEdit([first, { ...second, expiresAt: 0 }], page.columns, draft, 2)).toThrow('失效');
    expect(() => planPostgresCheckedEdit([first, second], page.columns, [
      { ...draft[0], change: { kind: 'delete', row: 0, pageToken: second.token } },
    ], 2)).toThrow('变化');
  });
});
