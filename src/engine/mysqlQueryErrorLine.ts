import type { QueryFailureSourceRange } from '../shared/queryFailure';
import { sqlExecutableWords, type SqlLexicalMode } from '../shared/queryParameters';

function lineRange(sql: string, line: number): QueryFailureSourceRange | undefined {
  let start = 0;
  for (let current = 1; current < line; current++) {
    const newline = sql.indexOf('\n', start);
    if (newline < 0) return;
    start = newline + 1;
  }
  const newline = sql.indexOf('\n', start);
  const end = newline < 0 ? sql.length : newline - Number(sql[newline - 1] === '\r');
  if (end > start) return {start, end};
}

/** ERR 没有独立字符位置。仅在标准解析消息的原片段能核对时映射报错行，绝不返回消息中的展开值。 */
export function mysqlQueryErrorLine(error: unknown, source: string, statement: QueryFailureSourceRange | undefined,
  template: string, wire: string, mode: SqlLexicalMode, server?: {dialect?: string; version?: string}): QueryFailureSourceRange | undefined {
  if (!(error instanceof Error) || !statement) return;
  const data = (key: string): unknown => Object.getOwnPropertyDescriptor(error, key)?.value;
  if (data('errno') !== 1064 || data('sqlState') !== '42000' || data('code') !== 'ER_PARSE_ERROR' ||
      (data('fatal') !== undefined && data('fatal') !== false)) return;
  const message = data('sqlMessage');
  if (typeof message !== 'string' || message.length > 1024 || source.slice(statement.start, statement.end) !== template ||
      /\r(?!\n)/.test(template)) return;
  const match = /^You have an error in your SQL syntax; [^\r\n]{1,255}? near '([\s\S]{1,512})' at line ([1-9]\d{0,7})$/.exec(message);
  if (!match) return;
  let reported = Number(match[2]), sent = lineRange(wire, reported);
  const fragment = wire.indexOf(match[1], sent?.start ?? 0);
  if (!sent || fragment < sent.start || fragment >= sent.end) {
    // MySQL 5.7 的实测行号有时落在片段的上一行。只在相邻下一行且全句唯一时修正。
    if (server?.dialect !== 'mysql' || !/^5\.7\./.test(server.version ?? '') || fragment < 0 ||
        wire.indexOf(match[1]) !== fragment || wire.lastIndexOf(match[1]) !== fragment) return;
    sent = lineRange(wire, ++reported);
    if (!sent || fragment < sent.start || fragment >= sent.end) return;
  }
  try {
    // 动态 SQL 和例程内部的解析回执属于另一个源，片段偶然重合也不能映射。
    const command = sqlExecutableWords(template, mode)[0];
    if (!command || ['CALL', 'EXECUTE', 'PREPARE', 'SIGNAL', 'RESIGNAL'].includes(command)) return;
  } catch { return; }
  // 值绑定只替换同一行内的占位符。换算行号使用原模板，避免暴露值或按其长度定位。
  const original = wire === template ? sent : lineRange(template, reported);
  if (original) return {start: statement.start + original.start, end: statement.start + original.end};
}
