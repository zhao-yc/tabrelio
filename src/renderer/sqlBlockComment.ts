import type { editor } from 'monaco-editor';
import { sqlBlockCommentZh as text } from './locales/sqlBlockComment.zh-CN';

/** PostgreSQL 的注释正文允许成对嵌套，其它方言保守拒绝内部标记。 */
function canWrap(source: string, nested: boolean): boolean {
  if (!nested) return !source.includes('/*') && !source.includes('*/');
  let depth = 0;
  for (const marker of source.matchAll(/\/\*|\*\//g)) {
    depth += marker[0] === '/*' ? 1 : -1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** 只切换完整选中的普通块。包裹时加边界空格，避免把选区首字符变成指令标记。 */
export function toggleSqlBlockComment(source: string, dialect: 'mysql' | 'mariadb' | 'sqlite' | 'postgresql'): string {
  const start = source.search(/\S/), end = source.trimEnd().length;
  if (start < 0) throw Error(text.selection);
  const selection = source.slice(start, end), nested = dialect === 'postgresql';
  const body = selection.slice(2, -2);
  if (selection.length >= 4 && selection.startsWith('/*') && selection.endsWith('*/') && canWrap(body, nested)) {
    if ((dialect === 'mysql' || dialect === 'mariadb') && /^(?:!|M!|\+)/i.test(body)) throw Error(text.directive);
    return source.slice(0, start) + body.replace(/^ /, '').replace(/ $/, '') + source.slice(end);
  }
  if (!canWrap(source, nested)) throw Error(text.delimiters);
  return '/* ' + source + ' */';
}

/** 仅替换当前选区，按原选区方向保留新选区，和前后输入分别撤销。 */
export function editSqlBlockComment(instance: editor.IStandaloneCodeEditor, dialect: Parameters<typeof toggleSqlBlockComment>[1]): void {
  const model = instance.getModel(), selections = instance.getSelections();
  if (!model || model.isDisposed() || instance.getRawOptions().readOnly) throw Error(text.unavailable);
  if (selections?.length !== 1 || selections[0].isEmpty()) throw Error(text.selection);
  const selection = selections[0], replacement = toggleSqlBlockComment(model.getValueInRange(selection), dialect);
  instance.pushUndoStop();
  const changed = instance.executeEdits('dbark-sql-block-comment', [{ range: selection, text: replacement }], inverse => inverse.map(({ range }) =>
    selection.setStartPosition(range.startLineNumber, range.startColumn).setEndPosition(range.endLineNumber, range.endColumn)));
  instance.pushUndoStop();
  if (!changed) throw Error(text.unavailable);
  instance.focus();
}
