import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { editor as monacoEditor, MarkerSeverity, type editor } from 'monaco-editor';
import { LocalReferencesWorkerClient } from './localReferencesWorkerClient';
import PostgresSyntaxCheckWorker from './postgresSyntaxCheck.worker?worker';
import { SqlSyntaxCheckController, type SqlSyntaxCheckView } from './sqlSyntaxCheckController';
import { postgresSyntaxCheckZh as text } from './locales/sqlSyntaxCheck.zh-CN';
import { useWorkspace } from './store';
import { uid } from './lib';
import type { SqlSyntaxCheckResult } from '../shared/sqlSyntaxCheck';

interface Target {
  instance: editor.IStandaloneCodeEditor;
  model: editor.ITextModel;
  current(): boolean;
}
interface Check {
  controller: SqlSyntaxCheckController;
  target: Target;
  result?: Extract<SqlSyntaxCheckResult, { status: 'ready' }>;
}

/** 语法标记属于原模型和字符串设置。再次编辑、切换会话和关闭时立即撤销原检查。 */
export function usePostgresSyntaxCheck(capture: () => Target | undefined, standardStrings?: boolean) {
  const owner = useRef<Check | undefined>(undefined);
  const mode = useRef(standardStrings);
  const [view, setView] = useState<SqlSyntaxCheckView>();
  useLayoutEffect(() => {
    mode.current = standardStrings;
    owner.current?.controller.observe();
  });
  useEffect(() => () => { owner.current?.controller.dispose(); owner.current = undefined; }, []);

  function close() {
    const check = owner.current;
    owner.current = undefined;
    check?.controller.dispose();
    setView(undefined);
  }

  function open() {
    if (owner.current?.controller.busy) return;
    const target = capture();
    if (!target) return;
    close();
    const { instance, model } = target;
    const version = model.getVersionId(), strings = mode.current, markerOwner = 'dbark-postgres-syntax:' + uid();
    const current = () => owner.current === check && target.current() && mode.current === strings &&
      !model.isDisposed() && instance.getModel() === model && model.getVersionId() === version;
    const check: Check = { target, controller: new SqlSyntaxCheckController({
      source: model.getValue(), current, mode: { noBackslashEscapes: strings },
      create: () => new LocalReferencesWorkerClient(() => new PostgresSyntaxCheckWorker(), 'mysql', 'dbark-postgres-syntax'),
      subscribe: changed => {
        const release = useWorkspace.subscribe(changed);
        const subscriptions = [model.onDidChangeContent(changed), model.onWillDispose(changed), instance.onDidChangeModel(changed), instance.onDidDispose(changed)];
        return () => { release(); subscriptions.forEach(subscription => subscription.dispose()); };
      },
      decorate: result => {
        if (!current()) return;
        check.result = result;
        monacoEditor.setModelMarkers(model, markerOwner, result.issues.map(issue => {
          const start = model.getPositionAt(issue.start), end = model.getPositionAt(issue.end);
          return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column,
            severity: MarkerSeverity.Warning, source: text.title, message: text.issueMessages[issue.code] ?? text.issue };
        }));
      },
      clear: () => {
        check.result = undefined;
        if (!model.isDisposed()) monacoEditor.setModelMarkers(model, markerOwner, []);
      },
      changed: next => { if (owner.current === check) setView(next); },
    }) };
    owner.current = check;
    void check.controller.start();
  }

  const check = owner.current;
  const panel = check && view ? {
    view,
    position: (offset: number) => check.target.model.isDisposed() ? { lineNumber: 1, column: 1 } : check.target.model.getPositionAt(offset),
    onSelect(index: number) {
      const issue = check.result?.issues[index];
      if (!issue || !check.controller.current()) return;
      const { model, instance } = check.target;
      const start = model.getPositionAt(issue.start), end = model.getPositionAt(issue.end);
      const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
      instance.setSelection(range);
      instance.revealRangeInCenter(range);
      instance.focus();
    },
    onCancel: () => check.controller.stop(),
    onClose: () => { if (owner.current === check) close(); },
    onRecheck: open,
  } : undefined;
  return { open, panel, busy: view?.busy === true };
}
