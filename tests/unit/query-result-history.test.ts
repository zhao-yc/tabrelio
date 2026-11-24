import { describe, expect, it } from 'vitest';
import { QueryResultHistory, prepareQueryResultOrganization, queryResultHistoryLimits, type QueryResultOrganization } from '../../src/renderer/queryResultHistory';
import { QueryResultOrganizationCache } from '../../src/renderer/queryResultOrganizationCache';
import { prepareQueryResultArchiveView } from '../../src/renderer/queryResultArchiveView';
import { projectQueryResultRows } from '../../src/renderer/queryResultColumns';
import type { QueryResultFindSettings } from '../../src/renderer/queryResultFind';
import type { QueryResult } from '../../src/shared/contracts';

const empty = (): QueryResultOrganization => ({ expression: { mode: 'AND', children: [] }, sort: [] });
const sorted = (direction: 'ASC' | 'DESC'): QueryResultOrganization => ({ ...empty(), sort: [{ column: 'id', direction, nulls: 'LAST' }] });
/** 行保持高精度原文及原引用；历史只复制配置。 */
function fixture() {
  const source: QueryResult = { columns: [{ key: 'id', name: '编号', type: 'BIGINT' }, { key: 'value', name: '金额', type: 'DECIMAL' }], rows: [{ id: '9007199254740993', value: '0.12345678901234567891' }, { id: '2', value: null }], truncated: true, elapsedMs: 0, statement: '不应进入历史的SQL' };
  const history = new QueryResultHistory(), binding = history.bind(source, source.columns, ['a'], empty())!;
  return { source, history, binding };
}
describe('当前结果排序筛选的有界撤销历史', () => {
  it('整份配置原子应用新控制器后保留历史，旧票据作废，原样应用不丢重做', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC'));
    const old = history.target(binding, -1)!, owner = {};
    history.record(binding, sorted('DESC'), owner);
    expect(history.bind(source, source.columns, ['a'], sorted('DESC'), owner)).toBe(binding);
    expect(() => history.commit(old)).toThrow();
    history.commit(history.target(binding, -1)!); expect(history.target(binding, 1)!.configuration).toEqual(sorted('DESC'));
    const nextOwner = {}; history.record(binding, sorted('ASC'), nextOwner);
    expect(history.bind(source, source.columns, ['a'], sorted('ASC'), nextOwner)).toBe(binding);
    expect(history.target(binding, 1)!.configuration).toEqual(sorted('DESC'));
  });
  it('按整次操作往返，票据不提前移动游标，配置副本深冻结', () => {
    const { history, binding } = fixture(), next = sorted('ASC'); history.record(binding, next);
    (next.sort[0] as any).direction = 'DESC'; const undo = history.target(binding, -1)!;
    expect(undo.configuration).toEqual(empty()); expect(history.target(binding, 1)).toBeUndefined(); history.commit(undo);
    const redo = history.target(binding, 1)!; expect(redo.configuration.sort[0].direction).toBe('ASC'); expect(Object.isFrozen(redo.configuration.sort[0])).toBe(true); history.commit(redo);
    expect(() => history.commit(undo)).toThrow();
  });
  it('原样应用保留重做；成功的新步骤丢弃未来分支', () => {
    const { history, binding } = fixture(); history.record(binding, sorted('ASC')); history.commit(history.target(binding, -1)!);
    history.record(binding, empty()); expect(history.target(binding, 1)).toBeDefined(); history.record(binding, sorted('DESC')); expect(history.target(binding, 1)).toBeUndefined();
  });
  it('同来源重绘不复制或清历史；上下文、列身份或控制器变代后拒旧票据', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC')); const old = history.target(binding, -1)!;
    expect(history.bind(source, source.columns, ['a'], sorted('ASC'))).toBe(binding);
    const newer = history.bind(source, source.columns, ['b'], empty())!; expect(history.target(binding, -1)).toBeUndefined(); expect(() => history.commit(old)).toThrow();
    history.record(newer, sorted('DESC')); const replaced = history.bind(source, source.columns, ['b'], sorted('DESC'), {}); expect(replaced).not.toBe(newer); expect(history.target(replaced, -1)).toBeUndefined();
  });
  it('提交已验证的新控制器后继续重做；显式失活再返回相同上下文也不复活', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC')); const owner = {}; history.commit(history.target(binding, -1)!, owner);
    expect(history.bind(source, source.columns, ['a'], empty(), owner)).toBe(binding); expect(history.target(binding, 1)).toBeDefined();
    history.invalidate(); const later = history.bind(source, source.columns, ['a'], empty(), owner)!; expect(later).not.toBe(binding); expect(history.target(later, -1)).toBeUndefined();
  });
  it('最多20步并按配置字符总量淘汰最旧步骤；超大单项不截断条件', () => {
    const { history, binding } = fixture();
    for (let i = 0; i < 40; i++) history.record(binding, { expression: { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: String(i) }] }, sort: [] });
    let count = 0; while (history.target(binding, -1)) { history.commit(history.target(binding, -1)!); count++; } expect(count).toBe(queryResultHistoryLimits.steps);
    const huge = { expression: { mode: 'AND' as const, children: [{ column: 'id', operator: 'eq' as const, value: 'x'.repeat(queryResultHistoryLimits.entryUnits) }] }, sort: [] };
    history.record(binding, huge); expect(history.limited).toBe(true); expect(history.target(binding, -1)).toBeUndefined(); expect(huge.expression.children[0].value).toHaveLength(queryResultHistoryLimits.entryUnits);
  });
  it('完整试算保持精确值、NULL、截断与原行身份，失败不修改已生效控制器', () => {
    const { source } = fixture(), before = structuredClone(source), current = prepareQueryResultOrganization(source, [], source.columns, sorted('ASC'));
    expect(current.sorter.view(current.sortBinding)!.result.rows).toEqual([source.rows[1], source.rows[0]]);
    expect(() => prepareQueryResultOrganization(source, [], source.columns, { ...empty(), sort: [{ column: 'missing', direction: 'ASC' }] })).toThrow();
    expect(current.sorter.view(current.sortBinding)!.rules).toEqual(sorted('ASC').sort); expect(source).toEqual(before);
    const none = prepareQueryResultOrganization(source, [], source.columns, { expression: { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: '0' }] }, sort: sorted('ASC').sort });
    expect(none.sorter.view(none.sortBinding)!.result.rows).toEqual([]); expect(none.sorter.view(none.sortBinding)!.result.truncated).toBe(true);
  });
  it('多个合法大小的配置共享总容量，不靠20步上限掩盖文本累计', () => {
    const { history, binding } = fixture();
    for (let i = 0; i < 12; i++) history.record(binding, { expression: { mode: 'AND', children: Array.from({ length: 24 }, () => ({ column: 'id', operator: 'eq', value: String(i) + 'x'.repeat(4000), enabled: false })) }, sort: [] });
    let count = 0; while (history.target(binding, -1)) { history.commit(history.target(binding, -1)!); count++; }
    expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(6); expect(history.limited).toBe(false);
  });
});

describe('每组查询结果的已应用整理配置', () => {
  it('批量导出读取其它结果的已应用规则，保留零行标题、列顺序、原行及截断标记', () => {
    const cache = new QueryResultOrganizationCache();
    const { source } = fixture(), { source: current } = fixture();
    const scope = 'connection:1', execution = 'run:1';
    const layout = { order: ['value', 'id'], visible: ['value', 'id'] };
    cache.restore(source, scope, execution, [], source.columns);
    cache.remember(source, scope, execution, sorted('ASC'));
    cache.restore(current, scope, execution, [], current.columns);
    const rules = cache.readConfiguration(source, scope, execution);
    const view = prepareQueryResultArchiveView(source, layout, rules, () => '9007199254740993');
    expect(view.result.rows).toEqual([source.rows[0]]);
    expect(view.result.rows[0]).toBe(source.rows[0]);
    expect(view.columns.map(column => column.key)).toEqual(['value', 'id']);
    expect(cache.readConfiguration(source, scope, 'run:2')).toBeUndefined();
    const none = prepareQueryResultArchiveView(source, layout, rules, () => '找不到的行');
    expect(projectQueryResultRows(none.result, none.columns)).toEqual({
      columns: [{ key: 'value', name: '金额' }, { key: 'id', name: '编号' }], rows: [], truncated: true,
    });
    expect(source.columns.map(column => column.key)).toEqual(['id', 'value']);
    expect(source.rows).toHaveLength(2);
  });

  it('查找条件属于原结果和执行，本次固定快照的查找可单独清除', () => {
    const cache = new QueryResultOrganizationCache();
    const { source } = fixture(), { source: pin } = fixture();
    const settings: QueryResultFindSettings = {
      query: '9007199254740993', sensitive: true, columnKey: 'id', mode: 'whole',
      checkedOnly: true, highlightAll: true, incremental: false,
    };
    const activate = (result: QueryResult, execution: string | undefined, scope = 'connection:1') => {
      cache.restore(result, scope, execution, [result], result.columns);
      return cache.findMemory(result, scope, execution)!;
    };
    const original = activate(source, 'run:1');
    original.remember(settings);
    const pinned = activate(pin, undefined);
    pinned.remember({ ...settings, query: '2' });
    expect(original.read()).toBeUndefined();
    const restoredOriginal = activate(source, 'run:1');
    original.clear();
    expect(restoredOriginal.read()).toEqual(settings);
    expect(activate(source, 'run:2').read()).toBeUndefined();
    const restoredPin = activate(pin, undefined);
    expect(restoredPin.read()?.query).toBe('2');
    restoredPin.clear();
    expect(restoredPin.read()).toBeUndefined();
    expect(activate(source, 'run:1', 'connection:2').read()).toBeUndefined();
  });

  it('按结果身份恢复原精度和排序，新结果及连接修订使用原返回顺序', () => {
    const cache = new QueryResultOrganizationCache();
    const {source: first} = fixture(), {source: second} = fixture();
    const activate = (source: QueryResult, scope = 'connection:1', execution = 'run:1') => cache.restore(source, scope, execution, [source], source.columns);
    expect(activate(first)).toBeUndefined();
    cache.remember(first, 'connection:1', 'run:1', sorted('ASC'));
    expect(activate(second)).toBeUndefined();
    cache.remember(second, 'connection:1', 'run:1', {expression: {mode: 'AND', children: [{column: 'id', operator: 'eq', value: '0'}]}, sort: sorted('DESC').sort});
    const firstView = activate(first)!;
    expect(firstView.sorter.view(firstView.sortBinding)?.result.rows).toEqual([first.rows[1], first.rows[0]]);
    expect(activate(first)).toBeUndefined();
    const emptyView = activate(second)!;
    expect(emptyView.sorter.view(emptyView.sortBinding)?.result.rows).toEqual([]);
    expect(activate(structuredClone(first))).toBeUndefined();
    expect(activate(first, 'connection:1', 'run:2')).toBeUndefined();
    expect(activate(first, 'connection:2')).toBeUndefined();
    expect(activate(second)).toBeUndefined();
  });

  it('清空规则和丢弃失效列配置后，旧规则不会在再次切回时出现', () => {
    const cache = new QueryResultOrganizationCache(), {source} = fixture();
    const activate = (visible = source.columns) => cache.restore(source, 'connection', undefined, [source], visible);
    const leave = () => cache.restore(undefined, 'connection', 'run:2', [], undefined);
    activate(); cache.remember(source, 'connection', undefined, sorted('DESC')); leave();
    expect(activate([source.columns[1]])).toBeUndefined(); leave();
    expect(activate()).toBeUndefined();
    cache.remember(source, 'connection', undefined, sorted('ASC')); leave();
    expect(activate()).toBeDefined();
    cache.remember(source, 'connection', undefined, empty()); leave();
    expect(activate()).toBeUndefined();
  });
});
