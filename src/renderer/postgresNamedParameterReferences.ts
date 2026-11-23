import type { LocalReferenceRange, LocalReferences } from '../shared/localReferences';
import type { LocalRename } from '../shared/localRename';
import { navicatParameterNameAt } from '../shared/navicatParameter';
import { postgresCompletionLimits as limits } from '../shared/postgresCompletion';
import { PostgresStatementLimit, splitPostgresParameterSql } from '../shared/postgresSql';

type NamedOccurrence = LocalReferenceRange & { name: string };
type Blocked = Extract<LocalReferences, { status: 'blocked' }>;

function occurrences(source: string, standardStrings: boolean): NamedOccurrence[] {
  return splitPostgresParameterSql(source, standardStrings).flatMap(statement =>
    (statement.namedParameters ?? []).map(({ name, start, end }) => ({
      name, start: statement.start + start, end: statement.start + end,
    })));
}

/** 先在光标附近找模板，再用执行词法确认整份草稿中的绑定，跳过字符串和注释中的同形文本。 */
function analyze(source: string, offset: number, standardStrings?: boolean): {
  target: LocalReferenceRange; name: string; group: LocalReferenceRange[]; names: Set<string>;
} | Blocked | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return;
  const windowStart = Math.max(0, offset - 67);
  const start = source.slice(windowStart, offset + 2).lastIndexOf('[$');
  if (start < 0) return;
  const opening = windowStart + start;
  const name = navicatParameterNameAt(source, opening);
  if (!name || opening > offset || offset > opening + name.length + 3) return;
  if (source.length > limits.source) return { status: 'blocked', reason: 'budget' };

  try {
    const tokens = occurrences(source, standardStrings ?? true);
    const target = tokens.find(token => token.start === opening);
    if (standardStrings === undefined && source.includes('\\')) {
      const alternate = occurrences(source, false);
      if (!target && !alternate.some(token => token.start === opening)) return;
      // 离线时全稿的名字和范围都须一致，避免少改一处或与已有参数合并。
      if (tokens.length !== alternate.length || tokens.some((token, index) =>
        token.start !== alternate[index].start || token.end !== alternate[index].end)) return { status: 'blocked', reason: 'syntax' };
    }
    if (!target) return;
    const group = tokens.filter(token => token.name === name).map(({ start, end }) => ({ start, end }));
    if (group.length > limits.items) return { status: 'blocked', reason: 'budget' };
    return { target: { start: target.start, end: target.end }, name, group, names: new Set(tokens.map(token => token.name)) };
  } catch (error) {
    return { status: 'blocked', reason: error instanceof PostgresStatementLimit ? 'budget' : 'syntax' };
  }
}

/** 命名参数没有单独声明，参与引用列表和高亮的都是正文占位符。 */
export function postgresNamedParameterReferences(source: string, offset: number, standardStrings?: boolean): LocalReferences | undefined {
  const binding = analyze(source, offset, standardStrings);
  if (!binding || 'status' in binding) return binding;
  return { status: 'ready', target: binding.target, declaration: null, references: binding.group };
}

/** 只替换参数名对应的模板，保留包裹符号并拒绝合并原本独立的输入。 */
export function postgresNamedParameterRename(source: string, offset: number, standardStrings?: boolean, newName?: string): LocalRename | undefined {
  const binding = analyze(source, offset, standardStrings);
  if (!binding || 'status' in binding) return binding;
  const { target, name, group, names } = binding;
  const result: LocalRename = { status: 'ready', target, name, kind: 'parameter', edits: [] };
  if (newName === undefined || newName === name) return result;
  const text = '[$' + newName + ']';
  if (navicatParameterNameAt(text, 0) !== newName) return { status: 'blocked', reason: 'parameter-name' };
  if (names.has(newName)) return { status: 'blocked', reason: 'parameter-collision' };
  result.edits = group.map(range => ({ ...range, text }));
  return result;
}
