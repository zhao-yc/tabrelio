import { z } from 'zod';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits as limits, sqliteCompletionSourceKey, sqliteCompletionSourceSchema, type SqliteCompletionSource } from './sqliteCompletion';
import type { LocalReferenceToken } from './localReferenceIndex';
import type { PhysicalObjectAnalysis } from './physicalObjectAnalysis';

type InsertRole = 'upsert-target' | 'excluded' | 'insert-returning';
export type SqliteCompletionRelation = ({ kind: 'physical'; alias?: string; visibleColumnsOnly?: true; insertRole?: InsertRole } & SqliteCompletionSource | { kind: 'local'; source: 'cte' | 'derived' | 'group'; name: string; alias?: string; columns: string[]; declaration?: true; projection?: number }) & { scopeDepth?: number; afterOuterJoin?: true };
export type SqliteAnalysisIntent = 'hover' | 'definition' | 'object';
export interface SqliteLocalDefinition { start: number; end: number; }
type OutputSource = SqliteCompletionSource;
interface OutputProjection { columns: string[]; sources: OutputSource[]; projections?: number[]; joinStars?: SqliteJoinStars[]; incomplete?: true; }
export type SqliteJoinOperand = { source: OutputSource } | { columns: string[] } | { group: number } | { projection: number };
type JoinInput = { operand: SqliteJoinOperand; merged?: true | string[]; binding?: string };
export interface SqliteJoinGroup { inputs: JoinInput[]; uniqueLeft?: true; }
type JoinStarInput = JoinInput & { outer?: 'right' | 'full' };
export interface SqliteJoinStars {
  groups: SqliteJoinGroup[];
  all?: JoinStarInput[];
  members?: { group: number; binding: string }[];
  sole?: true;
  uniqueLeft?: true;
}
export type SqliteLocalProjection = ({ name: string } | { star: SqliteJoinStars } | { unknown: true })[];
interface UsingProjection { left: JoinInput[]; right: SqliteJoinOperand; used: string[]; uniqueLeft?: true; groups?: SqliteJoinGroup[]; starGroupSides?: 'left' | 'right' | 'both'; }
interface QualifiedJoinGroup { alias: string; groups: SqliteJoinGroup[]; }
type OutputAliasClause = 'order' | 'group' | 'having' | 'where' | 'on';
interface OutputAliasHints { clause: OutputAliasClause; names: string[]; scopeDepth: number; outputFirst?: true; sourcesIncomplete?: true; }
interface SqliteWindowName { name: string; quote?: '"' | '`' | '['; }
interface SqliteWindowNames { names: SqliteWindowName[]; inline?: true; }
export type SqliteCompletionAnalysis = { status: 'ready'; target: { start: number; end: number; prefix: string; quoted: boolean }; syntax: ('relation' | 'column' | 'keyword')[]; qualifiers: string[]; relations: SqliteCompletionRelation[]; output?: OutputProjection; outputAliases?: OutputAliasHints; windowNames?: SqliteWindowNames; using?: UsingProjection; joinGroup?: QualifiedJoinGroup; localProjections?: SqliteLocalProjection[]; unqualifiedColumns?: true; writableColumns?: true; definition?: SqliteLocalDefinition } | { status: 'blocked'; reason: string };
type Token = { kind: 'id' | 'string' | 'number' | 'parameter' | 'symbol'; value: string; start: number; end: number; depth: number; quoted?: boolean; closed?: boolean; pair?: number };
type ProjectionSource = { start: number; end: number; ctes: Map<string, Cte> };
type Cte = { name: string; columns?: string[]; start: number; end: number; declaration: SqliteLocalDefinition; projectionSource?: ProjectionSource };
type Binding = { relation: SqliteCompletionRelation; start: number; end: number; aliasIndex?: number; referenceIndex?: number; declaration?: SqliteLocalDefinition; unknown?: boolean; nestedProjection?: true; level?: number; afterOuterJoin?: true;
  group?: { root: number; groups: SqliteJoinGroup[]; members: Binding[] }; projectionSource?: ProjectionSource; };
type JoinStarScope = { inputs: JoinStarInput[]; groups: SqliteJoinGroup[]; owners: Map<Binding, number>; uniqueLeft: boolean };
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

/** UPSERT 允许 schema.目标别名。未显式指定 schema 时，目录仍按原 INSERT 的目标解析。 */
export function sqliteCompletionRelationMatches(relation: SqliteCompletionRelation, qualifiers: string[]): boolean {
  if (!qualifiers.length) return true;
  const binding = fold(relation.alias ?? relation.name);
  if (qualifiers.length === 1) return binding === fold(qualifiers[0]);
  if (qualifiers.length !== 2 || relation.kind !== 'physical' || binding !== fold(qualifiers[1])) return false;
  const schema = fold(qualifiers[0]);
  if (relation.insertRole === 'upsert-target') return relation.schema === undefined || relation.schema === schema;
  return !relation.insertRole && !relation.alias && relation.schema === schema;
}

/** 只交付可达子树，避免为同一查询块内无关的分组读取目录。 */
function compactJoinGroups(source: SqliteJoinGroup[], roots: SqliteJoinOperand[]): { groups: SqliteJoinGroup[]; operands: SqliteJoinOperand[] } {
  const groups: SqliteJoinGroup[] = [];
  function visit(operand: SqliteJoinOperand): SqliteJoinOperand {
    if (!('group' in operand)) return operand;
    const node = source[operand.group];
    const inputs = node.inputs.map(input => ({ ...input, operand: visit(input.operand) }));
    groups.push({ ...node, inputs });
    return { group: groups.length - 1 };
  }
  return { operands: roots.map(visit), groups };
}

/** 裸星号按整个 FROM 投影，限定星号只依赖包含成员的最外层投影。 */
function joinStarProjection(scope: JoinStarScope, all: boolean, members: { group: number; binding: string }[]): SqliteJoinStars {
  const roots = all ? scope.inputs.map(({ operand }) => operand) : [...new Set(members.map(({ group }) => group))].map(group => ({ group }));
  const compact = compactJoinGroups(scope.groups, roots);
  const indices = new Map(roots.flatMap((operand, index) => 'group' in operand ? [[operand.group, (compact.operands[index] as { group: number }).group] as const] : []));
  return {
    groups: compact.groups,
    ...(all ? { all: scope.inputs.map((input, index) => ({ ...input, operand: compact.operands[index] })) } : {}),
    ...(members.length ? { members: members.map(({ group, binding }) => ({ group: indices.get(group)!, binding })) } : {}),
    ...(scope.inputs.length === 1 ? { sole: true } : {}),
    ...(all && scope.uniqueLeft ? { uniqueLeft: true } : {}),
  };
}
const literalNames = ['null', 'true', 'false', 'current_date', 'current_time', 'current_timestamp'];
const joinModifiers = ['natural', 'left', 'right', 'full', 'outer', 'inner', 'cross'];

interface ConflictArm { start: number; targetClose?: number; action: number; }

/** SELECT 的 JOIN 条件可能调用 conflict()，仅承认完整动作或已进入 SELECT 尾部的草稿。 */
function insertConflictArms(tokens: Token[], start: number, end: number, depth: number, selectSource: boolean): ConflictArm[] {
  const arms: ConflictArm[] = [];
  const isAction = (at: number) => at < end && keyword(tokens[at], 'do') &&
    (at + 1 === end || keyword(tokens[at + 1], 'update') || keyword(tokens[at + 1], 'nothing'));
  let joinPossible = false;
  for (let at = start; at < end; at++) {
    const token = tokens[at];
    if (token.depth !== depth) continue;
    if (selectSource) {
      if (fromClause(tokens, at)) joinPossible = true;
      else if (['where', 'having', 'limit', 'window', ...setOperators].some(word => keyword(token, word)) ||
        (keyword(token, 'group') || keyword(token, 'order')) && keyword(tokens[at + 1], 'by')) joinPossible = false;
    }
    if (!keyword(token, 'on') || !keyword(tokens[at + 1], 'conflict')) continue;
    const open = tokens[at + 2];
    const targetClose = open?.kind === 'symbol' && open.value === '(' ? open.pair ?? end : undefined;
    let action = targetClose === undefined ? at + 2 : targetClose + 1;
    if (targetClose !== undefined && keyword(tokens[action], 'where')) {
      for (action++; action < end; action++) {
        const part = tokens[action];
        if (part.depth === depth && (isAction(action) || ['on', 'join', ...setOperators].some(word => keyword(part, word)) || part.kind === 'symbol' && part.value === ',')) break;
      }
    }
    if (selectSource && joinPossible && !isAction(action)) continue;
    if (!isAction(action)) action = end;
    arms.push({ start: at, ...(targetClose === undefined ? {} : { targetClose }), action });
    if (arms.length > limits.entries) fail('budget');
  }
  return arms;
}

function subqueryAt(tokens: Token[], start: number, end: number, offset: number, sourceEnd: number): { start: number; end: number } | undefined {
  for (let at = start; at < end; at++) {
    if (tokens[at].kind !== 'symbol' || tokens[at].value !== '(' || !(keyword(tokens[at + 1], 'select') || keyword(tokens[at + 1], 'with'))) continue;
    const finish = tokens[at].pair ?? end;
    if (offset >= (tokens[at + 1]?.start ?? sourceEnd) && offset <= (tokens[finish]?.start ?? sourceEnd)) return { start: at + 1, end: finish };
    at = finish;
  }
}

interface JoinCondition { on: number; end: number; outer: boolean; }

/** 约束到当前连接为止。嵌套参数的逗号和 IS DISTINCT FROM 留在 ON 表达式内。 */
function joinCondition(tokens: Token[], join: number, on: number, bound: number, target: Ready['target']): JoinCondition | undefined {
  if (target.start < tokens[on].end) return;
  const depth = tokens[on].depth;
  let end = on + 1;
  for (; end < bound; end++) {
    const token = tokens[end];
    if (token.depth !== depth) continue;
    if (token.kind === 'symbol' && token.value === ',' || ['join', 'using', 'on', 'where', 'having', 'window', 'limit', 'returning'].some(word => keyword(token, word)) ||
      (keyword(token, 'group') || keyword(token, 'order')) && keyword(tokens[end + 1], 'by')) break;
    if (joinModifiers.some(word => keyword(token, word))) {
      let next = end + 1;
      while (next < bound && joinModifiers.some(word => keyword(tokens[next], word))) next++;
      if (keyword(tokens[next], 'join')) break;
    }
  }
  if (end < bound && target.end > tokens[end].start || target.start > (tokens[bound]?.start ?? Infinity)) return;
  return { on, end, outer: modifiersAtJoin(tokens, join).some(word => ['left', 'right', 'full', 'outer'].includes(word)) };
}

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
    if (!token || token.quoted && !token.closed || !token.quoted && structural.has(fold(token.value)) || intent !== 'object' && (tokens[index + 1]?.value === '(' ||
      ['as', 'collate', 'window'].some(word => keyword(tokens[index - 1], word)) || intent === 'hover' && keyword(tokens[index - 1], 'over'))) fail('hover-target');
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

type ProjectionItem = { name?: string; star?: string | null; alias?: Token; expression?: Token[] };
const aliasOperators = new Set('collate escape is like glob regexp match over filter between in isnull notnull'.split(' '));
/** 保持首分支投影顺序，星号和显式名字的先后决定 SQLite 的重名后缀。 */
function projectionItems(tokens: Token[], start: number, end: number): ProjectionItem[] {
  const depth = tokens[start]?.depth ?? 0; let select = -1;
  for (let i = start; i < end; i++) {
    const token = tokens[i];
    if (token.depth !== depth) continue;
    if (setOperators.some(word => keyword(token, word))) return [];
    if (keyword(token, 'select')) { select = i; break; }
  }
  if (select < 0) return []; let finish = end;
  for (let i = select + 1; i < end; i++) if (tokens[i].depth === depth && (fromClause(tokens, i) ||
    ['where', 'group', 'having', 'window', 'order', 'limit', ...setOperators].some(word => keyword(tokens[i], word)))) { finish = i; break; }
  let begin = select + 1; if (keyword(tokens[begin], 'distinct') || keyword(tokens[begin], 'all')) begin++;
  const parts: Token[][] = []; for (let i = begin, last = begin; i <= finish; i++) if (i === finish || tokens[i].depth === depth && tokens[i].value === ',') { parts.push(tokens.slice(last, i)); last = i + 1; }
  if (parts.length > limits.entries) fail('budget');
  return parts.map(part => {
    const last = part.at(-1);
    if (last?.kind === 'symbol' && last.value === '*') {
      if (part.length === 1) return { star: null };
      if (part.length === 3 && part[0].kind === 'id' && part[1].kind === 'symbol' && part[1].value === '.') return { star: part[0].value };
      return {};
    }
    let name: string | undefined, alias: Token | undefined, as = -1;
    for (let i = 0; i < part.length; i++) if (part[i].depth === depth && keyword(part[i], 'as')) as = i;
    if (as >= 0) { if (as > 0 && as === part.length - 2 && last?.kind === 'id') alias = last; }
    else if (part.length % 2 === 1 && part.every((token, i) => i % 2 ? token.value === '.' : token.kind === 'id') &&
      !(part.length === 1 && literalNames.some(word => keyword(part[0], word)))) name = part.at(-1)!.value;
    else if (last?.kind === 'id' && part.length > 1 && (last.quoted || !structural.has(fold(last.value)) &&
      !aliasOperators.has(fold(last.value)) && !literalNames.includes(fold(last.value)))) {
      const prior = part.at(-2)!;
      if (prior.kind === 'symbol' && prior.value === ')' || prior.kind !== 'symbol' && (prior.kind !== 'id' || prior.quoted ||
        keyword(prior, 'end') || !structural.has(fold(prior.value)) && !aliasOperators.has(fold(prior.value)))) alias = last;
    }
    if (alias?.value && (!alias.quoted || alias.closed) && unicode(alias.value)) return { name: alias.value, alias, expression: part.slice(0, as >= 0 ? as : -1) };
    return name && unicode(name) ? { name } : {};
  });
}

const scalarFunctions = new Set('abs cast char coalesce concat concat_ws date datetime format glob hex if ifnull iif instr json json_array json_array_length json_error_position json_extract json_insert json_object json_patch json_quote json_remove json_replace json_set json_type json_valid jsonb jsonb_array jsonb_extract jsonb_object jsonb_patch jsonb_remove jsonb_replace jsonb_set julianday length like likelihood likely lower ltrim nullif octet_length printf quote random randomblob replace round rtrim sign strftime substr substring time timediff trim typeof unhex unicode unixepoch unlikely upper zeroblob ceil ceiling floor trunc sqrt pow power mod'.split(' '));

/** GROUP BY、WHERE 与 ON 只能使用确认不含聚合或窗口函数的表达式别名。 */
function allowedOutputAlias(clause: OutputAliasClause, expression: Token[], tokens: Token[]): boolean {
  if (clause === 'order') return true;
  const last = expression.at(-1)?.end ?? 0;
  for (let index = 0; index < expression.length; index++) {
    const token = expression[index];
    if (token.kind === 'symbol' && token.value === '(' && token.pair !== undefined &&
      (keyword(expression[index + 1], 'select') || keyword(expression[index + 1], 'with'))) {
      const close = tokens[token.pair];
      while (index + 1 < expression.length && expression[index + 1].end <= close.end) index++;
      continue;
    }
    if (keyword(token, 'over') && expression[index - 1]?.value === ')' &&
      (expression[index + 1]?.kind === 'id' || expression[index + 1]?.value === '(')) return false;
    if (clause === 'having' || token.kind !== 'id' || expression[index + 1]?.kind !== 'symbol' || expression[index + 1].value !== '(') continue;
    const name = fold(token.value);
    if (!token.quoted && (structural.has(name) || ['exists', 'in'].includes(name))) continue;
    if (scalarFunctions.has(name)) continue;
    if (name === 'min' || name === 'max') {
      const open = expression[index + 1];
      if (open.pair !== undefined && tokens[open.pair].end <= last && expression.some(item =>
        item.kind === 'symbol' && item.value === ',' && item.depth === open.depth + 1 && item.start > open.start && item.end < tokens[open.pair!].end)) continue;
    }
    return false;
  }
  return true;
}

const scalarExpressionWords = new Set('null current_date current_time current_timestamp case when then else end and or not is isnull notnull between in like glob match regexp escape'.split(' '));

/** 外连接右侧还有表时，只推断常量及能逐项绑定到当前连接输入的标量表达式。 */
function aliasUsesJoinInputs(expression: Token[], bindings: Binding[]): boolean {
  for (let at = 0; at < expression.length; at++) {
    const first = expression[at], next = expression[at + 1];
    if (first.kind !== 'id') continue;
    if (!first.quoted && scalarExpressionWords.has(fold(first.value))) continue;
    if (next?.value === '(' && next.kind === 'symbol' && scalarFunctions.has(fold(first.value))) continue;
    const names = [fold(first.value)];
    while (expression[at + 1]?.kind === 'symbol' && expression[at + 1].value === '.' && expression[at + 2]?.kind === 'id') {
      names.push(fold(expression[at + 2].value));
      at += 2;
    }
    if (names.length < 2 || names.length > 3) return false;
    const matches = bindings.filter(({ relation }) => names.length === 2 ? fold(relation.alias ?? relation.name) === names[0] :
      relation.kind === 'physical' && !relation.alias && relation.schema === names[0] && fold(relation.name) === names[1]);
    if (matches.length !== 1 || matches[0].afterOuterJoin) return false;
  }
  return true;
}

function bareOrderItem(tokens: Token[], start: number, end: number, target: Ready['target']): boolean {
  const marker = Symbol();
  const items: (Token | typeof marker)[] = [];
  let inserted = false;
  for (const token of tokens.slice(start, end)) {
    if (!inserted && token.start >= target.start) { items.push(marker); inserted = true; }
    if (token.start < target.start || token.end > target.end) items.push(token);
  }
  if (!inserted) items.push(marker);
  let left = 0, right = items.length;
  const tokenAt = (index: number) => { const item = items[index]; return item === marker ? undefined : item; };
  while (left < right - 1) {
    const first = tokenAt(left), last = tokenAt(right - 1), prior = tokenAt(right - 2);
    if ((keyword(last, 'first') || keyword(last, 'last')) && keyword(prior, 'nulls')) right -= 2;
    else if (keyword(last, 'asc') || keyword(last, 'desc')) right--;
    else if (last?.kind === 'id' && keyword(prior, 'collate')) right -= 2;
    else if (first?.kind === 'symbol' && first.value === '(' && first.pair !== undefined && tokens[first.pair] === last) { left++; right--; }
    else break;
  }
  return right === left + 1 && items[left] === marker;
}

/** 排序项单独使用别名时优先解析输出。更大的表达式先按 SQLite 规则查来源。 */
function outputAliasContext(tokens: Token[], start: number, end: number, target: Ready['target'], join?: JoinCondition): Pick<OutputAliasHints, 'clause' | 'outputFirst'> | undefined {
  const base = tokens[start].depth;
  let clause: OutputAliasClause | undefined = join && 'on', begin = join ? join.on + 1 : start + 1, finish = join?.end ?? end;
  for (let at = start + 1; !join && at < end; at++) {
    const token = tokens[at];
    if (token.depth !== base || token.kind !== 'id' || token.quoted) continue;
    const word = fold(token.value);
    const by = (word === 'group' || word === 'order') && keyword(tokens[at + 1], 'by');
    if (!by && !['where', 'having', 'window', 'limit', 'offset', 'returning'].includes(word) && !fromClause(tokens, at)) continue;
    if (token.start >= target.end && token.start > target.start) { finish = at; break; }
    if ((by ? tokens[at + 1] : token).end > target.start) return;
    clause = by || word === 'where' || word === 'having' ? word as OutputAliasClause : undefined;
    begin = at + (by ? 2 : 1);
  }
  if (!clause) return;
  let itemStart = begin, itemEnd = finish, preceding: Token | undefined, beforePreceding: Token | undefined;
  for (let at = begin; at < finish; at++) {
    const token = tokens[at], open = tokens[at + 1];
    if (token.end <= target.start) { beforePreceding = preceding; preceding = token; }
    if ((keyword(token, 'over') || keyword(token, 'filter')) && open?.kind === 'symbol' && open.value === '(' &&
      open.end <= target.start && target.end <= (tokens[open.pair ?? finish]?.start ?? Infinity)) return;
    if (token.kind === 'symbol' && token.value === ',' && token.depth === base) {
      if (token.end <= target.start) itemStart = at + 1;
      else if (token.start >= target.end) { itemEnd = at; break; }
    }
  }
  if (keyword(preceding, 'collate') || keyword(preceding, 'nulls')) return;
  if (clause === 'order') {
    const at = tokens.findIndex((token, index) => index >= itemStart && index < itemEnd && token.start === target.start && token.end === target.end);
    if (keyword(preceding, 'asc') || keyword(preceding, 'desc') ||
      keyword(beforePreceding, 'nulls') && (keyword(preceding, 'first') || keyword(preceding, 'last')) ||
      at > itemStart && ['asc', 'desc', 'nulls'].some(word => keyword(tokens[at], word))) return;
  }
  const outputFirst = clause === 'order' && bareOrderItem(tokens, itemStart, itemEnd, target);
  return { clause, ...(outputFirst ? { outputFirst: true } : {}) };
}

interface WindowShape { base?: Token; partition: boolean; order: boolean; frame: boolean; }
const windowFrameTypes = ['rows', 'range', 'groups'];
const windowFrameExpressionPrefixes = new Set(['by', 'collate', 'and', 'or', 'is', 'not', 'like', 'glob', 'match', 'regexp', 'between', 'in', 'when', 'then', 'else']);

/** 只读窗口规范的顶层结构。函数参数、子查询及点限定词不参与继承判断。 */
function windowShape(tokens: Token[], open: number, end: number): WindowShape {
  const depth = tokens[open].depth + 1;
  const first = tokens[open + 1], parts = tokens.slice(open + 1, end).filter(token => token.depth === depth);
  const isBy = (index: number, word: string) => keyword(parts[index], word) && keyword(parts[index + 1], 'by') && parts[index - 1]?.value !== '.';
  const partition = parts.some((_, index) => isBy(index, 'partition'));
  const order = parts.some((_, index) => isBy(index, 'order'));
  let lastBoundary = -1;
  parts.forEach((token, at) => {
    if (keyword(token, 'preceding') || keyword(token, 'following') || keyword(token, 'current') && keyword(parts[at + 1], 'row')) lastBoundary = at;
  });
  const frame = parts.some((token, index) => {
    if (index >= lastBoundary || !windowFrameTypes.some(word => keyword(token, word))) return false;
    const previous = parts[index - 1];
    // ORDER BY rows+following 中的 rows 是字段，帧只能出现在表达式结束后。
    return (previous?.kind === 'symbol' ? previous.value === ')' : !previous || previous.quoted || !windowFrameExpressionPrefixes.has(fold(previous.value))) &&
      ![',', '.'].includes(parts[index + 1]?.value);
  });
  const startsFrame = frame && windowFrameTypes.some(word => keyword(first, word));
  const base = first?.kind === 'id' && !isBy(0, 'partition') && !isBy(0, 'order') && !startsFrame ? first : undefined;
  return { base, partition, order, frame };
}

/** 当前 SELECT 独立管理窗口名，继承定义只采用此前声明，裸 OVER 可引用本块完整列表。 */
function namedWindowContext(source: string, tokens: Token[], head: number, end: number, prior: number, target: Ready['target']): { definitions: Token[]; inline?: true } | undefined {
  const depth = tokens[head].depth, previous = tokens[prior];
  const isOpen = previous?.kind === 'symbol' && previous.value === '(';
  const over = isOpen ? prior - 1 : prior;
  const afterCall = (at: number) => {
    const close = tokens[at - 1];
    return keyword(tokens[at], 'over') && close?.kind === 'symbol' && close.value === ')' && close.pair !== undefined &&
      close.pair > head && tokens[close.pair - 1]?.kind === 'id';
  };
  const useOver = afterCall(over);
  const useBase = isOpen && keyword(tokens[prior - 1], 'as');
  // SQLite 对窗口名比较原始词形，保留声明的引号种类及转义。
  const keyOf = (token: Token) => fold(source.slice(token.start, token.end));
  const definitions = new Map<string, { name: Token; shape: WindowShape }>(), seen = new Set<string>();
  let clause = 'select', window = -1, allowedOver = false, nestedOver = false;
  for (let at = head + 1; at < end; at++) {
    const token = tokens[at];
    if (at === over) allowedOver = !nestedOver && (clause === 'select' || clause === 'order');
    // 同一查询块的窗口规范和 FILTER 条件中不能再调用窗口函数。
    if (useOver && at < over && (afterCall(at) || keyword(token, 'filter') && keyword(tokens[at + 2], 'where')) &&
      tokens[at + 1]?.value === '(' && (tokens[at + 1].pair ?? end) > over) nestedOver = true;
    if (token.depth !== depth || tokens[at - 1]?.value === '.') continue;
    if (keyword(token, 'window') && tokens[at + 1]?.kind === 'id' && keyword(tokens[at + 2], 'as')) { window = at; clause = 'window'; }
    else if (keyword(token, 'order') && keyword(tokens[at + 1], 'by')) clause = 'order';
    else if (fromClause(tokens, at) || ['where', 'group', 'having', 'limit', 'offset'].some(word => keyword(token, word))) clause = 'other';
  }
  if (useOver && !allowedOver) fail('window-context');
  if (!useOver && window < 0) return;
  const eligible = (shape?: WindowShape) => [...definitions.values()].filter(({ name, shape: base }) => !shape ||
    !shape.partition && !base.frame && !(shape.order && base.order) &&
    (name.quoted || !['partition', 'order', 'rows', 'range', 'groups'].includes(fold(name.value)))).map(window => window.name);
  let reference: { definitions: Token[]; inline: true } | undefined;
  if (window >= 0) {
    for (let at = window + 1; at < end;) {
      const name = tokens[at], open = at + 2, token = tokens[open];
      if (name.kind !== 'id' || !name.value || name.quoted && !name.closed || !keyword(tokens[at + 1], 'as') || token?.value !== '(') {
        if (useOver || reference) fail('window-definition');
        break;
      }
      if (name.start === target.start && name.end === target.end) fail('window-declaration');
      const key = keyOf(name);
      if (seen.size >= limits.entries) fail('budget');
      if (seen.has(key) && (useOver || useBase)) fail('window-definition');
      seen.add(key);
      const close = token.pair ?? end, shape = windowShape(tokens, open, close);
      if (open === prior && !(shape.base === undefined && target.end > target.start && tokens[open + 1]?.start === target.start)) {
        reference = { definitions: eligible(shape), inline: true };
      }
      const base = shape.base && definitions.get(keyOf(shape.base));
      if (token.pair !== undefined && tokens[open + 1]?.kind !== 'string' &&
        (!shape.base || base && !shape.partition && !base.shape.frame && !(shape.order && base.shape.order))) {
        definitions.set(key, { name, shape: { ...shape, order: shape.order || base?.shape.order === true } });
      }
      at = close + 1;
      if (tokens[at]?.value !== ',') break;
      at++;
    }
  }
  if (!useOver) return reference;
  if (!isOpen) return { definitions: eligible() };
  const shape = windowShape(tokens, prior, previous.pair ?? end);
  if (!shape.base && target.end > target.start && tokens[prior + 1]?.start === target.start) return;
  return { definitions: eligible(shape), inline: true };
}

/** 显式列清单可离线确定。复合排序另外收集待展开的星号并去重。 */
function projectionColumns(tokens: Token[], start: number, end: number, wildcards?: (string | null)[]): string[] | undefined {
  const columns = new Map<string, string>();
  for (const { name, star } of projectionItems(tokens, start, end)) {
    if (wildcards && star !== undefined) wildcards.push(star);
    if (name && !columns.has(fold(name))) columns.set(fold(name), name);
    else if (!wildcards) return;
  }
  return columns.size ? [...columns.values()] : undefined;
}

/** 纯分析入口不读取文件、会话、IPC或数据库；预算与未知语法均以固定原因阻断。 */
export function analyzeSqliteCompletion(source: string, offset: number, intent?: SqliteAnalysisIntent, definitionKind?: (kind: 'alias' | 'cte' | 'window' | 'physical') => void, physicalObject?: (value: Extract<PhysicalObjectAnalysis, { status: 'ready' }>) => void): SqliteCompletionAnalysis {
  try {
    if (typeof source !== 'string' || source.length > limits.sourceUnits) fail('budget');
    if (!unicode(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !boundary(source, offset)) fail('input');
    if (intent !== undefined && intent !== 'hover' && intent !== 'definition' && intent !== 'object') fail('input');
    const tokens = lex(source, offset, intent === 'object'), target = targetAt(source, tokens, offset, intent), statement = statementAt(tokens, offset), beforeTarget = tokens.filter(token => token.end <= target.start), qualifiers: string[] = [];
    let q = beforeTarget.length - 1;
    while (q >= 1 && beforeTarget[q].value === '.' && beforeTarget[q - 1].kind === 'id') { qualifiers.unshift(beforeTarget[q - 1].value); q -= 2; }
    if (qualifiers.length > 2) fail('qualifier');
    const windowPrior = tokens.indexOf(beforeTarget[q]);
    const active = tokens.slice(statement.start, statement.end);
    if (active.some(token => token.value === '#' || token.value === ']' || token.value === ')' && token.pair === undefined)) fail('syntax');
    if (intent === 'object' && active.some(token => token.closed === false || token.value === '(' && token.pair === undefined)) fail('syntax');
    let relationBudget = 0;
    const localProjections: SqliteLocalProjection[] = [], sourceIndex = new Map<ProjectionSource, number>();
    const stagedSources: ProjectionSource[] = [], compiled = new Map<ProjectionSource, number>(), compiling = new Set<ProjectionSource>();
    const projectionSource = (start: number, end: number, ctes: Map<string, Cte>) =>
      projectionItems(tokens, start, end).some(item => item.star !== undefined) ? { start, end, ctes } : undefined;
    function sourceOperand(binding: Binding): SqliteJoinOperand {
      const { relation, projectionSource } = binding;
      if (relation.kind === 'physical') return { source: columnSource(relation) };
      if (!projectionSource) return { columns: relation.columns };
      let index = sourceIndex.get(projectionSource);
      if (index === undefined) {
        index = stagedSources.length;
        stagedSources.push(projectionSource);
        sourceIndex.set(projectionSource, index);
      }
      return { projection: index };
    }
    /** 完成候选实际引用的局部节点，按依赖顺序分配回包编号。 */
    function resolveOperand(operand: SqliteJoinOperand): SqliteJoinOperand {
      if (!('projection' in operand)) return operand;
      const index = compileProjection(stagedSources[operand.projection]);
      return index === undefined ? { columns: [] } : { projection: index };
    }
    const resolveInput = <T extends JoinInput>(input: T): T => ({ ...input, operand: resolveOperand(input.operand) });
    const resolveGroups = (groups: SqliteJoinGroup[]): SqliteJoinGroup[] => groups.map(group => ({ ...group, inputs: group.inputs.map(resolveInput) }));
    const resolveStar = (star: SqliteJoinStars): SqliteJoinStars => ({ ...star, ...(star.all ? { all: star.all.map(resolveInput) } : {}), groups: resolveGroups(star.groups) });
    function saveProjection(descriptor: ProjectionSource, parts: SqliteLocalProjection): number {
      const index = localProjections.length;
      if (index >= limits.relations) fail('budget');
      localProjections.push(parts);
      compiled.set(descriptor, index);
      return index;
    }
    /** 按实际投影逐层信任可见来源，遇到循环局部名保留未知槽，绝不回退同名永久表。 */
    function compileProjection(descriptor: ProjectionSource): number | undefined {
      if (compiled.has(descriptor)) return compiled.get(descriptor);
      if (compiling.has(descriptor)) return;
      if (compiling.size >= limits.relations || localProjections.length >= limits.relations) fail('budget');
      compiling.add(descriptor);
      const { start, end, ctes } = descriptor;
      try {
        const { bindings, joinStarScope } = scope(start, end, ctes, [], compiling.size, true, true);
        function projectItem(item: ProjectionItem): SqliteLocalProjection[number] {
          if (item.name) return { name: item.name };
          if (item.star === undefined || !joinStarScope) return { unknown: true };
          let star: SqliteJoinStars;
          if (item.star === null) star = joinStarProjection(joinStarScope, true, []);
          else {
            const alias = fold(item.star);
            const matches = bindings.filter(({ relation }) => fold(relation.alias ?? relation.name) === alias);
            if (matches.length !== 1) return { unknown: true };
            const binding = matches[0], group = joinStarScope.owners.get(binding);
            star = group === undefined ? { groups: [], all: [{ operand: sourceOperand(binding) }], sole: true }
              : joinStarProjection(joinStarScope, false, [{ group, binding: item.star }]);
          }
          return { star: resolveStar(star) };
        }
        const parts: SqliteLocalProjection = [];
        for (const item of projectionItems(tokens, start, end)) {
          const part = projectItem(item);
          parts.push(part);
          if ('unknown' in part) break;
        }
        return saveProjection(descriptor, parts);
      } catch (error) {
        if (error instanceof Error && ['alias', 'derived-alias', 'relation', 'relation-group', 'schema', 'table-function', 'using'].includes(error.message))
          return saveProjection(descriptor, [{ unknown: true }]);
        throw error;
      } finally { compiling.delete(descriptor); }
    }
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
        const result = columns ?? projectionColumns(tokens, i, close);
        const cte: Cte = { name: name.value, columns: result, start: i, end: close, declaration: { start: name.start, end: name.end },
          projectionSource: result ? undefined : projectionSource(i, close, ctes) };
        if (declared.some(value => fold(value.name) === fold(cte.name))) fail('cte');
        if (++relationBudget > limits.relations) fail('budget'); declared.push(cte); ctes.set(fold(cte.name), cte); i = close < end ? close + 1 : end;
        if (tokens[i]?.value !== ',') break; i++;
      }
      return { head: i, ctes, declared };
    }
    function scope(start: number, end: number, inherited: Map<string, Cte>, outer: Binding[], level: number, projectionOnly = false, localPlan = false): { bindings: Binding[]; ctes: Map<string, Cte>; syntax: Ready['syntax']; output?: OutputProjection; outputAliases?: OutputAliasHints; windowNames?: SqliteWindowNames; windowDefinition?: SqliteLocalDefinition; using?: UsingProjection; joinStarScope?: JoinStarScope; unqualified?: true; writable?: true } {
      if (level > limits.depth) fail('budget');
      const parsed = withClause(start, end, inherited), ctes = parsed.ctes, head = parsed.head, base = tokens[head]?.depth ?? tokens[start]?.depth ?? 0;
      if (!projectionOnly) for (const cte of parsed.declared) if (offset >= (tokens[cte.start]?.start ?? source.length) && offset <= (tokens[cte.end]?.start ?? source.length)) return scope(cte.start, cte.end, ctes, [], level + 1);
      if (!projectionOnly && intent && target.start < (tokens[head]?.start ?? source.length)) fail('hover-target');
      if (head >= end) return { bindings: [], ctes, syntax: ['keyword'] };
      const command = fold(tokens[head].value);
      const insert = command === 'insert' || command === 'replace';
      if (!['select', 'values', 'update', 'insert', 'replace', 'delete'].includes(command) || tokens[head].quoted) {
        if (head === start && tokens.length === 1 && tokens[0].kind === 'id') return { bindings: [], ctes, syntax: ['keyword'] };
        fail('statement');
      }
      const compounds = tokens.map((token, index) => index >= head && index < end && token.depth === base && setOperators.some(word => keyword(token, word)) ? index : -1).filter(index => index >= 0);
      if (compounds.length && (command === 'update' || command === 'delete')) fail('compound');
      if (compounds.length && (command === 'select' || command === 'values')) {
        // 局部关系的输出名沿用复合查询的首分支，光标在外层时也不能误取后续分支。
        if (localPlan) return scope(head, compounds[0], ctes, [], level + 1, true, true);
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
          const columns = new Map<string, string>(), sources = new Map<string, OutputSource>(), projections = new Set<number>();
          const joinStars: SqliteJoinStars[] = [];
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
            let bindings: Binding[], starScope: JoinStarScope | undefined;
            try { ({ bindings, joinStarScope: starScope } = scope(branchStart, branchEnd, ctes, [], level + 1, true)); }
            catch (error) {
              if (!(error instanceof Error) || !['alias', 'derived-alias', 'relation', 'relation-group', 'schema', 'table-function', 'using'].includes(error.message)) throw error;
              incomplete = true;
              continue;
            }
            const members: { group: number; binding: string }[] = [];
            const all = !!starScope && wildcards.includes(null);
            for (const wildcard of new Set(wildcards.map(name => name === null ? null : fold(name)))) {
              if (wildcard === null && all) continue;
              const matches = wildcard === null ? bindings : bindings.filter(({ relation }) => fold(relation.alias ?? relation.name) === wildcard);
              if (!matches.length || wildcard !== null && matches.length !== 1) { incomplete = true; continue; }
              for (const binding of matches) {
                const { relation, unknown, nestedProjection } = binding, group = starScope?.owners.get(binding);
                if (nestedProjection) {
                  if (group === undefined || wildcard === null) incomplete = true;
                  else members.push({ group, binding: relation.alias ?? relation.name });
                }
                else if (relation.kind === 'physical') {
                  const source = columnSource(relation), key = sqliteCompletionSourceKey(source);
                  if (!sources.has(key)) sources.set(key, source);
                } else if (binding.projectionSource) {
                  const projection = compileProjection(binding.projectionSource);
                  if (projection === undefined) incomplete = true;
                  else projections.add(projection);
                } else if (unknown) incomplete = true;
                else for (const name of relation.columns) addColumn(name);
              }
            }
            if (starScope && (all || members.length)) joinStars.push(resolveStar(joinStarProjection(starScope, all, members)));
          }
          if (!columns.size && !sources.size && !projections.size && !joinStars.length && !incomplete) fail('compound');
          return { bindings: [], ctes: new Map(), syntax: ['column'], output: {
            columns: [...columns.values()].slice(0, limits.entries), sources: [...sources.values()],
            ...(projections.size ? { projections: [...projections] } : {}), ...(joinStars.length ? { joinStars } : {}), ...(incomplete ? { incomplete: true } : {}),
          } };
        }
        const branch = compounds.filter(index => tokens[index].end <= offset).length;
        const branchStart = starts[branch], branchEnd = compounds[branch] ?? tail;
        if (!intent && branch > 0 && (branchStart >= branchEnd || offset <= tokens[branchStart].end)) {
          return { bindings: [], ctes, syntax: ['keyword'] };
        }
        return scope(branchStart, branchEnd, ctes, outer, level + 1);
      }
      const usingPosition = (start: number, end: number, depth: number) => projectionOnly || !['select', 'update'].includes(command) ? -1 : tokens.findIndex((token, at) => {
        const open = tokens[at + 1];
        return at >= start && at < end && token.depth === depth && keyword(token, 'using') && open?.kind === 'symbol' &&
          open.value === '(' && offset >= open.end && offset <= (tokens[open.pair ?? end]?.start ?? source.length);
      });
      const usingAt = usingPosition(head, end, base);
      if (usingAt >= 0 && (intent || qualifiers.length)) fail('using');
      const relationEnd = usingAt < 0 ? end : usingAt, relationOnly = projectionOnly || usingAt >= 0;
      type Joins = Map<Binding, { natural: boolean; rightOrFull: boolean; full: boolean; merged?: string[] }>;
      const joins: Joins = new Map(), groups: SqliteJoinGroup[] = [];
      const groupedOperands = new Map<Binding, { end: number; size: number; group: number; alias?: Binding }>();
      const groupedHeads = new Map<Binding, Binding>();
      const own: Binding[] = [], derived: { start: number; end: number }[] = []; let relationContext = false, aliasContext = false, targetBinding: Binding | undefined, argumentBinding: Binding | undefined;
      let groupScope: Binding[] | undefined, groupUsing: UsingProjection | undefined, groupUsingIsolated = false, activeOn: JoinCondition | undefined;
      function noteCondition(join: number | undefined, on: number, bound: number) {
        if (command === 'select' && !projectionOnly && join !== undefined) activeOn = joinCondition(tokens, join, on, bound, target) ?? activeOn;
      }
      const relevant = (begin: number, finish: number) => offset >= (tokens[begin]?.start ?? source.length) && target.start <= (tokens[finish - 1]?.end ?? source.length);
      const hasRightOrFull = (start: number, end: number, depth: number) => tokens.some((token, at) => at >= start && at < end && token.depth === depth &&
        keyword(token, 'join') && modifiersAtJoin(tokens, at).some(word => word === 'right' || word === 'full'));
      function joinInputs(bindings: Binding[], joins: Joins, includeBindings = false) {
        const inputs: { end: number; join?: ReturnType<Joins['get']>; input: JoinInput }[] = [];
        for (let at = 0; at < bindings.length; at++) {
          const binding = bindings[at], { relation } = binding, group = groupedOperands.get(binding), join = joins.get(binding);
          const operand: SqliteJoinOperand = group ? { group: group.group } : sourceOperand(binding);
          const merged = join?.natural ? true : join?.merged;
          const name = includeBindings && !group && (relation.alias || relation.kind === 'local' && relation.name);
          inputs.push({ end: group?.end ?? binding.end, join, input: { operand, ...(merged ? { merged } : {}), ...(name ? { binding: name } : {}) } });
          if (group) at += group.size - 1;
        }
        return inputs;
      }
      const uniqueJoinLeft = (joins: Joins, start: number, end: number, depth: number) =>
        [...joins.values()].some(join => join.rightOrFull) || hasRightOrFull(start, end, depth);
      function usingProjection(bindings: Binding[], joins: Joins, using: number, start: number, end: number, depth: number): UsingProjection {
        const inputs = joinInputs(bindings, joins), right = inputs.at(-1);
        if (intent || qualifiers.length || !right?.join || right.end > using || right.join.natural || inputs.length < 2 || relationContext || aliasContext) fail('using');
        const tail = tokens.slice(right.end, using);
        const indexed = tail.length === 3 && keyword(tail[0], 'indexed') && keyword(tail[1], 'by') && tail[2].kind === 'id';
        const noIndex = tail.length === 2 && keyword(tail[0], 'not') && keyword(tail[1], 'indexed');
        if (tail.length && !indexed && !noIndex) fail('using');
        // SQLite 对含 RIGHT/FULL JOIN 的整个查询块启用 USING 同名列消歧。
        const uniqueLeft = uniqueJoinLeft(joins, start, end, depth);
        const left = inputs.slice(0, -1).map(({ input }) => input), rightOperand = right.input.operand;
        let starGroupSides: UsingProjection['starGroupSides'];
        if (groups.length && uniqueLeft && keyword(tokens[start], 'select')) {
          const wildcards: (string | null)[] = [];
          projectionColumns(tokens, start, end, wildcards);
          if (wildcards.includes(null)) {
            // 外层星号可能把组中原本重名的列作为未限定名称再解析。
            const later = hasRightOrFull(using + 1, end, depth);
            const checkLeft = (right.join.full || later) && left.some(({ operand }) => 'group' in operand);
            const checkRight = (right.join.rightOrFull || later) && 'group' in rightOperand;
            starGroupSides = checkLeft ? (checkRight ? 'both' : 'left') : checkRight ? 'right' : undefined;
          }
        }
        const compact = compactJoinGroups(groups, [...left.map(({ operand }) => operand), rightOperand]);
        return {
          left: left.map((input, index) => ({ ...input, operand: resolveOperand(compact.operands[index]) })), right: resolveOperand(compact.operands.at(-1)!),
          used: usingNames(tokens, using + 1, tokens[using + 1].pair ?? end, target),
          ...(uniqueLeft ? { uniqueLeft: true } : {}), ...(compact.groups.length ? { groups: resolveGroups(compact.groups) } : {}),
          ...(starGroupSides ? { starGroupSides } : {}),
        };
      }
      function readPreviousUsing(joins: Joins, at: number, bound: number) {
        const last = own.at(-1)!, join = joins.get(groupedHeads.get(last) ?? last), close = tokens[at + 1].pair;
        if (!join || close === undefined || close >= bound) fail('using');
        join.merged = usingNames(tokens, at + 1, close);
      }
      function recordJoin(joins: Joins, before: number, at: number) {
        if (own.length <= before) return;
        const modifiers = modifiersAtJoin(tokens, at);
        const right = modifiers.includes('right'), full = modifiers.includes('full') || right && modifiers.includes('left');
        joins.set(own[before], { natural: modifiers.includes('natural'), rightOrFull: right || full, full });
      }
      /** SQLite 展开首个无修饰的括号来源，其余多来源组按嵌套查询隔离 ON/USING。 */
      function relationGroup(open: number, close: number, bound: number, hasPrefix: boolean, parentJoins?: Joins): number {
        const depth = tokens[open].depth + 1, inside = offset >= tokens[open].end && offset <= (tokens[close]?.start ?? source.length);
        const first = own.length, using = usingPosition(open + 1, close, depth), stop = using < 0 ? close : using;
        const joins: Joins = new Map();
        const collectJoins = using >= 0 || parentJoins || !inside ? joins : undefined;
        let at = relation(open + 1, false, stop, false, collectJoins), lastJoin: number | undefined;
        while (at < stop) {
          const token = tokens[at];
          if (token.depth === depth) {
            if (keyword(token, 'join') || token.kind === 'symbol' && token.value === ',') {
              const before = own.length, next = relation(at + 1, false, stop, true, collectJoins);
              if (collectJoins) recordJoin(collectJoins, before, at);
              lastJoin = own.length > before ? at : undefined;
              at = next;
              continue;
            }
            if (inside && keyword(token, 'on')) { noteCondition(lastJoin, at, stop); lastJoin = undefined; }
            if (collectJoins && keyword(token, 'using') && tokens[at + 1]?.value === '(') readPreviousUsing(collectJoins, at, stop);
            if (keyword(token, 'using')) lastJoin = undefined;
          }
          at++;
        }
        const members = own.slice(first);
        if (using >= 0) groupUsing = usingProjection(members, joins, using, open + 1, close, depth);
        let next = close < bound ? close + 1 : close;
        const explicit = keyword(tokens[next], 'as');
        if (explicit) next++;
        const token = tokens[next];
        const alias = next < bound && token?.kind === 'id' && token.value && (token.quoted || !structural.has(fold(token.value))) ? token : undefined;
        const aliasIndex = alias ? next++ : undefined;
        if (aliasIndex !== undefined) aliasContext ||= relevant(aliasIndex, aliasIndex + 1);
        else if (explicit) aliasContext = true;
        const flattened = !hasPrefix && !alias && !keyword(tokens[next], 'on') && !keyword(tokens[next], 'using');
        if (flattened && parentJoins) for (const [binding, join] of joins) parentJoins.set(binding, join);
        if (groupUsing && inside && !groupUsingIsolated) {
          if (hasRightOrFull(open + 1, close, depth)) groupUsing.uniqueLeft = true;
          groupUsingIsolated = !flattened && members.length > 1;
        }
        if (members.length === 1) {
          const binding = members[0];
          // 包装单一来源时 SQLite 复制物理目标，不继承括号内的原别名。
          if (!flattened && !inside) {
            if (!alias && binding.relation.kind === 'local' && binding.relation.source === 'derived') fail('derived-alias');
            delete binding.relation.alias;
            if (alias) {
              binding.relation.alias = alias.value;
              if (binding.relation.kind === 'local' && binding.relation.source === 'derived') binding.relation.name = alias.value;
            }
            binding.aliasIndex = aliasIndex;
          }
          binding.end = next;
        } else if (members.length > 1) {
          if (inside && !flattened) groupScope ??= members;
          if (!flattened && !inside) {
            const first = members[0], last = members.at(-1)!, inputs = joinInputs(members, joins, true);
            // 单个已有子组复用其投影。外层别名覆盖子组名，成员标识符仍然可见。
            const prior = groupedOperands.get(first);
            let group = prior?.group ?? 0;
            if (inputs.length !== 1 || !prior) {
              const uniqueLeft = uniqueJoinLeft(joins, open + 1, close, depth);
              group = groups.length;
              groups.push({ inputs: inputs.map(({ input }) => input), ...(uniqueLeft ? { uniqueLeft: true } : {}) });
            }
            const binding: Binding | undefined = alias ? {
              relation: { kind: 'local', source: 'group', name: alias.value, alias: alias.value, columns: [] },
              start: open, end: next, aliasIndex, level, group: { root: group, groups, members },
            } : undefined;
            groupedOperands.set(first, { end: next, size: members.length, group, alias: binding });
            groupedHeads.set(last, first);
            for (const member of members) {
              member.nestedProjection = true;
              if (member.relation.kind === 'physical') member.relation.visibleColumnsOnly = true;
            }
          }
        }
        return next;
      }
      function relation(at: number, target = false, bound = relationEnd, hasPrefix = false, parentJoins?: Joins): number {
        const begin = at; let binding: Binding;
        if (at >= bound) {
          if (relationOnly || offset < (tokens[bound - 1]?.end ?? 0) || offset > (tokens[bound]?.start ?? source.length)) fail('relation');
          relationContext = true;
          return at;
        }
        if (tokens[at]?.kind === 'symbol' && tokens[at].value === '(') {
          const open = at++, close = tokens[open].pair ?? bound;
          if (target || close > bound) fail('relation-group');
          if (!keyword(tokens[at], 'select') && !keyword(tokens[at], 'with')) return relationGroup(open, close, bound, hasPrefix, parentJoins);
          derived.push({ start: at, end: close }); const columns = projectionColumns(tokens, at, close);
          const plan = columns ? undefined : projectionSource(at, close, ctes);
          at = close < bound ? close + 1 : bound;
          if (keyword(tokens[at], 'as')) at++;
          const alias = tokens[at];
          if (alias?.kind === 'id' && alias.value && (alias.quoted || !structural.has(fold(alias.value)))) {
            binding = { relation: { kind: 'local', source: 'derived', name: alias.value, alias: alias.value, columns: columns ?? [] }, start: begin, end: at + 1, aliasIndex: at, unknown: !columns && !plan, projectionSource: plan }; at++;
          } else {
            if (!relationOnly && !parentJoins) { if (offset >= tokens[open].start && offset <= (tokens[close]?.start ?? source.length)) return at; fail('derived-alias'); }
            if (keyword(tokens[at - 1], 'as')) fail('alias');
            // 匿名派生表参与裸星号展开，不参与任何名称限定匹配。
            binding = { relation: { kind: 'local', source: 'derived', name: '', columns: columns ?? [] }, start: begin, end: at, unknown: !columns && !plan, projectionSource: plan };
          }
        } else {
          const first = tokens[at]; if (!first || first.kind !== 'id') { if (!first || first.start >= offset) { relationContext = true; return at; } fail('relation'); }
          if (!first.value) { relationContext = true; return at + 1; }
          if (relationOnly && (!first.quoted && structural.has(fold(first.value)) || first.quoted && !first.closed)) fail('relation');
          let name = first.value, schema: 'main' | 'temp' | undefined; at++;
          if (tokens[at]?.value === '.') {
            const folded = fold(name); if (folded !== 'main' && folded !== 'temp') fail('schema'); schema = folded; at++;
            if (tokens[at]?.kind !== 'id' || !tokens[at].value) { relationContext = true; return at; } name = tokens[at++].value;
            if (relationOnly && (at > bound || !tokens[at - 1].quoted && structural.has(fold(name)))) fail('relation');
          }
          const nameEnd = at;
          const tableFunction = !target && tokens[at]?.kind === 'symbol' && tokens[at].value === '(' && ['select', 'update'].includes(command);
          const local = schema === undefined ? ctes.get(fold(name)) : undefined; if (target && local) fail('dml-target');
          let inArgument = false;
          if (tableFunction) {
            const open = tokens[at], close = open.pair ?? bound;
            inArgument = offset >= open.end && offset <= (tokens[close]?.start ?? source.length);
            if (close >= bound && !inArgument || local && !inArgument) fail('table-function');
            at = close < bound ? close + 1 : close;
          }
          const relation: SqliteCompletionRelation = local ? { kind: 'local', source: 'cte', name: local.name, columns: local.columns ?? [] }
            : { kind: 'physical', name, ...(schema ? { schema } : {}), ...(tableFunction ? { tableFunction: true } : {}) };
          binding = { relation, start: begin, end: at, referenceIndex: nameEnd - 1,
            ...(local ? { declaration: local.declaration, projectionSource: local.projectionSource } : {}), unknown: !!local && !local.columns && !local.projectionSource };
          if (inArgument) argumentBinding = binding;
          relationContext ||= relevant(begin, nameEnd);
          if (keyword(tokens[at], 'as')) { at++; const alias = tokens[at]; if (!alias || alias.kind !== 'id' || !alias.value) { aliasContext = true; return at; } binding.relation.alias = alias.value; binding.aliasIndex = at; at++; }
          else if (!(target && insert) && tokens[at]?.kind === 'id' && (tokens[at].quoted || !structural.has(fold(tokens[at].value)))) { binding.relation.alias = tokens[at].value; binding.aliasIndex = at; at++; }
          binding.end = at;
        }
        if (binding.aliasIndex !== undefined && relevant(binding.aliasIndex, binding.aliasIndex + 1)) aliasContext = true;
        if (++relationBudget > limits.relations) fail('budget'); binding.level = level; own.push(binding); return at;
      }
      let index = head + 1;
      if (command === 'update' || insert) {
        if (keyword(tokens[index], 'or')) index += 2;
        if (keyword(tokens[index], 'into')) index++;
        index = relation(index, true); targetBinding = own[0];
      }
      if (insert && targetBinding?.relation.kind === 'physical' && !relationContext && !aliasContext) {
        const binding = targetBinding, physical = targetBinding.relation;
        const columns = (bindings: Binding[], unqualified: boolean, writable = false) => {
          if (unqualified && qualifiers.length) fail('qualified-target');
          return { bindings, ctes: new Map<string, Cte>(), syntax: ['column'] as Ready['syntax'],
            ...(unqualified ? { unqualified: true as const } : {}), ...(writable ? { writable: true as const } : {}) };
        };
        let data = index;
        if (tokens[data]?.kind === 'symbol' && tokens[data].value === '(') {
          const close = tokens[data].pair ?? end;
          if (target.start >= tokens[data].end && target.end <= (tokens[close]?.start ?? source.length)) return columns([binding], true, true);
          data = close + 1;
        }
        const returning = tokens.findIndex((token, at) => at >= data && at < end && token.depth === base && keyword(token, 'returning'));
        const beforeReturning = returning < 0 ? end : returning;
        const selectSource = keyword(tokens[data], 'select') || keyword(tokens[data], 'with');
        const arms = selectSource || keyword(tokens[data], 'values') ? insertConflictArms(tokens, data, beforeReturning, base, selectSource) : [];
        const inputEnd = arms[0]?.start ?? beforeReturning;
        const inside = (begin: number, finish: number, bindings: Binding[]) => {
          const nested = subqueryAt(tokens, begin, finish, offset, source.length);
          if (nested) return scope(nested.start, nested.end, ctes, bindings, level + 1);
        };
        if (returning >= 0 && target.start >= tokens[returning].end) {
          // RETURNING 的目标使用实际表名，INSERT 的 AS 别名及 excluded 均不在该命名空间。
          const { alias: _alias, ...returnTarget } = physical;
          const result: Binding = { ...binding, relation: { ...returnTarget, insertRole: 'insert-returning' }, aliasIndex: undefined };
          return inside(returning + 1, end, [result]) ?? columns([result], !qualifiers.length);
        }
        const armIndex = arms.findIndex((arm, at) => target.start >= tokens[arm.start + 1].end &&
          target.end <= (tokens[arms[at + 1]?.start ?? beforeReturning]?.start ?? source.length));
        if (armIndex >= 0) {
          const arm = arms[armIndex], finish = arms[armIndex + 1]?.start ?? beforeReturning;
          const current: Binding = { ...binding, relation: { ...physical, insertRole: 'upsert-target' } };
          const { targetClose, action } = arm;
          const inTarget = targetClose !== undefined && target.start >= tokens[arm.start + 2].end && target.end <= (tokens[targetClose]?.start ?? source.length);
          const predicate = targetClose !== undefined ? tokens[targetClose + 1] : undefined;
          if (inTarget || keyword(predicate, 'where') && target.start >= predicate!.end && target.end <= (tokens[Math.min(action, finish)]?.start ?? source.length)) {
            const prior = beforeTarget.at(-1);
            if (keyword(prior, 'collate')) fail('collation');
            return columns([current], !qualifiers.length);
          }
          const set = tokens[action + 2];
          if (action >= finish || !keyword(tokens[action + 1], 'update') || !keyword(set, 'set') || target.start < set.end) fail('upsert-action');
          let assignment = action + 3, equals = -1;
          for (let at = assignment; at < finish; at++) {
            const token = tokens[at];
            if (token.depth !== base) continue;
            if (keyword(token, 'where')) break;
            if (token.value === ',' && token.end <= target.start && token.kind === 'symbol') { assignment = at + 1; equals = -1; }
            if (at >= assignment && equals < 0 && token.kind === 'symbol' && token.value === '=') equals = at;
          }
          const where = tokens.findIndex((token, at) => at >= action + 3 && at < finish && token.depth === base && keyword(token, 'where'));
          if ((where < 0 || target.start < tokens[where].end) && (equals < 0 || target.start <= tokens[equals].start)) return columns([current], true, true);
          const bindings = [current];
          // 真实目标叫 excluded 时，SQLite 优先解析该目标的旧行。
          if (fold(physical.alias ?? physical.name) !== 'excluded') {
            bindings.push({ start: binding.start, end: binding.end, level, relation: { ...physical, alias: 'excluded', insertRole: 'excluded' } });
          }
          return inside(action + 3, finish, bindings) ?? columns(bindings, false);
        }
        if (selectSource && target.start >= tokens[data].start && target.end <= (tokens[inputEnd]?.start ?? source.length)) return scope(data, inputEnd, ctes, [], level + 1);
        if (target.start >= (tokens[data]?.start ?? source.length)) {
          const nested = inside(data, inputEnd, []);
          if (nested) return nested;
          fail(keyword(tokens[data], 'values') ? 'values' : 'insert-source');
        }
      }
      let inFrom = false, lastJoin: number | undefined;
      const collectRootJoins = usingAt >= 0 || projectionOnly;
      for (let at = command === 'select' || command === 'delete' ? head + 1 : index; at < relationEnd; at++) {
        const token = tokens[at]; if (token.depth !== base) continue;
        const joined = keyword(token, 'join') || token.kind === 'symbol' && token.value === ',';
        if (fromClause(tokens, at) || joined && (inFrom || usingAt < 0 && keyword(token, 'join'))) {
          const before = own.length, next = relation(at + 1, command === 'delete' && !targetBinding, relationEnd, joined, collectRootJoins ? joins : undefined);
          if (collectRootJoins && joined) recordJoin(joins, before, at);
          lastJoin = inFrom && joined && own.length > before ? at : undefined;
          if (command === 'delete' && !targetBinding) targetBinding = own[0];
          inFrom = true;
          if (next > at + 1) at = next - 1;
          continue;
        }
        if (collectRootJoins && inFrom && keyword(token, 'using') && tokens[at + 1]?.value === '(') {
          readPreviousUsing(joins, at, relationEnd);
        }
        if (inFrom && keyword(token, 'on')) { noteCondition(lastJoin, at, relationEnd); lastJoin = undefined; }
        if (keyword(token, 'using')) lastJoin = undefined;
        if (['where', 'group', 'having', 'order', 'limit', 'returning', 'set', 'values', 'window'].some(word => keyword(token, word))) inFrom = false;
      }
      if (groupUsing) {
        if (!groupUsingIsolated && hasRightOrFull(head, end, base)) groupUsing.uniqueLeft = true;
        return { bindings: [], ctes: new Map(), syntax: ['column'], using: groupUsing };
      }
      if (usingAt >= 0) {
        if (!inFrom) fail('using');
        return { bindings: [], ctes: new Map(), syntax: ['column'], using: usingProjection(own.filter(binding => binding !== targetBinding), joins, usingAt, head, end, base) };
      }
      if (projectionOnly) {
        if (relationContext || aliasContext) fail('relation');
        const owners = new Map<Binding, number>();
        for (let at = 0; at < own.length; at++) {
          const group = groupedOperands.get(own[at]);
          if (!group) continue;
          for (const member of own.slice(at, at + group.size)) owners.set(member, group.group);
          at += group.size - 1;
        }
        const inputs: JoinStarInput[] = owners.size || localPlan || own.some(binding => binding.projectionSource) ? joinInputs(own, joins).map(({ input, join }) => ({
          ...input, ...(join?.rightOrFull ? { outer: join.full ? 'full' : 'right' } : {}),
        })) : [];
        const joinStarScope = inputs.length ? { groups, owners, inputs, uniqueLeft: uniqueJoinLeft(joins, head, end, base) } : undefined;
        return { bindings: own, ctes, syntax: ['column'], ...(joinStarScope ? { joinStarScope } : {}) };
      }
      // 函数实参使用已绑定的输入和相关外层。自身返回列及此后才加入的关系留在调用外。
      const scoped = groupScope ?? own;
      const visibleOwn = argumentBinding ? scoped.slice(0, scoped.indexOf(argumentBinding)).filter(binding => binding !== targetBinding) : [...scoped];
      const sourceCount = visibleOwn.length;
      for (let at = 0; at < sourceCount; at++) {
        const group = groupedOperands.get(visibleOwn[at]);
        if (!group || at + group.size > sourceCount) continue;
        if (group.alias) visibleOwn.push(group.alias);
        at += group.size - 1;
      }
      if (activeOn?.outer) {
        const { on } = activeOn;
        for (const [index, binding] of visibleOwn.entries()) {
          if (binding.start > on) visibleOwn[index] = { ...binding, afterOuterJoin: true };
        }
      }
      // 子查询只继承真正可相关的外层binding；FROM派生表与CTE体不得看到外层行别名。
      const nested = subqueryAt(tokens, head, end, offset, source.length);
      if (nested) return scope(nested.start, nested.end, ctes, derived.some(item => item.start === nested.start) ? [] : [...visibleOwn, ...outer], level + 1);
      if (command === 'select' && windowPrior >= head) {
        const window = namedWindowContext(source, tokens, head, end, windowPrior, target);
        if (window) {
          if (qualifiers.length || tokens[windowPrior + 2]?.kind === 'symbol' && tokens[windowPrior + 2].value === '.') fail('window-qualified');
          const prefix = fold(target.prefix);
          if (intent === 'definition') {
            const raw = fold(source.slice(target.start, target.end));
            const name = window.definitions.find(token => fold(source.slice(token.start, token.end)) === raw);
            if (!name) fail('definition');
            return { bindings: [], ctes: new Map(), syntax: ['column'], windowDefinition: { start: name.start, end: name.end } };
          }
          if (intent) fail('window-target');
          const names = window.definitions.filter(token => fold(token.value).startsWith(prefix)).map(token => ({
            name: token.value,
            ...(token.quoted ? { quote: source[token.start] as SqliteWindowName['quote'] } : {}),
          }));
          return { bindings: [], ctes: new Map(), syntax: ['keyword'], windowNames: { names, ...(window.inline ? { inline: true } : {}) } };
        }
      }
      const aliases = new Set<string>();
      for (const [index, binding] of visibleOwn.entries()) {
        const name = fold(binding.relation.alias ?? binding.relation.name);
        if (!name) continue;
        const matches = visibleOwn.slice(0, index).filter(previous => fold(previous.relation.alias ?? previous.relation.name) === name);
        for (const previous of matches) {
          if (binding.group?.members.includes(previous)) continue;
          if (!((qualifiers.length === 2 || (intent === 'definition' || intent === 'object') && qualifiers.length === 1 && ['main', 'temp'].includes(fold(qualifiers[0]))) && binding.relation.kind === 'physical' && previous.relation.kind === 'physical' && !binding.relation.alias && !previous.relation.alias && !!binding.relation.schema && !!previous.relation.schema && binding.relation.schema !== previous.relation.schema)) fail('ambiguous');
        }
        aliases.add(name);
      }
      const lexicalBindings = [...visibleOwn.filter(binding => binding.relation.name), ...outer.filter(binding => !aliases.has(fold(binding.relation.alias ?? binding.relation.name)))];
      let bindings = lexicalBindings.filter(binding => !binding.afterOuterJoin || intent === 'hover' && !qualifiers.length);
      if (aliasContext && intent !== 'object') fail('alias');
      let unqualified = false;
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
      for (let at = head; at < end; at++) if (keyword(tokens[at], 'using') && tokens[at + 1]?.value === '(' && offset >= tokens[at + 1].end && offset <= (tokens[tokens[at + 1].pair ?? end]?.start ?? source.length)) fail('using');
      const priorTokens = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start);
      if (keyword(priorTokens.at(-1), 'by') && keyword(priorTokens.at(-2), 'indexed')) fail('index');
      if (!relationContext) {
        const prior = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start).at(-1);
        relationContext = !!prior && ['from', 'join', 'update', 'into'].some(word => keyword(prior, word)) || !!prior && prior.value === ',' && inFrom;
      }
      let outputAliases: OutputAliasHints | undefined;
      if (command === 'select' && !relationContext && !qualifiers.length && !argumentBinding && !groupScope && (!intent || intent === 'hover')) {
        const context = outputAliasContext(tokens, head, end, target, activeOn);
        const items = context || intent === 'hover' ? projectionItems(tokens, head, end) : [];
        if (intent === 'hover' && items.some(({ alias }) => alias?.start === target.start && alias.end === target.end)) fail('output-alias');
        if (context) {
          const lateInputs = context.clause === 'on' && visibleOwn.some(binding => binding.afterOuterJoin);
          const seen = new Set<string>(), names: string[] = [];
          for (const { alias, expression } of items) {
            if (!alias || !expression) continue;
            const key = fold(alias.value);
            if (seen.has(key)) continue;
            seen.add(key);
            if (alias.value.length <= limits.nameUnits && key.startsWith(fold(target.prefix)) && allowedOutputAlias(context.clause, expression, tokens) &&
              (!lateInputs || aliasUsesJoinInputs(expression, visibleOwn))) names.push(alias.value);
          }
          if (names.length) {
            // 无名派生表未进入限定字段目录，连接组的重名后缀也可能与输出别名冲突。
            const sourcesIncomplete = visibleOwn.some(binding => binding.unknown || !binding.relation.name) ||
              names.some(name => /:\d+$/.test(name)) && visibleOwn.some(binding => binding.nestedProjection);
            outputAliases = { ...context, names, scopeDepth: level, ...(sourcesIncomplete ? { sourcesIncomplete: true } : {}) };
            // 后续表仍可能抢占未限定的别名。仅为同层别名消歧保留其目录身份。
            if (lateInputs && !intent) bindings = lexicalBindings.filter(binding => !binding.afterOuterJoin || binding.level === level);
          }
        }
      }
      const unknown = bindings.some(binding => binding.unknown && (!qualifiers.length || fold(binding.relation.alias ?? binding.relation.name) === fold(qualifiers[0])));
      if (intent !== 'definition' && intent !== 'object' && !relationContext && unknown && !outputAliases) fail('local-output');
      return { bindings, ctes, syntax: relationContext ? ['relation', 'keyword'] : ['column', 'keyword'], ...(outputAliases ? { outputAliases } : {}) };
    }
    const parsed = scope(statement.start, statement.end, new Map(), [], 0);
    if (parsed.windowDefinition) {
      definitionKind?.('window');
      return { status: 'ready', target, syntax: parsed.syntax, qualifiers, relations: [], definition: parsed.windowDefinition };
    }
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
        const matches = parsed.bindings.filter(({ relation }) => sqliteCompletionRelationMatches(relation, [...qualifiers, target.prefix]) &&
          (!qualifiers.length || relation.kind === 'physical' && relation.schema === fold(qualifiers[0])));
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
    const columnIntent = (!intent || intent === 'hover') && parsed.syntax.includes('column');
    const alias = columnIntent ? parsed.bindings.find(binding => binding.group && qualifiers.length === 1 && fold(binding.relation.name) === fold(qualifiers[0])) : undefined;
    const relations = [...parsed.bindings.map(binding => {
      const { relation, projectionSource, afterOuterJoin } = binding;
      const projection = columnIntent && !alias && projectionSource && relation.kind === 'local' && (!qualifiers.length ||
        qualifiers.length === 1 && fold(relation.alias ?? relation.name) === fold(qualifiers[0])) ? compileProjection(projectionSource) : undefined;
      return { ...relation, ...(intent === 'hover' || parsed.outputAliases ? { scopeDepth: binding.level! } : {}),
        ...(afterOuterJoin ? { afterOuterJoin } : {}), ...(projection === undefined ? {} : { projection }) };
    }), ...declarations];
    if (relations.filter(relation => relation.kind !== 'local' || relation.source !== 'group').length > limits.relations) fail('budget');
    if (parsed.syntax.includes('relation') && qualifiers.some(name => !['main', 'temp'].includes(fold(name))) || qualifiers.length === 2 && !['main', 'temp'].includes(fold(qualifiers[0]))) fail('schema');
    const joinGroup: QualifiedJoinGroup | undefined = alias?.group ? {
      alias: alias.relation.name, groups: resolveGroups(compactJoinGroups(alias.group.groups, [{ group: alias.group.root }]).groups),
    } : undefined;
    return { status: 'ready', target, syntax: parsed.syntax, qualifiers, relations,
      ...(parsed.output ? { output: parsed.output } : {}), ...(parsed.outputAliases ? { outputAliases: parsed.outputAliases } : {}),
      ...(parsed.windowNames ? { windowNames: parsed.windowNames } : {}),
      ...(parsed.using ? { using: parsed.using } : {}), ...(joinGroup ? { joinGroup } : {}),
      ...(localProjections.length ? { localProjections } : {}),
      ...(parsed.unqualified ? { unqualifiedColumns: true } : {}), ...(parsed.writable ? { writableColumns: true } : {}), ...(definition ? { definition } : {}) };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && /^[a-z-]{1,64}$/.test(reason.message) ? reason.message : 'analysis' }; }
}

const nameSchema = z.string().min(1).max(limits.nameUnits).refine(unicode);
const columnNames = z.array(nameSchema).max(limits.entries).refine(columns => new Set(columns.map(fold)).size === columns.length);
const outputSource = sqliteCompletionSourceSchema;
const outputSources = z.array(outputSource)
  .max(limits.relations).refine(sources => new Set(sources.map(sqliteCompletionSourceKey)).size === sources.length);
const projectionIndex = z.number().int().min(0).max(limits.relations - 1);
const joinOperand = z.union([z.object({ source: outputSource }).strict(), z.object({ columns: columnNames }).strict(),
  z.object({ group: z.number().int().min(0).max(limits.relations - 2) }).strict(), z.object({ projection: projectionIndex }).strict()]);
const joinInput = z.object({ operand: joinOperand, merged: z.union([z.literal(true), columnNames]).optional(), binding: nameSchema.optional() }).strict();
const joinGroupList = z.array(z.object({ inputs: z.array(joinInput).min(2).max(limits.relations), uniqueLeft: z.literal(true).optional() }).strict())
  .max(limits.relations - 1);
const joinGroups = joinGroupList.min(1);
function validJoinGroups(groups: SqliteJoinGroup[], roots: SqliteJoinOperand[], projectionBound = 0): boolean {
  const references = new Set<number>();
  let leaves = 0;
  // 每个子组在其父节点之前登记且只被引用一次，最大深度由已验证的组数限制。
  function valid(operand: SqliteJoinOperand, bound: number) {
    if ('projection' in operand) return operand.projection < projectionBound && ++leaves <= limits.relations;
    if (!('group' in operand)) return ++leaves <= limits.relations;
    if (operand.group >= bound || references.has(operand.group)) return false;
    references.add(operand.group);
    return true;
  }
  return groups.every(({ inputs }, index) => inputs[0]?.merged === undefined && inputs.every(({ operand, binding }) =>
    (!binding || !('group' in operand)) && valid(operand, index))) && roots.every(operand => valid(operand, groups.length)) && references.size === groups.length;
}
const usingProjection = z.object({ left: z.array(joinInput).min(1).max(limits.relations - 1), right: joinOperand,
  used: columnNames, uniqueLeft: z.literal(true).optional(), groups: joinGroups.optional(), starGroupSides: z.enum(['left', 'right', 'both']).optional(),
}).strict().refine(({ left, right, groups = [], uniqueLeft, starGroupSides }) => {
  if (starGroupSides && (!uniqueLeft || starGroupSides !== 'right' && !left.some(({ operand }) => 'group' in operand) ||
    starGroupSides !== 'left' && !('group' in right))) return false;
  return left[0]?.merged === undefined && left.every(input => !input.binding) && validJoinGroups(groups, [...left.map(({ operand }) => operand), right], limits.relations);
});
const qualifiedGroup = z.object({ alias: nameSchema, groups: joinGroups }).strict()
  .refine(({ groups }) => validJoinGroups(groups, [{ group: groups.length - 1 }], limits.relations));
const starSchema = z.object({ groups: joinGroupList, all: z.array(joinInput.extend({ outer: z.enum(['right', 'full']).optional() })).min(1).max(limits.relations).optional(),
  members: z.array(z.object({ group: z.number().int().min(0).max(limits.relations - 2), binding: nameSchema }).strict()).min(1).max(limits.relations).optional(),
  sole: z.literal(true).optional(), uniqueLeft: z.literal(true).optional(),
}).strict();
function validJoinStars({ groups, all, members = [], sole, uniqueLeft }: SqliteJoinStars, projectionBound = 0): boolean {
  if ((!all && !members.length) || (!all && uniqueLeft) || (all && (!!sole !== (all.length === 1) || all[0]?.merged || all[0]?.outer ||
    all.some(input => input.binding || input.outer && !uniqueLeft)))) return false;
  const memberKeys = new Set(members.map(({ group, binding }) => group + '\0' + fold(binding)));
  if (memberKeys.size !== members.length) return false;
  const inputs = all?.map(({ operand }) => operand) ?? [];
  const allGroups = inputs.flatMap(operand => 'group' in operand ? [operand.group] : []);
  const selectedGroups = new Set(allGroups);
  if (selectedGroups.size !== allGroups.length) return false;
  if (all && members.some(({ group }) => !selectedGroups.has(group))) return false;
  for (const { group } of members) selectedGroups.add(group);
  if (sole && groups.length && selectedGroups.size !== 1) return false;
  const roots = [...inputs.filter(operand => !('group' in operand)), ...[...selectedGroups].map(group => ({ group }))];
  return validJoinGroups(groups, roots, projectionBound);
}
const joinStars = starSchema.refine(star => (star.groups.length > 0 || star.all?.some(({ operand }) => 'projection' in operand)) && validJoinStars(star, limits.relations));
function starOperands(star: SqliteJoinStars): SqliteJoinOperand[] {
  return [...(star.all ?? []), ...star.groups.flatMap(group => group.inputs)].map(({ operand }) => operand);
}
const localProjectionSchema = z.array(z.array(z.union([z.object({ name: nameSchema }).strict(),
  z.object({ star: starSchema }).strict(), z.object({ unknown: z.literal(true) }).strict()])).min(1).max(limits.entries)).min(1).max(limits.relations)
  .refine(projections => {
    const catalog = new Set<string>();
    return projections.every((parts, index) => parts.every(part => {
      if (!('star' in part)) return true;
      if (!validJoinStars(part.star, index)) return false;
      for (const operand of starOperands(part.star)) if ('source' in operand) catalog.add(sqliteCompletionSourceKey(operand.source));
      return catalog.size <= limits.relations;
    }));
  });
const outputProjection = z.object({ columns: columnNames, sources: outputSources,
  projections: z.array(projectionIndex).min(1).max(limits.relations).optional(),
  joinStars: z.array(joinStars).min(1).max(limits.relations).optional(), incomplete: z.literal(true).optional(),
}).strict().refine(({ sources, joinStars = [], projections = [] }) => {
  if (new Set(projections).size !== projections.length) return false;
  const catalog = new Set(sources.map(sqliteCompletionSourceKey));
  let count = 0;
  for (const star of joinStars) {
    count += star.groups.length;
    for (const operand of starOperands(star)) {
      if ('source' in operand) catalog.add(sqliteCompletionSourceKey(operand.source));
    }
  }
  return count < limits.relations && catalog.size <= limits.relations;
});
const outputAliasSchema = z.object({ clause: z.enum(['order', 'group', 'having', 'where', 'on']), names: columnNames, scopeDepth: z.number().int().min(0).max(limits.depth),
  outputFirst: z.literal(true).optional(), sourcesIncomplete: z.literal(true).optional(),
}).strict().refine(value => value.names.length > 0 && (!value.outputFirst || value.clause === 'order'));
const windowNameSchema = z.object({ names: z.array(z.object({ name: nameSchema, quote: z.enum(['"', '`', '[']).optional() }).strict().refine(({ name, quote }) =>
  quote === '[' ? !name.includes(']') : quote !== undefined || idStart(String.fromCodePoint(name.codePointAt(0)!)) && Array.from(name).every(idPart),
)).max(limits.entries), inline: z.literal(true).optional() }).strict().refine(({ names }) =>
  new Set(names.map(({ name, quote }) => (quote ?? '') + '\0' + fold(name))).size === names.length,
);
const relationSchema = z.discriminatedUnion('kind', [
  outputSource.extend({ kind: z.literal('physical'), alias: nameSchema.optional(), visibleColumnsOnly: z.literal(true).optional(), scopeDepth: z.number().int().min(0).max(limits.depth).optional(), afterOuterJoin: z.literal(true).optional(), insertRole: z.enum(['upsert-target', 'excluded', 'insert-returning']).optional() }),
  z.object({ kind: z.literal('local'), source: z.enum(['cte', 'derived', 'group']), name: nameSchema, alias: nameSchema.optional(), columns: columnNames,
    declaration: z.literal(true).optional(), scopeDepth: z.number().int().min(0).max(limits.depth).optional(), projection: projectionIndex.optional(), afterOuterJoin: z.literal(true).optional() }).strict(),
]);
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), reason: z.string().regex(/^[a-z-]{1,64}$/) }).strict(),
  z.object({ status: z.literal('ready'), target: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), prefix: z.string().max(limits.nameUnits).refine(unicode), quoted: z.boolean() }).strict(), syntax: z.array(z.enum(['relation', 'column', 'keyword'])).min(1).max(3).refine(value => new Set(value).size === value.length), qualifiers: z.array(nameSchema).max(2), relations: z.array(relationSchema).max(limits.relations * 2 - 1), output: outputProjection.optional(), outputAliases: outputAliasSchema.optional(), windowNames: windowNameSchema.optional(), using: usingProjection.optional(), joinGroup: qualifiedGroup.optional(), localProjections: localProjectionSchema.optional(), unqualifiedColumns: z.literal(true).optional(), writableColumns: z.literal(true).optional(), definition: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional() }).strict(),
]);
/** Client只核有界回包形状与原范围，不在渲染线程重新解析整份用户SQL。 */
export function validateSqliteCompletionAnalysis(raw: unknown, source: string, offset: number, intent?: SqliteAnalysisIntent): SqliteCompletionAnalysis {
  const value = resultSchema.parse(raw) as SqliteCompletionAnalysis;
  if (new TextEncoder().encode(JSON.stringify(value)).length > limits.outputBytes) fail('budget');
  if (value.status === 'blocked') return value;
  if (value.output && !(value.output.columns.length || value.output.sources.length || value.output.projections?.length || value.output.joinStars?.length || value.output.incomplete) ||
    value.output && value.using) fail('response');
  if ((value.output || value.using) && (intent || value.relations.length || value.qualifiers.length || value.unqualifiedColumns ||
    value.syntax.length !== 1 || value.syntax[0] !== 'column')) fail('response');
  if (value.outputAliases && (intent === 'definition' || intent === 'object' || value.qualifiers.length || value.unqualifiedColumns ||
    value.output || value.using || value.joinGroup || !value.syntax.includes('column') || value.syntax.includes('relation') ||
    value.outputAliases.names.some(name => !fold(name).startsWith(fold(value.target.prefix))))) fail('response');
  if (value.windowNames && (intent || value.qualifiers.length || value.relations.length || value.output || value.outputAliases || value.using ||
    value.joinGroup || value.unqualifiedColumns || value.localProjections || value.syntax.length !== 1 || value.syntax[0] !== 'keyword' ||
    value.windowNames.names.some(({ name }) => !fold(name).startsWith(fold(value.target.prefix))))) fail('response');
  const writeBindings = value.relations.filter((relation): relation is Extract<SqliteCompletionRelation, { kind: 'physical' }> => relation.kind === 'physical' && relation.insertRole !== undefined);
  const incoming = writeBindings.filter(relation => relation.insertRole === 'excluded');
  const targets = writeBindings.filter(relation => relation.insertRole !== 'excluded');
  if (incoming.length > 1 || targets.length > 1 || writeBindings.some(relation => relation.tableFunction || relation.afterOuterJoin ||
    relation.insertRole === 'excluded' && relation.alias !== 'excluded' || relation.insertRole === 'insert-returning' && relation.alias !== undefined) ||
    incoming.length && targets.some(relation => relation.insertRole !== 'upsert-target' || fold(relation.alias ?? relation.name) === 'excluded' ||
      sqliteCompletionSourceKey(relation) !== sqliteCompletionSourceKey(incoming[0]))) fail('response');
  if (value.writableColumns && (!value.unqualifiedColumns || value.relations.length !== 1 || value.relations[0].kind !== 'physical' ||
    value.relations[0].tableFunction || value.relations[0].insertRole === 'excluded' || value.relations[0].insertRole === 'insert-returning' ||
    value.syntax.length !== 1 || value.syntax[0] !== 'column' || value.output || value.using || value.windowNames)) fail('response');
  const groupRelations = value.relations.filter((relation): relation is Extract<SqliteCompletionRelation, { kind: 'local' }> =>
    relation.kind === 'local' && relation.source === 'group');
  if (value.relations.length - groupRelations.length > limits.relations || groupRelations.length >= limits.relations ||
    groupRelations.some(relation => relation.columns.length || relation.alias !== relation.name)) fail('response');
  const qualified = value.qualifiers.length === 1 && groupRelations.find(relation => fold(relation.name) === fold(value.qualifiers[0]));
  if (value.joinGroup ? !qualified || value.joinGroup.alias !== qualified.name || intent === 'definition' || intent === 'object' ||
    !value.syntax.includes('column') || value.output || value.using || value.unqualifiedColumns : qualified && (!intent || intent === 'hover') && value.syntax.includes('column')) fail('response');
  const localProjections = value.localProjections ?? [], visited = new Set<number>(), catalog = new Set<string>();
  function consume(operand: SqliteJoinOperand) {
    if ('projection' in operand) visit(operand.projection);
    else if ('source' in operand) catalog.add(sqliteCompletionSourceKey(operand.source));
  }
  function visit(index: number) {
    if (index >= localProjections.length) fail('response');
    if (visited.has(index)) return;
    visited.add(index);
    for (const part of localProjections[index]) if ('star' in part) {
      for (const operand of starOperands(part.star)) consume(operand);
    }
  }
  if (value.using) {
    consume(value.using.right);
    for (const { operand } of value.using.left) consume(operand);
  }
  for (const group of value.using?.groups ?? value.joinGroup?.groups ?? []) {
    for (const { operand } of group.inputs) consume(operand);
  }
  for (const source of value.output?.sources ?? []) consume({ source });
  for (const projection of value.output?.projections ?? []) visit(projection);
  for (const star of value.output?.joinStars ?? []) for (const operand of starOperands(star)) consume(operand);
  for (const relation of value.relations) if (relation.kind === 'local' && relation.projection !== undefined) {
    if (intent === 'definition' || intent === 'object' || !value.syntax.includes('column') || value.joinGroup || value.using || value.output ||
      relation.source === 'group' || relation.declaration || relation.columns.length || value.qualifiers.length > 1 ||
      value.qualifiers.length === 1 && fold(value.qualifiers[0]) !== fold(relation.alias ?? relation.name)) fail('response');
    visit(relation.projection);
  }
  if (visited.size !== localProjections.length || catalog.size > limits.relations) fail('response');
  if (value.relations.some(relation => relation.kind === 'local' && relation.declaration && relation.source !== 'cte')) fail('response');
  const aliasDepth = value.outputAliases?.scopeDepth;
  if (value.relations.some(relation => {
    const needsDepth = (relation.kind !== 'local' || !relation.declaration) && (intent === 'hover' || aliasDepth !== undefined);
    if (needsDepth !== (relation.scopeDepth !== undefined)) return true;
    if (relation.afterOuterJoin && (!needsDepth || value.qualifiers.length || intent !== 'hover' &&
      (value.outputAliases?.clause !== 'on' || relation.scopeDepth !== aliasDepth))) return true;
    return aliasDepth !== undefined && relation.scopeDepth !== undefined && relation.scopeDepth > aliasDepth;
  })) fail('response');
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
