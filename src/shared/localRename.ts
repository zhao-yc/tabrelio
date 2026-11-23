import type { LocalReferenceToken } from './localReferenceIndex';
import type { LocalReferences } from './localReferences';
import { sqliteBindName } from './sqliteNamedBind';

const maximumRenameRanges = 256;

export type LocalRenameDialect = 'mysql' | 'sqlite';
type RenameDialect = LocalRenameDialect | 'postgresql';
type LocalDeclarationKind = 'alias' | 'cte' | 'window';
type LocalRenameKind = LocalDeclarationKind | 'parameter' | 'column';
export type LocalRename = { status: 'blocked'; reason: string } | {
  status: 'ready'; target: { start: number; end: number }; name: string; kind: LocalRenameKind;
  edits: { start: number; end: number; text: string }[];
};
export type LocalRenameContext = { status: 'blocked'; reason: string } | {
  status: 'ready'; target: LocalReferenceToken; tokens: LocalReferenceToken[];
  parameter?: { navicatNames: ReadonlySet<string> };
};

/** 名称作为一个引用标识符写入，不接受控制符、孤立代理或超出该方言的名称预算。 */
export function quoteLocalRename(name: string, dialect: RenameDialect): string | undefined {
  if (typeof name !== 'string' || !name.trim() || name.length > (dialect === 'sqlite' ? 512 : 256) || /[\x00-\x1f\x7f]/.test(name)) return;
  for (const point of name) if (point.length === 1 && /[\ud800-\udfff]/.test(point) || dialect === 'mysql' && point.length > 1) return;
  // PostgreSQL 的 63 字节限制按 UTF-8 检查，避免服务器截断后改变绑定。
  if (dialect === 'postgresql' && new TextEncoder().encode(name).length > 63) return;
  const quote = dialect === 'mysql' ? '`' : '"';
  return quote + name.replaceAll(quote, quote + quote) + quote;
}

/** PostgreSQL 的输入已经按原引号规范化，新名称写为引用标识符后保留大小写。 */
const folded = (name: string, dialect: RenameDialect) => {
  if (dialect === 'postgresql') return name;
  return dialect === 'sqlite' ? name.replace(/[A-Z]/g, letter => letter.toLowerCase()) : name.toLowerCase();
};

/** 完整同名token必须全部落到这一声明，无法证明的词整份拒绝，绝不输出部分替换。 */
export function planLocalRename(context: LocalRenameContext, references: LocalReferences, dialect: RenameDialect, classify: (reference: { start: number; end: number }) => LocalDeclarationKind | 'physical' | undefined, newName?: string): LocalRename {
  if (context.status !== 'ready') return context;
  if (references.status !== 'ready') return references;
  if (!references.declaration) return { status: 'blocked', reason: 'unresolved' };
  const { target, tokens } = context, group = [references.declaration, ...references.references].sort((a, b) => a.start - b.start);
  const same = tokens.filter(token => folded(token.value, dialect) === folded(target.value, dialect));
  if (same.length !== group.length || same.some((token, index) => token.start !== group[index].start || token.end !== group[index].end)) return { status: 'blocked', reason: 'unresolved' };
  let direct: LocalDeclarationKind | undefined;
  for (const reference of references.references) {
    const kind = classify(reference);
    if (kind === 'alias' || kind === 'cte' || kind === 'window' && dialect === 'sqlite') { direct = kind; break; }
  }
  if (!direct) return { status: 'blocked', reason: 'physical' };
  const result = { status: 'ready' as const, target: { start: target.start, end: target.end }, name: target.value, kind: direct, edits: [] as { start: number; end: number; text: string }[] };
  if (newName === undefined) return result;
  const text = quoteLocalRename(newName, dialect);
  if (!text || dialect === 'mysql' && direct === 'cte' && newName.length > 64) return { status: 'blocked', reason: 'name' };
  if (newName === target.value) return result;
  if (tokens.some(token => folded(token.value, dialect) === folded(newName, dialect) && !group.some(item => item.start === token.start))) return { status: 'blocked', reason: 'collision' };
  result.edits = group.map(range => ({ ...range, text }));
  return result;
}

/** 只替换原生占位符，大小写不同的参数独立。遇到旧模板歧义或合并绑定时整批拒绝。 */
export function planSqliteParameterRename(context: Extract<LocalRenameContext, { status: 'ready' }>, newName?: string): LocalRename {
  const { target, tokens, parameter } = context;
  if (!parameter) return { status: 'blocked', reason: 'unresolved' };
  const group = tokens.filter(token => token.value === target.value);
  if (group.length > maximumRenameRanges) return { status: 'blocked', reason: 'budget' };
  if (parameter.navicatNames.has(target.value)) return { status: 'blocked', reason: 'parameter-template' };
  const result: LocalRename = { status: 'ready', target: { start: target.start, end: target.end }, kind: 'parameter', name: target.value, edits: [] };
  if (newName === undefined) return result;
  const name = newName.startsWith(':') ? newName.slice(1) : newName;
  if (!sqliteBindName.test(name)) return { status: 'blocked', reason: 'parameter-name' };
  const text = ':' + name;
  if (text === target.value) return result;
  if (parameter.navicatNames.has(text)) return { status: 'blocked', reason: 'parameter-template' };
  if (tokens.some(token => token.value === text)) return { status: 'blocked', reason: 'parameter-collision' };
  result.edits = group.map(({ start, end }) => ({ start, end, text }));
  return result;
}

/** 工作线程只可交付经核对的原文完整范围及此次新名称。 */
export function validLocalRename(value: unknown, context: LocalRenameContext, dialect: LocalRenameDialect, newName?: string): value is LocalRename {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.status === 'blocked') return Object.keys(result).sort().join(',') === 'reason,status' && typeof result.reason === 'string' && /^[a-z-]{1,64}$/.test(result.reason);
  if (context.status !== 'ready' || Object.keys(result).sort().join(',') !== 'edits,kind,name,status,target' || result.status !== 'ready' ||
    result.name !== context.target.value || !Array.isArray(result.edits)) return false;
  const target = result.target as Record<string, unknown> | null;
  if (!target || Object.keys(target).sort().join(',') !== 'end,start' || target.start !== context.target.start || target.end !== context.target.end) return false;
  if (context.parameter) {
    if (dialect !== 'sqlite' || result.kind !== 'parameter') return false;
    const expected = planSqliteParameterRename(context, newName), edits = result.edits;
    return expected.status === 'ready' && edits.length === expected.edits.length && expected.edits.every((span, index) => {
      const item: unknown = edits[index];
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'end,start,text') return false;
      const edit = item as { start: number; end: number; text: string };
      return edit.start === span.start && edit.end === span.end && edit.text === span.text;
    });
  }
  if (result.kind !== 'alias' && result.kind !== 'cte' && !(result.kind === 'window' && dialect === 'sqlite')) return false;
  if (newName === undefined || newName === result.name) return result.edits.length === 0;
  const text = quoteLocalRename(newName, dialect), tokens = context.tokens.filter(token => folded(token.value, dialect) === folded(context.target.value, dialect));
  return !!text && tokens.length >= 2 && tokens.length <= maximumRenameRanges && result.edits.length === tokens.length && result.edits.every((item: unknown, index: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'end,start,text') return false;
    const edit = item as { start: number; end: number; text: string };
    return edit.start === tokens[index].start && edit.end === tokens[index].end && edit.text === text;
  });
}
