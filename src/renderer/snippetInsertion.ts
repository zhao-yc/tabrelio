import type * as monaco from 'monaco-editor';
import type { SqlSnippet } from '../shared/contracts';
import { builtinSnippetInsertion } from './snippetCompletion';

/** 用户片段和历史始终沿普通文本编辑，保留 $、JSON、注释和引号。 */
export function snippetEdit<T>(range: T, sql: string): { range: T; text: string; forceMoveMarkers: boolean } {
  return { range, text: sql, forceMoveMarkers: true };
}

interface EditorSnippetController extends monaco.editor.IEditorContribution {
  cancel(): void;
  insert(template: string, options: {adjustWhitespace: boolean}): void;
}

/** 只给本地内置模板启用 Monaco 的 Tab 字段；旧字段会话结束后再开启新会话。 */
export function prepareBuiltinSnippetInsert(editor: monaco.editor.IStandaloneCodeEditor, snippet: SqlSnippet): (() => void) | undefined {
  const template = builtinSnippetInsertion(snippet);
  if (!template) return;
  const controller = editor.getContribution<EditorSnippetController>('snippetController2');
  if (!controller) return;
  return () => {
    controller.cancel();
    controller.insert(template, {adjustWhitespace: false});
  };
}
