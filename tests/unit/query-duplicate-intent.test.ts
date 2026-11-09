import { describe, expect, it, vi } from 'vitest';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { editorContentBridge, flushEditorContent } from '../../src/renderer/editorContentBridge';
import { QueryDuplicateIntent, type QueryDuplicateScope } from '../../src/renderer/queryDuplicateIntent';
import { analyzeStatementNavigation } from '../../src/shared/statementNavigation';
import { SqlScriptScanner } from '../../src/shared/sqlScriptScanner';

/** 真实正文桥与复制控制器，Monaco只用RAM公开端口；无store、IPC或系统剪贴板。 */
function fixture() {
  const model = new ContentModelPort('SELECT 原文;'), editor = new ContentEditorPort(model), connection: any = { id: 'c' }, listeners = new Set<() => void>();
  let scope: QueryDuplicateScope = { tab: { id: 'q', kind: 'query', title: '已保存查询', connectionId: 'c', sql: model.value, databaseContext: { state: 'known', database: null }, sourceBinding: { id: 'saved', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } }, connection, connectionVersion: 1, sessionId: '', present: true, active: true, blocked: false };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const bridge = editorContentBridge(editor as any, () => ({ value: 'SELECT 原文;', readOnly: false, onChange: sql => { scope = { ...scope, tab: { ...scope.tab!, sql } }; notify(); } }), () => {});
  const open = vi.fn(), ports = { editor: () => editor as any, scope: () => scope, subscribe: (changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); }; }, flush: flushEditorContent, database: async () => ({ state: 'known', database: null } as const), open };
  return { model, editor, bridge, open, ports, getScope: () => scope, change: (update: Partial<QueryDuplicateScope>) => { scope = { ...scope, ...update }; notify(); }, close: () => { bridge.dispose(); editor.dispose(); } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

/** 只模拟 Monaco 选区读口和选区事件，正文仍走原桥。 */
function selectionFixture() {
  const f = fixture(), listeners = new Set<() => void>();
  type Range = { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number; isEmpty(): boolean };
  let ranges: Range[] = [];
  Object.assign(f.editor, {
    getSelections: () => ranges,
    onDidChangeCursorSelection: (changed: () => void) => {
      listeners.add(changed);
      return { dispose: () => listeners.delete(changed) };
    },
  });
  Object.assign(f.model, {
    getValueInRange: (range: Range) => f.model.value.slice(range.startColumn - 1, range.endColumn - 1),
  });
  const select = (...columns: [number, number][]) => {
    ranges = columns.map(([startColumn, endColumn]) => ({
      startLineNumber: 1, endLineNumber: 1, startColumn, endColumn, isEmpty: () => startColumn === endColumn,
    }));
    for (const changed of listeners) changed();
  };
  return { ...f, select };
}

describe('查询复制意图与既有正文桥', () => {
  it.each([true, false])('把 MySQL 例程复制成可独立分段的草稿，原分隔符结尾存在=%s', async terminated => {
    const f = selectionFixture();
    const body = "CREATE PROCEDURE p() BEGIN SELECT ';', '__dbark_0!'; SELECT 2; END";
    const script = 'SELECT 0;\nDELIMITER $$\n' + body + (terminated ? '$$\nDELIMITER ;\nSELECT 3;' : '');
    f.editor.nativeInput(script);
    f.change({ connection: { id: 'c', dialect: 'mysql', name: '离线 MySQL', color: '', group: '',
      host: '127.0.0.1', port: 1, user: 'offline' } });
    f.select([1, 1]);
    const analysis = analyzeStatementNavigation(script, 'mysql');
    if (analysis.status !== 'ready') throw Error('例程语句定位失败');
    await new QueryDuplicateIntent(f.ports, 'statement', [analysis.statements[1]]).run();
    const draft = f.open.mock.calls[0][0];
    expect(draft.title).toBe('已保存查询（当前语句）');
    if (terminated) expect(draft.sql).toBe('DELIMITER $$\n' + body + '$$\nDELIMITER ;');
    expect(new SqlScriptScanner().push(draft.sql, true)).toEqual([body]);
    expect(f.model.value).toBe(script);
    expect(f.editor.edits).toEqual([]);
    f.close();
  });
  it('读取库上下文期间移动光标再移回，当前语句副本仍失效', async () => {
    const f = selectionFixture(), gate = deferred<{ state: 'known'; database: null }>();
    const end = f.model.value.length - 1;
    f.select([2, 2]);
    const intent = new QueryDuplicateIntent({ ...f.ports, database: () => gate.promise }, 'statement',
      [{ start: 0, end, delimiterStart: end, delimiterEnd: end + 1 }]);
    const result = intent.run();
    f.select([3, 3]);
    f.select([2, 2]);
    gate.resolve({ state: 'known', database: null });
    await expect(result).rejects.toThrow('已变化');
    expect(f.open).not.toHaveBeenCalled();
    f.close();
  });
  it('非连续语句原序合并，多个光标不影响明确目录勾选', async () => {
    const f = selectionFixture();
    const sql = "SELECT '甲;';\nSELECT '排除';\nSELECT 3;";
    f.editor.nativeInput(sql);
    f.select([2, 2], [5, 5]);
    const analysis = analyzeStatementNavigation(sql, 'sqlite');
    if (analysis.status !== 'ready') throw Error('无法创建测试目录');
    const [first, , third] = analysis.statements;
    expect(() => new QueryDuplicateIntent(f.ports, 'statements', [third, first])).toThrow('已变化');
    await new QueryDuplicateIntent(f.ports, 'statements', [first, third]).run();
    expect(f.open.mock.calls[0][0]).toMatchObject({ title: '已保存查询（勾选语句）', sql: "SELECT '甲;';\nSELECT 3;" });
    expect(f.editor.edits).toEqual([]);
    f.close();
  });
  it('保存勾选语句只读模型，等待期间原目录失效则不提交', async () => {
    const f = selectionFixture(), gate = deferred<{ state: 'known'; database: '复用库' }>();
    const end = f.model.value.length - 1, ranges = [{ start: 0, end, delimiterStart: end, delimiterEnd: end + 1 }];
    f.change({ tab: { ...f.getScope().tab!, sql: 'SELECT 原文;\r\n' } });
    const before = f.getScope().tab, flush = vi.fn(), database = vi.fn(() => gate.promise);
    const pending = new QueryDuplicateIntent({ ...f.ports, flush, database }, 'save-statements', ranges).run();
    expect(database).toHaveBeenCalledOnce();
    f.change({ blocked: true });
    f.change({ blocked: false });
    gate.resolve({ state: 'known', database: '复用库' });
    await expect(pending).rejects.toThrow('已变化');
    expect(f.open).not.toHaveBeenCalled();
    await new QueryDuplicateIntent({ ...f.ports, flush, database }, 'save-statements', ranges).run();
    expect(f.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sql: 'SELECT 原文;', database: '复用库' }));
    expect(f.getScope().tab).toBe(before);
    expect(flush).not.toHaveBeenCalled();
    f.close();
  });
  it('选区原文独立建草稿，仍刷新原全文且保留原来源和版本', async () => {
    const f = selectionFixture(), before = f.getScope().tab, version = f.model.version;
    f.select([7, 10]);
    await new QueryDuplicateIntent({ ...f.ports, database: () => ({ state: 'known', database: '当前库' }) }, 'selection').run();
    expect(f.open).toHaveBeenCalledExactlyOnceWith({ kind: 'query', title: '已保存查询（选区）', connectionId: 'c', sql: ' 原文',
      database: '当前库', databaseContext: { state: 'known', database: '当前库' } });
    expect(f.getScope().tab).toBe(before);
    expect(f.model.version).toBe(version);
    expect(f.editor.edits).toEqual([]);
    f.close();
  });
  it('空选区、纯空白和多个范围均拒绝，不能回退到全文', () => {
    const f = selectionFixture();
    for (const ranges of [[], [[1, 1]], [[7, 8]], [[1, 2], [8, 10]]] as [number, number][][]) {
      f.select(...ranges);
      expect(() => new QueryDuplicateIntent(f.ports, 'selection')).toThrow('请选择一段非空 SQL');
    }
    expect(f.open).not.toHaveBeenCalled();
    f.close();
  });
  it('等待数据库上下文时移动选区再移回，旧意图仍失效', async () => {
    const f = selectionFixture(), gate = deferred<{ state: 'known'; database: string }>();
    f.select([8, 10]);
    const intent = new QueryDuplicateIntent({ ...f.ports, database: () => gate.promise }, 'selection');
    const pending = intent.run();
    await Promise.resolve();
    f.select([1, 7]);
    f.select([8, 10]);
    gate.resolve({ state: 'known', database: '当前库' });
    await expect(pending).rejects.toThrow('已变化');
    expect(f.open).not.toHaveBeenCalled();
    f.close();
  });
  it('flush补发尚未交付的最新模型正文，只建白名单独立草稿，不编辑原模型/撤销栈/来源', async () => {
    const f = fixture(); f.model.deferred = true; f.editor.nativeInput('SELECT 用户刚输入;'); const binding = f.getScope().tab!.sourceBinding, version = f.model.version;
    const intent = new QueryDuplicateIntent(f.ports); await intent.run();
    expect(f.open).toHaveBeenCalledExactlyOnceWith({ kind: 'query', title: '已保存查询（副本）', connectionId: 'c', sql: 'SELECT 用户刚输入;', database: undefined, databaseContext: { state: 'known', database: null } });
    expect(f.getScope().tab!.sourceBinding).toBe(binding); expect(f.model.getValue()).toBe('SELECT 用户刚输入;'); expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(0); expect(f.editor.undoStops).toBe(0); expect(f.editor.edits).toEqual([]);
    f.model.flush(); expect(f.open).toHaveBeenCalledTimes(1); await expect(intent.run()).rejects.toThrow('已变化'); f.close();
  });
  it('指定目标只交付最新正文和来源标签，未知默认库或活动会话也不触发协议读取', async () => {
    const f = fixture(), chooseTarget = vi.fn(), database = vi.fn(() => ({ state: 'unknown' } as const));
    f.change({ sessionId: 'original-session', tab: { ...f.getScope().tab!, databaseContext: { state: 'unknown' } } });
    f.model.deferred = true;
    f.editor.nativeInput('SELECT 最新正文;');
    await new QueryDuplicateIntent({ ...f.ports, database, chooseTarget }, 'target').run();
    expect(chooseTarget).toHaveBeenCalledExactlyOnceWith({ sourceTabId: 'q', title: '已保存查询（副本）', sql: 'SELECT 最新正文;' });
    expect(database).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
    f.close();
  });
  it('外部新草稿尚未进模型时不允许flush把旧模型覆盖回store', async () => {
    const f = fixture(); f.change({ tab: { ...f.getScope().tab!, sql: 'SELECT 外部新草稿;' } }); const intent = new QueryDuplicateIntent(f.ports);
    await expect(intent.run()).rejects.toThrow(); expect(f.getScope().tab!.sql).toBe('SELECT 外部新草稿;'); expect(f.model.getValue()).toBe('SELECT 原文;'); expect(f.open).not.toHaveBeenCalled(); f.close();
  });
  it.each(['关闭重开', '连接删除恢复', '连接修订恢复', '换连', '编辑撤回', '换模型', '只读', '弹窗', '新作业'] as const)('flush等待期%s永久失效，不接纳迟到返回', async kind => {
    const f = fixture(), wait = deferred<string>(); const intent = new QueryDuplicateIntent({ ...f.ports, flush: () => wait.promise }); const pending = intent.run(); const initial = f.getScope();
    if (kind === '关闭重开') { f.change({ present: false, tab: undefined }); f.change(initial); }
    if (kind === '连接删除恢复') { f.change({ connection: undefined }); f.change(initial); }
    if (kind === '连接修订恢复') { f.change({ connectionVersion: 2 }); f.change(initial); }
    if (kind === '换连') f.change({ tab: { ...initial.tab!, connectionId: 'other' } });
    if (kind === '编辑撤回') { f.editor.nativeInput('SELECT 新;'); f.editor.nativeInput('SELECT 原文;'); }
    if (kind === '换模型') f.editor.setModel(new ContentModelPort('SELECT 原文;')); if (kind === '只读') f.editor.readOnly = true; if (kind === '弹窗' || kind === '新作业') f.change({ blocked: true });
    wait.resolve('SELECT 原文;'); await expect(pending).rejects.toThrow('已变化'); expect(f.open).not.toHaveBeenCalled(); f.close();
  });
  it('等待协议上下文时关闭原编辑器，不会用已flush正文复活标签', async () => {
    const f = fixture(), wait = deferred<{ state: 'known'; database: string }>(); const intent = new QueryDuplicateIntent({ ...f.ports, database: () => wait.promise }), pending = intent.run(); await Promise.resolve(); f.close(); wait.resolve({ state: 'known', database: 'live' }); await expect(pending).rejects.toThrow(); expect(f.open).not.toHaveBeenCalled();
  });
  it('旧桥dispose不能删除同editor新桥的flush；失效/只读桥不能取正文', () => {
    const f = fixture(), second = editorContentBridge(f.editor as any, () => ({ value: f.model.value, readOnly: false }), () => {}); f.bridge.dispose(); expect(flushEditorContent(f.editor as any)).toBe(f.model.value); second.dispose(); expect(() => flushEditorContent(f.editor as any)).toThrow(); f.close();
  });
});
