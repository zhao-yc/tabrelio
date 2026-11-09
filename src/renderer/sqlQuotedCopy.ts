export const sqlQuotedCopyAction = 'dbark-sql-copy-quoted';
// 按 UTF-16 单元限制，Java 字面量即使全为三字节字符也留在常量池预算内。
export const sqlQuotedCopyMaxUnits = 16_000;
export const sqlQuoteFormats = ['javascript', 'python', 'java'] as const;
export type SqlQuoteFormat = typeof sqlQuoteFormats[number];

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
