import { hasSqlDetails, parseSync, scanSync } from 'libpg-query';
import { navicatParameterNameAt } from './navicatParameter';
import { sqlSyntaxBoundary, sqlSyntaxCheckLimits as limits, type SqlSyntaxCheckResult, type SqlSyntaxIssue } from './sqlSyntaxCheck';

type ScanToken = ReturnType<typeof scanSync>['tokens'][number];

/** 原生解析位置按 Unicode 码点计算，扫描范围按 UTF-8 字节计算，编辑器使用 UTF-16。 */
function sourceOffsets(source: string) {
  const points = [0], bytes = new Map([[0, 0]]);
  let offset = 0, byte = 0;
  for (const character of source) {
    const value = character.codePointAt(0)!;
    offset += character.length;
    byte += value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4;
    points.push(offset);
    bytes.set(byte, offset);
  }
  return { points, bytes };
}

/** 将真实命名模板替换为位置参数，占用完全相同的码点与字节，诊断无需猜测原位置。 */
function parameterSql(source: string, tokens: ScanToken[], bytes: ReadonlyMap<number, number>) {
  const parameters: { start: number; end: number }[] = [];
  if (!source.includes('[$')) return { sql: source, parameters };
  const pieces: string[] = [];
  let previous = 0;
  for (const token of tokens) {
    if (token.text !== '[') continue;
    const start = bytes.get(token.start);
    if (start === undefined) continue;
    const name = navicatParameterNameAt(source, start);
    if (!name) continue;
    const end = start + name.length + 3;
    pieces.push(source.slice(previous, start), ' $1'.padEnd(end - start));
    parameters.push({ start, end });
    previous = end;
  }
  return { sql: pieces.join('') + source.slice(previous), parameters };
}

/** 使用 PostgreSQL 18 原始语法树检查整稿，保留 BEGIN ATOMIC 等由语法决定的语句边界。 */
export function checkPostgresSyntax(source: string, standardStrings?: boolean): SqlSyntaxCheckResult {
  if (typeof source !== 'string' || /[\u0000\uD800-\uDFFF]/u.test(source)) return { status: 'blocked', reason: 'input' };
  if (source.length > limits.sourceUnits) return { status: 'blocked', reason: 'budget' };
  if (!source.length) return { status: 'ready', statementCount: 0, issues: [] };
  if (standardStrings !== undefined && typeof standardStrings !== 'boolean') return { status: 'blocked', reason: 'mode' };
  const { points, bytes } = sourceOffsets(source);
  let tokens: ScanToken[] = [];
  try {
    tokens = scanSync(source).tokens;
  } catch {
    // 词法报错时由原生解析器给出准确位置，未知字符串模式下不能采用单一词法猜测。
    if (standardStrings !== true && source.includes('\\')) return { status: 'blocked', reason: 'mode' };
  }
  if (tokens.length > limits.tokens) return { status: 'blocked', reason: 'budget' };
  if (tokens.some(token => token.text === '\\')) return { status: 'blocked', reason: 'client-command' };
  const requiresStandardStrings = tokens.some(token => /^U&'/i.test(token.text) || token.text.startsWith("'") && token.text.includes('\\'));
  if (requiresStandardStrings && standardStrings !== true) return { status: 'blocked', reason: 'mode' };
  let depth = 0;
  for (const token of tokens) {
    if (token.text === '(' || token.text === '[') depth++;
    if (token.text === ')' || token.text === ']') depth = Math.max(0, depth - 1);
    if (depth > limits.depth) return { status: 'blocked', reason: 'budget' };
  }
  // 未闭合字符串或其它词法错误由原生解析器检查。只替换原生扫描已确认处于 SQL 正文的模板。
  const { sql, parameters } = parameterSql(source, tokens, bytes);
  try {
    const { stmts = [] } = parseSync(sql);
    if (stmts.length > limits.statements) return { status: 'blocked', reason: 'budget' };
    if (requiresStandardStrings && stmts.some(statement => {
      const node = statement.stmt;
      const variable = node && 'VariableSetStmt' in node ? node.VariableSetStmt : undefined;
      return variable?.name === 'standard_conforming_strings' || variable?.kind === 'VAR_RESET_ALL';
    })) return { status: 'blocked', reason: 'dynamic-mode' };
    return { status: 'ready', statementCount: stmts.length, issues: [] };
  } catch (error) {
    if (!hasSqlDetails(error) || !error.sqlDetails) return { status: 'blocked', reason: 'parser' };
    const { cursorPosition, message } = error.sqlDetails;
    if (/stack depth limit|out of memory/i.test(message)) return { status: 'blocked', reason: 'budget' };
    let start = points[cursorPosition];
    if (start === undefined) return { status: 'blocked', reason: 'position' };
    const parameter = parameters.find(item => item.start <= start && item.end > start);
    if (parameter) return { status: 'ready', statementCount: 0, issues: [{ ...parameter, code: 'syntax' }] };
    if (!sqlSyntaxBoundary(source, start)) start--;
    const token = tokens.find(item => bytes.get(item.start) === start);
    let end = token ? bytes.get(token.end) ?? start : points[cursorPosition + 1] ?? start;
    if (!sqlSyntaxBoundary(source, end)) end++;
    const code: SqlSyntaxIssue['code'] = message === 'syntax error at end of input' ? 'incomplete' :
      /^unterminated \/\* comment/.test(message) ? 'unclosed-comment' :
      /^unterminated quoted identifier/.test(message) ? 'unclosed-identifier' :
      /^unterminated (?:quoted|dollar-quoted|bit|hexadecimal|Unicode) string/.test(message) ? 'unclosed-string' : 'syntax';
    if (code.startsWith('unclosed-')) end = source.length;
    // 解析失败时只报告首处已定位的问题，无法从失败的语法树得出完整语句数。
    return { status: 'ready', statementCount: 0, issues: [{ start, end, code }] };
  }
}
