import { afterEach, expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';
import type { LocalReferences } from '../../src/shared/localReferences';
import { bindSqlReferenceHighlights } from '../../src/renderer/sqlReferenceHighlights';

const sql = 'SELECT s.id, (SELECT s.id FROM child s) FROM parent s WHERE s.id=1';
const outer = sql.indexOf('s.id') + 1, inner = sql.indexOf('s.id', outer) + 1;

/** 只替换编辑器事件及装饰端口；范围来自实际作用域分析。 */
function fixture(sourceLimit = 262_144) {
  vi.useFakeTimers();
  let offset = outer, version = 1, selected = false, live = true;
  const events = new Map<string, () => void>();
  const on = (key: string) => (listener: () => void) => { events.set(key, listener); return { dispose: () => events.delete(key) }; };
  const position = (offset: number) => ({ lineNumber: 1, column: offset + 1 });
  const model = { isDisposed: () => false, getWordAtPosition: () => ({ word: 's' }), getValueLength: () => sql.length,
    getVersionId: () => version, getOffsetAt: () => offset, getPositionAt: position, getValue: vi.fn(() => sql) };
  const decorations = { set: vi.fn<(ranges: editor.IModelDeltaDecoration[]) => string[]>(() => []), clear: vi.fn() };
  const instance = { getModel: () => model, getPosition: () => position(offset), getSelections: () => [{ isEmpty: () => !selected }],
    createDecorationsCollection: () => decorations, onDidChangeCursorSelection: on('cursor'), onDidChangeModelContent: on('edit'),
    onDidChangeModel: on('model'), onDidFocusEditorText: on('focus'), onDidBlurEditorText: on('blur'), onDidDispose: on('dispose') };
  const analyze = vi.fn(async (source: string, point: number, _signal: AbortSignal): Promise<LocalReferences> => analyzeLocalReferences(source, point));
  const controller = bindSqlReferenceHighlights(instance as unknown as Parameters<typeof bindSqlReferenceHighlights>[0], { current: () => live, sourceLimit, analyze });
  return { analyze, decorations, model, events, controller, move(point: number) { offset = point; events.get('cursor')?.(); },
    edit() { version++; events.get('edit')?.(); }, select() { selected = true; events.get('cursor')?.(); }, deactivate() { live = false; controller.invalidate(); } };
}

afterEach(() => vi.useRealTimers());

it('停稳后只高亮外层声明和两处引用，移动到同一绑定不重复分析，内层单独解析', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(279); expect(f.model.getValue).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(f.analyze).toHaveBeenCalledOnce();
  const starts = () => f.decorations.set.mock.calls.at(-1)?.[0].map(item => [item.range.startColumn - 1, item.options.inlineClassName]);
  expect(starts()).toEqual([[sql.indexOf('parent s') + 7, 'sql-local-declaration'], [outer - 1, 'sql-local-reference'], [sql.lastIndexOf('s.id'), 'sql-local-reference']]);
  f.move(sql.lastIndexOf('s.id') + 1); await vi.advanceTimersByTimeAsync(300); expect(f.analyze).toHaveBeenCalledOnce();
  f.move(inner); expect(f.decorations.clear).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(280);
  expect(starts()).toEqual([[sql.indexOf('child s') + 6, 'sql-local-declaration'], [inner - 1, 'sql-local-reference']]);
  f.controller.dispose(); expect(f.events.size).toBe(0);
});

it.each(['edit', 'blur', 'model', 'select', 'deactivate', 'dispose'] as const)('%s后撤销在途分析，迟到结果不能涂到当前编辑器', async reason => {
  const f = fixture(); let finish!: (value: LocalReferences) => void;
  f.analyze.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(280);
  if (reason === 'edit') f.edit(); else if (reason === 'select') f.select(); else if (reason === 'deactivate') f.deactivate(); else f.events.get(reason)?.();
  expect(f.analyze.mock.calls[0][2].aborted).toBe(true);
  finish(analyzeLocalReferences(sql, outer)); await vi.advanceTimersByTimeAsync(0);
  expect(f.decorations.set).not.toHaveBeenCalled(); f.controller.dispose();
});

it('超出正文预算和未解析符号不会扫描或使用同字回退', async () => {
  const large = fixture(1); await vi.advanceTimersByTimeAsync(280);
  expect(large.model.getValue).not.toHaveBeenCalled(); large.controller.dispose();
  const f = fixture(); f.analyze.mockResolvedValue({ status: 'blocked', reason: 'syntax' });
  await vi.advanceTimersByTimeAsync(280); expect(f.decorations.set).not.toHaveBeenCalled(); f.controller.dispose();
});
