import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import { buildSqliteExplainPlan, sqliteExplainLimits } from '../../src/shared/sqliteExplain';
import { capturePlanSnapshot } from '../../src/shared/explainSnapshot';
import { explainSnapshotZh as snapshotText } from '../../src/shared/explainSnapshot.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteExplainZh as text } from '../../src/renderer/locales/sqliteExplain.zh-CN';
import { explainZh as findText } from '../../src/renderer/locales/explain.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const grids = vi.hoisted(() => ({ calls: [] as any[] }));
// 仅隔离虚拟网格 DOM；原始列/行、只读属性和来源守卫在此端口精确核对。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: (props: any) => { grids.calls.push(props); return <div role="grid"/>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let View: typeof import('../../src/renderer/components/SqliteExplainPlanView')['SqliteExplainPlanView'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), scroll = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); Reflect.set(node, 'scrollIntoView', scroll); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteExplainPlanView: View } = await import('../../src/renderer/components/SqliteExplainPlanView'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; grids.calls = []; vi.clearAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

function fixture(): QueryOutcome {
  const result: QueryResult = { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }, { key: 'c1', name: 'parent', type: 'SQLITE' }, { key: 'c2', name: 'notused', type: 'SQLITE' }, { key: 'c3', name: 'detail', type: 'SQLITE' }], rows: [{ c0: '9007199254740993', c1: '0', c2: '0', c3: 'SCAN "表🧭"' }], truncated: false, elapsedMs: 0, statement: 'EXPLAIN QUERY PLAN SELECT 1' };
  return { results: [result], elapsedMs: 1, sqliteExplain: { dialect: 'sqlite', version: '3.合成', initialView: 'tree', raw: 'id\tparent\tnotused\tdetail\n9007199254740993\t0\t0\tSCAN "表🧭"', rawTruncated: false, warnings: ['原生输出不包含实际耗时。'], nodes: [
    { id: '9007199254740993', depth: 0, auxiliary: '0', detail: '根计划原文' },
    { id: '2', parent: '9007199254740993', depth: 1, auxiliary: '0', detail: 'SEARCH "表🧭" USING INDEX idx_name (name=?)' },
    { id: '3', parent: '2', depth: 2, auxiliary: '0', detail: '保留原文 <script>不得运行</script>' },
    { id: '4', parent: '9007199254740993', depth: 1, auxiliary: '0', detail: 'USE TEMP B-TREE FOR ORDER BY' },
  ] } };
}
async function mount(outcome = fixture(), busy = false, fileActions = false) {
  let allowed = true; const invoke = vi.fn<(command: string, payload: unknown) => Promise<unknown>>(() => { throw Error('本地计划阅读禁止 IPC'); }); Reflect.set(window, 'dbark', { invoke }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = async (next = outcome, nextBusy = busy) => { await act(async () => root!.render(<View outcome={next} busy={nextBusy} isCurrent={() => allowed} fileActions={fileActions}/>)); }; await render();
  return { outcome, invoke, render, async allowed(value: boolean) { allowed = value; await render(); } };
}
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(node => (node.getAttribute('aria-label') ?? node.textContent) === label); expect(node, label).toBeDefined(); return node!; }
function tree(): MemoryNode[] { return document.querySelectorAll('[role="treeitem"]'); }
function selected() { return tree().find(node => node.getAttribute('aria-selected') === 'true'); }
function callback(node: MemoryNode, name = 'onClick'): (...args: any[]) => unknown { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return Reflect.get(node, key)[name]; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function key(node: MemoryNode, value: string, modifiers: { shiftKey?: boolean; isComposing?: boolean } = {}) { const event = Object.assign(new MemoryEvent('keydown'), { key: value, ...modifiers }); await act(async () => node.dispatchEvent(event)); return event; }
function searchInput() { return document.querySelector(`input[aria-label="${text.find}"]`)!; }
function searchCount() { return document.querySelector(`[aria-label="${findText.findCount}"]`)!.textContent; }
async function search(value: string) { await act(async () => { const input = searchInput(); input.value = value; input.dispatchEvent(new MemoryEvent('input')); }); }

function currentPlan(detail: string): QueryOutcome {
  const original = fixture().results[0];
  const result = { ...original, rows: [{ ...original.rows[0], c3: detail }] };
  return { results: [result], elapsedMs: 0, sqliteExplain: buildSqliteExplainPlan(result, '3.53.4') };
}

describe('SQLite 计划专属视图真实 React RAM', () => {
  it('当前计划与基准共用只读差异视图，关闭后保留查找和节点', async () => {
    const f = await mount(currentPlan('SEARCH 表 USING INDEX idx_name'), false, true);
    const baseline = capturePlanSnapshot(currentPlan('SCAN 表'));
    f.invoke.mockResolvedValueOnce({ name: '基准.json', snapshot: baseline });
    await search('idx_name'); await click(findText.next);
    const original = selected();
    await click(snapshotText.compareBaseline);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('基准.json · 3.53.4');
    expect(dialog?.textContent).toContain(snapshotText.compareCurrent);
    expect(dialog?.textContent).toContain('SCAN 表');
    expect(dialog?.textContent).toContain('SEARCH 表 USING INDEX idx_name');
    expect(dialog?.textContent).toContain(snapshotText.compareCount(1, 1));
    expect(f.invoke.mock.calls).toEqual([['explainFiles.open', {}]]);
    await click(zh.dialogs.text001);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(selected()).toBe(original);
    expect(searchInput().value).toBe('idx_name');
  });

  it('文件选择期间阻止重复对比和保存，换代后忽略之前的回执', async () => {
    const f = await mount(currentPlan('SEARCH 表'), false, true);
    const baseline = capturePlanSnapshot(currentPlan('SCAN 表'));
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    f.invoke.mockReturnValueOnce(pending);
    const compare = callback(button(snapshotText.compareBaseline));
    const save = callback(button(snapshotText.save));
    await act(async () => { compare(); compare(); save(); });
    expect(f.invoke.mock.calls).toEqual([['explainFiles.open', {}]]);
    await f.render(currentPlan('SCAN 新计划'));
    await act(async () => finish({ name: '迟到.json', snapshot: baseline }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(selected()?.textContent).toContain('SCAN 新计划');
    expect(document.body.textContent).not.toContain('迟到.json');
    expect(button(snapshotText.compareBaseline).disabled).toBe(false);
  });

  it('原数值id和detail逐字保留，不解释脚本或构造MySQL估计指标', async () => {
    const f = await mount(); expect(document.querySelector('[data-sqlite-explain-view]')).not.toBeNull(); expect(tree()).toHaveLength(4); expect(tree()[0].textContent).toContain('9007199254740993'); expect(tree()[1].textContent).toContain(f.outcome.sqliteExplain!.nodes[1].detail); expect(tree()[2].textContent).toContain('<script>不得运行</script>'); expect(document.querySelectorAll('script')).toHaveLength(0); expect(document.body.textContent).toContain(text.estimates); expect(document.body.textContent).toContain('原生输出不包含实际耗时。'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('tree/table/raw切换读取同一原回包，原网格列行不复制不推断类型，零请求', async () => {
    const f = await mount(); await click(text.tableLabel); const grid = grids.calls.at(-1); expect(grid.columns).toBe(f.outcome.results[0].columns); expect(grid.rows).toBe(f.outcome.results[0].rows); expect(grid.binaryFileActions).toBe(false); for (const action of ['onSortChange', 'onFilterCell', 'onSelectionChange', 'onStatistics']) expect(grid[action]).toBeUndefined();
    await click(text.rawLabel); expect(document.querySelector('[aria-label="' + text.rawContent + '"]')!.textContent).toBe(f.outcome.sqliteExplain!.raw); await click(text.treeLabel); expect(tree()).toHaveLength(4); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('初始table严格沿后端指示；不完整树保留警告和原始表格', async () => {
    const value = fixture(); value.sqliteExplain!.initialView = 'table'; value.sqliteExplain!.nodes = []; value.sqliteExplain!.warnings.push('原始结果截断，树关系未确认。'); const f = await mount(value); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); expect(grids.calls.at(-1).rows).toBe(value.results[0].rows); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.empty); expect(document.body.textContent).toContain('原始结果截断，树关系未确认。'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('键盘折叠/展开与父子移动，选择和焦点停留真实可见节点', async () => {
    const f = await mount(); await key(tree()[0], 'ArrowRight'); expect(selected()!.textContent).toContain('SEARCH'); await key(selected()!, 'ArrowRight'); expect(selected()!.textContent).toContain('不得运行'); await key(selected()!, 'ArrowLeft'); expect(selected()!.textContent).toContain('SEARCH'); await key(selected()!, 'ArrowLeft'); expect(tree()).toHaveLength(3); expect(selected()!.getAttribute('aria-expanded')).toBe('false'); await key(selected()!, 'Enter'); expect(tree()).toHaveLength(4); await key(selected()!, 'End'); expect(selected()!.textContent).toContain('TEMP B-TREE'); expect(document.activeElement).toBe(selected()); await click(text.collapse); expect(tree()).toHaveLength(1); await click(text.expand); expect(tree()).toHaveLength(4); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('从原文视图查找折叠节点，只展开命中祖先并聚焦原节点', async () => {
    const value = fixture();
    value.sqliteExplain!.nodes.push({ id: '5', parent: '9007199254740993', depth: 1, auxiliary: '0', detail: '无关分支' },
      { id: '6', parent: '5', depth: 2, auxiliary: '0', detail: '仍然折叠' });
    const f = await mount(value);
    await click(text.collapse); expect(tree()).toHaveLength(1);
    await click(text.rawLabel); await search('<SCRIPT>');
    expect(searchCount()).toBe(findText.matches(0, 1));
    await key(searchInput(), 'Enter');
    expect(button(text.treeLabel).getAttribute('aria-pressed')).toBe('true');
    expect(selected()!.textContent).toContain('保留原文 <script>不得运行</script>');
    expect(selected()!.getAttribute('data-plan-match')).toBe('true');
    expect(document.activeElement).toBe(selected());
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(tree().find(node => node.textContent.includes('无关分支'))?.getAttribute('aria-expanded')).toBe('false');
    expect(tree().some(node => node.textContent.includes('仍然折叠'))).toBe(false);
    expect(searchCount()).toBe(findText.matches(1, 1));
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('完整节点编号、Unicode 和字面匹配，前后环绕且中文输入组合不跳转', async () => {
    const value = fixture(); value.sqliteExplain!.nodes[3].detail += ' IDX_NAME🧭';
    await mount(value);
    await search('Idx_Name'); expect(searchCount()).toBe(findText.matches(0, 2));
    const composition = await key(searchInput(), 'Enter', { isComposing: true });
    expect(composition.defaultPrevented).toBe(false);
    await key(searchInput(), 'Enter', { shiftKey: true });
    expect(selected()?.textContent).toContain('TEMP B-TREE');
    await click(findText.next); expect(selected()?.textContent).toContain('SEARCH');
    await click(findText.previous); expect(selected()?.textContent).toContain('TEMP B-TREE');
    await search('9007199254740993'); expect(searchCount()).toBe(findText.matches(0, 3));
    await search('900719925474099'); expect(button(findText.next).disabled).toBe(true);
    await search('🧭'); expect(searchCount()).toBe(findText.matches(0, 2));
    await search('.*'); expect(searchCount()).toBe(findText.matches(0, 0));
  });
  it('超长输入保留已应用关键字，清空和换代不复用旧回调', async () => {
    const f = await mount();
    await search('idx_name'); await click(findText.next);
    const oldSelection = selected(), staleNext = callback(button(findText.next)), staleInput = callback(searchInput(), 'onInput');
    await search('x'.repeat(201));
    expect(searchInput().value).toBe('idx_name');
    expect(searchInput().getAttribute('aria-invalid')).toBe('true');
    expect(searchCount()).toBe(findText.matches(1, 1)); expect(selected()).toBe(oldSelection);
    await key(searchInput(), 'Escape'); expect(searchInput().value).toBe(''); expect(selected()).toBe(oldSelection);
    await f.render(fixture()); await f.render(f.outcome);
    await act(async () => { staleNext(); staleInput({ currentTarget: { value: '旧查找' } }); });
    expect(searchInput().value).toBe(''); expect(searchCount()).toBe(findText.findIdle); expect(selected()).toBe(tree()[0]);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('新outcome及A→B→A重置本地状态，旧节点和切换回调不能操作后继计划', async () => {
    const f = await mount(), oldCollapse = callback(button(text.collapse)), oldNode = callback(tree()[1]); await click(text.collapse); const next = fixture(); next.sqliteExplain!.nodes[0].detail = '新计划'; await f.render(next); await f.render(f.outcome); expect(tree()).toHaveLength(4); await act(async () => { oldCollapse(); oldNode(); }); expect(tree()).toHaveLength(4); expect(selected()!.textContent).toContain('根计划'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('旧原文/表格按钮在render代次变更后不能复用，来源拒绝也禁本地旧动作', async () => {
    const f = await mount(), oldRaw = callback(button(text.rawLabel)); await click(text.tableLabel); await act(async () => oldRaw()); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); await f.allowed(false); await act(async () => callback(button(text.treeLabel))()); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); expect(grids.calls.at(-1).isCurrent()).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('300节点及64深度仍用扁平有界DOM；超界不截成另一棵完整树', async () => {
    const value = fixture(); value.sqliteExplain!.nodes = Array.from({ length: sqliteExplainLimits.nodes }, (_, index) => ({ id: String(index), depth: index < sqliteExplainLimits.depth ? index : 0, ...(index > 0 && index < sqliteExplainLimits.depth ? { parent: String(index - 1) } : {}), auxiliary: '0', detail: '节点 ' + index })); const f = await mount(value); expect(tree()).toHaveLength(300); expect(tree()[63].getAttribute('aria-level')).toBe('64'); const oversized = fixture(); oversized.sqliteExplain!.nodes = [...value.sqliteExplain!.nodes, { id: 'extra', depth: 0, auxiliary: '0', detail: '超界' }]; await f.render(oversized); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.bounds);
    const tooDeep = fixture(); tooDeep.sqliteExplain!.nodes[0].depth = sqliteExplainLimits.depth; await f.render(tooDeep); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.bounds); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('原文截断警告不冒充完整结果，保存类busy仍保相同计划与本地阅读状态', async () => {
    const value = fixture(); value.sqliteExplain!.rawTruncated = true; const f = await mount(value); await click(text.rawLabel); await f.render(value, true); expect(button(text.rawLabel).getAttribute('aria-pressed')).toBe('true'); expect(document.body.textContent).toContain(text.truncated); await click(text.tableLabel); expect(grids.calls.at(-1).isCurrent()).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });
});
