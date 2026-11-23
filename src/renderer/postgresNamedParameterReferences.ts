import type { LocalReferenceRange, LocalReferences } from '../shared/localReferences';
import type { LocalRename } from '../shared/localRename';
import { navicatParameterNameAt } from '../shared/navicatParameter';
import { postgresCompletionLimits as limits } from '../shared/postgresCompletion';
import { PostgresStatementLimit, splitPostgresParameterSql } from '../shared/postgresSql';

type NamedOccurrence = LocalReferenceRange & { name: string; statementStart: number };
type Blocked = Extract<LocalReferences, { status: 'blocked' }>;

function occurrences(source: string, standardStrings: boolean): NamedOccurrence[] {
  return splitPostgresParameterSql(source, standardStrings).flatMap(statement =>
    (statement.namedParameters ?? []).map(({ name, start, end }) => ({
      name, start: statement.start + start, end: statement.start + end, statementStart: statement.start,
    })));
}

function openingAt(source: string, offset: number): number | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return;
  const windowStart = Math.max(0, offset - 67);
  const start = source.slice(windowStart, offset + 2).lastIndexOf('[$');
  if (start >= 0) return windowStart + start;
}

/** 用执行词法确认整份草稿的绑定和所属语句，排除引号与注释中的同形文本。 */
function scanAt(source: string, opening: number, standardStrings?: boolean): {
  target: NamedOccurrence; tokens: NamedOccurrence[];
} | Blocked | undefined {
  if (source.length > limits.source) return { status: 'blocked', reason: 'budget' };

  try {
    const tokens = occurrences(source, standardStrings ?? true);
    const target = tokens.find(token => token.start === opening);
    if (standardStrings === undefined && source.includes('\\')) {
      const alternate = occurrences(source, false);
      if (!target && !alternate.some(token => token.start === opening)) return;
      // 离线时全稿的名字和范围都须一致，避免少改一处或与已有参数合并。
      if (tokens.length !== alternate.length || tokens.some((token, index) =>
        token.start !== alternate[index].start || token.end !== alternate[index].end ||
        token.statementStart !== alternate[index].statementStart)) return { status: 'blocked', reason: 'syntax' };
    }
    if (target) return { target, tokens };
  } catch (error) {
    return { status: 'blocked', reason: error instanceof PostgresStatementLimit ? 'budget' : 'syntax' };
  }
}

function bindingAt(source: string, offset: number, standardStrings?: boolean) {
  const opening = openingAt(source, offset);
  if (opening === undefined) return;
  const name = navicatParameterNameAt(source, opening);
  if (!name || offset > opening + name.length + 3) return;
  return scanAt(source, opening, standardStrings);
}

const rangeOf = ({ start, end }: LocalReferenceRange): LocalReferenceRange => ({ start, end });

/** 命名参数没有单独声明，参与引用列表和高亮的都是正文占位符。 */
export function postgresNamedParameterReferences(source: string, offset: number, standardStrings?: boolean): LocalReferences | undefined {
  const binding = bindingAt(source, offset, standardStrings);
  if (!binding || 'status' in binding) return binding;
  const { target, tokens } = binding;
  const references = tokens.filter(token => token.name === target.name).map(rangeOf);
  if (references.length > limits.items) return { status: 'blocked', reason: 'budget' };
  return { status: 'ready', target: rangeOf(target), declaration: null, references };
}

/** 只替换参数名对应的模板，保留包裹符号并拒绝合并原本独立的输入。 */
export function postgresNamedParameterRename(source: string, offset: number, standardStrings?: boolean, newName?: string): LocalRename | undefined {
  const binding = bindingAt(source, offset, standardStrings);
  if (!binding || 'status' in binding) return binding;
  const { target, tokens } = binding;
  const { name } = target;
  const group = tokens.filter(token => token.name === name);
  if (group.length > limits.items) return { status: 'blocked', reason: 'budget' };
  const result: LocalRename = { status: 'ready', target: rangeOf(target), name, kind: 'parameter', edits: [] };
  if (newName === undefined || newName === name) return result;
  const text = '[$' + newName + ']';
  if (navicatParameterNameAt(text, 0) !== newName) return { status: 'blocked', reason: 'parameter-name' };
  if (tokens.some(token => token.name === newName)) return { status: 'blocked', reason: 'parameter-collision' };
  result.edits = group.map(token => ({ ...rangeOf(token), text }));
  return result;
}

/** 用完整占位符验证正在输入的模板，所有替换仅发生在扫描副本中。 */
export function postgresNamedParameterCompletion(source: string, offset: number, standardStrings?: boolean) {
  const start = openingAt(source, offset);
  if (start === undefined || offset < start + 2 || source.length > limits.source) return;
  const nameStart = start + 2;
  const spelling = /^[A-Za-z_][A-Za-z_0-9]{0,63}/.exec(source.slice(nameStart, nameStart + 64))?.[0] ?? '';
  const nameEnd = nameStart + spelling.length;
  // 保护 $1、dollar 标签和超长或非 ASCII 标识符，不把它们改成模板。
  if (offset > nameEnd || /[A-Za-z0-9_$\u0080-\uFFFF]/.test(source[nameEnd] ?? '')) return;
  const end = nameEnd + (source[nameEnd] === ']' ? 1 : 0);
  const probe = source.slice(0, start) + '[$_]' + source.slice(end);
  const binding = scanAt(probe, start, standardStrings);
  if (!binding || 'status' in binding) return null;

  const prefix = source.slice(nameStart, offset), names = new Map<string, boolean>();
  for (const token of binding.tokens) {
    if (token === binding.target || !token.name.startsWith(prefix)) continue;
    const local = token.statementStart === binding.target.statementStart;
    names.set(token.name, local || names.get(token.name) === true);
  }
  const items = [...names].map(([name, local]) => ({ name, local })).sort((left, right) => Number(right.local) - Number(left.local));
  return { start, end, items: items.slice(0, limits.items) };
}

/** 悬停只展示参数名和引用计数，不读取值或目录。 */
export function postgresNamedParameterHover(source: string, offset: number, standardStrings?: boolean) {
  const binding = bindingAt(source, offset, standardStrings);
  if (!binding || 'status' in binding) return;
  const { target, tokens } = binding;
  const matches = tokens.filter(token => token.name === target.name);
  return { ...rangeOf(target), name: target.name, draftCount: matches.length,
    statementCount: matches.filter(token => token.statementStart === target.statementStart).length };
}
