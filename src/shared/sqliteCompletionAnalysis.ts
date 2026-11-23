import { z } from 'zod';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits as limits, sqliteCompletionSourceKey, sqliteCompletionSourceSchema, type SqliteCompletionSource } from './sqliteCompletion';
import type { LocalReferenceToken } from './localReferenceIndex';
import type { PhysicalObjectAnalysis } from './physicalObjectAnalysis';

export type SqliteCompletionRelation = ({ kind: 'physical'; alias?: string } & SqliteCompletionSource | { kind: 'local'; source: 'cte' | 'derived'; name: string; alias?: string; columns: string[]; declaration?: true }) & { scopeDepth?: number };
export type SqliteAnalysisIntent = 'hover' | 'definition' | 'object';
export interface SqliteLocalDefinition { start: number; end: number; }
type OutputSource = SqliteCompletionSource;
interface OutputProjection { columns: string[]; sources: OutputSource[]; incomplete?: true; }
type JoinOperand = { source: OutputSource } | { columns: string[] };
interface UsingProjection { left: { operand: JoinOperand; merged?: true | string[] }[]; right: JoinOperand; used: string[]; uniqueLeft?: true; }
export type SqliteCompletionAnalysis = { status: 'ready'; target: { start: number; end: number; prefix: string; quoted: boolean }; syntax: ('relation' | 'column' | 'keyword')[]; qualifiers: string[]; relations: SqliteCompletionRelation[]; output?: OutputProjection; using?: UsingProjection; unqualifiedColumns?: true; definition?: SqliteLocalDefinition } | { status: 'blocked'; reason: string };
type Token = { kind: 'id' | 'string' | 'number' | 'parameter' | 'symbol'; value: string; start: number; end: number; depth: number; quoted?: boolean; closed?: boolean; pair?: number };
type Cte = { name: string; columns?: string[]; start: number; end: number; declaration: SqliteLocalDefinition };
type Binding = { relation: SqliteCompletionRelation; start: number; end: number; aliasIndex?: number; referenceIndex?: number; declaration?: SqliteLocalDefinition; unknown?: boolean; level?: number };
type Ready = Extract<SqliteCompletionAnalysis, { status: 'ready' }>;
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const idStart = (character: string) => !!character && (/[A-Za-z_]/.test(character) || character.codePointAt(0)! >= 128);
const idPart = (character: string) => !!character && (/[A-Za-z0-9_$]/.test(character) || character.codePointAt(0)! >= 128);
/** 显式never函数声明让目录边界失败后的分支可靠收窄，不能继续使用未确认值。 */
function fail(reason: string): never { throw new Error(reason); }
const boundary = (source: string, offset: number) => !(offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset]));
const keyword = (token: Token | undefined, word: string) => !!token && token.kind === 'id' && !token.quoted && fold(token.value) === word;
const fromClause = (tokens: Token[], index: number) => keyword(tokens[index], 'from') &&
  !(keyword(tokens[index - 1], 'distinct') &&
    (keyword(tokens[index - 2], 'is') || keyword(tokens[index - 2], 'not') && keyword(tokens[index - 3], 'is')));
const structural = new Set('select from where group having order limit offset returning set values into update delete insert replace join on using as left right full outer inner cross natural union except intersect window indexed not by and or when then else end case'.split(' '));
const setOperators = ['union', 'intersect', 'except'];
/** 从绑定取准确目录身份，别名和 SQL 实参不会进入列元数据请求。 */
function columnSource({ name, schema, tableFunction }: Extract<SqliteCompletionRelation, { kind: 'physical' }>): SqliteCompletionSource {
  return { name, ...(schema ? { schema } : {}), ...(tableFunction ? { tableFunction } : {}) };
}
const literalNames = ['null', 'true', 'false', 'current_date', 'current_time', 'current_timestamp'];
const joinModifiers = ['natural', 'left', 'right', 'full', 'outer', 'inner', 'cross'];

function modifiersAtJoin(tokens: Token[], index: number): string[] {
  const modifiers: string[] = [];
  if (keyword(tokens[index], 'join')) for (let at = index - 1; at >= 0; at--) {
    const modifier = joinModifiers.find(word => keyword(tokens[at], word));
    if (!modifier) break;
    modifiers.push(modifier);
  }
  return modifiers;
}

/** USING 的每一项必须是一个列名。只允许光标所在项尚未填写，保留其余项用于去重。 */
function usingNames(tokens: Token[], open: number, end: number, target?: Ready['target']): string[] {
  const names = new Map<string, string>();
  let current = !target, begin = open + 1;
  for (let at = begin; at <= end; at++) {
    if (at < end && !(tokens[at].kind === 'symbol' && tokens[at].value === ',')) continue;
    const token = tokens[begin];
    if (target && (at === begin && target.start === target.end && target.start >= tokens[begin - 1].end &&
      target.end <= (tokens[at]?.start ?? Infinity) || at === begin + 1 && token.start === target.start && token.end === target.end && token.kind === 'id')) {
      current = true;
    } else {
      if (at !== begin + 1 || token.kind !== 'id' || !token.value || token.quoted && !token.closed ||
        !token.quoted && structural.has(fold(token.value))) fail('using');
      const key = fold(token.value);
      if (!names.has(key)) names.set(key, token.value);
      if (names.size > limits.entries) fail('budget');
    }
    begin = at + 1;
  }
  if (!current) fail('using');
  return [...names.values()];
}

/** SQLite词法独立实现：--无需空白、块注释不嵌套、方括号在第一个]结束，不借用MySQL模式。 */
function lex(source: string, offset: number, complete = false): Token[] {
  const tokens: Token[] = [], stack: number[] = []; let i = 0, depth = 0;
  const push = (token: Token) => { if (tokens.length >= limits.tokens) fail('budget'); tokens.push(token); };
  const inSpan = (start: number, end: number, open: boolean) => offset >= start && (offset < end || open && offset === end);
  while (i < source.length) {
    const start = i, character = source[i];
    if (/[\t\n\v\f\r ]/.test(character)) { i++; continue; }
    if (source.startsWith('--', i)) { i += 2; while (i < source.length && source[i] !== '\r' && source[i] !== '\n') i++; if (inSpan(start, i, i === source.length)) fail('comment'); continue; }
    if (source.startsWith('/*', i)) { const close = source.indexOf('*/', i + 2); i = close < 0 ? source.length : close + 2; if (inSpan(start, i, close < 0) || complete && close < 0) fail('comment'); continue; }
    if (character === "'" || character === '"' || character === '\u0060' || character === '[') {
      const closing = character === '[' ? ']' : character; let value = '', closed = false; i++;
      while (i < source.length) {
        if (source[i] === closing) { if (character !== '[' && source[i + 1] === closing) { value += closing; i += 2; continue; } i++; closed = true; break; }
        const point = source.codePointAt(i)!; value += String.fromCodePoint(point); i += point > 65535 ? 2 : 1;
      }
      const kind = character === "'" ? 'string' : 'id';
      if (kind === 'string' && inSpan(start, i, !closed)) fail('string');
      if (kind === 'id' && value.length > limits.nameUnits) fail('budget');
      push({ kind, value, start, end: i, depth, quoted: kind === 'id', closed }); continue;
    }
    if (character === ':' || character === '@' || character === '$' || character === '?') {
      i++; while (i < source.length && (idPart(String.fromCodePoint(source.codePointAt(i)!)) || character === '$' && source[i] === ':')) i += source.codePointAt(i)! > 65535 ? 2 : 1;
      if (character === '$' && source[i] === '(') { const close = source.indexOf(')', i + 1); i = close < 0 ? source.length : close + 1; }
      if (offset >= start && offset <= i) fail('parameter');
      push({ kind: 'parameter', value: source.slice(start, i), start, end: i, depth }); continue;
    }
    if (idStart(String.fromCodePoint(source.codePointAt(i)!))) {
      i += source.codePointAt(i)! > 65535 ? 2 : 1;
      while (i < source.length && idPart(String.fromCodePoint(source.codePointAt(i)!))) i += source.codePointAt(i)! > 65535 ? 2 : 1;
      const value = source.slice(start, i); if (value.length > limits.nameUnits) fail('budget'); push({ kind: 'id', value, start, end: i, depth }); continue;
    }
    if (/[0-9]/.test(character) || character === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
      i++; while (i < source.length && /[A-Za-z0-9_.]/.test(source[i])) i++;
      if (offset >= start && offset <= i) fail('number'); push({ kind: 'number', value: source.slice(start, i), start, end: i, depth }); continue;
    }
    if (character === '(') { if (++depth > limits.depth) fail('budget'); const index = tokens.length; push({ kind: 'symbol', value: character, start, end: ++i, depth: depth - 1 }); stack.push(index); continue; }
    if (character === ')') { const open = stack.pop(); if (open !== undefined) depth--; const index = tokens.length; push({ kind: 'symbol', value: character, start, end: ++i, depth, ...(open === undefined ? {} : { pair: open }) }); if (open !== undefined) tokens[open].pair = index; continue; }
    push({ kind: 'symbol', value: character, start, end: ++i, depth });
  }
  return tokens;
}

/** 目录分析仅接收完整语句正文，复用 SQLite 词法而不借用光标恢复规则。 */
export function sqliteDefinitionTokens(source: string, allowParameters = false): Token[] {
  if (source.length > limits.sourceUnits || !unicode(source)) fail('budget');
  const tokens = lex(source, -1, true);
  if (tokens.some(token => token.closed === false || !allowParameters && token.kind === 'parameter' ||
      token.kind === 'symbol' && ['(', ')'].includes(token.value) && token.pair === undefined)) fail('syntax');
  return tokens;
}

/** 全引号范围替换；prefix只解码光标之前的原文，UTF16坐标不转换成码点下标。 */
function targetAt(source: string, tokens: Token[], offset: number, intent?: SqliteAnalysisIntent): Ready['target'] {
  const token = tokens.find(item => item.kind === 'id' && item.start <= offset && offset <= item.end);
  // 悬停解析完整标识符而不是光标前缀；未闭合引用、关键字和函数名不能冒充字段。
  if (intent) {
    const index = token ? tokens.indexOf(token) : -1;
    if (!token || token.quoted && !token.closed || !token.quoted && structural.has(fold(token.value)) || intent !== 'object' && (tokens[index + 1]?.value === '(' || ['as', 'collate', 'over', 'window'].some(word => keyword(tokens[index - 1], word)))) fail('hover-target');
    return { start: token.start, end: token.end, prefix: token.value, quoted: !!token.quoted };
  }
  if (!token) return { start: offset, end: offset, prefix: '', quoted: false };
  const quote = token.quoted ? source[token.start] : '', end = token.quoted && token.closed ? Math.min(offset, token.end - 1) : offset;
  let prefix = source.slice(token.start + (token.quoted ? 1 : 0), Math.max(token.start + (token.quoted ? 1 : 0), end));
  if (quote && quote !== '[') prefix = prefix.split(quote + quote).join(quote);
  if (prefix.length > limits.prefixUnits) fail('prefix');
  return { start: token.start, end: token.end, prefix, quoted: !!token.quoted };
}

/** 只分析原statement；CREATE TRIGGER的body分号不被误当独立SQL作用域。 */
function statementAt(tokens: Token[], offset: number): { start: number; end: number } {
  let start = 0, triggerStart = -1, body = false, cases = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i === start && keyword(token, 'create')) { let next = i + 1; if (keyword(tokens[next], 'temp') || keyword(tokens[next], 'temporary')) next++; if (keyword(tokens[next], 'trigger')) triggerStart = i; }
    if (triggerStart >= 0) {
      if (keyword(token, 'case')) cases++;
      else if (keyword(token, 'end') && cases) cases--;
      else if (keyword(token, 'begin')) body = true;
      else if (body && keyword(token, 'end') && token.depth === 0) {
        const end = tokens[i + 1]?.value === ';' ? i + 2 : i + 1;
        if (offset >= tokens[triggerStart].start && offset <= (tokens[end - 1]?.end ?? token.end)) fail('trigger');
        i = end - 1; start = end; triggerStart = -1; body = false; continue;
      }
      continue;
    }
    if (token.value === ';' && token.depth === 0) { if (offset <= token.start) return { start, end: i }; start = i + 1; }
  }
  if (triggerStart >= 0 && offset >= tokens[triggerStart].start) fail('trigger');
  return { start, end: tokens.length };
}

/** 引用索引复用SQLite自己的词法、语句及trigger边界；声明位置也可选中，不借MySQL引号或名称规则。 */
export function sqliteReferenceContext(source: string, offset: number): { status: 'ready'; target: LocalReferenceToken; tokens: LocalReferenceToken[] } | { status: 'blocked'; reason: string } {
  try {
    if (typeof source !== 'string' || source.length > limits.sourceUnits) fail('budget');
    if (!unicode(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !boundary(source, offset)) fail('input');
    const tokens = lex(source, offset), statement = statementAt(tokens, offset);
    const active = tokens.slice(statement.start, statement.end).filter(token => token.kind === 'id' && (!token.quoted || token.closed));
    const target = active.find(token => token.start <= offset && offset <= token.end);
    if (!target || !target.quoted && structural.has(fold(target.value))) fail('reference-target');
    return { status: 'ready', target: { start: target.start, end: target.end, value: target.value }, tokens: active.map(token => ({ start: token.start, end: token.end, value: token.value })) };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && /^[a-z-]{1,64}$/.test(reason.message) ? reason.message : 'analysis' }; }
}

/** 对象回包校验复用方言词法并保留点号token，限定名无需字符串拆分或正则猜测。 */
export function sqlitePhysicalObjectContext(source: string, offset: number): { status: 'ready'; target: LocalReferenceToken; tokens: Token[] } | { status: 'blocked'; reason: string } {
  try {
    if (typeof source !== 'string' || source.length > limits.sourceUnits) fail('budget');
    if (!unicode(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !boundary(source, offset)) fail('input');
    const tokens = lex(source, offset, true), statement = statementAt(tokens, offset), target = targetAt(source, tokens, offset, 'object'), active = tokens.slice(statement.start, statement.end);
    const token = active.find(token => token.start === target.start && token.end === target.end);
    if (!token || active.some(token => token.closed === false || token.value === '(' && token.pair === undefined || token.value === ')' && token.pair === undefined)) fail('syntax');
    return { status: 'ready', target: { start: token.start, end: token.end, value: token.value }, tokens: active };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && /^[a-z-]{1,64}$/.test(reason.message) ? reason.message : 'analysis' }; }
}

/** CTE 和派生表需要完整的首分支投影。复合排序同时收集已知名称和待展开的星号。 */
function projectionColumns(tokens: Token[], start: number, end: number, wildcards?: (string | null)[]): string[] | undefined {
  const depth = tokens[start]?.depth ?? 0; let select = -1;
  for (let i = start; i < end; i++) {
    const token = tokens[i];
    if (token.depth !== depth) continue;
    if (setOperators.some(word => keyword(token, word))) return;
    if (keyword(token, 'select')) { select = i; break; }
  }
  if (select < 0) return; let finish = end;
  for (let i = select + 1; i < end; i++) if (tokens[i].depth === depth && (fromClause(tokens, i) ||
    ['where', 'group', 'having', 'window', 'order', 'limit', ...setOperators].some(word => keyword(tokens[i], word)))) { finish = i; break; }
  let begin = select + 1; if (keyword(tokens[begin], 'distinct') || keyword(tokens[begin], 'all')) begin++;
  const parts: Token[][] = []; for (let i = begin, last = begin; i <= finish; i++) if (i === finish || tokens[i].depth === depth && tokens[i].value === ',') { parts.push(tokens.slice(last, i)); last = i + 1; }
  const columns: string[] = [];
  for (const part of parts) {
    const last = part.at(-1);
    if (wildcards && last?.kind === 'symbol' && last.value === '*') {
      if (part.length === 1) wildcards.push(null);
      else if (part.length === 3 && part[0].kind === 'id' && part[1].kind === 'symbol' && part[1].value === '.') wildcards.push(part[0].value);
      continue;
    }
    if (!part.length || !wildcards && part.some(token => token.kind === 'symbol' && token.value === '*' && token.depth === depth)) {
      if (wildcards) continue;
      return;
    }
    let name: string | undefined, as = -1;
    for (let i = 0; i < part.length; i++) if (part[i].depth === depth && keyword(part[i], 'as')) as = i;
    if (as >= 0) { if (as > 0 && as === part.length - 2 && part[as + 1]?.kind === 'id') name = part[as + 1].value; }
    else if (part.length % 2 === 1 && part.every((token, i) => i % 2 ? token.value === '.' : token.kind === 'id') &&
      !(wildcards && part.length === 1 && literalNames.some(word => keyword(part[0], word)))) name = part.at(-1)!.value;
    else if (part.at(-1)?.kind === 'id' && part.length > 1 && (part.at(-2)?.value === ')' || ['id', 'number', 'string'].includes(part.at(-2)!.kind) && !['collate', 'escape', 'is', 'like', 'glob', 'regexp', 'match', 'over', 'filter'].some(word => keyword(part.at(-2), word))) && !structural.has(fold(part.at(-1)!.value))) name = part.at(-1)!.value;
    if (!name || !unicode(name) || columns.some(column => fold(column) === fold(name!))) {
      if (wildcards) continue;
      return;
    }
    columns.push(name); if (columns.length > limits.entries) fail('budget');
  }
  return columns.length ? columns : undefined;
}

/** 纯分析入口不读取文件、会话、IPC或数据库；预算与未知语法均以固定原因阻断。 */
export function analyzeSqliteCompletion(source: string, offset: number, intent?: SqliteAnalysisIntent, definitionKind?: (kind: 'alias' | 'cte' | 'physical') => void, physicalObject?: (value: Extract<PhysicalObjectAnalysis, { status: 'ready' }>) => void): SqliteCompletionAnalysis {
  try {
    if (typeof source !== 'string' || source.length > limits.sourceUnits) fail('budget');
    if (!unicode(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !boundary(source, offset)) fail('input');
    if (intent !== undefined && intent !== 'hover' && intent !== 'definition' && intent !== 'object') fail('input');
    const tokens = lex(source, offset, intent === 'object'), target = targetAt(source, tokens, offset, intent), statement = statementAt(tokens, offset), beforeTarget = tokens.filter(token => token.end <= target.start), qualifiers: string[] = [];
    let q = beforeTarget.length - 1;
    while (q >= 1 && beforeTarget[q].value === '.' && beforeTarget[q - 1].kind === 'id') { qualifiers.unshift(beforeTarget[q - 1].value); q -= 2; }
    if (qualifiers.length > 2) fail('qualifier');
    const active = tokens.slice(statement.start, statement.end);
    if (active.some(token => token.value === '#' || token.value === ']' || token.value === ')' && token.pair === undefined)) fail('syntax');
    if (intent === 'object' && active.some(token => token.closed === false || token.value === '(' && token.pair === undefined)) fail('syntax');
    let relationBudget = 0;
    /** 收集本层CTE头后再推导输出，前向引用与递归名先遮蔽永久对象。 */
    function withClause(start: number, end: number, inherited: Map<string, Cte>): { head: number; ctes: Map<string, Cte>; declared: Cte[] } {
      const ctes = new Map(inherited), declared: Cte[] = []; let i = start;
      if (!keyword(tokens[i], 'with')) return { head: i, ctes, declared };
      i++; if (keyword(tokens[i], 'recursive')) i++;
      while (i < end) {
        const name = tokens[i++]; if (name?.kind !== 'id' || !name.value) fail('cte');
        let columns: string[] | undefined;
        if (tokens[i]?.value === '(') {
          const close = tokens[i].pair; if (close === undefined || close >= end) fail('cte');
          columns = []; for (let at = i + 1; at < close; at++) { if ((at - i) % 2 ? tokens[at].kind !== 'id' || !tokens[at].value : tokens[at].value !== ',') fail('cte'); if ((at - i) % 2) columns.push(tokens[at].value); }
          if (!columns.length || columns.length > limits.entries || new Set(columns.map(fold)).size !== columns.length) fail('cte'); i = close + 1;
        }
        if (!keyword(tokens[i++], 'as')) fail('cte');
        if (keyword(tokens[i], 'not')) { i++; if (!keyword(tokens[i++], 'materialized')) fail('cte'); } else if (keyword(tokens[i], 'materialized')) i++;
        if (tokens[i]?.value !== '(') fail('cte'); const open = i++, close = tokens[open].pair ?? end;
        const cte: Cte = { name: name.value, columns: columns ?? projectionColumns(tokens, i, close), start: i, end: close, declaration: { start: name.start, end: name.end } };
        if (declared.some(value => fold(value.name) === fold(cte.name))) fail('cte');
        if (++relationBudget > limits.relations) fail('budget'); declared.push(cte); ctes.set(fold(cte.name), cte); i = close < end ? close + 1 : end;
        if (tokens[i]?.value !== ',') break; i++;
      }
      return { head: i, ctes, declared };
    }
    function scope(start: number, end: number, inherited: Map<string, Cte>, outer: Binding[], level: number, projectionOnly = false): { bindings: Binding[]; ctes: Map<string, Cte>; syntax: Ready['syntax']; output?: OutputProjection; using?: UsingProjection; unqualified?: true } {
      if (level > limits.depth) fail('budget');
      const parsed = withClause(start, end, inherited), ctes = parsed.ctes, head = parsed.head, base = tokens[head]?.depth ?? tokens[start]?.depth ?? 0;
      for (const cte of parsed.declared) if (offset >= (tokens[cte.start]?.start ?? source.length) && offset <= (tokens[cte.end]?.start ?? source.length)) return scope(cte.start, cte.end, ctes, [], level + 1);
      if (intent && target.start < (tokens[head]?.start ?? source.length)) fail('hover-target');
      if (head >= end) return { bindings: [], ctes, syntax: ['keyword'] };
      const command = fold(tokens[head].value);
      if (!['select', 'values', 'update', 'insert', 'replace', 'delete'].includes(command) || tokens[head].quoted) {
        if (head === start && tokens.length === 1 && tokens[0].kind === 'id') return { bindings: [], ctes, syntax: ['keyword'] };
        fail('statement');
      }
      const compounds = tokens.map((token, index) => index >= head && index < end && token.depth === base && setOperators.some(word => keyword(token, word)) ? index : -1).filter(index => index >= 0);
      if (compounds.length && (command === 'update' || command === 'delete')) fail('compound');
      if (compounds.length && (command === 'select' || command === 'values')) {
        // 同一层的兄弟分支共享 WITH 和合法外层绑定，各自独立解析 FROM，尾部排序只读投影名称。
        const starts = [head, ...compounds.map(index => index + (keyword(tokens[index], 'union') && keyword(tokens[index + 1], 'all') ? 2 : 1))];
        const lastStart = starts.at(-1)!;
        let tail = lastStart;
        while (tail < end && !(tokens[tail].depth === base && ['order', 'limit'].some(word => keyword(tokens[tail], word)))) tail++;
        if (tail < end && offset >= tokens[tail].start) {
          const by = tokens[tail + 1];
          if (intent || qualifiers.length || !keyword(tokens[lastStart], 'select') || !keyword(tokens[tail], 'order') ||
            !keyword(by, 'by') || target.start <= by.start) fail('compound');
          // 只补排序项开头的裸名称，COLLATE、方向、表达式内部及 LIMIT 属于其它语法。
          const previous = beforeTarget.at(-1);
          const limit = tokens.findIndex((token, index) => index > tail && index < end && token.depth === base && keyword(token, 'limit'));
          if (limit >= 0 && target.start >= tokens[limit].start || previous !== by &&
            !(previous?.kind === 'symbol' && previous.value === ',' && previous.depth === base)) fail('compound');
          const next = tokens.slice(tail + 2, end).find(token => token.start >= target.end && token.end > target.start);
          if (next && !(next.kind === 'symbol' && next.value === ',') &&
            !['collate', 'asc', 'desc', 'nulls', 'limit'].some(word => keyword(next, word))) fail('compound');
          const columns = new Map<string, string>(), sources = new Map<string, OutputSource>();
          let incomplete = false;
          const addColumn = (name: string) => {
            const key = fold(name);
            if (!columns.has(key)) columns.set(key, name);
            if (columns.size > limits.entries) incomplete = true;
          };
          for (const [index, branchStart] of starts.entries()) {
            if (!keyword(tokens[branchStart], 'select')) continue;
            const branchEnd = compounds[index] ?? tail, wildcards: (string | null)[] = [];
            for (const name of projectionColumns(tokens, branchStart, branchEnd, wildcards) ?? []) addColumn(name);
            if (!wildcards.length) continue;
            let bindings: Binding[];
            try { bindings = scope(branchStart, branchEnd, ctes, [], level + 1, true).bindings; }
            catch (error) {
              if (!(error instanceof Error) || !['alias', 'derived-alias', 'relation', 'relation-group', 'schema', 'table-function'].includes(error.message)) throw error;
              incomplete = true;
              continue;
            }
            for (const wildcard of new Set(wildcards.map(name => name === null ? null : fold(name)))) {
              const matches = wildcard === null ? bindings : bindings.filter(({ relation }) => fold(relation.alias ?? relation.name) === wildcard);
              if (!matches.length || wildcard !== null && matches.length !== 1) { incomplete = true; continue; }
              for (const { relation, unknown } of matches) {
                if (relation.kind === 'physical') {
                  const source = columnSource(relation), key = sqliteCompletionSourceKey(source);
                  if (!sources.has(key)) sources.set(key, source);
                } else if (unknown) incomplete = true;
                else for (const name of relation.columns) addColumn(name);
              }
            }
          }
          if (!columns.size && !sources.size && !incomplete) fail('compound');
          return { bindings: [], ctes: new Map(), syntax: ['column'], output: {
            columns: [...columns.values()].slice(0, limits.entries), sources: [...sources.values()], ...(incomplete ? { incomplete: true } : {}),
          } };
        }
        const branch = compounds.filter(index => tokens[index].end <= offset).length;
        const branchStart = starts[branch], branchEnd = compounds[branch] ?? tail;
        if (!intent && branch > 0 && (branchStart >= branchEnd || offset <= tokens[branchStart].end)) {
          return { bindings: [], ctes, syntax: ['keyword'] };
        }
        return scope(branchStart, branchEnd, ctes, outer, level + 1);
      }
      const usingAt = projectionOnly || !['select', 'update'].includes(command) ? -1 : tokens.findIndex((token, at) => {
        const open = tokens[at + 1];
        return at >= head && at < end && token.depth === base && keyword(token, 'using') && open?.kind === 'symbol' &&
          open.value === '(' && offset >= open.end && offset <= (tokens[open.pair ?? end]?.start ?? source.length);
      });
      if (usingAt >= 0 && (intent || qualifiers.length)) fail('using');
      const relationEnd = usingAt < 0 ? end : usingAt, relationOnly = projectionOnly || usingAt >= 0;
      const joins = new Map<Binding, { natural: boolean; merged?: string[] }>();
      const own: Binding[] = [], derived: { start: number; end: number }[] = []; let relationContext = false, aliasContext = false, targetBinding: Binding | undefined, argumentBinding: Binding | undefined, insertList: { start: number; end: number } | undefined;
      const relevant = (begin: number, finish: number) => offset >= (tokens[begin]?.start ?? source.length) && target.start <= (tokens[finish - 1]?.end ?? source.length);
      function relation(at: number, target = false): number {
        const begin = at; let binding: Binding;
        if (relationOnly && at >= relationEnd) fail('relation');
        if (tokens[at]?.value === '(') {
          const open = at++, close = tokens[open].pair ?? end;
          if (!keyword(tokens[at], 'select') && !keyword(tokens[at], 'with')) fail('relation-group');
          derived.push({ start: at, end: close }); const columns = projectionColumns(tokens, at, close); at = close < end ? close + 1 : end;
          if (keyword(tokens[at], 'as')) at++;
          const alias = tokens[at];
          if (alias?.kind === 'id' && alias.value && (alias.quoted || !structural.has(fold(alias.value)))) {
            binding = { relation: { kind: 'local', source: 'derived', name: alias.value, alias: alias.value, columns: columns ?? [] }, start: begin, end: at + 1, aliasIndex: at, unknown: !columns }; at++;
          } else {
            if (!relationOnly) { if (offset >= tokens[open].start && offset <= (tokens[close]?.start ?? source.length)) return at; fail('derived-alias'); }
            if (keyword(tokens[at - 1], 'as')) fail('alias');
            // 匿名派生表参与裸星号展开，不参与任何名称限定匹配。
            binding = { relation: { kind: 'local', source: 'derived', name: '', columns: columns ?? [] }, start: begin, end: at, unknown: !columns };
          }
        } else {
          const first = tokens[at]; if (!first || first.kind !== 'id') { if (!first || first.start >= offset) { relationContext = true; return at; } fail('relation'); }
          if (!first.value) { relationContext = true; return at + 1; }
          if (relationOnly && (!first.quoted && structural.has(fold(first.value)) || first.quoted && !first.closed)) fail('relation');
          let name = first.value, schema: 'main' | 'temp' | undefined; at++;
          if (tokens[at]?.value === '.') {
            const folded = fold(name); if (folded !== 'main' && folded !== 'temp') fail('schema'); schema = folded; at++;
            if (tokens[at]?.kind !== 'id' || !tokens[at].value) { relationContext = true; return at; } name = tokens[at++].value;
            if (relationOnly && (at > relationEnd || !tokens[at - 1].quoted && structural.has(fold(name)))) fail('relation');
          }
          const nameEnd = at;
          const tableFunction = !target && tokens[at]?.kind === 'symbol' && tokens[at].value === '(' && ['select', 'update'].includes(command);
          const local = schema === undefined ? ctes.get(fold(name)) : undefined; if (target && local) fail('dml-target');
          let inArgument = false;
          if (tableFunction) {
            const open = tokens[at], close = open.pair ?? relationEnd;
            inArgument = offset >= open.end && offset <= (tokens[close]?.start ?? source.length);
            if (close >= relationEnd && !inArgument || local && !inArgument) fail('table-function');
            at = close < relationEnd ? close + 1 : close;
          }
          const relation: SqliteCompletionRelation = local ? { kind: 'local', source: 'cte', name: local.name, columns: local.columns ?? [] }
            : { kind: 'physical', name, ...(schema ? { schema } : {}), ...(tableFunction ? { tableFunction: true } : {}) };
          binding = { relation, start: begin, end: at, referenceIndex: nameEnd - 1, ...(local ? { declaration: local.declaration } : {}), unknown: !!local && !local.columns };
          if (inArgument) argumentBinding = binding;
          relationContext ||= relevant(begin, nameEnd);
          if (keyword(tokens[at], 'as')) { at++; const alias = tokens[at]; if (!alias || alias.kind !== 'id' || !alias.value) { aliasContext = true; return at; } binding.relation.alias = alias.value; binding.aliasIndex = at; at++; }
          else if (tokens[at]?.kind === 'id' && (tokens[at].quoted || !structural.has(fold(tokens[at].value)))) { binding.relation.alias = tokens[at].value; binding.aliasIndex = at; at++; }
          binding.end = at;
        }
        if (binding.aliasIndex !== undefined && relevant(binding.aliasIndex, binding.aliasIndex + 1)) aliasContext = true;
        if (++relationBudget > limits.relations) fail('budget'); binding.level = level; own.push(binding); return at;
      }
      let index = head + 1;
      if (command === 'update' || command === 'insert' || command === 'replace') {
        if (keyword(tokens[index], 'or')) index += 2;
        if (keyword(tokens[index], 'into')) index++;
        index = relation(index, true); targetBinding = own[0];
        if ((command === 'insert' || command === 'replace') && tokens[index]?.value === '(') insertList = { start: index, end: tokens[index].pair ?? end };
      }
      let inFrom = false;
      for (let at = command === 'select' || command === 'delete' ? head + 1 : index; at < relationEnd; at++) {
        const token = tokens[at]; if (token.depth !== base) continue;
        const joined = keyword(token, 'join') || token.kind === 'symbol' && token.value === ',';
        if (fromClause(tokens, at) || joined && (inFrom || usingAt < 0 && keyword(token, 'join'))) {
          const before = own.length, next = relation(at + 1, command === 'delete' && !targetBinding);
          if (usingAt >= 0 && joined && own.length > before) {
            joins.set(own[before], { natural: modifiersAtJoin(tokens, at).includes('natural') });
          }
          if (command === 'delete' && !targetBinding) targetBinding = own[0];
          inFrom = true;
          if (next > at + 1) at = next - 1;
          continue;
        }
        if (usingAt >= 0 && inFrom && keyword(token, 'using') && tokens[at + 1]?.value === '(') {
          const join = joins.get(own.at(-1)!); const close = tokens[at + 1].pair;
          if (!join || close === undefined || close >= usingAt) fail('using');
          join.merged = usingNames(tokens, at + 1, close);
        }
        if (['where', 'group', 'having', 'order', 'limit', 'returning', 'set', 'values', 'window'].some(word => keyword(token, word))) inFrom = false;
      }
      if (usingAt >= 0) {
        const inputs = own.filter(binding => binding !== targetBinding), right = inputs.pop();
        const join = right && joins.get(right);
        if (!right || !join || right.end > usingAt || !inFrom || join.natural || !inputs.length || relationContext || aliasContext) fail('using');
        const tail = tokens.slice(right.end, usingAt);
        const indexed = tail.length === 3 && keyword(tail[0], 'indexed') && keyword(tail[1], 'by') && tail[2].kind === 'id';
        const noIndex = tail.length === 2 && keyword(tail[0], 'not') && keyword(tail[1], 'indexed');
        if (tail.length && !indexed && !noIndex) fail('using');
        // SQLite 对含 RIGHT/FULL JOIN 的整个 SELECT 分支启用 USING 同名列消歧。
        const uniqueLeft = tokens.some((token, at) => at >= head && at < end && token.depth === base &&
          keyword(token, 'join') && modifiersAtJoin(tokens, at).some(word => word === 'right' || word === 'full'));
        const operand = ({ relation }: Binding): JoinOperand => relation.kind === 'local' ? { columns: relation.columns }
          : { source: columnSource(relation) };
        return { bindings: [], ctes: new Map(), syntax: ['column'], using: {
          left: inputs.map(binding => {
            const prior = joins.get(binding), merged = prior?.natural ? true : prior?.merged;
            return { operand: operand(binding), ...(merged ? { merged } : {}) };
          }), right: operand(right), used: usingNames(tokens, usingAt + 1, tokens[usingAt + 1].pair ?? end, target),
          ...(uniqueLeft ? { uniqueLeft: true } : {}),
        } };
      }
      if (projectionOnly) {
        if (relationContext || aliasContext) fail('relation');
        return { bindings: own, ctes, syntax: ['column'] };
      }
      // 函数实参使用已绑定的输入和相关外层。自身返回列及此后才加入的关系留在调用外。
      const visibleOwn = argumentBinding ? own.slice(0, own.indexOf(argumentBinding)).filter(binding => binding !== targetBinding) : own;
      // 子查询只继承真正可相关的外层binding；FROM派生表与CTE体不得看到外层行别名。
      for (let at = head; at < end; at++) if (tokens[at].value === '(' && (keyword(tokens[at + 1], 'select') || keyword(tokens[at + 1], 'with'))) {
        const finish = tokens[at].pair ?? end;
        if (offset >= (tokens[at + 1]?.start ?? source.length) && offset <= (tokens[finish]?.start ?? source.length)) return scope(at + 1, finish, ctes, derived.some(item => item.start === at + 1) ? [] : [...visibleOwn, ...outer], level + 1);
        at = finish;
      }
      // SQLite允许部分子句引用输出别名；未证明其血缘时不显示同名物理列的类型。
      if (intent === 'hover' && command === 'select' && !qualifiers.length) {
        let finish = end;
        for (let i = head + 1; i < end; i++) if (tokens[i].depth === base && ['from', 'union', 'except', 'intersect'].some(word => keyword(tokens[i], word))) { finish = i; break; }
        for (let i = head + 1, begin = head + 1; i <= finish; i++) if (i === finish || tokens[i].depth === base && tokens[i].value === ',') {
          const part = tokens.slice(begin, i); begin = i + 1;
          if (keyword(part[0], 'distinct') || keyword(part[0], 'all')) part.shift();
          const last = part.at(-1), prior = part.at(-2);
          const alias = last?.kind === 'id' && (keyword(prior, 'as') || part.length > 1 && prior?.value !== '.' && (prior?.value === ')' || ['id', 'number', 'string'].includes(prior?.kind ?? '')) && !structural.has(fold(last.value)) && !['collate', 'escape', 'is', 'like', 'glob', 'regexp', 'match', 'over', 'filter'].some(word => keyword(prior, word))) ? last : undefined;
          if (alias && fold(alias.value) === fold(target.prefix)) fail('output-alias');
        }
      }
      const aliases = new Set<string>(); for (const binding of visibleOwn) { const name = fold(binding.relation.alias ?? binding.relation.name), previous = visibleOwn.find(item => item !== binding && aliases.has(name) && fold(item.relation.alias ?? item.relation.name) === name); if (previous && !((qualifiers.length === 2 || (intent === 'definition' || intent === 'object') && qualifiers.length === 1 && ['main', 'temp'].includes(fold(qualifiers[0]))) && binding.relation.kind === 'physical' && previous.relation.kind === 'physical' && !binding.relation.alias && !previous.relation.alias && !!binding.relation.schema && !!previous.relation.schema && binding.relation.schema !== previous.relation.schema)) fail('ambiguous'); aliases.add(name); }
      const bindings = [...visibleOwn, ...outer.filter(binding => !aliases.has(fold(binding.relation.alias ?? binding.relation.name)))];
      if (aliasContext && intent !== 'object') fail('alias');
      let unqualified = false;
      if (insertList && offset >= tokens[insertList.start].end && offset <= (tokens[insertList.end]?.start ?? source.length)) unqualified = true;
      const returning = tokens.findIndex((token, at) => at >= head && at < end && token.depth === base && keyword(token, 'returning'));
      if (returning >= 0 && offset >= tokens[returning].end && targetBinding) unqualified = true;
      if (command === 'update') {
        const set = tokens.findIndex((token, at) => at >= head && at < end && token.depth === base && keyword(token, 'set'));
        if (set >= 0 && offset >= tokens[set].end) {
          let last = set + 1, stop = end;
          for (let at = set + 1; at < end; at++) if (tokens[at].depth === base && ['where', 'from', 'returning', 'order', 'limit'].some(word => keyword(tokens[at], word))) { stop = at; break; }
          if (offset <= (tokens[stop]?.start ?? source.length)) {
            for (let at = set + 1; at < stop; at++) if (tokens[at].depth === base && tokens[at].value === ',' && tokens[at].end <= target.start) last = at + 1;
            const equals = tokens.findIndex((token, at) => at >= last && at < stop && token.depth === base && token.value === '=');
            if (equals < 0 || target.start <= tokens[equals].start) unqualified = true;
          }
        }
      }
      if (unqualified) { if (qualifiers.length) fail('qualified-target'); return { bindings: targetBinding ? [targetBinding] : [], ctes, syntax: ['column'], unqualified: true }; }
      if (command === 'insert' || command === 'replace') {
        const select = tokens.findIndex((token, at) => at >= index && at < end && token.depth === base && keyword(token, 'select'));
        if (select >= 0 && offset >= tokens[select].start && (returning < 0 || offset < tokens[returning].start)) return scope(select, returning < 0 ? end : returning, ctes, [], level + 1);
        const values = tokens.findIndex((token, at) => at >= index && at < end && token.depth === base && keyword(token, 'values'));
        if (values >= 0 && offset >= tokens[values].end) fail('values');
      }
      for (let at = head; at < end; at++) if (keyword(tokens[at], 'using') && tokens[at + 1]?.value === '(' && offset >= tokens[at + 1].end && offset <= (tokens[tokens[at + 1].pair ?? end]?.start ?? source.length)) fail('using');
      const priorTokens = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start);
      if (keyword(priorTokens.at(-1), 'by') && keyword(priorTokens.at(-2), 'indexed')) fail('index');
      if (!relationContext) {
        const prior = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start).at(-1);
        relationContext = !!prior && ['from', 'join', 'update', 'into'].some(word => keyword(prior, word)) || !!prior && prior.value === ',' && inFrom;
      }
      if (intent !== 'definition' && intent !== 'object' && !relationContext && bindings.some(binding => binding.unknown && (!qualifiers.length || fold(binding.relation.alias ?? binding.relation.name) === fold(qualifiers[0])))) fail('local-output');
      return { bindings, ctes, syntax: relationContext ? ['relation', 'keyword'] : ['column', 'keyword'] };
    }
    const parsed = scope(statement.start, statement.end, new Map(), [], 0);
    if (intent === 'object') {
      const index = tokens.findIndex(token => token.start === target.start && token.end === target.end);
      let matches = parsed.bindings.filter(binding => binding.referenceIndex === index || binding.aliasIndex === index);
      if (!matches.length && tokens[index + 1]?.value === '.' && parsed.syntax.includes('column') && qualifiers.length <= 1 && (tokens[index + 2]?.kind === 'id' || tokens[index + 2]?.value === '*') && !['.', '('].includes(tokens[index + 3]?.value ?? '')) {
        matches = parsed.bindings.filter(({ relation }) => fold(relation.alias ?? relation.name) === fold(target.prefix) && (!qualifiers.length || !relation.alias && relation.kind === 'physical' && relation.schema === fold(qualifiers[0])));
      }
      if (matches.length !== 1) fail('ambiguous');
      const binding = matches[0]; if (binding.relation.kind !== 'physical' || binding.relation.tableFunction || binding.referenceIndex === undefined) fail('local');
      const table = tokens[binding.referenceIndex], database = binding.relation.schema ? tokens[binding.start] : undefined;
      if (table.kind !== 'id' || !table.closed && table.quoted || database && (database.kind !== 'id' || tokens[binding.start + 1]?.value !== '.')) fail('syntax');
      physicalObject?.({ status: 'ready', target: { start: target.start, end: target.end }, object: { table: table.value, tableRange: { start: table.start, end: table.end }, ...(database ? { database: database.value, databaseRange: { start: database.start, end: database.end } } : {}) } });
    }
    let definition: SqliteLocalDefinition | undefined, kind: 'alias' | 'cte' | 'physical' = 'physical';
    if (intent === 'definition') {
      const index = tokens.findIndex(token => token.start === target.start && token.end === target.end);
      const range = (index: number | undefined) => index === undefined ? undefined : { start: tokens[index].start, end: tokens[index].end };
      if (tokens[index + 1]?.value === '.' && parsed.syntax.includes('column') && !['.', '('].includes(tokens[index + 3]?.value ?? '')) {
        // 只跳准确可见绑定；三段名称的schema段、被别名遮蔽的原表名不能伪装成声明。
        const matches = parsed.bindings.filter(({ relation }) => fold(relation.alias ?? relation.name) === fold(target.prefix) && (!qualifiers.length || qualifiers.length === 1 && relation.kind === 'physical' && !relation.alias && relation.schema === fold(qualifiers[0])));
        if (matches.length === 1) { const binding = matches[0]; definition = range(binding.aliasIndex) ?? binding.declaration ?? range(binding.referenceIndex); kind = binding.aliasIndex !== undefined ? 'alias' : binding.declaration ? 'cte' : 'physical'; }
      } else {
        const matches = parsed.bindings.filter(binding => binding.referenceIndex === index && binding.relation.kind === 'local' && binding.relation.source === 'cte');
        if (matches.length === 1) { definition = matches[0].declaration; kind = 'cte'; }
      }
      if (!definition || definition.start === target.start && definition.end === target.end) fail('definition');
      // 本地重命名只接收已确认的声明类型，不改变原声明回包形状。
      definitionKind?.(kind);
    }
    const declarations: SqliteCompletionRelation[] = [...parsed.ctes.values()].map(cte => ({ kind: 'local', source: 'cte', name: cte.name, columns: cte.columns ?? [], declaration: true }));
    const relations = [...parsed.bindings.map(binding => intent === 'hover' ? { ...binding.relation, scopeDepth: binding.level! } : binding.relation), ...declarations];
    if (relations.length > limits.relations) fail('budget');
    if (parsed.syntax.includes('relation') && qualifiers.some(name => !['main', 'temp'].includes(fold(name))) || qualifiers.length === 2 && !['main', 'temp'].includes(fold(qualifiers[0]))) fail('schema');
    return { status: 'ready', target, syntax: parsed.syntax, qualifiers, relations,
      ...(parsed.output ? { output: parsed.output } : {}),
      ...(parsed.using ? { using: parsed.using } : {}),
      ...(parsed.unqualified ? { unqualifiedColumns: true } : {}), ...(definition ? { definition } : {}) };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && /^[a-z-]{1,64}$/.test(reason.message) ? reason.message : 'analysis' }; }
}

const nameSchema = z.string().min(1).max(limits.nameUnits).refine(unicode);
const columnNames = z.array(nameSchema).max(limits.entries).refine(columns => new Set(columns.map(fold)).size === columns.length);
const outputSource = sqliteCompletionSourceSchema;
const outputSources = z.array(outputSource)
  .max(limits.relations).refine(sources => new Set(sources.map(sqliteCompletionSourceKey)).size === sources.length);
const joinOperand = z.union([z.object({ source: outputSource }).strict(), z.object({ columns: columnNames }).strict()]);
const usingProjection = z.object({ left: z.array(z.object({ operand: joinOperand, merged: z.union([z.literal(true), columnNames]).optional() }).strict())
  .min(1).max(limits.relations - 1).refine(left => left[0]?.merged === undefined), right: joinOperand,
  used: columnNames, uniqueLeft: z.literal(true).optional() }).strict();
const relationSchema = z.discriminatedUnion('kind', [
  outputSource.extend({ kind: z.literal('physical'), alias: nameSchema.optional(), scopeDepth: z.number().int().min(0).max(limits.depth).optional() }),
  z.object({ kind: z.literal('local'), source: z.enum(['cte', 'derived']), name: nameSchema, alias: nameSchema.optional(), columns: columnNames, declaration: z.literal(true).optional(), scopeDepth: z.number().int().min(0).max(limits.depth).optional() }).strict(),
]);
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), reason: z.string().regex(/^[a-z-]{1,64}$/) }).strict(),
  z.object({ status: z.literal('ready'), target: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), prefix: z.string().max(limits.nameUnits).refine(unicode), quoted: z.boolean() }).strict(), syntax: z.array(z.enum(['relation', 'column', 'keyword'])).min(1).max(3).refine(value => new Set(value).size === value.length), qualifiers: z.array(nameSchema).max(2), relations: z.array(relationSchema).max(limits.relations), output: z.object({ columns: columnNames, sources: outputSources, incomplete: z.literal(true).optional() }).strict().optional(), using: usingProjection.optional(), unqualifiedColumns: z.literal(true).optional(), definition: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional() }).strict(),
]);
/** Client只核有界回包形状与原范围，不在渲染线程重新解析整份用户SQL。 */
export function validateSqliteCompletionAnalysis(raw: unknown, source: string, offset: number, intent?: SqliteAnalysisIntent): SqliteCompletionAnalysis {
  const value = resultSchema.parse(raw) as SqliteCompletionAnalysis;
  if (new TextEncoder().encode(JSON.stringify(value)).length > limits.outputBytes) fail('budget');
  if (value.status === 'blocked') return value;
  if (value.output && !(value.output.columns.length || value.output.sources.length || value.output.incomplete) ||
    value.output && value.using) fail('response');
  if ((value.output || value.using) && (intent || value.relations.length || value.qualifiers.length || value.unqualifiedColumns ||
    value.syntax.length !== 1 || value.syntax[0] !== 'column')) fail('response');
  if (value.relations.some(relation => relation.kind === 'local' && relation.declaration && relation.source !== 'cte')) fail('response');
  if (value.relations.some(relation => intent === 'hover' ? (relation.kind !== 'local' || !relation.declaration) && relation.scopeDepth === undefined : relation.scopeDepth !== undefined)) fail('response');
  const target = value.target;
  if (target.start > offset || target.end < offset || target.end > source.length || !boundary(source, target.start) || !boundary(source, target.end) || !boundary(source, offset)) fail('response');
  const rawName = source.slice(target.start, target.end), quote = rawName[0], quoted = ['"', '\u0060', '['].includes(quote ?? '');
  if (target.quoted !== quoted || rawName.length > limits.nameUnits * 2 + 2) fail('response');
  const end = intent ? target.end : offset;
  let prefix = source.slice(target.start + (quoted ? 1 : 0), end);
  if (quoted) { const close = quote === '[' ? ']' : quote; if (intent && !rawName.endsWith(close)) fail('response'); if (rawName.endsWith(close) && end === target.end) prefix = prefix.slice(0, -1); if (quote !== '[') prefix = prefix.split(quote + quote).join(quote); }
  else if (rawName && (!idStart(String.fromCodePoint(rawName.codePointAt(0)!)) || !Array.from(rawName).every(idPart)) || !quoted && (idPart(source[target.end] ?? '') || target.start > 0 && idPart(source[target.start - 1]))) fail('response');
  if (prefix !== target.prefix || !prefix && intent || prefix.length > (intent ? limits.nameUnits : limits.prefixUnits) || value.unqualifiedColumns && (!value.syntax.includes('column') || value.qualifiers.length)) fail('response');
  if (intent !== 'definition') { if (value.definition !== undefined) fail('response'); }
  else {
    const definition = value.definition;
    if (!definition || definition.start >= definition.end || definition.end > source.length || !boundary(source, definition.start) || !boundary(source, definition.end) || definition.end - definition.start > limits.nameUnits * 2 + 2 || definition.start === target.start && definition.end === target.end) fail('response');
    const raw = source.slice(definition.start, definition.end), quote = raw[0], quoted = ['"', '\u0060', '['].includes(quote);
    let name = raw;
    if (quoted) { const close = quote === '[' ? ']' : quote; if (!raw.endsWith(close)) fail('response'); name = raw.slice(1, -1); if (quote !== '[') name = name.split(quote + quote).join(quote); }
    else if (!Array.from(raw).every(idPart) || !idStart(String.fromCodePoint(raw.codePointAt(0)!)) || idPart(source[definition.start - 1] ?? '') || idPart(source[definition.end] ?? '')) fail('response');
    if (!unicode(name) || fold(name) !== fold(target.prefix)) fail('response');
  }
  return value;
}
