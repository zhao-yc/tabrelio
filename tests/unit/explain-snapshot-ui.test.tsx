import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
import { workspaceToolCommandSource } from '../helpers/workspaceToolCommandSource';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';
import { readEditorWordWrap } from '../../src/shared/editorWordWrap';
import { appDialogSelector } from '../../src/renderer/modalSelectors';
let errorMessage: typeof import('../../src/renderer/lib')['errorMessage'];
let restoreNavigationMenuPort: () => void = () => {};
let ActionMenu: typeof import('../../src/renderer/components/ActionMenu')['ActionMenu'], ActionMenuSection: typeof import('../../src/renderer/components/ActionMenu')['ActionMenuSection'];
import { act, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan } from '../../src/shared/explain';
import { captureExplainSnapshot, capturePlanSnapshot, encodeExplainSnapshot, explainSnapshotLimits } from '../../src/shared/explainSnapshot';
import { buildSqliteExplainPlan } from '../../src/shared/sqliteExplain';
import { comparePlanSnapshots } from '../../src/shared/planSnapshotComparison';
import { PlanComparisonView } from '../../src/renderer/components/PlanComparisonView';
import { sqliteExplainZh } from '../../src/renderer/locales/sqliteExplain.zh-CN';
import { explainSnapshotZh as text } from '../../src/shared/explainSnapshot.zh-CN';
import { explainZh as planText } from '../../src/renderer/locales/explain.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 网格端口不属于文件交互；实际 Modal、计划树、codec、React 与 IPC 调用均保留。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ExplainSnapshotDialog')['ExplainSnapshotDialog'];
let View: typeof import('../../src/renderer/components/ExplainPlanView')['ExplainPlanView'];
let Save: typeof import('../../src/renderer/components/ExplainSnapshotSaveButton')['ExplainSnapshotSaveButton'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let store: typeof import('../../src/renderer/store')['useWorkspace'];
const bridge = vi.fn();
/** 从正式 App 取入口状态、开关及模态表达式，验证无连接场景无需引入整套数据库工作区。 */
function appEntry(invalidate: () => void) {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  let declaration = '', modal = ''; const methods: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(file) === '[explainSnapshot, setExplainSnapshot]')) declaration = node.getText(file);
    if (ts.isFunctionDeclaration(node) && ['openExplainSnapshot','closeExplainSnapshot'].includes(node.name?.text ?? '')) methods.push(node.getText(file));
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'explainSnapshot' && ts.isJsxSelfClosingElement(node.right)) modal = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(app); expect([declaration, modal].every(Boolean)).toBe(true); expect(methods).toHaveLength(2);
  const menu = workspaceToolCommandSource(source, readFileSync(new URL('../../src/renderer/components/NavigationToolbar.tsx', import.meta.url), 'utf8'), 'explain-snapshot');
  const context: any = createContext({ exports: {}, useState, document, appDialogSelector, useWorkspace: store, flushSettings: () => Promise.resolve(), errorMessage, readEditorWordWrap, ActionMenu, ActionMenuSection, uiCommandLabels, navigationZh, ExplainSnapshotDialog: Dialog, workbenchNavigation: { invalidate: invalidate }, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry({children}:any){${declaration}
${methods.join('\n')}
${menu}return <><ActionMenu label={navigationZh.tools}>{toolActions}</ActionMenu>${modal ? '{' + modal + '}' : ''}{children}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.Entry as React.ComponentType<{ children?: React.ReactNode }>;
}

beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); ({ ActionMenu, ActionMenuSection } = await import('../../src/renderer/components/ActionMenu')); ({ errorMessage } = await import('../../src/renderer/lib')); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name); (node as any).scrollIntoView = vi.fn(); const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store } = await import('../../src/renderer/store')); ({ ExplainSnapshotDialog: Dialog } = await import('../../src/renderer/components/ExplainSnapshotDialog')); ({ ExplainPlanView: View } = await import('../../src/renderer/components/ExplainPlanView')); ({ ExplainSnapshotSaveButton: Save } = await import('../../src/renderer/components/ExplainSnapshotSaveButton'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; bridge.mockReset(); });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 原始数据库结果交由正式 codec 处理，不用另一个文件实现替代被测代码。 */
function fixture(name = 'orders'): QueryOutcome {
  const raw = JSON.stringify({ query_block: { select_id: 1, nested_loop: [{ table: { table_name: name, access_type: 'ALL', rows_examined_per_scan: 12 } }] } });
  return { elapsedMs: 4, explain: parseExplainPlan(raw, 'mysql', '8.4.11'), results: [{ columns: [{ key: 'EXPLAIN', name: 'EXPLAIN', type: 'JSON' }], rows: [{ EXPLAIN: raw }], truncated: false, elapsedMs: 4, statement: 'EXPLAIN SELECT secret FROM orders' }] };
}
/** 受控原始 Promise 用于观察未结束 I/O，避免定时器假定任务已完成。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(element: React.ReactNode) { (window as any).dbark = { invoke: bridge }; const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await render(element); }
async function render(element: React.ReactNode) { await act(async () => root!.render(element)); }
function button(label: string) { const node = navigationMenuRamButton(document, label) ?? document.querySelectorAll('button').find(item => item.textContent === label || item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
function props(node: ReturnType<typeof memoryDocument>['body']) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }
async function search(value: string) { const input = document.querySelector(`input[aria-label="${planText.find}"]`)!; await act(async () => { input.value = value; input.dispatchEvent(new MemoryEvent('input')); }); }
function compareSearchInput() { return document.querySelector(`input[aria-label="${text.compareFind}"]`)!; }
async function compareSearch(value: string) { const input = compareSearchInput(); await act(async () => { input.value = value; input.dispatchEvent(new MemoryEvent('input')); }); }
const opened = (name = '原始.dbark-plan.json', outcome = fixture()) => ({ name, snapshot: captureExplainSnapshot(outcome) });

it('挂载不选择文件且无需连接，明示离线，不出现任何数据库执行按钮', async () => {
  const onClose = vi.fn(); await mount(<Dialog onClose={onClose}/>); expect(bridge).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notice);
  bridge.mockResolvedValueOnce(opened()); await click(text.choose); expect(bridge.mock.calls).toEqual([['explainFiles.open', {}]]); expect(document.body.textContent).toContain('orders'); expect(document.body.textContent).toContain('MySQL 8.4.11'); expect(document.body.textContent).not.toContain(planText.text); expect(document.body.textContent).not.toContain('SELECT secret'); await click(text.close); expect(onClose).toHaveBeenCalledTimes(1);
});

it('打开原请求 pending 时同步拦截双击、关闭按钮与 Escape，完成才解锁', async () => {
  const onClose = vi.fn(), pending = deferred<ReturnType<typeof opened> | null>(); bridge.mockReturnValue(pending.promise); await mount(<Dialog onClose={onClose}/>);
  const choose = props(button(text.choose)).onClick; await act(async () => { choose(); choose(); }); expect(bridge).toHaveBeenCalledTimes(1); expect(button(text.close).disabled).toBe(true);
  await click(zh.dialogs.text001); await act(async () => document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }))); expect(onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve(null)); expect(button(text.choose).disabled).toBe(false); await click(zh.dialogs.text001); expect(onClose).toHaveBeenCalledTimes(1);
});

it('无连接离线打开 SQLite 四列计划并按原文件另存', async () => {
  const original = { columns: ['id', 'parent', 'notused', 'detail'].map(name => ({ key: name, name, type: 'SQLITE' })),
    rows: [{ id: '7', parent: '0', notused: '0', detail: 'SEARCH subject USING INDEX subject_index' }],
    truncated: false, statement: '原查询不入文件', elapsedMs: 4 };
  const snapshot = capturePlanSnapshot({ elapsedMs: 4, results: [original], sqliteExplain: buildSqliteExplainPlan(original, '3.53.0') });
  await mount(<Dialog onClose={vi.fn()}/>);
  bridge.mockResolvedValueOnce({ name: 'SQLite.dbark-plan.json', snapshot }); await click(text.choose);
  expect(document.body.textContent).toContain(text.sqlite);
  expect(document.body.textContent).not.toContain(original.statement);
  const tree = document.querySelector('[role="tree"]');
  expect(tree?.getAttribute('aria-label')).toBe(sqliteExplainZh.treeLabel);
  expect(tree?.textContent).toContain('subject_index');
  bridge.mockResolvedValueOnce({ name: 'SQLite副本.dbark-plan.json' }); await click(text.saveAs);
  expect(bridge.mock.calls).toEqual([['explainFiles.open', {}], ['explainFiles.save', { snapshot }]]);
});

it('离线对比 SQLite 快照，异类文件与取消保留比较，返回后可另存基准', async () => {
  const file = (name: string, detail: string, version: string) => {
    const original = { columns: ['id', 'parent', 'notused', 'detail'].map(key => ({ key, name: key, type: 'SQLITE' })),
      rows: [{ id: '7', parent: '0', notused: '0', detail }], truncated: false, statement: '', elapsedMs: 4 };
    return { name, snapshot: capturePlanSnapshot({ elapsedMs: 4, results: [original], sqliteExplain: buildSqliteExplainPlan(original, version) }) };
  };
  const before = file('基准.json', 'SCAN subject', '3.50.0');
  const after = file('对比.json', 'SEARCH subject USING INDEX subject_index', '3.53.0');
  await mount(<Dialog onClose={vi.fn()}/>);
  bridge.mockResolvedValueOnce(before); await click(text.choose);
  bridge.mockResolvedValueOnce(after); await click(text.compareChoose);
  const region = () => document.querySelector(`[aria-label="${text.sqliteCompareTitle}"]`);
  const comparison = region();
  expect(comparison?.textContent).toContain(text.compareCount(1, 1));
  expect(comparison?.textContent).toContain('基准.json · 3.50.0');
  expect(comparison?.textContent).toContain('对比.json · 3.53.0');
  expect(comparison?.textContent).toContain('SEARCH subject USING INDEX subject_index');
  await compareSearch('SUBJECT_INDEX');
  bridge.mockResolvedValueOnce(opened()); await click(text.compareChoose);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(text.sqliteCompareUnsupported);
  expect(region()).toBe(comparison);
  bridge.mockResolvedValueOnce(null); await click(text.compareChoose);
  expect(region()).toBe(comparison);
  expect(compareSearchInput().value).toBe('SUBJECT_INDEX');
  bridge.mockResolvedValueOnce(file('新对比.json', 'SEARCH subject USING INDEX new_index', '3.53.4')); await click(text.compareChoose);
  expect(compareSearchInput().value).toBe('');
  expect(region()?.textContent).toContain('new_index');
  await click(text.compareClose);
  expect(region()).toBeNull();
  expect(document.querySelector('[role="tree"]')?.textContent).toContain('SCAN subject');
  bridge.mockResolvedValueOnce(null); await click(text.saveAs);
  expect(bridge.mock.calls).toEqual([...Array.from({ length: 5 }, () => ['explainFiles.open', {}]), ['explainFiles.save', { snapshot: before.snapshot }]]);
});

it('差异查找匹配路径、两侧字段和值，在匹配间环绕并保留原选择', async () => {
  const capture = (details: string[]) => {
    const result = { columns: ['id', 'parent', 'notused', 'detail'].map(key => ({ key, name: key, type: 'SQLITE' })),
      rows: details.map((detail, index) => ({ id: String(index + 1), parent: '0', notused: '0', detail })), truncated: false, statement: '', elapsedMs: 0 };
    return capturePlanSnapshot({ results: [result], elapsedMs: 0, sqliteExplain: buildSqliteExplainPlan(result, '3.53.4') });
  };
  const left = capture(['SEARCH subject USING INDEX old_idx🚢', 'SCAN subject', 'SCAN keep_only']);
  const right = capture(['SEARCH subject USING INDEX idx_replacement', 'SEARCH subject USING INDEX new_idx', 'SCAN keep_only']);
  const comparison = comparePlanSnapshots(left, right);
  await mount(<PlanComparisonView comparison={comparison} dialect="sqlite" left="基准" right="当前"/>);
  const activePath = () => document.querySelector('[aria-pressed="true"]')?.querySelector('small')?.textContent;
  expect(activePath()).toBe('1');
  await act(async () => {
    const node = document.querySelectorAll('button').find(item => item.textContent.includes('new_idx'))!;
    node.dispatchEvent(new MemoryEvent('click'));
  });
  expect(activePath()).toBe('2');

  await compareSearch(' OLD_IDX🚢 ');
  expect(document.body.textContent).toContain(text.compareFindCount(1, 1));
  expect(activePath()).toBe('1');
  expect(document.querySelector('tr[data-plan-match="true"]')?.textContent).toContain('old_idx🚢');
  expect(button(text.compareFindNext).disabled).toBe(true);
  await click(text.compareFindClear);
  expect(activePath()).toBe('2');

  await compareSearch('DETAIL');
  expect(document.body.textContent).toContain(text.compareFindCount(2, 2));
  const press = async (shiftKey = false, isComposing = false) => act(async () => {
    compareSearchInput().dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Enter', shiftKey, isComposing }));
  });
  await press(false, true);
  expect(activePath()).toBe('2');
  await press(); expect(activePath()).toBe('1');
  await press(true); expect(activePath()).toBe('2');
  await click(text.compareFindPrevious); expect(activePath()).toBe('1');

  await compareSearch('3');
  expect(document.body.textContent).toContain(text.compareFindEmpty);
  const showAll = document.querySelector('input[type="checkbox"]')!;
  await act(async () => props(showAll).onChange({ currentTarget: { checked: true } }));
  expect(activePath()).toBe('3');
  expect(document.body.textContent).toContain(text.compareFindCount(1, 1));
  expect(document.body.textContent).toContain(text.compareCount(2, 3));
  expect(bridge).not.toHaveBeenCalled();
});

it('取消和不合法新文件保留原计划、查找、节点选择和文件名', async () => {
  await mount(<Dialog onClose={vi.fn()}/>); bridge.mockResolvedValueOnce(opened()); await click(text.choose); await search('orders'); await click(planText.next);
  const selected = document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true');
  bridge.mockResolvedValueOnce(null); await click(text.choose); expect(document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true')).toBe(selected);
  bridge.mockResolvedValueOnce({ name: '错误文件', snapshot: { version: 9 } }); await click(text.choose); expect(document.querySelector('[role="alert"]')!.textContent).toContain(text.invalid); expect(document.body.textContent).toContain('原始.dbark-plan.json'); expect(document.body.textContent).not.toContain('错误文件'); expect(document.querySelector(`input[aria-label="${planText.find}"]`)!.value).toBe('orders'); expect(document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true')).toBe(selected);
});

it('另存共享原文件锁，保存内容不含 SQL，完成不重建计划及本地查找', async () => {
  const onClose = vi.fn(), pending = deferred<{ name: string } | null>(); await mount(<Dialog onClose={onClose}/>); bridge.mockResolvedValueOnce(opened()); await click(text.choose); await search('orders'); await click(planText.next);
  const tree = document.querySelector('[role="tree"]'), chosen = document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true');
  bridge.mockReturnValueOnce(pending.promise); const save = props(button(text.saveAs)).onClick; await act(async () => { save(); save(); }); expect(bridge).toHaveBeenCalledTimes(2); expect(bridge.mock.calls[1][0]).toBe('explainFiles.save'); expect(JSON.stringify(bridge.mock.calls[1][1])).not.toContain('SELECT secret'); expect(button(text.choose).disabled).toBe(true);
  await click(zh.dialogs.text001); expect(onClose).not.toHaveBeenCalled(); await act(async () => pending.resolve({ name: '另存.dbark-plan.json' })); expect(document.body.textContent).toContain(text.saved('另存.dbark-plan.json')); expect(document.querySelector('[role="tree"]')).toBe(tree); expect(document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true')).toBe(chosen); expect(document.querySelector(`input[aria-label="${planText.find}"]`)!.value).toBe('orders'); expect(button(text.choose).disabled).toBe(false);
});

it('保存取消不声称成功，真实错误和可能已写入提示原样显示，不自动重试', async () => {
  await mount(<Save outcome={fixture()} busy={false}/>); bridge.mockResolvedValueOnce(null); await click(text.save); expect(document.querySelector('[role="status"]')).toBeNull();
  bridge.mockRejectedValueOnce(Error(text.unknownWrite)); await click(text.save); expect(document.querySelector('[role="alert"]')!.textContent).toBe(text.unknownWrite); expect(bridge).toHaveBeenCalledTimes(2); expect(button(text.save).disabled).toBe(false);
});

it('查询 busy 及迟到旧点击不能保存，A→B→A 原回执不复活，原请求 settle 才解锁', async () => {
  const a = fixture('A'), b = fixture('B'), pending = deferred<{ name: string } | null>(); bridge.mockReturnValueOnce(pending.promise); await mount(<Save outcome={a} busy={false}/>);
  const old = props(button(text.save)).onClick; await render(<Save outcome={a} busy/>); await act(async () => old()); expect(bridge).not.toHaveBeenCalled();
  await render(<Save outcome={a} busy={false}/>); await click(text.save); await render(<Save outcome={b} busy={false}/>); await render(<Save outcome={a} busy={false}/>); expect(button(text.saving).disabled).toBe(true);
  await act(async () => pending.resolve({ name: '旧回执' })); expect(document.body.textContent).not.toContain('旧回执'); expect(button(text.save).disabled).toBe(false); await act(async () => old()); expect(bridge).toHaveBeenCalledTimes(1);
});

it('组件卸载后保存及打开迟到回执不能污染后来弹窗，也不补发请求', async () => {
  const oldOpen = deferred<ReturnType<typeof opened> | null>(); bridge.mockReturnValueOnce(oldOpen.promise); await mount(<Dialog onClose={vi.fn()}/>); await click(text.choose); await render(<span/>); await render(<Dialog onClose={vi.fn()}/>); await act(async () => oldOpen.resolve(opened('旧文件'))); expect(document.body.textContent).not.toContain('旧文件'); expect(bridge).toHaveBeenCalledTimes(1);
  const oldSave = deferred<{ name: string } | null>(); bridge.mockReturnValueOnce(oldSave.promise); await render(<Save outcome={fixture()} busy={false}/>); await click(text.save); await render(<span/>); await render(<Dialog onClose={vi.fn()}/>); await act(async () => oldSave.resolve({ name: '旧保存' })); expect(document.body.textContent).not.toContain('旧保存'); expect(bridge).toHaveBeenCalledTimes(2);
});

it('默认计划视图不增加文件调用；显式启用时仍保留原文本执行入口', async () => {
  const outcome = fixture(), onText = vi.fn(); await mount(<View outcome={outcome} busy={false} onText={onText}/>); expect(document.body.textContent).not.toContain(text.save); expect(bridge).not.toHaveBeenCalled(); await click(planText.text); expect(onText).toHaveBeenCalledTimes(1);
  await render(<View outcome={outcome} busy={false} fileActions/>); expect(document.body.textContent).not.toContain(planText.text); expect(button(text.save)).toBeDefined(); expect(bridge).not.toHaveBeenCalled();
});

it('断连后文件保存仍可用，文本请求受原 busy 约束；活动查询同时禁用保存', async () => {
  const outcome = fixture(), onText = vi.fn(); await mount(<View outcome={outcome} busy fileBusy={false} fileActions onText={onText}/>); expect(button(planText.text).disabled).toBe(true); expect(button(text.save).disabled).toBe(false);
  bridge.mockResolvedValueOnce(null); await click(text.save); expect(bridge).toHaveBeenCalledTimes(1); expect(onText).not.toHaveBeenCalled(); await render(<View outcome={outcome} busy fileBusy fileActions onText={onText}/>); expect(button(text.save).disabled).toBe(true);
});

it('文本计划离线恢复后按原字段和数字/NULL/二进制精确另存，不发送文本执行请求', async () => {
  const outcome: QueryOutcome = { elapsedMs: 1, explain: { dialect: 'mariadb', version: '11.4', format: 'text', raw: '', rawTruncated: false, nodes: [], warnings: ['服务器原始提示'] }, results: [{ columns: [{ key: 'table', name: 'table', type: 'VARCHAR' }, { key: 'rows', name: 'rows', type: 'BIGINT' }, { key: 'filtered', name: 'filtered', type: 'DOUBLE' }, { key: 'ref', name: 'ref', type: 'VARCHAR' }, { key: 'binary', name: 'binary', type: 'BLOB' }], rows: [{ table: 'orders', rows: '9007199254740993', filtered: -0, ref: null, binary: { type: 'binary', base64: 'AAH/' } }], truncated: false, statement: 'EXPLAIN SELECT 隐藏语句', elapsedMs: 1 }] };
  const original = captureExplainSnapshot(outcome); await mount(<Dialog onClose={vi.fn()}/>); bridge.mockResolvedValueOnce({ name: '文本计划', snapshot: original }); await click(text.choose); expect(document.body.textContent).toContain('MariaDB 11.4'); expect(document.body.textContent).toContain('服务器原始提示'); expect(document.body.textContent).not.toContain(planText.text);
  bridge.mockResolvedValueOnce({ name: '文本副本' }); await click(text.saveAs); expect(bridge.mock.calls.map(call => call[0])).toEqual(['explainFiles.open', 'explainFiles.save']); expect(bridge.mock.calls[1][1]).toEqual({ snapshot: original });
});

it('跨打开和另存的旧回调不能绕过同步共享锁', async () => {
  await mount(<Dialog onClose={vi.fn()}/>); bridge.mockResolvedValueOnce(opened()); await click(text.choose);
  const choose = props(button(text.choose)).onClick, save = props(button(text.saveAs)).onClick, pendingOpen = deferred<ReturnType<typeof opened> | null>(); bridge.mockReturnValueOnce(pendingOpen.promise);
  await act(async () => { choose(); save(); }); expect(bridge).toHaveBeenCalledTimes(2); expect(bridge.mock.calls[1][0]).toBe('explainFiles.open'); await act(async () => pendingOpen.resolve(null));
  const pendingSave = deferred<{ name: string } | null>(); bridge.mockReturnValueOnce(pendingSave.promise); const currentSave = props(button(text.saveAs)).onClick; await act(async () => { currentSave(); choose(); }); expect(bridge).toHaveBeenCalledTimes(3); expect(bridge.mock.calls[2][0]).toBe('explainFiles.save'); await act(async () => pendingSave.resolve(null));
});

it('正式 App 无连接入口可用且遵守现有模态门和导航失效规则', async () => {
  const invalidate = vi.fn(), Entry = appEntry(invalidate); await mount(<Entry/>); expect(button(uiCommandLabels['explain-snapshot']).disabled).toBe(false);
  const clickEntry = props(button(uiCommandLabels['explain-snapshot'])).onClick, other = document.createElement('div'); other.setAttribute('role', 'dialog'); document.body.appendChild(other); await act(async () => clickEntry()); expect(invalidate).not.toHaveBeenCalled(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); document.body.removeChild(other);
  await click(uiCommandLabels['explain-snapshot']); expect(invalidate).toHaveBeenCalledTimes(1); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(bridge).not.toHaveBeenCalled(); await click(text.close); expect(invalidate).toHaveBeenCalledTimes(2); expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('恰为1MiB的合法原始文件在本版本新增解析诊断后仍能精确另存', async () => {
  const snapshot = captureExplainSnapshot(fixture()); snapshot.raw = '{' + ' '.repeat(16000); snapshot.result.rows[0].EXPLAIN = snapshot.raw;
  snapshot.warnings = [...Array.from({ length: 63 }, () => 'w'.repeat(16000)), ''];
  const remaining = explainSnapshotLimits.bytes - Buffer.byteLength(JSON.stringify(snapshot) + '\n', 'utf8'); expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThan(16000); snapshot.warnings[63] = 'x'.repeat(remaining);
  expect(Buffer.byteLength(encodeExplainSnapshot(snapshot), 'utf8')).toBe(explainSnapshotLimits.bytes);
  await mount(<Dialog onClose={vi.fn()}/>); bridge.mockResolvedValueOnce({ name: '边界计划', snapshot }); await click(text.choose);
  // 原始JSON故意缺少闭合括号；本版本诊断必须显示，但不能在另存时追加到原文件预算。
  const diagnostic = parseExplainPlan(snapshot.raw, 'mysql', '8.4.11').warnings[0]; expect(diagnostic).toBeTruthy(); expect(snapshot.warnings).not.toContain(diagnostic); expect(document.body.textContent).toContain(diagnostic);
  bridge.mockResolvedValueOnce({ name: '边界副本' }); await click(text.saveAs); expect(bridge).toHaveBeenCalledTimes(2); expect(bridge.mock.calls[1]).toEqual(['explainFiles.save', { snapshot }]); expect(document.querySelector('[role="alert"]')).toBeNull(); expect(document.body.textContent).toContain(text.saved('边界副本'));
});
