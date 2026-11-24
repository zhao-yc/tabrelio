import type * as monaco from 'monaco-editor';
import type { QueryFailure } from '../shared/queryFailure';

export interface QueryFailureSourceScope {
  tabId: string; connectionId: string; connectionVersion: number; draft: string | undefined;
  present: boolean; active: boolean; busy: boolean; modal: boolean; closing: boolean;
}
interface Capture {
  editor: monaco.editor.IStandaloneCodeEditor; source: string; all: boolean;
  scope(): QueryFailureSourceScope; subscribe(changed: () => void): () => void;
  onInvalidated(): void;
}
export interface QueryFailureMark {
  failure: QueryFailure;
  range: monaco.IRange;
}

/** UTF16半开区间不能拆开CRLF或一个完整代理对。 */
function boundary(source: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return false;
  const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset);
  return !(before === 13 && after === 10 || before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

/** 源码定位只保留本次真实模型租约；不持有执行权限，也不修改SQL或撤销栈。 */
export class QueryFailureSourceLease {
  private valid = true;
  private readonly subscriptions: Array<{ dispose(): void }> = [];
  private range: { start: number; end: number } | undefined;
  private draft: string | undefined;
  private publishedFull = false;
  private clearMarks?: () => void;

  /** 唯一创建入口验证真实全文或选区，调用方不能自行传入推测的基址。 */
  static capture(capture: Capture): QueryFailureSourceLease | undefined {
    try {
      const model = capture.editor.getModel(), scope = capture.scope();
      if (!model || model.isDisposed() || !scope.present || !scope.active || scope.busy || scope.modal || scope.closing) return;
      const full = model.getValue(), version = model.getVersionId(); let base = 0;
      if (capture.source !== full) {
        if (capture.all) return;
        const selection = capture.editor.getSelection(); if (!selection) return;
        const start = model.getOffsetAt(selection.getStartPosition()), end = model.getOffsetAt(selection.getEndPosition());
        if (!boundary(full, start) || !boundary(full, end) || start >= end || full.slice(start, end) !== capture.source || model.getValueInRange(selection) !== capture.source) return;
        base = start;
      }
      return new QueryFailureSourceLease(capture, model, version, full, base, { ...scope });
    } catch { return; }
  }

  private constructor(private readonly capture: Capture, private readonly model: monaco.editor.ITextModel, private readonly version: number, private readonly full: string, private readonly base: number, private readonly origin: QueryFailureSourceScope) {
    this.draft = origin.draft; this.publishedFull = this.draft === full;
    try {
      const watch = (subscription: { dispose(): void }) => { if (this.valid) this.subscriptions.push(subscription); else subscription.dispose(); };
      watch(model.onDidChangeContent(() => this.invalidate())); watch(model.onWillDispose(() => this.invalidate())); watch(capture.editor.onDidChangeModel(() => this.invalidate())); watch(capture.editor.onDidDispose(() => this.invalidate()));
      const unsubscribe = capture.subscribe(() => { this.current(); }); watch({ dispose: unsubscribe });
      if (!this.current()) this.dispose();
    } catch { this.dispose(); }
  }

  /** 工作区可自然接收原模型正文；外来草稿先到或已发布正文退回旧值均永久失效。 */
  private current(): boolean {
    if (!this.valid) return false;
    try {
      const scope = this.capture.scope();
      if (!scope.present || scope.tabId !== this.origin.tabId || scope.connectionId !== this.origin.connectionId || scope.connectionVersion !== this.origin.connectionVersion || this.capture.editor.getModel() !== this.model || this.model.isDisposed() || this.model.getVersionId() !== this.version || this.model.getValue() !== this.full) { this.invalidate(); return false; }
      if (scope.draft !== this.draft) {
        if (!this.publishedFull && scope.draft === this.full) { this.draft = scope.draft; this.publishedFull = true; }
        else { this.invalidate(); return false; }
      }
      return true;
    } catch { this.invalidate(); return false; }
  }

  /** 单独验证引擎给出的数值范围，不读取访问器，也不按SQL文本搜索重复语句。 */
  bindRange(value: unknown): boolean {
    try {
      if (!this.current()) return false;
      this.range = this.checkedRange(value);
      return true;
    } catch { this.dispose(); return false; }
  }

  private checkedRange(value: unknown, allowCaret = false): {start: number; end: number} {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) throw Error('范围不可用');
    const descriptors = Object.getOwnPropertyDescriptors(value), start = descriptors.start, end = descriptors.end;
    if (!start || !end || !('value' in start) || !('value' in end) || typeof start.value !== 'number' || typeof end.value !== 'number') throw Error('范围不可用');
    const from = start.value, to = end.value;
    if (from > to || !allowCaret && from === to || !boundary(this.capture.source, from) || !boundary(this.capture.source, to) ||
        !boundary(this.full, this.base + from) || !boundary(this.full, this.base + to)) throw Error('范围不可用');
    return { start: this.base + from, end: this.base + to };
  }

  private active(checkModal = true): boolean {
    if (!this.current()) return false;
    try { const scope = this.capture.scope(); return scope.active && !scope.busy && (!checkModal || !scope.modal) && !scope.closing; } catch { this.invalidate(); return false; }
  }

  /** 光标和选区移动不会失效；非活动标签、模态、忙碌或关闭期间只暂时禁用。 */
  available(): boolean {
    return !!this.range && this.active();
  }

  /** 渲染使用调用方的模态状态，因为此时 DOM 仍可能保留即将关闭的窗口。 */
  availableForRender(): boolean {
    return !!this.range && this.active(false);
  }

  /** 成功结果的临时目标不覆盖首错按钮已绑定的范围。 */
  canLocateRange(value: unknown, checkModal = true): boolean {
    try { if (!this.active(checkModal)) return false; this.checkedRange(value); return true; } catch { return false; }
  }

  locateRange(value: unknown): boolean {
    try { return this.active() && this.select(this.checkedRange(value)); } catch { return false; }
  }

  /** 精确位置必须落在同一失败语句内，只允许在该语句末尾放置零宽光标。 */
  private checkedErrorRange(failure: QueryFailure): {start: number; end: number} {
    const statement = this.checkedRange(failure.sourceRange);
    const error = this.checkedRange(failure.errorRange, true);
    if (error.start < statement.start || error.end > statement.end || error.start === error.end && error.end !== statement.end)
      throw Error('错误位置不在原语句内');
    return error;
  }

  canLocateError(failure: QueryFailure, checkModal = true): boolean {
    try { if (!this.active(checkModal)) return false; this.checkedErrorRange(failure); return true; } catch { return false; }
  }

  locateError(failure: QueryFailure): boolean {
    try { return this.active() && this.select(this.checkedErrorRange(failure)); } catch { return false; }
  }

  /** 标记和定位共用原模型及选区基址。缺少精确位置时只标起始行，长语句仍可从回执整句定位。 */
  markFailures(failures: readonly QueryFailure[], publish: (model: monaco.editor.ITextModel, marks: QueryFailureMark[]) => () => void): (() => void) | undefined {
    this.clearMarks?.();
    this.clearMarks = undefined;
    if (!this.current()) return;
    const marks: QueryFailureMark[] = [];
    for (const failure of failures.slice(0, 100)) {
      try {
        const statement = this.checkedRange(failure.sourceRange);
        let precise: typeof statement | undefined;
        if (failure.errorRange) {
          try { precise = this.checkedErrorRange(failure); } catch { /* 不采信越出语句的精确位置。 */ }
        }
        const selected = precise ?? statement;
        const start = this.model.getPositionAt(selected.start), end = this.model.getPositionAt(selected.end);
        const firstLineOnly = !precise && start.lineNumber !== end.lineNumber;
        marks.push({failure, range: {startLineNumber: start.lineNumber, startColumn: start.column,
          endLineNumber: firstLineOnly ? start.lineNumber : end.lineNumber,
          endColumn: firstLineOnly ? this.model.getLineMaxColumn(start.lineNumber) : end.column}});
      } catch { /* 未确认的单条范围不妨碍其他真实失败的标记。 */ }
    }
    if (!marks.length || !this.current()) return;
    try {
      const clear = publish(this.model, marks);
      if (!this.valid) { clear(); return; }
      const release = () => {
        if (this.clearMarks !== release) return;
        this.clearMarks = undefined;
        try { clear(); } catch { /* 标记的清理不能阻止租约回收。 */ }
      };
      this.clearMarks = release;
      return release;
    } catch { return; }
  }

  /** 读取原范围不移动光标；拥有当前模态的调用方可单独核验窗口归属。 */
  readRange(value: unknown, checkModal = true): string | undefined {
    try {
      if (!this.active(checkModal)) return;
      const { start, end } = this.checkedRange(value);
      return this.full.slice(start, end);
    } catch { return; }
  }

  /** 点击只选择、滚动及聚焦原模型；每个同步端口前重核，不投递IPC或再次执行。 */
  locate(): boolean {
    return !!this.range && this.select(this.range);
  }

  private select(range: {start: number; end: number}): boolean {
    if (!this.active()) return false;
    try {
      const start = this.model.getPositionAt(range.start), end = this.model.getPositionAt(range.end), selection = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
      if (!this.active()) return false; this.capture.editor.setSelection(selection);
      if (!this.active()) return false; this.capture.editor.revealRangeInCenter(selection);
      if (!this.active()) return false; this.capture.editor.focus(); return true;
    } catch { this.invalidate(); return false; }
  }

  /** 一次失效即释放全部监听；同文Undo、同ID连接恢复或迟到回调都不能复活。 */
  private invalidate(): void { if (!this.valid) return; this.valid = false; this.clearMarks?.(); for (const subscription of this.subscriptions.splice(0)) { try { subscription.dispose(); } catch { /* 其它监听仍须精确释放。 */ } } try { this.capture.onInvalidated(); } catch { /* 定位失效通知不能影响原查询。 */ } }
  dispose(): void { this.invalidate(); }
}

/** 捕获仅由全文零偏移或当时真实选区给出基址；失败只禁用定位，不能阻止原查询。 */
export function captureQueryFailureSource(capture: Capture): QueryFailureSourceLease | undefined {
  return QueryFailureSourceLease.capture(capture);
}
