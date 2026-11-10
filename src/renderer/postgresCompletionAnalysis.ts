import { postgresCompletionLimits as limits, type PostgresCompletionReference, type PostgresRoutineCompletionTarget } from '../shared/postgresCompletion';
import { currentPostgresStatement, scanPostgresEditorTokens, type PostgresEditorToken } from '../shared/postgresSql';
import type { LocalReferenceRange, LocalReferences } from '../shared/localReferences';
import { planLocalRename, type LocalRename } from '../shared/localRename';

type Group = { kind: 'group'; start: number; end: number; closed: boolean; closing: ')' | ']'; parts: Part[] };
type Part = PostgresEditorToken | Group;
interface Projection { names: (string | null)[]; stars: PostgresCompletionReference[]; exact: boolean; declaration?: LocalReferenceRange; }
export interface PostgresCompletionRelation extends PostgresCompletionReference { alias?: string; projection?: Projection; }
interface ScopedRelation extends PostgresCompletionRelation { declaration?: LocalReferenceRange; usingColumns?: string[]; }
interface ReferenceTrace {
  edges: Map<PostgresEditorToken, LocalReferenceRange>;
  declarations: Map<number, 'alias' | 'cte'>;
  implicitNames: Map<number, Set<string>>;
  unsupported: boolean;
}
interface RelationSpan { end: number; relation: number; }
type Scope = ReadonlyMap<string, Projection>;
type Query = { kind: 'relations'; schema?: string; ctes?: string[] } |
  { kind: 'columns'; relations: PostgresCompletionRelation[]; qualified: boolean };
export interface PostgresCompletionAnalysis {
  start: number;
  end: number;
  prefix: string;
  quoted: boolean;
  query?: Query;
  routine?: PostgresRoutineCompletionTarget;
  existingCall?: boolean;
}
const entries = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO']);
const endsFrom = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'RETURNING',
  'SET', 'VALUES', 'WINDOW', 'FOR']);
const setOperators = new Set(['UNION', 'EXCEPT', 'INTERSECT']);
const stop = new Set([...entries, ...endsFrom, ...setOperators, 'ON', 'USING', 'CROSS', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'NATURAL', 'AS', 'WITH', 'SELECT', 'TABLESAMPLE', 'OVERRIDING',
  'CONFLICT', 'DO', 'NULLS', 'DISTINCT', 'LATERAL', 'ONLY', 'END', 'COLLATE', 'TRUE', 'FALSE', 'NULL']);
const commands = new Set(['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'VALUES', 'WITH', 'CALL']);
const expressionEntries = new Set(['SELECT', 'WHERE', 'HAVING', 'ON', 'RETURNING', 'VALUES', 'WHEN', 'THEN', 'ELSE',
  'AND', 'OR', 'NOT', 'BY', 'DISTINCT', 'ALL']);
const expressionOperators = new Set(['(', '[', ',', '=', '+', '-', '*', '/', '%', '<', '>', '|', '&', '^', '~']);
const unknown: Projection = { names: [], stars: [], exact: false };
const referenceCommands = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE']);
const unsupportedReferenceSyntax = new Set(['TABLESAMPLE', 'SEARCH', 'CYCLE', 'XMLTABLE', 'JSON_TABLE']);

/** PostgreSQL 未引用标识符折叠 ASCII 大写字母，引用名称保留原大小写。 */
const identifier = (part?: Part) => part?.kind === 'identifier' && !part.open ? part.text
  : part?.kind === 'word' ? part.text.replace(/[A-Z]/g, char => char.toLowerCase()) : undefined;
const keyword = (part?: Part) => part?.kind === 'word' ? part.text.toUpperCase() : '';
const punct = (part: Part | undefined, value: string) => part?.kind === 'punct' && part.text === value;
const contains = (part: Group, offset: number) => part.start < offset && (part.closed ? offset < part.end : offset <= part.end);

/** 只建当前语句的括号树，保留未闭合括号以处理编辑中的 SQL。 */
function groupStatement(tokens: PostgresEditorToken[], offset: number, length: number, strict = false): Part[] | undefined {
  const root: Part[] = [];
  const stack: Group[] = [];
  for (const token of tokens) {
    if (token.kind === 'blocked' && token.text === 'comment') continue;
    if (!stack.length && punct(token, ';')) {
      if (token.start >= offset) break;
      if (strict) return;
      root.length = 0;
      continue;
    }
    if (stack.length && punct(token, stack.at(-1)!.closing)) {
      const group = stack.pop()!;
      group.end = token.end;
      group.closed = true;
      continue;
    }
    if (strict && [')', ']', ';'].some(value => punct(token, value))) return;
    const current = stack.at(-1)?.parts ?? root;
    if (punct(token, '(') || punct(token, '[')) {
      if (stack.length >= 24) return;
      const group: Group = { kind: 'group', start: token.start, end: length, closed: false,
        closing: punct(token, '(') ? ')' : ']', parts: [] };
      current.push(group);
      stack.push(group);
    } else current.push(token);
  }
  return strict && stack.length ? undefined : root;
}

/** 位置别名覆盖已知输出；通配展开缺少位置时只保留显式声明。 */
function rename(projection: Projection, names: string[]): Projection {
  if (!names.length) return projection;
  return {
    names: [...names, ...(projection.exact ? projection.names.slice(names.length) : [])].slice(0, limits.items),
    stars: [],
    exact: projection.exact,
  };
}

/** 列名列表必须由完整标识符和逗号组成。 */
function nameList(group?: Part): string[] {
  if (group?.kind !== 'group' || group.closing !== ')' || !group.closed || group.parts.length % 2 !== 1) return [];
  const names: string[] = [];
  for (let i = 0; i < group.parts.length; i += 2) {
    const name = identifier(group.parts[i]);
    if (!name || name.length > limits.name || i && !punct(group.parts[i - 1], ',')) return [];
    names.push(name);
  }
  return names;
}

/** 关系入口与 FROM 清单边界沿同一规则识别。 */
function relationEntry(parts: Part[], index: number): boolean {
  const word = keyword(parts[index]);
  return entries.has(word) &&
    !(word === 'FROM' && keyword(parts[index - 1]) === 'DISTINCT') &&
    !(word === 'UPDATE' && index !== 0) &&
    !(word === 'INTO' && keyword(parts[0]) !== 'INSERT');
}

/** 写入目标只能是实际表，WITH 同名定义只参与读取位置。 */
function writeTarget(parts: Part[], index: number): boolean {
  const word = keyword(parts[index]);
  return word === 'UPDATE' || word === 'INTO' || word === 'FROM' && index === 1 && keyword(parts[0]) === 'DELETE';
}

interface QueryContext {
  offset: number;
  start: number;
  left: PostgresEditorToken[];
}
interface Parsed { projection: Projection; query?: Query; routine?: PostgresRoutineCompletionTarget; }

/** 只接受一个 schema 限定符，关系别名和赋值左侧继续由字段补全处理。 */
function expressionRoutine(main: Part[], left: PostgresEditorToken[], cursorGroup: Part | undefined,
  refs: PostgresCompletionRelation[][]): PostgresRoutineCompletionTarget | undefined {
  const dotted = punct(left.at(-1), '.');
  const schema = dotted ? identifier(left.at(-2)) : undefined;
  if (dotted && (!schema || refs.some(level => level.some(ref => (ref.alias ?? ref.name) === schema)))) return;
  const before = left.at(dotted ? -3 : -1);
  if (!before || !(expressionEntries.has(keyword(before)) || (before.kind === 'punct' && expressionOperators.has(before.text)))) return;
  const command = keyword(main[0]);
  if (cursorGroup) {
    const index = main.indexOf(cursorGroup);
    if (keyword(main[index - 1]) === 'USING' || (command === 'INSERT' &&
        !main.slice(0, index).some(part => ['VALUES', 'SELECT', 'RETURNING'].includes(keyword(part))))) return;
  } else if (command === 'UPDATE') {
    const preceding = main.filter(part => part.end <= before.end);
    const set = preceding.findIndex(part => keyword(part) === 'SET');
    if (set >= 0 && !preceding.slice(set + 1).some(part => ['WHERE', 'RETURNING', 'FROM'].includes(keyword(part)))) {
      const reversed = preceding.slice(set + 1).reverse();
      const separator = reversed.findIndex(part => punct(part, ','));
      if (!reversed.slice(0, separator < 0 ? undefined : separator).some(part => punct(part, '='))) return;
    }
  }
  return { context: 'expression', ...(schema ? { schema } : {}) };
}

/** 收集确定的投影名称，并将单源通配符的目录读取留给现有只读接口。 */
function project(parts: Part[], refs: PostgresCompletionRelation[]): Projection {
  const row = parts[1];
  if (keyword(parts[0]) === 'VALUES' && row?.kind === 'group' && row.closed && row.parts.length) {
    const count = 1 + row.parts.filter(part => punct(part, ',')).length;
    return { names: Array.from({ length: Math.min(count, limits.items) }, (_, i) => 'column' + (i + 1)),
      stars: [], exact: count <= limits.items };
  }
  const select = keyword(parts[0]) === 'SELECT';
  const returning = parts.findIndex(part => keyword(part) === 'RETURNING');
  if (!select && returning < 0) return unknown;
  let start = select ? 1 : returning + 1;
  if (select && ['ALL', 'DISTINCT'].includes(keyword(parts[start]))) start++;
  if (select && keyword(parts[start]) === 'ON' && parts[start + 1]?.kind === 'group') start += 2;
  const names: (string | null)[] = [];
  const stars: PostgresCompletionReference[] = [];
  const mergedJoinColumns = parts.some(part => ['NATURAL', 'USING'].includes(keyword(part)));
  let exact = true;
  let end = start;
  while (end <= parts.length) {
    const word = keyword(parts[end]);
    const done = end === parts.length || word === 'FROM' && keyword(parts[end - 1]) !== 'DISTINCT' || endsFrom.has(word);
    if (!done && !punct(parts[end], ',')) { end++; continue; }
    const column = parts.slice(start, end);
    const last = column.at(-1);
    const tail = identifier(last);
    const explicit = keyword(column.at(-2)) === 'AS';
    const path = column.length % 2 === 1 && column.every((part, i) =>
      i % 2 ? punct(part, '.') : !!identifier(part) && !stop.has(keyword(part)));
    const prior = column.at(-2);
    const implicit = column.length === 2 && (prior?.kind === 'group' || prior?.kind === 'blocked' ||
      (!!identifier(prior) && !stop.has(keyword(prior))) || (prior?.kind === 'punct' && /^[0-9]$/.test(prior.text))) ||
      column.length === 3 && prior?.kind === 'group' && !!identifier(column[0]);
    if (punct(last, '*')) {
      const owner = identifier(column.at(-3));
      const schema = column.length === 5 ? identifier(column[0]) : undefined;
      const match = column.length === 1 && !select ? refs.slice(0, 1)
        : column.length === 1 && !mergedJoinColumns ? refs : punct(column.at(-2), '.') && owner &&
        (column.length === 3 || schema && punct(column[1], '.')) ? refs.filter(ref => schema
          ? !ref.alias && ref.name === owner && ref.schema === schema : (ref.alias ?? ref.name) === owner) : [];
      if (match.length && (column.length === 1 || match.length === 1)) {
        for (const ref of match) {
          if (ref.projection) {
            names.push(...ref.projection.names);
            stars.push(...ref.projection.stars);
            exact &&= ref.projection.exact;
          } else {
            stars.push({ name: ref.name, ...(ref.schema ? { schema: ref.schema } : {}) });
            exact = false;
          }
        }
      } else exact = false;
    } else if (tail && tail.length <= limits.name && (explicit || (path || implicit) && !stop.has(keyword(last)))) {
      names.push(tail);
    } else if (column.length) names.push(null);
    if (done) break;
    start = ++end;
  }
  return { names: names.slice(0, limits.items), stars: stars.length <= limits.relations ? stars : [],
    exact: exact && names.length <= limits.items };
}

/** 在当前查询层或可关联的外层查找限定名，当前层同名别名遮蔽外层。 */
function columns(refs: PostgresCompletionRelation[], outer: PostgresCompletionRelation[][], left: PostgresEditorToken[]): Query | undefined {
  if (punct(left.at(-1), '.')) {
    const qualifier = identifier(left.at(-2));
    if (!qualifier) return;
    const schema = punct(left.at(-3), '.') ? identifier(left.at(-4)) : undefined;
    for (const level of [refs, ...outer]) {
      const matches = level.filter(ref => schema ? !ref.alias && ref.schema === schema && ref.name === qualifier : (ref.alias ?? ref.name) === qualifier);
      if (matches.length) return matches.length === 1 ? { kind: 'columns', relations: matches, qualified: true } : undefined;
    }
    return;
  }
  const level = refs.length ? refs : outer.find(group => group.length) ?? [];
  const names = level.map(ref => ref.alias ?? (ref.schema ? JSON.stringify([ref.schema, ref.name]) : ref.name));
  if (level.length && level.length <= limits.relations && (level.length === 1 || names.every(Boolean) && new Set(names).size === level.length)) {
    return { kind: 'columns', relations: level, qualified: false };
  }
}

/** 只索引表达式中的关系限定符，排除三段名称、类型、排序规则和模式限定的函数。 */
function traceQualifier(parts: Part[], i: number, visible: ScopedRelation[][], trace: ReferenceTrace): void {
  const token = parts[i], member = parts[i + 2], following = parts[i + 3];
  const name = identifier(token);
  if (!name || token.kind === 'group' || stop.has(keyword(token)) || !punct(parts[i + 1], '.') ||
      (!identifier(member) && !punct(member, '*')) || punct(parts[i - 1], '.') || punct(following, '.') ||
      punct(parts[i - 1], ':') || ['AS', 'COLLATE'].includes(keyword(parts[i - 1])) ||
      following?.kind === 'group' && following.closing === ')' || following?.kind === 'blocked' && !following.text) return;
  for (const level of visible) {
    const matches = level.filter(ref => (ref.alias ?? ref.name) === name);
    if (!matches.length) continue;
    if (matches.length === 1 && matches[0].declaration &&
        (!matches[0].usingColumns || punct(member, '*') || matches[0].usingColumns.includes(identifier(member)!))) {
      trace.edges.set(token, matches[0].declaration);
    }
    return;
  }
}

/** 表达式子查询沿用可见的父查询；表来源自身的括号已经按 LATERAL 规则处理。 */
function traceExpressions(parts: Part[], scope: Scope, refs: ScopedRelation[], outer: ScopedRelation[][],
  relations: ReadonlyMap<number, RelationSpan>, trace: ReferenceTrace): void {
  const levels = [refs, ...outer];
  const update = keyword(parts[0]) === 'UPDATE';
  let joinStart = 0, lastRelation = -1;
  let inAssignments = false, assignmentTarget = false;
  for (let i = 0; i < parts.length && !trace.unsupported; i++) {
    const part = parts[i], word = keyword(part), span = relations.get(i);
    if (span) {
      lastRelation = span.relation;
      if (word === 'FROM' || word === 'USING' || punct(part, ',')) joinStart = span.relation;
      levels[0] = refs;
      inAssignments = false;
      i = span.end - 1;
      continue;
    }
    // SET 左侧的点号可表示复合字段路径。只分析赋值表达式中的关系限定符。
    if (update && word === 'SET') { inAssignments = true; assignmentTarget = true; }
    if (word === 'WHERE') inAssignments = false;
    if (inAssignments) {
      if (punct(part, ',')) assignmentTarget = true;
      if (punct(part, '=')) assignmentTarget = false;
      if (assignmentTarget) continue;
    }
    if (endsFrom.has(word)) { levels[0] = refs; lastRelation = -1; }
    // ON 只可见本 JOIN 链已加入的关系，逗号分隔的前序表仍属于另外的 FROM 项。
    if (word === 'ON' && lastRelation >= 0) levels[0] = refs.slice(joinStart, lastRelation + 1);
    if (part.kind === 'group') {
      const command = keyword(part.parts[0]);
      if (referenceCommands.has(command)) parseQuery(part.parts, scope, levels, undefined, trace);
      else traceExpressions(part.parts, scope, levels[0], outer, new Map(), trace);
    } else traceQualifier(parts, i, levels, trace);
  }
}

/** RETURNING 的 OLD/NEW 别名只在输出表达式内可见，默认名称让位给已有关系。 */
function traceReturning(parts: Part[], scope: Scope, refs: ScopedRelation[], outer: ScopedRelation[][], trace: ReferenceTrace): void {
  const names = new Set([refs, ...outer].flat().map(ref => ref.alias ?? ref.name));
  const visible = [...refs], specified = new Set<string>();
  let start = 0;
  if (keyword(parts[0]) === 'WITH') {
    const options = parts[1];
    if (options?.kind !== 'group' || options.closing !== ')' || options.parts.length % 4 !== 3) {
      trace.unsupported = true;
      return;
    }
    for (let i = 0; i < options.parts.length; i += 4) {
      const role = keyword(options.parts[i]), declaration = options.parts[i + 2], alias = identifier(declaration);
      if (!['OLD', 'NEW'].includes(role) || specified.has(role) || keyword(options.parts[i + 1]) !== 'AS' ||
          !alias || stop.has(keyword(declaration)) || names.has(alias) ||
          i + 3 < options.parts.length && !punct(options.parts[i + 3], ',')) {
        trace.unsupported = true;
        return;
      }
      specified.add(role);
      names.add(alias);
      trace.declarations.set(declaration.start, 'alias');
      visible.push({ name: alias, declaration });
    }
    start = 2;
  }
  for (const role of ['OLD', 'NEW']) {
    const name = role.toLowerCase();
    if (!specified.has(role) && !names.has(name)) visible.push({ name });
  }
  traceExpressions(parts.slice(start), scope, visible, outer, new Map(), trace);
}

function startsReferenceQuery(part?: Part): boolean {
  while (part?.kind === 'group' && part.closing === ')') part = part.parts[0];
  return referenceCommands.has(keyword(part));
}

/** 保留服务器提供但不会出现在 SQL 原文里的关系名，供重命名检查冲突。 */
function reserveImplicitName(trace: ReferenceTrace, declaration: LocalReferenceRange | undefined, name: string): void {
  if (!declaration) return;
  const names = trace.implicitNames.get(declaration.start);
  if (names) names.add(name);
  else trace.implicitNames.set(declaration.start, new Set([name]));
}

/** 冲突索引只分析索引表达式和谓词。排序规则、操作符类及约束名称均不绑定目标别名。 */
function traceConflictTarget(parts: Part[], scope: Scope, target: ScopedRelation, outer: ScopedRelation[][], trace: ReferenceTrace): boolean {
  if (!parts.length) return true;
  if (keyword(parts[0]) === 'ON') return parts.length === 3 && keyword(parts[1]) === 'CONSTRAINT' && !!identifier(parts[2]);
  const indexes = parts[0];
  if (indexes.kind !== 'group' || indexes.closing !== ')' || !indexes.parts.length ||
      parts.length > 1 && (keyword(parts[1]) !== 'WHERE' || parts.length < 3)) return false;
  let start = 0;
  for (let i = 0; i <= indexes.parts.length; i++) {
    if (i < indexes.parts.length && !punct(indexes.parts[i], ',')) continue;
    const entry = indexes.parts.slice(start, i);
    const first = entry[0];
    if (!first) return false;
    let expression = first;
    if (identifier(first)) {
      const call = punct(entry[1], '.') && identifier(entry[2]) ? entry[3] : entry[1];
      if (call?.kind === 'group') expression = call;
    } else if (first.kind !== 'group') return false;
    if (expression.kind === 'group') {
      if (expression.closing !== ')') return false;
      traceExpressions(expression.parts, scope, [target], outer, new Map(), trace);
    }
    start = i + 1;
  }
  if (parts.length > 1) traceExpressions(parts.slice(2), scope, [target], outer, new Map(), trace);
  return !trace.unsupported;
}

/** INSERT 来源独立解析。目标只在冲突索引、更新动作和 RETURNING 的相应范围可见。 */
function traceInsert(parts: Part[], scope: Scope, outer: ScopedRelation[][], trace: ReferenceTrace): boolean {
  if (keyword(parts[1]) !== 'INTO') return false;
  let index = 2, name = identifier(parts[index]), schema: string | undefined;
  if (!name || stop.has(keyword(parts[index++]))) return false;
  if (punct(parts[index], '.')) {
    schema = name;
    name = identifier(parts[index + 1]);
    index += 2;
    if (!name || stop.has(keyword(parts[index - 1]))) return false;
  }
  const target: ScopedRelation = { name, schema };
  if (keyword(parts[index]) === 'AS') {
    const declaration = parts[index + 1], alias = identifier(declaration);
    if (!alias || stop.has(keyword(declaration))) return false;
    target.alias = alias;
    target.declaration = declaration;
    trace.declarations.set(declaration.start, 'alias');
    index += 2;
  }
  const columns = parts[index];
  if (columns?.kind === 'group' && !startsReferenceQuery(columns)) {
    if (columns.closing !== ')' || !identifier(columns.parts[0])) return false;
    index++;
  }
  if (keyword(parts[index]) === 'OVERRIDING') {
    if (!['SYSTEM', 'USER'].includes(keyword(parts[index + 1])) || keyword(parts[index + 2]) !== 'VALUE') return false;
    index += 3;
  }
  const returning = parts.findIndex((part, i) => i >= index && keyword(part) === 'RETURNING');
  const end = returning < 0 ? parts.length : returning;
  const action = parts.findIndex((part, i) => i >= index && i + 1 < end && keyword(part) === 'DO' &&
    ['UPDATE', 'NOTHING'].includes(keyword(parts[i + 1])));
  let conflict = action;
  if (action >= 0) {
    // JOIN ON conflict 可以出现在来源中，只有与 DO 动作配对的后置子句才切分来源。
    for (conflict = action - 2; conflict >= index; conflict--) {
      if (keyword(parts[conflict]) === 'ON' && keyword(parts[conflict + 1]) === 'CONFLICT') break;
    }
    if (conflict < index) return false;
  }
  const source = parts.slice(index, conflict < 0 ? end : conflict);
  const defaults = source.length === 2 && keyword(source[0]) === 'DEFAULT' && keyword(source[1]) === 'VALUES';
  if (!defaults) {
    if (!startsReferenceQuery(source[0])) return false;
    parseQuery(source, scope, outer, undefined, trace);
  }
  if (action >= 0 && !trace.unsupported) {
    const arbiter = parts.slice(conflict + 2, action);
    if (!traceConflictTarget(arbiter, scope, target, outer, trace)) return false;
    if (keyword(parts[action + 1]) === 'UPDATE') {
      if (!arbiter.length || keyword(parts[action + 2]) !== 'SET') return false;
      reserveImplicitName(trace, target.declaration, 'excluded');
      traceExpressions(parts.slice(action + 1, end), scope, [target, { name: 'excluded' }], outer, new Map(), trace);
    } else if (action + 2 !== end) return false;
  }
  if (returning >= 0 && !trace.unsupported) traceReturning(parts.slice(returning + 1), scope, [target], outer, trace);
  return !trace.unsupported;
}

interface RelationAlias { declaration?: Part; alias?: string; next: number; }

/** 读取关系别名。普通关系列表只重命名列，表函数的带类型列定义由调用方读取。 */
function readRelationAlias(parts: Part[], index: number, columns: boolean): RelationAlias | undefined {
  const explicit = keyword(parts[index]) === 'AS';
  if (explicit) index++;
  const declaration = parts[index];
  const alias = stop.has(keyword(declaration)) ? undefined : identifier(declaration);
  if (!alias) return explicit ? undefined : { next: index };
  if (alias.length > limits.name) return;
  index++;
  if (columns && parts[index]?.kind === 'group') {
    if (!nameList(parts[index]).length) return;
    index++;
  }
  return { declaration, alias, next: index };
}

function readFunctionCall(parts: Part[], start: number): { name: string; args: Group; next: number } | undefined {
  let index = start;
  let name = identifier(parts[index]);
  if (!name || stop.has(keyword(parts[index++]))) return;
  if (punct(parts[index], '.')) {
    name = identifier(parts[index + 1]);
    index += 2;
  }
  const args = parts[index];
  if (!name || name.length > limits.name || args?.kind !== 'group' || args.closing !== ')') return;
  return { name, args, next: index + 1 };
}

/** 只提取显式列名，类型和排序规则不进入表达式作用域。 */
function typedColumnNames(group?: Part): string[] | undefined {
  if (group?.kind !== 'group' || group.closing !== ')' || !group.closed) return;
  const parts = group.parts;
  const names: string[] = [];
  let start = 0;
  for (let i = 0; i <= parts.length; i++) {
    if (i < parts.length && !punct(parts[i], ',')) continue;
    const name = identifier(parts[start]);
    if (i - start < 2 || !name || name.length > limits.name || !identifier(parts[start + 1]) || punct(parts[i - 1], '.')) return;
    if (parts.slice(start + 1, i).some(part => !identifier(part) && part.kind !== 'group' && !punct(part, '.'))) return;
    names.push(name);
    start = i + 1;
  }
  return names;
}

interface TableFunctionSource { relation: ScopedRelation; args: Group[]; next: number; }

/** 未知函数列数时，只有确定越过位置别名的后续声明列才保留原名。 */
function tableFunctionProjection(members: (string[] | undefined)[], aliases: string[], ordinal: boolean): Projection {
  const names = [...aliases];
  let knownWidth = 0, exact = true;
  for (const member of members) {
    if (!member) { exact = false; continue; }
    for (const name of member) if (knownWidth++ >= aliases.length) names.push(name);
  }
  if (ordinal) {
    if (knownWidth >= aliases.length) names.push('ordinality');
    knownWidth++;
  }
  return { names: names.slice(0, limits.items), stars: [], exact: exact && aliases.length <= knownWidth && knownWidth <= limits.items };
}

/** ROWS FROM 的各个实参共享外部可见关系，函数名和成员列定义不会引入新的关系别名。 */
function readTableFunction(parts: Part[], start: number): TableFunctionSource | false | undefined {
  const rows = keyword(parts[start]) === 'ROWS' && keyword(parts[start + 1]) === 'FROM';
  const group = parts[start + 2];
  if (rows && (group?.kind !== 'group' || group.closing !== ')')) return false;
  const body = rows && group.kind === 'group' ? group.parts : parts;
  const first = readFunctionCall(body, rows ? 0 : start);
  if (!first) return rows ? false : undefined;
  const args = [first.args];
  const members: (string[] | undefined)[] = [];
  if (rows) {
    let member = first;
    for (;;) {
      let index = member.next;
      let names: string[] | undefined;
      if (keyword(body[index]) === 'AS') {
        names = typedColumnNames(body[index + 1]);
        if (!names) return false;
        index += 2;
      }
      members.push(names);
      if (index === body.length) break;
      if (!punct(body[index], ',')) return false;
      const following = readFunctionCall(body, index + 1);
      if (!following) return false;
      member = following;
      args.push(member.args);
    }
  } else members.push(undefined);
  let next = rows ? start + 3 : first.next;
  const ordinal = keyword(parts[next]) === 'WITH' && keyword(parts[next + 1]) === 'ORDINALITY';
  if (ordinal) next += 2;
  const anonymousColumns = keyword(parts[next]) === 'AS' && parts[next + 1]?.kind === 'group';
  const renamed: RelationAlias | undefined = anonymousColumns ? { next: next + 1 } : readRelationAlias(parts, next, false);
  if (!renamed) return false;
  const columns = parts[renamed.next];
  let aliases: string[] = [];
  next = renamed.next;
  if (columns?.kind === 'group') {
    if (!anonymousColumns && !renamed.declaration) return false;
    if (!anonymousColumns) aliases = nameList(columns);
    if (!aliases.length) {
      const names = typedColumnNames(columns);
      if (args.length !== 1 || members[0] || ordinal || !names) return false;
      members[0] = names;
    }
    next++;
  }
  return { relation: { name: first.name, alias: renamed.alias, declaration: renamed.declaration,
    projection: tableFunctionProjection(members, aliases, ordinal) }, args, next };
}

function traceTableFunction(source: TableFunctionSource, scope: Scope,
  preceding: ScopedRelation[], outer: ScopedRelation[][], trace: ReferenceTrace): void {
  const { declaration } = source.relation;
  if (declaration) trace.declarations.set(declaration.start, 'alias');
  for (const args of source.args) traceExpressions(args.parts, scope, preceding, outer, new Map(), trace);
}

/** 括号中的 JOIN 可以从子查询开始，子查询后的别名或 JOIN 不属于该查询。 */
function isMergeSourceQuery(part: Group): boolean {
  while (part.closing === ')') {
    const [first, following] = part.parts;
    if (first?.kind !== 'group') return referenceCommands.has(keyword(first));
    if (following && !setOperators.has(keyword(following)) && !endsFrom.has(keyword(following))) return false;
    part = first;
  }
  return false;
}

/** 目标在外层 MERGE ON 前尚未进入作用域。表函数和 LATERAL 子查询可以看到允许关联的 JOIN 左侧。 */
function traceMergeRelation(parts: Part[], start: number, target: boolean, scope: Scope, outer: ScopedRelation[][],
  preceding: ScopedRelation[], trace: ReferenceTrace): { relation: ScopedRelation; next: number } | undefined {
  const modifier = keyword(parts[start]);
  const only = modifier === 'ONLY', lateral = modifier === 'LATERAL';
  let next = start + (only || lateral ? 1 : 0);
  const call = !target && !only ? readTableFunction(parts, next) : undefined;
  if (call === false) return;
  if (call) {
    traceTableFunction(call, scope, preceding, outer, trace);
    return call;
  }
  const first = parts[next];
  let name = '', schema: string | undefined, cte: LocalReferenceRange | undefined;
  if (!target && !only && first?.kind === 'group' && isMergeSourceQuery(first)) {
    parseQuery(first.parts, scope, lateral ? [preceding, ...outer] : outer, undefined, trace);
    next++;
  } else {
    const wrapped = only && first?.kind === 'group' && first.closing === ')' ? first : undefined;
    const names = wrapped?.parts ?? parts;
    let index = wrapped ? 0 : next;
    let token = names[index++];
    name = identifier(token) ?? '';
    if (!name || stop.has(keyword(token))) return;
    if (punct(names[index], '.')) {
      schema = name;
      token = names[index + 1];
      name = identifier(token) ?? '';
      if (!name || stop.has(keyword(token))) return;
      index += 2;
    }
    if (wrapped && index !== names.length) return;
    next = wrapped ? next + 1 : index;
    if (lateral) return;
    if (!only && punct(parts[next], '*')) next++;
    if (!target && !schema) cte = scope.get(name)?.declaration;
    if (cte && token.kind !== 'group') trace.edges.set(token, cte);
  }
  if (name.length > limits.name || schema && schema.length > limits.name) return;
  const renamed = readRelationAlias(parts, next, !target);
  if (!renamed) return;
  const { alias, declaration } = renamed;
  if (declaration) trace.declarations.set(declaration.start, 'alias');
  return { relation: { name, schema, alias, declaration: declaration ?? cte }, next: renamed.next };
}

interface MergeSource { relations: ScopedRelation[]; root?: ScopedRelation; next: number; joined: boolean; }

/** 点号后的保留词仍可作为列名，例如 s.on。 */
const mergeKeyword = (parts: Part[], index: number) => punct(parts[index - 1], '.') ? '' : keyword(parts[index]);

function mergeJoin(parts: Part[], start: number): { next: number; qualified: boolean; lateral: boolean } | undefined {
  let index = start;
  const natural = mergeKeyword(parts, index) === 'NATURAL';
  if (natural) index++;
  const type = mergeKeyword(parts, index);
  if (type === 'CROSS' && natural) return;
  if (['CROSS', 'INNER', 'LEFT', 'RIGHT', 'FULL'].includes(type)) index++;
  if (['LEFT', 'RIGHT', 'FULL'].includes(type) && keyword(parts[index]) === 'OUTER') index++;
  if (mergeKeyword(parts, index) !== 'JOIN') return;
  return { next: index + 1, qualified: !natural && type !== 'CROSS', lateral: type !== 'RIGHT' && type !== 'FULL' };
}

function traceMergeOperand(parts: Part[], start: number, scope: Scope, outer: ScopedRelation[][], preceding: ScopedRelation[],
  trace: ReferenceTrace, depth: number): MergeSource | undefined {
  const part = parts[start];
  if (part?.kind === 'group' && part.closing === ')' && !isMergeSourceQuery(part)) {
    const inner = traceMergeSource(part.parts, 0, scope, outer, preceding, trace, depth + 1);
    if (!inner?.joined || inner.next !== part.parts.length) return;
    const renamed = readRelationAlias(parts, start + 1, true);
    if (!renamed) return;
    if (!renamed.declaration) return { ...inner, next: renamed.next };
    // 整个 JOIN 的别名会遮蔽输入表，只保留已收集的内部引用。
    trace.declarations.set(renamed.declaration.start, 'alias');
    const root = { name: renamed.alias!, declaration: renamed.declaration };
    return { relations: [root], root, next: renamed.next, joined: true };
  }
  const atom = traceMergeRelation(parts, start, false, scope, outer, preceding, trace);
  if (atom) return { relations: [atom.relation], root: atom.relation, next: atom.next, joined: false };
}

/** JOIN ON 只可见当前两个操作数。右侧尚未遇到 ON／USING 时，继续解析其未加括号的 JOIN。 */
function traceMergeSource(parts: Part[], start: number, scope: Scope, outer: ScopedRelation[][], preceding: ScopedRelation[],
  trace: ReferenceTrace, depth = 0): MergeSource | undefined {
  if (depth >= 24 || trace.unsupported) return;
  const first = traceMergeOperand(parts, start, scope, outer, preceding, trace, depth);
  if (!first) return;
  let left: MergeSource = first;
  for (let join = mergeJoin(parts, left.next); join && !trace.unsupported; join = mergeJoin(parts, left.next)) {
    const lateral: ScopedRelation[] = join.lateral ? [...preceding, ...left.relations] : preceding;
    const right = join.qualified ? traceMergeSource(parts, join.next, scope, outer, lateral, trace, depth + 1)
      : traceMergeOperand(parts, join.next, scope, outer, lateral, trace, depth);
    if (!right) return;
    let next = right.next;
    const relations = [...left.relations, ...right.relations];
    let root: ScopedRelation | undefined;
    if (join.qualified) {
      const qualifier = mergeKeyword(parts, next++);
      if (qualifier === 'USING') {
        const columns = nameList(parts[next++]);
        if (!columns.length) return;
        if (keyword(parts[next]) === 'AS') {
          const declaration = parts[next + 1], name = identifier(declaration);
          if (!name || name.length > limits.name || stop.has(keyword(declaration))) return;
          trace.declarations.set(declaration.start, 'alias');
          root = { name, declaration, usingColumns: columns };
          relations.push(root);
          next += 2;
        }
      } else if (qualifier === 'ON') {
        const condition = next;
        while (next < parts.length && !['ON', 'USING'].includes(mergeKeyword(parts, next)) && !mergeJoin(parts, next)) next++;
        if (next === condition) return;
        traceExpressions(parts.slice(condition, next), scope, relations, outer, new Map(), trace);
      } else return;
    }
    left = { relations, root, next, joined: true };
  }
  return left;
}

/** 只扫描动作右侧的表达式。INSERT 列表和 UPDATE 赋值左侧可以包含复合字段路径。 */
function traceMergeAction(parts: Part[], inserts: boolean, scope: Scope, refs: ScopedRelation[], outer: ScopedRelation[][],
  trace: ReferenceTrace): boolean {
  const action = keyword(parts[0]);
  if (action === 'DO') return keyword(parts[1]) === 'NOTHING' && parts.length === 2;
  if (!inserts) {
    if (action === 'DELETE') return parts.length === 1;
    if (action !== 'UPDATE' || keyword(parts[1]) !== 'SET' || parts.length < 5) return false;
    traceExpressions(parts, scope, refs, outer, new Map(), trace);
    return !trace.unsupported;
  }
  if (action !== 'INSERT') return false;
  if (keyword(parts[1]) === 'DEFAULT') return keyword(parts[2]) === 'VALUES' && parts.length === 3;
  let index = 1;
  const columns = parts[index];
  if (columns?.kind === 'group') {
    if (columns.closing !== ')' || !identifier(columns.parts[0])) return false;
    index++;
  }
  if (keyword(parts[index]) === 'OVERRIDING') {
    if (!['SYSTEM', 'USER'].includes(keyword(parts[index + 1])) || keyword(parts[index + 2]) !== 'VALUE') return false;
    index += 3;
  }
  const values = parts[index + 1];
  if (keyword(parts[index]) !== 'VALUES' || values?.kind !== 'group' || values.closing !== ')' ||
      !values.parts.length || parts.length !== index + 2) return false;
  traceExpressions(values.parts, scope, refs, outer, new Map(), trace);
  return !trace.unsupported;
}

/** MERGE 的 WHEN 条件和动作共用分支作用域。CASE 中的 WHEN/THEN 仍属于所在表达式。 */
function traceMerge(parts: Part[], scope: Scope, outer: ScopedRelation[][], trace: ReferenceTrace): boolean {
  if (keyword(parts[1]) !== 'INTO') return false;
  const target = traceMergeRelation(parts, 2, true, scope, outer, [], trace);
  if (!target || keyword(parts[target.next]) !== 'USING') return false;
  const sourceStart = target.next + 1;
  const clauses: { when: number; then?: number }[] = [];
  let depth = 0, end = parts.length, join = -1;
  for (let i = sourceStart; i < parts.length; i++) {
    const word = mergeKeyword(parts, i);
    if (word === 'CASE') depth++;
    else if (word === 'END' && depth) depth--;
    // WHEN 前最后一个顶层 ON 属于 MERGE；更早的 ON 属于来源 JOIN。
    else if (!depth && word === 'ON' && !clauses.length) join = i;
    else if (!depth && word === 'WHEN') clauses.push({ when: i });
    else if (!depth && word === 'THEN') {
      const clause = clauses.at(-1);
      if (!clause || clause.then !== undefined) return false;
      clause.then = i;
    } else if (!depth && word === 'RETURNING') {
      end = i;
      break;
    }
  }
  if (depth || join <= sourceStart || !clauses.length || clauses[0].when <= join + 1) return false;
  const source = traceMergeSource(parts.slice(sourceStart, join), 0, scope, outer, [], trace);
  if (!source || source.next !== join - sourceStart) return false;
  const { relation } = target;
  const rootName = source.root?.alias ?? source.root?.name;
  const implicit = rootName ? undefined : source.joined ? 'unnamed_join' : 'unnamed_subquery';
  if ((relation.alias ?? relation.name) === (rootName || implicit)) return false;
  const refs = [relation, ...source.relations];
  if (implicit) for (const ref of refs) reserveImplicitName(trace, ref.declaration, implicit);
  // 自动生成的来源名由服务器在处理匹配动作时打开，没有可跳转的原文声明。
  const actionSource = implicit ? [...source.relations, { name: implicit }] : source.relations;
  const matched = implicit ? [relation, ...actionSource] : refs;
  // PostgreSQL 17/18 只切换来源 JOIN 的首个根命名空间项，未遮蔽的输入别名仍可解析。
  const withoutSource = refs.filter(ref => ref !== source.root);
  traceExpressions(parts.slice(join + 1, clauses[0].when), scope, refs, outer, new Map(), trace);
  for (const [i, { when, then }] of clauses.entries()) {
    if (then === undefined) return false;
    let index = when + 1;
    const unmatched = keyword(parts[index]) === 'NOT';
    if (unmatched) index++;
    if (keyword(parts[index++]) !== 'MATCHED') return false;
    let side = '';
    if (unmatched && keyword(parts[index]) === 'BY') {
      side = keyword(parts[index + 1]);
      if (side !== 'SOURCE' && side !== 'TARGET') return false;
      index += 2;
    }
    const inserts = unmatched && side !== 'SOURCE';
    const visible = unmatched ? inserts ? actionSource : withoutSource : matched;
    if (index !== then) {
      if (keyword(parts[index]) !== 'AND' || index + 1 >= then) return false;
      traceExpressions(parts.slice(index + 1, then), scope, visible, outer, new Map(), trace);
    }
    if (!traceMergeAction(parts.slice(then + 1, clauses[i + 1]?.when ?? end), inserts, scope, visible, outer, trace)) return false;
  }
  if (end < parts.length) {
    if (end + 1 === parts.length) return false;
    traceReturning(parts.slice(end + 1), scope, refs, outer, trace);
  }
  return !trace.unsupported;
}

/** 推导当前查询输出。引用模式只收集同一作用域树中的局部绑定，跳过投影计算。 */
function parseQuery(parts: Part[], inherited: Scope, outer: ScopedRelation[][], context?: QueryContext, trace?: ReferenceTrace): Parsed {
  if (trace?.unsupported) return { projection: unknown };
  if (parts.length === 1 && parts[0].kind === 'group') {
    return parseQuery(parts[0].parts, inherited, outer, context && contains(parts[0], context.offset) ? context : undefined, trace);
  }
  const unsupported = (): Parsed => { if (trace) trace.unsupported = true; return { projection: unknown }; };
  const first = keyword(parts[0]);
  if (parts.length && parts[0].kind !== 'group' && !commands.has(first) && !(trace && ['TABLE', 'MERGE'].includes(first))) return unsupported();
  let start = 0;
  let scope = inherited;
  if (keyword(parts[0]) === 'WITH') {
    const ctes = new Map(inherited);
    scope = ctes;
    const recursive = keyword(parts[1]) === 'RECURSIVE';
    const definitions: { name: string; names: string[]; body: Group; declaration: Part }[] = [];
    start = recursive ? 2 : 1;
    do {
      const declaration = parts[start++];
      const name = identifier(declaration);
      if (!name || name.length > limits.name || trace && definitions.some(item => item.name === name)) return unsupported();
      const names = nameList(parts[start]);
      if (parts[start]?.kind === 'group') {
        if (trace && !names.length) return unsupported();
        start++;
      }
      if (keyword(parts[start++]) !== 'AS') return unsupported();
      if (keyword(parts[start]) === 'NOT') start++;
      if (keyword(parts[start]) === 'MATERIALIZED') start++;
      const body = parts[start++];
      if (body?.kind !== 'group') return unsupported();
      definitions.push({ name, names, body, declaration });
      trace?.declarations.set(declaration.start, 'cte');
    } while (punct(parts[start], ',') && ++start);
    // 递归 WITH 中先占住所有声明名，避免自引用或后置定义落到同名物理表。
    if (recursive) for (const { name, names, declaration } of definitions)
      ctes.set(name, trace ? { ...unknown, declaration } : rename(unknown, names));
    for (const { name, names, body, declaration } of definitions) {
      const active = context && contains(body, context.offset) ? context : undefined;
      const anchorEnd = recursive ? body.parts.findIndex(part => keyword(part) === 'UNION') : -1;
      if (active && anchorEnd > 0 && body.parts[anchorEnd].end <= active.offset) {
        const anchor = parseQuery(body.parts.slice(0, anchorEnd), ctes, outer);
        ctes.set(name, rename(anchor.projection, names));
      }
      const parsed = parseQuery(body.parts, ctes, outer, active, trace);
      if (active) return parsed;
      ctes.set(name, trace ? { ...unknown, declaration } : rename(parsed.projection, names));
    }
  }
  const main = parts.slice(start);
  const command = keyword(main[0]);
  if (trace && command === 'INSERT') {
    if (!traceInsert(main, scope, outer, trace)) return unsupported();
    return { projection: unknown };
  }
  if (trace && command === 'MERGE') {
    if (first === 'WITH' && keyword(parts[1]) === 'RECURSIVE' || !traceMerge(main, scope, outer, trace)) return unsupported();
    return { projection: unknown };
  }
  if (trace && main.some((part, i) => unsupportedReferenceSyntax.has(keyword(part)) || keyword(part) === 'INTO' ||
    keyword(part) === 'USING' && main[i + 1]?.kind === 'group' && keyword(main[i + 2]) === 'AS')) return unsupported();
  const firstSet = main.findIndex(part => setOperators.has(keyword(part)));
  if (firstSet >= 0) {
    let output = unknown, branchStart = 0, query: Query | undefined, routine: PostgresRoutineCompletionTarget | undefined;
    for (let i = 0; i <= main.length; i++) {
      if (i < main.length && !setOperators.has(keyword(main[i]))) continue;
      const branch = main.slice(branchStart, i);
      const active = context && (main[branchStart - 1]?.end ?? 0) <= context.offset &&
        (main[i]?.start ?? Infinity) >= context.offset ? context : undefined;
      // 最后一个分支后的 ORDER BY 归组合结果，不能看到该分支的表。
      const order = branchStart > 0 && i === main.length ? branch.findIndex(part => trace
        ? ['ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR'].includes(keyword(part)) : keyword(part) === 'ORDER') : -1;
      const inOrder = active && order >= 0 && active.offset >= branch[order].start;
      const parsed = parseQuery(order >= 0 ? branch.slice(0, order) : branch, scope, outer, inOrder ? undefined : active, trace);
      if (branchStart === 0) output = parsed.projection;
      if (inOrder) query = columns([{ name: '', projection: output }], [], active.left);
      else if (active) { query = parsed.query; routine = parsed.routine; }
      if (['ALL', 'DISTINCT'].includes(keyword(main[i + 1]))) i++;
      branchStart = i + 1;
    }
    return { projection: output, query, routine };
  }

  const write = command === 'UPDATE' || command === 'DELETE';
  const tableSource = !!trace && command === 'TABLE';
  if (trace && !write && !['SELECT', 'VALUES', 'TABLE'].includes(command)) return unsupported();
  if (write && command === 'DELETE' && keyword(main[1]) !== 'FROM') return unsupported();
  const returning = trace && write ? main.findIndex(part => keyword(part) === 'RETURNING') : -1;
  const where = command === 'DELETE' ? main.findIndex(part => keyword(part) === 'WHERE') : -1;
  const refs: ScopedRelation[] = [];
  const spans = trace ? new Map<number, RelationSpan>() : undefined;
  const commas = new Set<number>();
  let from = false, deleteUsing = -1;
  let joinChainStart = 0;
  let argumentRefs: ScopedRelation[] | undefined;
  let inFunctionMetadata = false;
  for (let i = 0; i < (returning < 0 ? main.length : returning); i++) {
    const word = keyword(main[i]);
    if (endsFrom.has(word)) from = false;
    const usingSource = command === 'DELETE' && word === 'USING' && deleteUsing < 0 && !from && (where < 0 || i < where);
    if (usingSource) deleteUsing = i;
    if (from && punct(main[i], ',')) commas.add(i);
    if (!usingSource && !(tableSource && i === 0) && !relationEntry(main, i) && !commas.has(i)) continue;
    const target = writeTarget(main, i);
    if (!target && (word === 'FROM' || word === 'JOIN' || usingSource)) from = true;
    if (!target && word !== 'JOIN') joinChainStart = refs.length;
    let next = i + 1;
    const modifier = keyword(main[next]);
    if (modifier === 'ONLY' || modifier === 'LATERAL') next++;
    // PostgreSQL 的 FROM/USING 来源子查询及表函数不能引用本语句的写入目标。
    const joinType = keyword(main[i - (keyword(main[i - 1]) === 'OUTER' ? 2 : 1)]);
    const available = word === 'JOIN' && ['RIGHT', 'FULL'].includes(joinType) ? refs.slice(0, joinChainStart) : refs;
    const preceding = write ? available.slice(1) : available;
    const call = !target && !tableSource && modifier !== 'ONLY' ? readTableFunction(main, next) : undefined;
    if (call === false) return unsupported();
    if (call) {
      if (trace) {
        traceTableFunction(call, scope, preceding, outer, trace);
        spans!.set(i, { end: call.next, relation: refs.length });
      }
      if (context && context.offset <= main[call.next - 1].end) {
        if (call.args.some(args => contains(args, context.offset))) argumentRefs = preceding.slice();
        else if (context.start >= call.args[0].end || keyword(main[next]) === 'ROWS' && context.start >= main[next + 1].end) {
          inFunctionMetadata = true;
        }
      }
      refs.push(call.relation);
      i = call.next - 1;
      continue;
    }
    let part = main[next];
    let name = '', schema: string | undefined, projection: Projection | undefined;
    let cte: LocalReferenceRange | undefined;
    if (part?.kind === 'group') {
      if (trace && (target || part.closing !== ')')) return unsupported();
      const active = context && contains(part, context.offset) ? context : undefined;
      const parsed = parseQuery(part.parts, scope, modifier === 'LATERAL' ? [preceding, ...outer] : outer, active, trace);
      if (active) return parsed;
      projection = parsed.projection;
      next++;
    } else {
      const first = identifier(part);
      if (!first || stop.has(keyword(part))) { if (trace) return unsupported(); continue; }
      name = first;
      if (punct(main[++next], '.')) {
        name = identifier(main[next + 1]) ?? '';
        schema = first;
        next += 2;
      }
      if (!name || punct(main[next], '.')) { if (trace) return unsupported(); continue; }
      if (main[next]?.kind === 'group' && word !== 'INTO') {
        if (trace) return unsupported();
        // 表函数的别名仍会遮蔽外层关系，未声明字段时不查询同名物理表。
        projection = unknown;
        next++;
      } else if (!schema && !writeTarget(main, i)) {
        projection = scope.get(name);
        cte = trace && modifier !== 'ONLY' && !punct(main[next], '*') ? projection?.declaration : undefined;
        if (trace && cte) trace.edges.set(part, cte);
      }
      if (trace && punct(main[next], '*')) next++;
    }
    const explicitAlias = keyword(main[next]) === 'AS';
    if (explicitAlias) next++;
    part = main[next];
    const alias = !stop.has(keyword(part)) ? identifier(part) : undefined;
    if (alias) {
      const renamed = nameList(main[next + 1]);
      if (renamed.length) projection = rename(projection ?? unknown, renamed);
    }
    if ([name, schema, alias].some(value => value && value.length > limits.name)) { if (trace) return unsupported(); continue; }
    if (trace) {
      if (explicitAlias && !alias) return unsupported();
      let end = next + (alias ? 1 : 0);
      if (tableSource && (alias || main[end] && !['ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR'].includes(keyword(main[end])))) return unsupported();
      if (alias && main[end]?.kind === 'group') {
        if (target || !nameList(main[end]).length) return unsupported();
        end++;
      }
      if (target && command === 'UPDATE' && keyword(main[end]) !== 'SET') return unsupported();
      if (target && command === 'DELETE' && main[end] && !['USING', 'WHERE', 'RETURNING'].includes(keyword(main[end]))) return unsupported();
      spans!.set(i, { end, relation: refs.length });
      if (alias) trace.declarations.set(part.start, 'alias');
      refs.push({ name, alias, schema, declaration: alias ? part : cte });
      i = end - 1;
      continue;
    }
    refs.push({ name, ...(schema ? { schema } : {}), ...(alias ? { alias } : {}), ...(projection ? { projection } : {}) });
  }
  if (trace) {
    traceExpressions(returning < 0 ? main : main.slice(0, returning), scope, refs, outer, spans!, trace);
    if (returning >= 0 && !trace.unsupported) traceReturning(main.slice(returning + 1), scope, refs, outer, trace);
    return { projection: unknown };
  }
  const projection = project(main, refs);
  if (!context || inFunctionMetadata || start > 0 && (main[0]?.start ?? context.start) > context.start) return { projection };

  const { left, offset } = context;
  const visible = argumentRefs ?? refs;
  const cursorGroup = main.find(part => part.kind === 'group' && contains(part, offset));
  if (cursorGroup?.kind === 'group') {
    let group = cursorGroup;
    // 只深入包含光标的表达式括号，普通函数参数仍沿用本层字段。
    while (true) {
      if (commands.has(keyword(group.parts[0]))) return parseQuery(group.parts, scope, [visible, ...outer], context);
      const nested = group.parts.find(part => part.kind === 'group' && contains(part, offset));
      if (nested?.kind !== 'group') break;
      group = nested;
    }
  } else {
    const dotted = punct(left.at(-1), '.');
    const qualifier = dotted ? identifier(left.at(-2)) : undefined;
    let before = left.at(dotted ? -3 : -1);
    const modifier = keyword(before);
    if (modifier === 'ONLY' || modifier === 'LATERAL') before = left.at(dotted ? -4 : -2);
    const position = main.findIndex(part => part === before);
    if (position === 0 && keyword(before) === 'CALL' && (!dotted || qualifier))
      return { projection, routine: { context: 'call', ...(qualifier ? { schema: qualifier } : {}) } };
    if (position >= 0 && (!dotted || qualifier) && (relationEntry(main, position) || commas.has(position) || position === deleteUsing)) {
      const ctes = qualifier || writeTarget(main, position) ? [] : [...scope.keys()].slice(0, limits.items);
      const routine: PostgresRoutineCompletionTarget | undefined = modifier !== 'ONLY' && !writeTarget(main, position)
        ? { context: 'from', ...(qualifier ? { schema: qualifier } : {}) } : undefined;
      return { projection, query: modifier === 'LATERAL' ? undefined :
        { kind: 'relations', ...(qualifier ? { schema: qualifier } : {}), ...(ctes.length ? { ctes } : {}) }, routine };
    }
  }
  return { projection, query: keyword(left.at(-1)) === 'AS' ? undefined : columns(visible, outer, left),
    routine: expressionRoutine(main, left, cursorGroup, [visible, ...outer]) };
}

const noLocalReference = { status: 'blocked', reason: 'syntax' } as const;
const rangeOf = ({ start, end }: LocalReferenceRange): LocalReferenceRange => ({ start, end });

/** 只读取光标所在语句，为导航和重命名提供同一套原文绑定。 */
function analyzePostgresBinding<T extends LocalReferences | LocalRename>(source: string, offset: number, standardStrings: boolean | undefined,
  plan: (references: Extract<LocalReferences, { status: 'ready' }>, target: PostgresEditorToken,
    tokens: PostgresEditorToken[], trace: ReferenceTrace) => T): T | Extract<LocalReferences, { status: 'blocked' }> {
  if (source.length > limits.source) return { status: 'blocked', reason: 'budget' };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length || /[\uD800-\uDFFF]/u.test(source)) return noLocalReference;

  function analyze(mode: boolean): T | Extract<LocalReferences, { status: 'blocked' }> {
    let statement: ReturnType<typeof currentPostgresStatement>;
    try { statement = currentPostgresStatement(source, offset, mode); }
    catch { return noLocalReference; }
    const scanned = scanPostgresEditorTokens(statement.sql, limits.tokens, mode);
    if (!scanned) return { status: 'blocked', reason: 'budget' };
    const encoder = new TextEncoder();
    // 目录未知时不能猜测长名截断或 U& 转义后与哪个声明同名。
    if (scanned.some(token => (token.kind === 'word' || token.kind === 'identifier') &&
      (encoder.encode(token.text).length > 63 || token.kind === 'identifier' &&
        (token.open || !token.text || /u&$/i.test(statement.sql.slice(Math.max(0, token.start - 2), token.start)))))) return noLocalReference;
    const tokens = scanned.map(token => ({ ...token, start: token.start + statement.start, end: token.end + statement.start }));
    const target = tokens.find(token => identifier(token) && offset >= token.start && offset <= token.end);
    if (!target) return noLocalReference;
    const parts = groupStatement(tokens, offset, statement.end, true);
    if (!parts) return noLocalReference;
    const trace: ReferenceTrace = { edges: new Map(), declarations: new Map(), implicitNames: new Map(), unsupported: false };
    parseQuery(parts, new Map(), [], undefined, trace);
    if (trace.unsupported) return noLocalReference;
    const declaration = trace.edges.get(target) ?? target;
    const references = [...trace.edges].filter(([, binding]) => binding.start === declaration.start)
      .map(([token]) => rangeOf(token)).sort((a, b) => a.start - b.start);
    if (!references.length) return noLocalReference;
    if (references.length > limits.items) return { status: 'blocked', reason: 'budget' };
    return plan({ status: 'ready', target: rangeOf(target), declaration: rangeOf(declaration), references }, target, tokens, trace);
  }

  const result = analyze(standardStrings ?? true);
  // 离线编辑时两种字符串模式必须确认同一结果，包括重命名的每一处编辑。
  return standardStrings === undefined && result.status === 'ready' && JSON.stringify(result) !== JSON.stringify(analyze(false))
    ? noLocalReference : result;
}

/** 只返回绑定声明和引用的范围，供高亮与导航使用。 */
export function analyzePostgresLocalReferences(source: string, offset: number, standardStrings?: boolean): LocalReferences {
  return analyzePostgresBinding(source, offset, standardStrings, references => references);
}

/** 同名词只有确定属于另一个绑定才可略过，任何未确认的同名词都会阻止整组修改。 */
export function analyzePostgresLocalRename(source: string, offset: number, standardStrings?: boolean, newName?: string): LocalRename {
  return analyzePostgresBinding(source, offset, standardStrings, (references, target, tokens, trace) => {
    const name = identifier(target)!;
    const declaration = references.declaration.start;
    if (newName !== undefined && newName !== name && trace.implicitNames.get(declaration)?.has(newName)) return { status: 'blocked', reason: 'collision' };
    const kind = trace.declarations.get(declaration);
    const localTokens = [];
    for (const token of tokens) {
      const value = identifier(token);
      if (value === undefined) continue;
      const owner = trace.edges.get(token)?.start ?? (trace.declarations.has(token.start) ? token.start : undefined);
      if (value === name && owner !== undefined && owner !== declaration) continue;
      localTokens.push({ ...rangeOf(token), value });
    }
    return planLocalRename({ status: 'ready', target: { ...rangeOf(target), value: name }, tokens: localTokens },
      references, 'postgresql', () => kind, newName);
  });
}

/** 定位当前标识符，屏蔽注释、字符串和参数，再解析当前语句的查询作用域。 */
export function analyzePostgresCompletion(source: string, offset: number): PostgresCompletionAnalysis | undefined {
  if (source.length > limits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const all = scanPostgresEditorTokens(source, limits.tokens);
  if (!all || all.some(token => token.kind === 'blocked' && offset > token.start &&
      (offset < token.end || token.open && offset === token.end))) return;
  const target = all.find(token => (token.kind === 'word' || token.kind === 'identifier') && offset >= token.start && offset <= token.end);
  const start = target?.start ?? offset, end = target?.end ?? offset, quoted = target?.kind === 'identifier';
  const raw = source.slice(start, offset);
  const prefix = quoted ? raw.slice(1, !target?.open && offset === end ? -1 : undefined).replaceAll('""', '"') : raw;
  if (prefix.length > limits.name) return;
  const parts = groupStatement(all, offset, source.length);
  const left = all.filter(token => token !== target && token.end <= start && !(token.kind === 'blocked' && token.text === 'comment'));
  const parsed = parts && parseQuery(parts, new Map(), [], { offset, start, left });
  const routine = parsed?.routine && (prefix || parsed.routine.schema) ? parsed.routine : undefined;
  const next = routine && all.find(token => token !== target && token.start >= end && !(token.kind === 'blocked' && token.text === 'comment'));
  return { start, end, prefix, quoted, ...(parsed?.query ? { query: parsed.query } : {}),
    ...(routine ? { routine, existingCall: punct(next || undefined, '(') } : {}) };
}

/** 在最近的调用层定位当前实参，字面量、数组、子查询和嵌套调用内的逗号不计入外层。 */
export function analyzePostgresSignature(source: string, offset: number) {
  if (source.length > limits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const scanned = scanPostgresEditorTokens(source, limits.tokens);
  const tokens = scanned?.filter(token => !(token.kind === 'blocked' && token.text === 'comment'));
  if (!tokens) return;
  const frames: { index: number; close: ')' | ']'; start: number; argument: number; previousNames: string[] }[] = [];
  const namedAt = (start: number) => {
    const operator = tokens[start + 1], last = tokens[start + 2];
    return operator && last && operator.end === last.start && last.end <= offset &&
      (punct(operator, '=') && punct(last, '>') || punct(operator, ':') && punct(last, '=')) ? identifier(tokens[start]) : undefined;
  };
  for (let i = 0; i < tokens.length && tokens[i].end <= offset; i++) {
    const token = tokens[i], frame = frames.at(-1);
    if (punct(token, '(') || punct(token, '[')) {
      if (frames.length >= 24) return;
      frames.push({ index: i, close: punct(token, '(') ? ')' : ']', start: i + 1, argument: 0, previousNames: [] });
    } else if (punct(token, ')') || punct(token, ']')) {
      if (frame && !punct(token, frame.close)) return;
      frames.pop();
    } else if (punct(token, ';')) frames.length = 0;
    else if (frame?.close === ')' && punct(token, ',')) {
      const name = namedAt(frame.start);
      if (name) frame.previousNames.push(name);
      frame.argument++;
      frame.start = i + 1;
    }
  }
  for (const frame of frames.reverse()) {
    if (frame.close !== ')') continue;
    const token = tokens[frame.index - 1], name = identifier(token);
    if (!name || name.length > limits.name || stop.has(keyword(token))) continue;
    const analysis = analyzePostgresCompletion(source, token.end);
    if (!analysis?.routine || !analysis.existingCall) continue;
    return { name, routine: analysis.routine, argument: frame.argument, named: namedAt(frame.start), previousNames: frame.previousNames };
  }
}
