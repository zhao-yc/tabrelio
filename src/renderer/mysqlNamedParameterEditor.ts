import { namedParameterTokens, nextStaticParameterMode, parameterScriptBrackets, type NamedParameterToken, type SqlLexicalMode } from '../shared/queryParameters';
import { SqlScriptScanner } from '../shared/sqlScriptScanner';
import { completionLimits as limits, type CompletionSessionState } from '../shared/sqlCompletion';

type Occurrence = NamedParameterToken & { statementStart: number };
type Dialect = 'mysql' | 'mariadb';

export function mysqlParameterEditorMode(dialect: Dialect, state?: CompletionSessionState): SqlLexicalMode {
  return {
    ansiQuotes: state?.ansiQuotes === true, ansiQuotesKnown: state?.ansiQuotes !== undefined,
    noBackslashEscapes: state?.noBackslashEscapes === true, noBackslashEscapesKnown: state?.noBackslashEscapes !== undefined,
    ...(dialect === 'mariadb' ? { bracketQuotes: state?.bracketQuotes ?? 'unknown' } : {}),
  };
}

/** 用执行扫描器保留原文偏移；跨过可能改变模式的语句后只接受各模式一致的解释。 */
function occurrences(source: string, mode: SqlLexicalMode): Occurrence[] | undefined {
  if (source.length > limits.sourceUnits) return;
  const scanner = new SqlScriptScanner(), result: Occurrence[] = [];
  const unknown = mysqlParameterEditorMode(mode.bracketQuotes === undefined ? 'mysql' : 'mariadb');
  try {
    for (let index = 0; index <= 1000; index++) {
      scanner.setMode(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown, mode.noBackslashEscapesKnown, parameterScriptBrackets(mode));
      const [statement] = scanner.pushRanges(index === 0 ? source : '', true, 1);
      if (!statement) return result;
      for (const token of namedParameterTokens(statement.sql, mode)) {
        if (result.length >= limits.tokens) return;
        result.push({ name: token.name, start: statement.start + token.start, end: statement.start + token.end, statementStart: statement.start });
      }
      if (nextStaticParameterMode(statement.sql, mode) !== mode) mode = unknown;
    }
  } catch {
    // 模式存在歧义或草稿尚未闭合时，不能发布猜测的范围或计数。
  }
}

/** 先限制光标附近的候选范围，普通 SQL 完成与悬停不触发整稿扫描。 */
export function mysqlParameterTarget(source: string, offset: number) {
  if (offset < 0 || offset > source.length || source.length > limits.sourceUnits) return;
  const before = source.slice(Math.max(0, offset - 67), offset);
  const opening = /(\[\$|:)[A-Za-z0-9_]{0,64}\]?$/.exec(before);
  if (!opening || opening[1] === ':' && opening[0].endsWith(']')) return;
  const start = offset - opening[0].length, marker = opening[1];
  if (marker === ':' && (source[start - 1] === ':' || source[start + 1] === '=')) return;
  const nameStart = start + marker.length;
  const name = /^[A-Za-z_][A-Za-z_0-9]{0,63}/.exec(source.slice(nameStart, nameStart + 64))?.[0] ?? '';
  const nameEnd = nameStart + name.length;
  if (/[A-Za-z0-9_$\u0080-\uFFFF]/.test(source[nameEnd] ?? '')) return;
  const closed = marker === ':' ? name.length > 0 : source[nameEnd] === ']';
  const end = nameEnd + (marker === '[$' && closed ? 1 : 0);
  if (offset > end) return;
  return { start, end, marker, name, closed, prefix: source.slice(nameStart, Math.min(offset, nameEnd)) };
}

type Target = NonNullable<ReturnType<typeof mysqlParameterTarget>>;

/** 只在扫描副本补齐占位符，建议保留正在输入的冒号或方括号写法。 */
export function mysqlNamedParameterCompletion(source: string, target: Target, mode: SqlLexicalMode) {
  const sample = target.marker === ':' ? ':_' : '[$_]';
  const complete = target.closed && !!target.name;
  const candidate = complete ? source : source.slice(0, target.start) + sample + source.slice(target.end);
  const tokens = occurrences(candidate, mode);
  const binding = tokens?.find(token => token.start === target.start && token.end === (complete ? target.end : target.start + sample.length));
  if (!binding || !tokens) return [];
  const names = new Map<string, boolean>();
  for (const token of tokens) {
    if (token === binding || !token.name.startsWith(target.prefix)) continue;
    names.set(token.name, token.statementStart === binding.statementStart || names.get(token.name) === true);
  }
  return [...names].map(([name, local]) => ({ label: target.marker === ':' ? ':' + name : '[$' + name + ']', local }))
    .sort((left, right) => Number(right.local) - Number(left.local)).slice(0, limits.suggestions);
}

/** 悬停统计绑定位置，不访问连接目录或参数值。 */
export function mysqlNamedParameterHover(source: string, target: Target, mode: SqlLexicalMode) {
  if (!target.closed || !target.name) return;
  const tokens = occurrences(source, mode);
  const binding = tokens?.find(token => token.start === target.start && token.end === target.end);
  if (!binding || !tokens) return;
  const matches = tokens.filter(token => token.name === binding.name);
  return { statementCount: matches.filter(token => token.statementStart === binding.statementStart).length, draftCount: matches.length };
}
