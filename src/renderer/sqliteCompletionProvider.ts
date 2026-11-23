import type { CompletionSessionState } from '../shared/sqlCompletion';
import { sqliteCompletionInputSchema, sqliteCompletionOutputSchema, sqliteCompletionLimits, foldSqliteCompletionName as fold, type SqliteCompletionInput, type SqliteCompletionLookup } from '../shared/sqliteCompletion';
import type { SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';
import { readableSqlitePragma } from '../shared/sqlitePragmaAccess';
import { sameCompletionState } from './completionContext';
import { sqliteCompletionSuggestions, type SqliteCompletionItem } from './sqliteCompletionSuggestions';
import { sqliteFieldHover } from './sqliteFieldHover';

interface Position { lineNumber: number; column: number; }
interface Disposable { dispose(): void; }
export interface SqliteCompletionModel {
  isDisposed(): boolean; getVersionId(): number; getValue(): string; getValueLength(): number;
  getOffsetAt(position: Position): number; getPositionAt(offset: number): Position;
  onDidChangeContent(listener: () => void): Disposable;
}
interface Token { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): Disposable; }
type Status = 'idle' | 'partial' | 'limited' | 'unavailable' | 'startupTimeout' | 'analysisTimeout';
interface Ports {
  connectionId: string; sessionId?: string;
  model(): SqliteCompletionModel | null; current(): boolean;
  worker: { analyze(source: string, offset: number, signal?: AbortSignal, intent?: 'hover'): Promise<SqliteCompletionAnalysis>; cancel(): Promise<void>; dispose(): Promise<void> };
  request(input: SqliteCompletionInput): Promise<unknown>; cancel(taskId: string): Promise<unknown>;
  state(sessionId: string): Promise<CompletionSessionState>; id(): string; status(status: Status): void;
}
interface Pending { sent: boolean; work: Promise<unknown>; cancel?: Promise<unknown>; }
interface Operation { intent?: 'hover'; controller: AbortController; pending: Map<string, Pending>; done: Promise<void>; finish(): void; workerStop?: Promise<void>; }
export interface SqliteCompletionSuggestion extends SqliteCompletionItem {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  filterText: string; sortText: string;
}
interface CompletionResult { suggestions: SqliteCompletionSuggestion[]; incomplete?: boolean; }
interface HoverResult { range: SqliteCompletionSuggestion['range']; contents: { value: string; isTrusted: false; supportHtml: false }[]; }
const stale = () => Object.assign(new Error('SQLite补全原来源已失效'), { name: 'AbortError' });

/** SQLite独立provider：只读目录请求与原模型／会话代次绑定，不执行建议或借用MySQL分析器。 */
export function createSqliteCompletionProvider(ports: Ports) {
  let disposed = false, active: Operation | undefined, closeWork: Promise<void> | undefined;
  /** 仅停止原操作；取消回执与原请求都等待终态，不能以ACK先到复用仍忙的原会话。 */
  function abort(operation: Operation): Promise<void> {
    operation.controller.abort();
    operation.workerStop ??= active === operation ? ports.worker.cancel().catch(() => {}) : Promise.resolve();
    for (const [id, pending] of operation.pending) if (pending.sent) pending.cancel ??= Promise.resolve().then(() => ports.cancel(id)).catch(() => {});
    return Promise.allSettled([operation.done, operation.workerStop, ...[...operation.pending.values()].flatMap(pending => pending.cancel ? [pending.cancel] : [])]).then(() => undefined);
  }
    /** 所有await之后重新核模型、版本及同一provider；新编辑、切会话和取消不交付旧结果。 */
    async function provide(model: SqliteCompletionModel, position: Position, token: Token, intent?: 'hover'): Promise<CompletionResult | HoverResult | null> {
      const empty = () => null;
      let version: number;
      try { if (disposed || !ports.current() || ports.model() !== model || model.isDisposed() || token.isCancellationRequested) return empty(); version = model.getVersionId(); } catch { return empty(); }
      // 键盘补全优先；悬停不能撤销仍在分析或读取的补全，也不另开并发会话目录。
      if (intent === 'hover' && active && active.intent !== 'hover') return empty();
      const previous = active;
      if (previous) void abort(previous);
      let finish!: () => void;
      const operation: Operation = { intent, controller: new AbortController(), pending: new Map(), done: new Promise(resolve => { finish = resolve; }), finish: () => finish() };
      active = operation;
      const current = () => { try { return !disposed && active === operation && !operation.controller.signal.aborted && ports.current() && ports.model() === model && !model.isDisposed() && model.getVersionId() === version; } catch { return false; } };
      const stop = () => { void abort(operation); };
      let cancellation: Disposable | undefined, change: Disposable | undefined;
      let stamp: string | undefined, state: CompletionSessionState | undefined;
      try {
        cancellation = token.onCancellationRequested(stop); change = model.onDidChangeContent(stop);
        if (previous) await previous.done;
        if (!current()) return empty(); if (!intent) ports.status('idle');
        if (model.getValueLength() > sqliteCompletionLimits.sourceUnits) { if (!intent) ports.status('limited'); return empty(); }
        if (ports.sessionId) {
          state = await ports.state(ports.sessionId); if (!current()) return empty();
          if (state.dialect !== 'sqlite' || state.busy || state.broken || !state.databaseKnown || state.database !== 'main' || !Number.isSafeInteger(state.objectsRevision) || state.objectsRevision! < 0) return empty();
        }
        const source = model.getValue(), offset = model.getOffsetAt(position);
        const analysis = await ports.worker.analyze(source, offset, operation.controller.signal, intent); if (!current()) return empty();
        if (analysis.status === 'blocked') { if (!intent) ports.status(analysis.reason === 'budget' ? 'limited' : analysis.reason === 'startup-timeout' ? 'startupTimeout' : analysis.reason === 'timeout' ? 'analysisTimeout' : analysis.reason === 'worker' ? 'unavailable' : 'idle'); return empty(); }
        /** 每个请求在发送前登记，取消发生在微任务投递前时不发送；不保存SQL或目录正文。 */
        const load = async (query: SqliteCompletionLookup) => {
          if (!current()) throw stale();
          const input = sqliteCompletionInputSchema.parse({ ...query, connectionId: ports.connectionId, ...(ports.sessionId ? { sessionId: ports.sessionId } : {}), taskId: ports.id() });
          if (operation.pending.has(input.taskId)) throw stale();
          const pending: Pending = { sent: false, work: Promise.resolve() }; operation.pending.set(input.taskId, pending);
          pending.work = Promise.resolve().then(() => { if (!current()) throw stale(); pending.sent = true; return ports.request(input); });
          try {
            const raw = await pending.work; if (!current()) throw stale();
            const result = sqliteCompletionOutputSchema.parse(raw);
            if (new TextEncoder().encode(JSON.stringify(result)).length > sqliteCompletionLimits.outputBytes || result.sessionRevision !== state?.objectsRevision || stamp !== undefined && result.stamp !== stamp) throw stale();
            if (query.kind === 'stamp' ? result.entries.length || result.incomplete : result.entries.some(entry => {
              if (query.kind === 'functions' || query.kind === 'collations') {
                return entry.kind !== (query.kind === 'functions' ? 'function' : 'collation') || !fold(entry.name).startsWith(fold(query.prefix)) ||
                  query.kind === 'functions' && query.deterministicOnly === true && entry.kind === 'function' && entry.signatures.some(signature => signature.type !== 'scalar');
              }
              if (query.kind === 'maintenance-objects') {
                const name = fold(entry.name);
                if (query.exact === undefined ? !name.startsWith(fold(query.prefix)) : name !== fold(query.exact)) return true;
                return entry.kind === 'maintenance-object' ? query.schema !== undefined && entry.schema !== query.schema :
                  query.operation !== 'reindex' || query.schema !== undefined || entry.kind !== 'maintenance-option' && entry.kind !== 'collation';
              }
              if (query.kind === 'pragmas') return entry.kind !== 'pragma' || !fold(entry.name).startsWith(fold(query.prefix)) ||
                !readableSqlitePragma(entry.name, query.withArgument ? '' : null);
              if (query.kind === 'pragma-functions') return entry.kind !== 'pragma-function' || !fold(entry.name).startsWith(fold(query.prefix));
              if (query.kind === 'conflict-keys') return entry.kind !== 'conflict-key' || fold(entry.table) !== fold(query.table) ||
                query.schema !== undefined && entry.schema !== query.schema;
              if (query.kind === 'pragma-objects') {
                if (entry.kind !== 'pragma-object' || query.schema !== undefined && entry.schema !== query.schema) return true;
                if (entry.object === 'index' && query.pragma !== 'index_info' && query.pragma !== 'index_xinfo' ||
                  entry.object === 'view' && !['table_info', 'table_xinfo', 'table_list'].includes(query.pragma)) return true;
                const name = fold(entry.name);
                return query.exact === undefined ? !name.startsWith(fold(query.prefix)) : name !== fold(query.exact);
              }
              if (entry.kind === 'function' || entry.kind === 'collation' || entry.kind === 'maintenance-option' || entry.kind === 'maintenance-object' ||
                entry.kind === 'pragma' || entry.kind === 'pragma-object' || entry.kind === 'pragma-function' || entry.kind === 'conflict-key') return true;
              if (query.kind === 'trigger-owner') return entry.kind !== query.triggerTarget || fold(entry.name) !== fold(query.table);
              if (query.schema !== undefined && entry.schema !== query.schema) return true;
              if (query.kind === 'drop-objects') return entry.kind !== 'drop-object' || entry.object !== query.object ||
                (query.exact !== undefined ? fold(entry.name) !== fold(query.exact) : !fold(entry.name).startsWith(fold(query.prefix)));
              if (query.kind === 'table-options') return entry.kind !== 'table-options' || fold(entry.name) !== fold(query.table);
              if (query.kind === 'relations') return query.triggerTarget ? entry.kind !== query.triggerTarget :
                entry.kind !== 'table' && (query.indexTable || query.alterTable || query.foreignKey || entry.kind !== 'view');
              return (query.kind === 'columns' ? entry.kind !== 'column' : entry.kind !== 'index') ||
                !('table' in entry) || fold(entry.table) !== fold(query.table);
            })) throw stale();
            const names = result.entries.map(entry => {
              if (query.kind === 'maintenance-objects') return (entry.kind === 'maintenance-object' ? entry.object + '\0' + entry.schema : entry.kind) + '\0' + fold(entry.name);
              if (query.kind === 'pragma-objects' && query.pragma === 'table_list' && entry.kind === 'pragma-object') return entry.schema + '\0' + fold(entry.name);
              if (query.kind === 'conflict-keys' && entry.kind === 'conflict-key') return entry.origin + '\0' + fold(entry.name);
              return fold(entry.name);
            });
            if (new Set(names).size !== names.length) throw stale();
            stamp ??= result.stamp; return result;
          } finally { if (pending.cancel) await pending.cancel; operation.pending.delete(input.taskId); }
        };
        // 目录串行读取，原物理会话不允许并发；一致stamp防止把跨DDL目录拼成一组建议。
        const result = intent ? undefined : await sqliteCompletionSuggestions(analysis, { load });
        const content = intent ? await sqliteFieldHover(analysis, { load }) : undefined;
        if (!current()) return empty();
        if (stamp !== undefined) await load({ kind: 'stamp', prefix: '' });
        if (ports.sessionId) {
          const latest = await ports.state(ports.sessionId); if (!current() || !state || !sameCompletionState(state, latest)) return empty();
        }
        if (!current()) return empty();
        const start = model.getPositionAt(analysis.target.start), end = model.getPositionAt(analysis.target.end), range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        if (intent) return content ? { range, contents: [{ value: content, isTrusted: false, supportHtml: false }] } : empty();
        ports.status(result!.incomplete ? 'partial' : 'idle');
        const typed = source.slice(analysis.target.start, offset);
        const typePrefixLength = analysis.target.prefix.replace(/[\t ]+/g, ' ').length;
        return { incomplete: result!.incomplete, suggestions: result!.items.map((item, index) => {
          // Monaco 用原编辑器前缀再次筛选。多词类型的筛选文本保留原空白，补入的名称使用标准拼写。
          const filterText = analysis.columnType ? typed + item.label.slice(typePrefixLength) :
            analysis.target.quoted ? source[analysis.target.start] + item.label : item.label;
          return { ...item, range, filterText, sortText: (item.kind === 'keyword' ? '9' : '0') + String(index).padStart(4, '0') };
        }) };
      } catch { if (current() && !intent) ports.status('unavailable'); return empty(); }
      finally { cancellation?.dispose(); change?.dispose(); if (operation.workerStop) await operation.workerStop; if (active === operation) active = undefined; operation.finish(); }
    }
  return {
    triggerCharacters: ['.', '"', '`', '[', ':'],
    /** 两种入口复用原串行占门、目录stamp与原会话状态核验；只交付对应的有界结果。 */
    async provideCompletionItems(model: SqliteCompletionModel, position: Position, _context: unknown, token: Token): Promise<CompletionResult> {
      const result = await provide(model, position, token); return result && 'suggestions' in result ? result : { suggestions: [] };
    },
    async provideHover(model: SqliteCompletionModel, position: Position, token: Token): Promise<HoverResult | null> {
      const result = await provide(model, position, token, 'hover'); return result && 'contents' in result ? result : null;
    },
    /** 退出编辑器后同时等待原目录任务和分析线程；其它provider的任务不在本对象内。 */
    dispose(): Promise<void> { if (closeWork) return closeWork; disposed = true; const operation = active; closeWork = (async () => { if (operation) await abort(operation); await ports.worker.dispose(); })(); return closeWork; },
  };
}
