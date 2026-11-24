import type { editor } from 'monaco-editor';
import type { NavigableStatement } from '../shared/statementNavigation';

export const sqlQuotedCopyAction = 'dbark-sql-copy-quoted';
// 按 UTF-16 单元限制，Java 字面量即使全为三字节字符也留在常量池预算内。
export const sqlQuotedCopyMaxUnits = 16_000;
export const sqlQuoteFormats = ['javascript', 'python', 'java'] as const;
export type SqlQuoteFormat = typeof sqlQuoteFormats[number];

export interface SqlQuotedStatementSource { source: string; range: NavigableStatement; }
type StatementPreview = (statement: SqlQuotedStatementSource) => void;
const previews = new WeakMap<editor.IStandaloneCodeEditor, StatementPreview>();

/** 只把已核准的原文范围交还给同一编辑器，预览和剪贴板权限仍由编辑器持有。 */
export function bindSqlQuotedStatementPreview(instance: editor.IStandaloneCodeEditor, open: StatementPreview): () => void {
  previews.set(instance, open);
  return () => { if (previews.get(instance) === open) previews.delete(instance); };
}
export function openSqlQuotedStatement(instance: editor.IStandaloneCodeEditor, source: string, range: NavigableStatement): void {
  previews.get(instance)?.({source, range});
}

/** 保留语句正文和普通分号，排除语句之间的空白及客户端自定义分隔符。 */
export function sqlQuotedStatementText({source, range}: SqlQuotedStatementSource): string | undefined {
  const {start, end, delimiterStart, delimiterEnd} = range;
  if (![start, end, delimiterStart, delimiterEnd].every(Number.isSafeInteger) || start < 0 || start >= end ||
      end > delimiterStart || delimiterStart > delimiterEnd || delimiterEnd > source.length) return;
  // PostgreSQL 的原始语句范围可以从上一个分号后开始。跳过空白，保留随语句返回的注释。
  let first = start;
  while (first < end && /[ \t\r\n\f\v]/.test(source[first])) first++;
  if (first === end) return;
  const last = delimiterEnd === delimiterStart + 1 && source[delimiterStart] === ';' ? delimiterEnd : end;
  if (last - first > sqlQuotedCopyMaxUnits) throw new RangeError('SQL 语句超过带引号复制上限');
  return source.slice(first, last);
}

const escapes = new Map([
  ['\\', '\\\\'], ['\n', '\\n'], ['\r', '\\r'], ['\t', '\\t'], ['\b', '\\b'], ['\f', '\\f'],
]);

/** 只包裹及转义代码字符串。常用控制符使用短转义，避免 Java 在词法分析前把换行还原。 */
export function quoteSqlForCode(sql: string, format: SqlQuoteFormat): string {
  if (sql.length > sqlQuotedCopyMaxUnits) throw new RangeError('SQL 选区超过带引号复制上限');
  const quote = format === 'python' ? "'" : '"';
  const escaped = sql.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff\\'"]/gu, character => {
    if (character === quote) return '\\' + character;
    if (character === "'" || character === '"') return character;
    return escapes.get(character) ?? '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
  });
  return quote + escaped + quote;
}
