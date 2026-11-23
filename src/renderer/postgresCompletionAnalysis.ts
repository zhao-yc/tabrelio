import { postgresCompletionLimits as limits, type PostgresCatalogRelation, type PostgresCompletionReference,
  type PostgresConflictSelection, type PostgresRoutineCompletionTarget } from '../shared/postgresCompletion';
import { currentPostgresStatement, scanPostgresEditorTokens, type PostgresEditorToken } from '../shared/postgresSql';
import type { DeclaredLocalReferences, LocalBindingReferences, LocalReferenceRange, LocalReferences } from '../shared/localReferences';
import { planLocalRename, quoteLocalRename, type LocalRename } from '../shared/localRename';
import { postgresNamedParameterReferences, postgresNamedParameterRename } from './postgresNamedParameterReferences';
import type { PostgresJoinOutput, PostgresJoinSource, PostgresUsingColumns } from './postgresJoinColumns';

type Group = { kind: 'group'; start: number; end: number; closed: boolean; closing: ')' | ']'; parts: Part[] };
type Part = PostgresEditorToken | Group;
interface Projection {
  names: (string | null)[]; stars: PostgresCompletionReference[]; exact: boolean;
  declaration?: LocalReferenceRange; origins?: (LocalReferenceRange | null)[];
}
export interface PostgresCompletionRelation extends PostgresCompletionReference { alias?: string; projection?: Projection; qualifiedOnly?: boolean; }
interface ScopedRelation extends PostgresCompletionRelation { declaration?: LocalReferenceRange; usingColumns?: string[]; physical?: true; }
interface PhysicalRelation extends LocalReferenceRange { name: string; schema?: string; }
interface ProjectionRenameFacts {
  explicit: Set<number>;
  separate: Set<number>;
  uncertain: Set<number>;
  outputs: Projection[];
}
export interface PostgresFieldTarget extends LocalReferenceRange {
  name: string;
  relations: { name: string; schema?: string; alias?: string }[];
}
interface ReferenceTrace {
  edges: Map<PostgresEditorToken, LocalReferenceRange>;
  declarations: Map<number, 'alias' | 'cte' | 'window'>;
  implicitNames: Map<number, Set<string>>;
  windowSlots: Map<number, PostgresEditorToken[]>;
  joinAliases: Set<number>;
  joinColumnTokens: Set<number>;
  physicalRelations?: PhysicalRelation[];
  field?: { offset: number; target?: PostgresFieldTarget };
  projected?: true;
  projectionRename?: ProjectionRenameFacts;
  unsupported: boolean;
}
interface RelationSpan { end: number; relation: number; joined?: true; }
type Scope = ReadonlyMap<string, Projection>;
type Query = { kind: 'relations'; schema?: string; ctes?: string[]; mergeTarget?: true } |
  { kind: 'columns'; relations: PostgresCompletionRelation[]; qualified: boolean; joinOutput?: PostgresJoinOutput } |
  { kind: 'lockTargets'; names: string[] } |
  { kind: 'lockKeywords'; items: string[] } |
  { kind: 'conflictTarget'; relation: PostgresCatalogRelation; selection: PostgresConflictSelection } | PostgresUsingColumns;
export interface PostgresCompletionAnalysis {
  start: number;
  end: number;
  prefix: string;
  quoted: boolean;
  query?: Query;
  routine?: PostgresRoutineCompletionTarget;
  existingCall?: boolean;
  keywords?: readonly string[];
  windows?: { names: string[]; inline: boolean };
}
const entries = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO']);
const endsFrom = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'RETURNING',
  'SET', 'VALUES', 'WINDOW', 'FOR']);
const setOperators = new Set(['UNION', 'EXCEPT', 'INTERSECT']);
const stop = new Set([...entries, ...endsFrom, ...setOperators, 'ON', 'USING', 'CROSS', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'NATURAL', 'AS', 'WITH', 'SELECT', 'TABLESAMPLE', 'OVERRIDING',
  'CONFLICT', 'DO', 'NULLS', 'DISTINCT', 'LATERAL', 'ONLY', 'END', 'COLLATE', 'TRUE', 'FALSE', 'NULL']);
const commands = new Set(['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'VALUES', 'WITH', 'CALL', 'TABLE']);
const expressionEntries = new Set(['SELECT', 'WHERE', 'HAVING', 'ON', 'RETURNING', 'VALUES', 'WHEN', 'THEN', 'ELSE',
  'AND', 'OR', 'NOT', 'BY', 'DISTINCT', 'ALL']);
const expressionOperators = new Set(['(', '[', ',', '=', '+', '-', '*', '/', '%', '<', '>', '|', '&', '^', '~']);
const unknown: Projection = { names: [], stars: [], exact: false };
const joinSources = new WeakMap<Projection, PostgresJoinSource>();
const joinedOutputs = new WeakSet<Projection>();
const referenceCommands = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE']);
const unsupportedReferenceSyntax = new Set(['TABLESAMPLE', 'SEARCH', 'CYCLE']);
const declaredTableSyntax = new Set(['JSON_TABLE', 'XMLTABLE']);

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

interface StatementQuery {
  parts: Part[];
  recursiveView?: { name: string; declaration: Part; columns: Group; names: string[] };
}

/** 依据定义头识别查询起点，避免把建表字段、存储选项和填充选项当作查询内容。 */
function createStatementQuery(parts: Part[], offset: number, explain: boolean): StatementQuery | undefined {
  let index = 1;
  const take = (word: string) => {
    if (keyword(parts[index]) !== word) return false;
    index++;
    return true;
  };
  const replace = take('OR');
  if (replace && !take('REPLACE')) return;
  const locality = take('GLOBAL') || take('LOCAL');
  const temporary = take('TEMP') || take('TEMPORARY');
  if (locality && !temporary) return;
  if (!temporary) take('UNLOGGED');
  const recursive = take('RECURSIVE');
  const materialized = !recursive && take('MATERIALIZED');
  const table = !recursive && !materialized && take('TABLE');
  if (!table && !take('VIEW')) return;
  const ordinary = !materialized && !table;
  if ((!ordinary && replace) || (explain && ordinary) || (materialized && temporary)) return;
  if (!ordinary && take('IF') && (!take('NOT') || !take('EXISTS'))) return;

  let declaration = parts[index++];
  if (!identifier(declaration) || stop.has(keyword(declaration))) return;
  if (punct(parts[index], '.')) {
    declaration = parts[++index];
    if (!identifier(declaration)) return;
    index++;
  }
  const name = identifier(declaration)!;
  if (name.length > limits.name) return;
  const columns = parts[index];
  const names = nameList(columns);
  if (columns?.kind === 'group') {
    if (!names.length) return;
    index++;
  } else if (recursive) return;

  if (!ordinary && take('USING') && !identifier(parts[index++])) return;
  if (take('WITH')) {
    const options = parts[index++];
    if (options?.kind !== 'group' || options.closing !== ')' || !options.closed) return;
  } else if (table && take('WITHOUT') && !take('OIDS')) return;
  if (table && take('ON') && (!take('COMMIT') || !(take('DROP') || (take('DELETE') || take('PRESERVE')) && take('ROWS')))) return;
  if (!ordinary && take('TABLESPACE') && !identifier(parts[index++])) return;
  if (!take('AS') || !startsReferenceQuery(parts[index]) || offset < parts[index].start) return;

  let end = parts.length;
  if (!ordinary && keyword(parts[end - 1]) === 'DATA') {
    const suffix = end - (keyword(parts[end - 2]) === 'NO' ? 3 : 2);
    if (keyword(parts[suffix]) === 'WITH') end = suffix;
  } else if (ordinary && keyword(parts[end - 1]) === 'OPTION' && keyword(parts[end - 2]) === 'CHECK') {
    const suffix = end - (['LOCAL', 'CASCADED'].includes(keyword(parts[end - 3])) ? 4 : 3);
    if (keyword(parts[suffix]) === 'WITH') end = suffix;
  }
  if (end <= index || end < parts.length && offset >= parts[end].start) return;
  return { parts: parts.slice(index, end), ...(recursive && columns?.kind === 'group'
    ? { recursiveView: { name, declaration, columns, names } } : {}) };
}

/** 只把实际查询交给语义分析，保留原文位置，排除选项、参数类型和导出目标。 */
function statementQuery(parts: Part[], offset: number): StatementQuery | undefined {
  const command = keyword(parts[0]);
  if (command === 'CREATE') return createStatementQuery(parts, offset, false);
  if (!['EXPLAIN', 'PREPARE', 'DECLARE', 'COPY'].includes(command)) return { parts };

  const first = parts[1];
  let start = 1;
  let end = parts.length;
  if (command === 'EXPLAIN') {
    // 首个括号也可以是 SELECT 本身。只有选项括号才应跳过。
    if (first?.kind === 'group' && !startsReferenceQuery(first)) {
      if (first.closing !== ')' || !first.closed) return;
      start++;
    } else {
      if (['ANALYZE', 'ANALYSE'].includes(keyword(parts[start]))) start++;
      if (keyword(parts[start]) === 'VERBOSE') start++;
    }
  }
  if (command === 'PREPARE') {
    if (!identifier(first)) return;
    const types = parts[2];
    if (types?.kind === 'group' && (types.closing !== ')' || !types.closed)) return;
    const as = types?.kind === 'group' ? 3 : 2;
    if (keyword(parts[as]) !== 'AS') return;
    start = as + 1;
  }
  if (command === 'DECLARE') {
    if (!identifier(first)) return;
    const cursor = parts.findIndex((part, index) => index >= 2 && keyword(part) === 'CURSOR');
    if (cursor < 0 || !/^(?:(?:NO SCROLL|SCROLL|BINARY|ASENSITIVE|INSENSITIVE) )*$/.test(
      parts.slice(2, cursor).map(part => keyword(part) + ' ').join(''))) return;
    const hold = ['WITH', 'WITHOUT'].includes(keyword(parts[cursor + 1]));
    if (hold && keyword(parts[cursor + 2]) !== 'HOLD') return;
    const forIndex = cursor + (hold ? 3 : 1);
    if (keyword(parts[forIndex]) !== 'FOR') return;
    start = forIndex + 1;
  }
  if (command === 'COPY') {
    if (first?.kind !== 'group' || first.closing !== ')' || !contains(first, offset) || parts[2] && keyword(parts[2]) !== 'TO') return;
    end = 2;
  }
  const body = parts[start];
  if (!body || offset < body.start) return;
  if (command === 'EXPLAIN' && keyword(body) === 'CREATE') return createStatementQuery(parts.slice(start), offset, true);
  if (command === 'EXPLAIN' && keyword(body) === 'DECLARE') return statementQuery(parts.slice(start), offset);
  if (!startsReferenceQuery(body)) {
    const write = command === 'COPY' && body.kind === 'group' ? body.parts[0] : body;
    if (command === 'DECLARE' || !['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(keyword(write))) return;
  }
  return { parts: parts.slice(start, end) };
}

/** 位置别名覆盖已知输出；通配展开缺少位置时只保留显式声明。 */
function rename(projection: Projection, names: string[], aliases?: Part, trace?: ReferenceTrace): Projection {
  if (!names.length) return projection;
  const origins = aliases?.kind === 'group' && projection.exact && names.length <= projection.names.length
    ? projection.names.map((_, index) => index < names.length ? aliases.parts[index * 2] : projection.origins?.[index] ?? null)
    : undefined;
  if (origins && trace?.projectionRename) {
    for (const origin of origins.slice(0, names.length)) if (origin) trace.projectionRename.explicit.add(origin.start);
  }
  const output = {
    names: [...names, ...(projection.exact ? projection.names.slice(names.length) : [])].slice(0, limits.items),
    stars: [],
    exact: projection.exact && (!aliases || names.length <= projection.names.length),
    ...(origins ? { origins } : {}),
  };
  const input = !trace && joinSources.get(projection);
  if (input) joinSources.set(output, { kind: 'alias', input, names });
  if (!trace && joinedOutputs.has(projection)) joinedOutputs.add(output);
  return keepProjection(output, origins ?? [], trace?.projectionRename);
}

function relationJoinSource(ref: PostgresCompletionRelation): PostgresJoinSource | undefined {
  const projection = ref.projection;
  if (projection) return projectedJoinSource(projection);
  const { name, schema } = ref;
  const encoder = new TextEncoder();
  if (!name || /[\u0000\uD800-\uDFFF]/u.test(name + (schema ?? '')) ||
    encoder.encode(name).length > 63 || schema && encoder.encode(schema).length > 63) return;
  return { kind: 'relation', relation: { name, ...(schema ? { schema } : {}) } };
}

function projectedJoinSource(projection: Projection): PostgresJoinSource | undefined {
  const source = joinSources.get(projection);
  if (source) return source;
  if (projection.exact && projection.names.every((name): name is string => name !== null))
    return { kind: 'names', names: projection.names };
}

/** 连接投影缺少完整目录时，不能拿单表星号或部分输出代替合并结果。 */
export function isJoinedProjection(ref: PostgresCompletionRelation): boolean {
  return !!ref.projection && joinedOutputs.has(ref.projection);
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
  end: number;
  left: PostgresEditorToken[];
  keywordPrefix?: string;
}
interface Parsed { projection: Projection; query?: Query; routine?: PostgresRoutineCompletionTarget; windows?: PostgresCompletionAnalysis['windows']; }

/** 物理星号继承读取权限；表函数仍通过其独立的签名和返回类型读取目录。 */
export function catalogColumnReferences(ref: PostgresCompletionRelation): PostgresCompletionReference[] {
  const { name, schema, projection, columnAccess } = ref;
  const sources = projection?.stars ?? [{ name, ...(schema ? { schema } : {}) }];
  if (!columnAccess) return sources;
  return sources.map(source => source.functionCall || source.functionLayout ? source : { ...source, columnAccess });
}

/** 只接受一个 schema 限定符，关系别名和赋值左侧继续由字段补全处理。 */
function expressionRoutine(main: Part[], left: PostgresEditorToken[], cursorGroup: Part | undefined,
  refs: PostgresCompletionRelation[][], expressionStart?: number): PostgresRoutineCompletionTarget | undefined {
  const dotted = punct(left.at(-1), '.');
  const schema = dotted ? identifier(left.at(-2)) : undefined;
  if (dotted && (!schema || refs.some(level => level.some(ref => (ref.alias ?? ref.name) === schema)))) return;
  const before = left.at(dotted ? -3 : -1);
  if (!before || !(before.end === expressionStart || expressionEntries.has(keyword(before)) ||
      (before.kind === 'punct' && expressionOperators.has(before.text)))) return;
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
function project(parts: Part[], refs: PostgresCompletionRelation[], starSources?: PostgresCompletionRelation[], trace?: ReferenceTrace): Projection {
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
  const origins: (LocalReferenceRange | null)[] = [];
  const stars: PostgresCompletionReference[] = [];
  const joins: PostgresJoinSource[] = [];
  let knownJoinShape = !trace;
  let includesJoin = false;
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
      const match = column.length === 1 ? starSources ?? (!select ? refs.slice(0, 1) : mergedJoinColumns ? [] : refs)
        : punct(column.at(-2), '.') && owner &&
        (column.length === 3 || schema && punct(column[1], '.')) ? refs.filter(ref => schema
          ? !ref.alias && ref.name === owner && ref.schema === schema : (ref.alias ?? ref.name) === owner) : [];
      if (match.length && (column.length === 1 || match.length === 1)) {
        for (const ref of match) {
          if (knownJoinShape) {
            const input = relationJoinSource(ref);
            if (input) joins.push(input);
            else knownJoinShape = false;
          }
          if (ref.projection) {
            includesJoin ||= joinedOutputs.has(ref.projection);
            names.push(...ref.projection.names);
            if (trace?.projected) origins.push(...ref.projection.names.map((_, index) => ref.projection?.origins?.[index] ?? null));
            exact &&= ref.projection.exact;
          } else exact = false;
          stars.push(...catalogColumnReferences(ref));
        }
      } else { exact = false; knownJoinShape = false; }
    } else if (tail && tail.length <= limits.name && (explicit || (path || implicit) && !stop.has(keyword(last)))) {
      names.push(tail);
      if (knownJoinShape) joins.push({ kind: 'names', names: [tail] });
      // 显式改名建立新声明；原名投影有已确认来源时沿用原声明。
      if (trace?.projected) {
        origins.push(last && last.kind !== 'group' ? path ? trace.edges.get(last) ?? last : last : null);
        if ((explicit || implicit) && last) trace.projectionRename?.explicit.add(last.start);
      }
    } else if (column.length) {
      names.push(null);
      knownJoinShape = false;
      if (trace?.projected) origins.push(null);
    }
    if (done) break;
    start = ++end;
  }
  const output = { names: names.slice(0, limits.items), stars: stars.length <= limits.relations ? stars : [],
    exact: exact && names.length <= limits.items,
    ...(trace?.projected && exact && names.length <= limits.items ? { origins } : {}) };
  if (knownJoinShape && joins.length && (!output.exact || includesJoin))
    joinSources.set(output, { kind: 'projection', parts: joins });
  if (includesJoin) joinedOutputs.add(output);
  return keepProjection(output, origins, trace?.projectionRename);
}

/** 星号按 FROM 项的顺序展开，限定名另用于消除连接输出里仍然重名的列。 */
function joinColumnOutput(projections: Projection[], refs: PostgresCompletionRelation[]): PostgresJoinOutput | undefined {
  const sources = projections.map(projectedJoinSource);
  if (!sources.length || sources.some(source => source === undefined)) return;
  const candidates = refs.flatMap(ref => {
    const name = ref.alias ?? ref.name;
    const source = relationJoinSource(ref);
    if (!source || !name) return [];
    return [{ qualifier: { name, ...(!ref.alias && ref.schema ? { schema: ref.schema } : {}) }, source }];
  });
  const qualifiers = candidates.filter(({qualifier}) => candidates.filter(item =>
    item.qualifier.name === qualifier.name && item.qualifier.schema === qualifier.schema).length === 1);
  return { source: { kind: 'projection', parts: sources as PostgresJoinSource[] }, qualifiers };
}

/** 在当前查询层或可关联的外层查找限定名，当前层同名别名遮蔽外层。 */
function columns(refs: PostgresCompletionRelation[], outer: PostgresCompletionRelation[][], left: PostgresEditorToken[],
  outputs?: Projection[]): Query | undefined {
  if (punct(left.at(-1), '.')) {
    const qualifier = identifier(left.at(-2));
    if (!qualifier) return;
    const schema = punct(left.at(-3), '.') ? identifier(left.at(-4)) : undefined;
    for (const level of [refs, ...outer]) {
      const matches = level.filter(ref => schema ? !ref.alias && ref.schema === schema && ref.name === qualifier : (ref.alias ?? ref.name) === qualifier);
      if (matches.length > 1) return;
      if (matches.length === 1) {
        const projection = matches[0].projection;
        const source = projection && joinedOutputs.has(projection) ? projectedJoinSource(projection) : undefined;
        return { kind: 'columns', relations: matches, qualified: true, ...(source ? { joinOutput: { source, qualifiers: [] } } : {}) };
      }
    }
    return;
  }
  const level = [refs, ...outer].map(group => group.filter(ref => !ref.qualifiedOnly)).find(group => group.length) ?? [];
  const names = level.map(ref => ref.alias ?? (ref.schema ? JSON.stringify([ref.schema, ref.name]) : ref.name));
  if (level.length && level.length <= limits.relations && (level.length === 1 || names.every(Boolean) && new Set(names).size === level.length)) {
    const projections = outputs ?? (level.some(isJoinedProjection) ? level.map(relationProjection) : undefined);
    const joinOutput = projections ? joinColumnOutput(projections, refs) : undefined;
    return { kind: 'columns', relations: level, qualified: false, ...(joinOutput ? {joinOutput} : {}) };
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
    if (matches.length === 1 && (!matches[0].usingColumns || punct(member, '*') || matches[0].usingColumns.includes(identifier(member)!))) {
      if (matches[0].declaration) trace.edges.set(token, matches[0].declaration);
      if (identifier(member)) trace.joinColumnTokens.add(member.start);
    }
    return;
  }
}

const bareFieldPrefix = new Set(['SELECT', 'DISTINCT', 'ALL', 'WHERE', 'ON', 'WHEN', 'THEN', 'ELSE', 'AND', 'OR', 'NOT', 'BETWEEN', 'LIKE', 'ILIKE']);

function knownProjection(projection: Projection | undefined): projection is Projection {
  return !!projection?.exact && !projection.stars.length && projection.names.every(name => name !== null);
}

/** 已知列进入宽度或名称未确认的投影时，无法证明改名后的输出仍唯一。 */
function keepProjection(output: Projection, origins: readonly (LocalReferenceRange | null)[], facts?: ProjectionRenameFacts): Projection {
  if (!facts) return output;
  if (knownProjection(output)) facts.outputs.push(output);
  else for (const origin of origins) if (origin) facts.uncertain.add(origin.start);
  return output;
}

/** 同层同名输出不能合并，即使两个位置最终来自同一个声明。 */
function projectedMatches(projection: Projection, name: string): (LocalReferenceRange | null)[] {
  return projection.names.flatMap((column, index) => column === name ? [projection.origins?.[index] ?? null] : []);
}

/** 空列表证明可见输入中没有该名称，未知目录和不完整投影不能当作缺列。 */
function projectedInputMatches(name: string, levels: ScopedRelation[][]): (LocalReferenceRange | null)[] | undefined {
  for (const level of levels) {
    const projections = level.map(relation => relation.projection);
    if (!projections.every(knownProjection)) return;
    const matches = projections.flatMap(projection => projectedMatches(projection, name));
    if (matches.length) return matches;
  }
  return [];
}

function recordProjectedMatch(token: PostgresEditorToken, matches: (LocalReferenceRange | null)[] | undefined, trace: ReferenceTrace): void {
  if (matches?.length === 1 && matches[0] && token.start !== matches[0].start) trace.edges.set(token, matches[0]);
}

function recordProjectedColumn(token: PostgresEditorToken, name: string, levels: ScopedRelation[][], trace: ReferenceTrace): void {
  recordProjectedMatch(token, projectedInputMatches(name, levels), trace);
}

/** 只在已确认的表达式位置收集字段，限定名沿查询块遮蔽规则解析。 */
function traceField(parts: Part[], i: number, visible: ScopedRelation[][], trace: ReferenceTrace, bare: boolean): void {
  const token = parts[i], name = identifier(token), before = parts[i - 1], after = parts[i + 1];
  const field = trace.field;
  if (!name || token.kind === 'group' || field && (token.start > field.offset || field.offset > token.end) || stop.has(keyword(token)) ||
      punct(after, '.') || after?.kind === 'group' && after.closing === ')' ||
      punct(after, '=') && punct(parts[i + 2], '>') || punct(after, ':') && punct(parts[i + 2], '=')) return;
  let candidates: ScopedRelation[] | undefined;
  if (punct(before, '.')) {
    const owner = identifier(parts[i - 2]);
    const scoped = punct(parts[i - 3], '.');
    const schema = scoped ? identifier(parts[i - 4]) : undefined;
    const prefix = parts[i - (scoped ? 5 : 3)];
    if (!owner || scoped && !schema || punct(prefix, '.') || punct(prefix, ':') || ['AS', 'COLLATE'].includes(keyword(prefix))) return;
    for (const scope of visible) {
      const matches = scope.filter(relation => schema ? !relation.alias && relation.name === owner && relation.schema === schema :
        (relation.alias ?? relation.name) === owner);
      if (!matches.length) continue;
      if (matches.length === 1) candidates = matches;
      break;
    }
  } else if (bare && (bareFieldPrefix.has(keyword(before)) || before?.kind === 'punct' && expressionOperators.has(before.text))) {
    const levels = visible.map(scope => scope.filter(relation => !relation.qualifiedOnly));
    if (trace.projected) {
      if (trace.projectionRename && levels.some(level => level.length) && levels.every(level => level.every(relation => relation.physical)))
        trace.projectionRename.separate.add(token.start);
      recordProjectedColumn(token, name, levels, trace);
      return;
    }
    candidates = levels.find(scope => scope.length);
  }
  if (trace.projected) {
    if (candidates?.length === 1) {
      if (candidates[0].physical) trace.projectionRename?.separate.add(token.start);
      recordProjectedColumn(token, name, [candidates], trace);
    }
    return;
  }
  if (!field || !candidates?.length || candidates.length > limits.relations || candidates.some(relation => !relation.physical)) return;
  field.target = { ...rangeOf(token), name, relations: candidates.map(({ name, schema, alias }) => ({ name, schema, alias })) };
}

/** 表达式子查询沿用可见的父查询；表来源自身的括号已经按 LATERAL 规则处理。 */
function traceExpressions(parts: Part[], scope: Scope, refs: ScopedRelation[], outer: ScopedRelation[][],
  relations: ReadonlyMap<number, RelationSpan>, trace: ReferenceTrace): void {
  const levels = [refs, ...outer];
  const update = keyword(parts[0]) === 'UPDATE';
  const bareSelect = !!(trace.field || trace.projected) && keyword(parts[0]) === 'SELECT' &&
    !parts.some(part => ['NATURAL', 'USING'].includes(keyword(part)));
  let bare = bareSelect;
  let joinStart = 0, lastRelation = -1;
  let inAssignments = false, assignmentTarget = false;
  for (let i = 0; i < parts.length && !trace.unsupported; i++) {
    const part = parts[i], word = keyword(part), span = relations.get(i);
    if (span) {
      lastRelation = span.joined ? -1 : span.relation;
      if (word === 'FROM' || word === 'USING' || punct(part, ',')) joinStart = span.relation;
      levels[0] = refs;
      inAssignments = false;
      bare = false;
      i = span.end - 1;
      continue;
    }
    if (declaredTableSyntax.has(word) && parts[i + 1]?.kind === 'group' && !punct(parts[i - 1], '.')) {
      trace.unsupported = true;
      return;
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
    if (endsFrom.has(word) || word === 'ON') bare = bareSelect && (word === 'WHERE' || word === 'ON');
    if (part.kind === 'group') {
      const command = keyword(part.parts[0]);
      if (referenceCommands.has(command)) parseQuery(part.parts, scope, levels, undefined, trace);
      else traceExpressions(part.parts, scope, levels[0], outer, new Map(), trace);
    } else {
      traceQualifier(parts, i, levels, trace);
      if (trace.field || trace.projected) traceField(parts, i, levels, trace, bare);
    }
  }
}

/** ORDER BY 的单独列名优先绑定输出列。表达式内同名字段仍走各自的来源作用域。 */
function traceProjectionOrder(parts: Part[], projection: Projection, trace: ReferenceTrace, input?: ScopedRelation[][]): void {
  if (!knownProjection(projection)) return;
  const order = parts.findIndex((part, index) => keyword(part) === 'ORDER' && keyword(parts[index + 1]) === 'BY');
  if (order < 0) return;
  let start = order + 2;
  for (let end = start; end <= parts.length; end++) {
    const done = end === parts.length || ['LIMIT', 'OFFSET', 'FETCH', 'FOR'].includes(keyword(parts[end]));
    if (!done && !punct(parts[end], ',')) continue;
    const token = parts[start], name = identifier(token);
    if (start < end && token.kind !== 'group' && name) {
      let tail = start + 1;
      if (['ASC', 'DESC'].includes(keyword(parts[tail]))) tail++;
      if (keyword(parts[tail]) === 'NULLS' && ['FIRST', 'LAST'].includes(keyword(parts[tail + 1]))) tail += 2;
      if (tail === end) traceOutputFirst(token, name, projection, trace, input);
    }
    if (done) break;
    start = end + 1;
  }
}

function traceOutputFirst(token: PostgresEditorToken, name: string, projection: Projection, trace: ReferenceTrace, input?: ScopedRelation[][]): void {
  if (!knownProjection(projection)) return;
  const matches = projectedMatches(projection, name);
  if (matches.length) recordProjectedMatch(token, matches, trace);
  else if (input) recordProjectedColumn(token, name, input, trace);
}

/** GROUP BY 的裸名称先查本层输入，再查输出；两处均无匹配时才看可关联的外层列。 */
function traceGroupingName(token: PostgresEditorToken, name: string, projection: Projection, input: ScopedRelation[][],
  merged: boolean, trace: ReferenceTrace): void {
  const current = projectedInputMatches(name, input.slice(0, 1));
  if (!current) return;
  if (current.length) {
    if (!merged) recordProjectedMatch(token, current, trace);
    return;
  }
  traceOutputFirst(token, name, projection, trace, input.slice(1));
}

/** 分组集合中的隐式行括号可展开为单独分组项。显式 ROW 和普通函数仍按表达式处理。 */
function traceGroupingItems(parts: Part[], visit: (token: PostgresEditorToken, name: string) => void): void {
  let start = 0;
  for (let end = 0; end <= parts.length; end++) {
    if (end !== parts.length && !punct(parts[end], ',')) continue;
    const leading = parts[start], word = keyword(leading);
    if (end === start + 1) {
      if (leading.kind === 'group' && leading.closing === ')') traceGroupingItems(leading.parts, visit);
      else {
        const name = identifier(leading);
        if (leading.kind !== 'group' && name && !stop.has(word)) visit(leading, name);
      }
    } else if (end > start) {
      const group = parts[end - 1];
      if (group.kind === 'group' && group.closing === ')' &&
          (end === start + 2 && ['ROLLUP', 'CUBE'].includes(word) ||
           end === start + 3 && word === 'GROUPING' && keyword(parts[start + 1]) === 'SETS')) traceGroupingItems(group.parts, visit);
    }
    start = end + 1;
  }
}

/** DISTINCT ON 采用输出优先，但多列表达式括号不是可展开的分组集合。 */
function traceDistinctOn(parts: Part[], projection: Projection, input: ScopedRelation[][], trace: ReferenceTrace): void {
  const group = parts[3];
  if (keyword(parts[1]) !== 'DISTINCT' || keyword(parts[2]) !== 'ON' || group?.kind !== 'group' || group.closing !== ')') return;
  let start = 0;
  for (let end = 0; end <= group.parts.length; end++) {
    if (end !== group.parts.length && !punct(group.parts[end], ',')) continue;
    if (end === start + 1) {
      let token = group.parts[start];
      while (token.kind === 'group' && token.closing === ')' && token.parts.length === 1) token = token.parts[0];
      const name = identifier(token);
      if (token.kind !== 'group' && name && !stop.has(keyword(token))) traceOutputFirst(token, name, projection, trace, input);
    }
    start = end + 1;
  }
}

function traceProjectionGrouping(parts: Part[], projection: Projection, input: ScopedRelation[][], trace: ReferenceTrace): void {
  const group = parts.findIndex((part, index) => keyword(part) === 'GROUP' && keyword(parts[index + 1]) === 'BY');
  if (group < 0) return;
  let start = group + 2;
  if (['ALL', 'DISTINCT'].includes(keyword(parts[start]))) start++;
  const boundary = parts.findIndex((part, index) => index >= start && endsFrom.has(keyword(part)));
  const merged = parts.slice(0, group).some(part => ['NATURAL', 'USING'].includes(keyword(part)));
  traceGroupingItems(parts.slice(start, boundary >= 0 ? boundary : undefined), (token, name) =>
    traceGroupingName(token, name, projection, input, merged, trace));
}

interface WindowShape { parent?: PostgresEditorToken; partition: boolean; order: boolean; frame: boolean; }
interface NamedWindow extends WindowShape {
  name: string;
  token: PostgresEditorToken;
  definition: Group;
  valid: boolean;
}
const windowFrameWords = new Set(['ROWS', 'RANGE', 'GROUPS']);
const windowSpecWords = new Set(['PARTITION', 'ORDER', ...windowFrameWords]);
const windowTail = new Set(['ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR']);

function windowToken(part?: Part): PostgresEditorToken | undefined {
  const name = identifier(part);
  return part && part.kind !== 'group' && name && !stop.has(keyword(part)) &&
    new TextEncoder().encode(name).length <= 63 ? part : undefined;
}

/** 窗口规范只看当前括号层。把 ORDER BY rows 或 x.rows 这样的字段和真实窗口帧分开。 */
function windowShape(parts: Part[]): WindowShape {
  const by = (word: string) => parts.some((part, index) =>
    keyword(part) === word && keyword(parts[index + 1]) === 'BY' && !punct(parts[index - 1], '.'));
  let lastBoundary = -1;
  parts.forEach((part, index) => {
    const word = keyword(part);
    if (word === 'PRECEDING' || word === 'FOLLOWING' || word === 'CURRENT' && keyword(parts[index + 1]) === 'ROW') lastBoundary = index;
  });
  const frame = parts.some((part, index) => {
    if (index >= lastBoundary || !windowFrameWords.has(keyword(part))) return false;
    const previous = parts[index - 1], next = parts[index + 1];
    return !(previous?.kind === 'punct' && !/^\d$/.test(previous.text)) &&
      !['BY', 'COLLATE', 'WHEN', 'THEN', 'ELSE', 'AND', 'OR'].includes(keyword(previous)) &&
      !punct(next, ',') && !punct(next, '.');
  });
  return { parent: windowSpecWords.has(keyword(parts[0])) ? undefined : windowToken(parts[0]),
    partition: by('PARTITION'), order: by('ORDER'), frame };
}

const acceptsWindowBase = (window: NamedWindow, shape: WindowShape) =>
  window.valid && !window.frame && !shape.partition && !(window.order && shape.order);

/** WINDOW 列表按声明顺序构造。继承的排序也计入后续窗口的排序重定义约束。 */
function namedWindows(parts: Part[]): NamedWindow[] | undefined {
  const at = parts.findIndex((part, index) => keyword(part) === 'WINDOW' && !punct(parts[index - 1], '.'));
  if (at < 0) return [];
  const windows = new Map<string, NamedWindow>();
  let index = at + 1;
  for (;;) {
    const token = windowToken(parts[index]), name = identifier(token);
    const definition = parts[index + 2];
    if (!token || !name || windows.has(name) || windows.size >= limits.items ||
      keyword(parts[index + 1]) !== 'AS' || definition?.kind !== 'group' || definition.closing !== ')') return;
    const shape = windowShape(definition.parts), parent = identifier(shape.parent);
    const base = parent === undefined ? undefined : windows.get(parent);
    windows.set(name, { ...shape, name, token, definition, order: shape.order || base?.order === true,
      valid: definition.closed && (parent === undefined || !!base && acceptsWindowBase(base, shape)) });
    index += 3;
    if (!punct(parts[index], ',')) break;
    index++;
  }
  if (parts[index] && !windowTail.has(keyword(parts[index]))) return;
  return [...windows.values()];
}

/** OVER 只能跟在函数调用或它的 FILTER、WITHIN GROUP 之后。子查询另有 WINDOW 名称空间。 */
function visitWindowCalls(parts: Part[], visit: (over: PostgresEditorToken, target?: Part) => void): void {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === 'group') {
      if (!referenceCommands.has(keyword(part.parts[0]))) visitWindowCalls(part.parts, visit);
      continue;
    }
    if (keyword(part) !== 'OVER') continue;
    let call = i - 1;
    if (keyword(parts[call - 1]) === 'FILTER') call -= 2;
    if (keyword(parts[call - 1]) === 'GROUP' && keyword(parts[call - 2]) === 'WITHIN') call -= 3;
    const args = parts[call], name = parts[call - 1];
    if (args?.kind !== 'group' || args.closing !== ')' || !args.closed || !windowToken(name) ||
      punct(parts[call - 2], '::') || punct(parts[call - 2], ':')) continue;
    visit(part, parts[i + 1]);
    if (parts[i + 1]?.kind === 'group') i++;
  }
}

function selectWindowCalls(parts: Part[], visit: (over: PostgresEditorToken, target?: Part) => void): void {
  const boundary = parts.findIndex(part => endsFrom.has(keyword(part)) || keyword(part) === 'FROM');
  visitWindowCalls(parts.slice(1, boundary < 0 ? undefined : boundary), visit);
  const order = parts.findIndex((part, index) => keyword(part) === 'ORDER' && keyword(parts[index + 1]) === 'BY');
  if (order < 0) return;
  const end = parts.findIndex((part, index) => index > order + 1 && windowTail.has(keyword(part)));
  visitWindowCalls(parts.slice(order + 2, end < 0 ? undefined : end), visit);
}

/** 补全只在裸 OVER 后或规范首词的名称位置触发，不查询目录。 */
function completeWindowNames(parts: Part[], context: QueryContext): PostgresCompletionAnalysis['windows'] {
  let names: PostgresCompletionAnalysis['windows'];
  const windows = namedWindows(parts);
  const inline = (group: Group, allowed: NamedWindow[]) => {
    if (!contains(group, context.offset)) return;
    const first = group.parts[0];
    if (first) {
      const clause = windowSpecWords.has(keyword(first));
      const beforeClause = clause && context.offset < first.start;
      const replacingName = !clause && ['word', 'identifier'].includes(first.kind) && first.start === context.start;
      if (!beforeClause && !replacingName) return;
    }
    const shape = windowShape(group.parts);
    names = { inline: true, names: allowed.filter(window => acceptsWindowBase(window, shape)).map(window => window.name) };
  };
  selectWindowCalls(parts, (over, target) => {
    if (target?.kind === 'group') {
      if (target.closing === ')') inline(target, windows ?? []);
    } else if (context.left.at(-1) === over && (!target || context.start < target.start ||
      context.start === target.start && ['identifier', 'word'].includes(target.kind) && !stop.has(keyword(target)))) {
      names = { inline: false, names: (windows ?? []).filter(window => window.valid).map(window => window.name) };
    }
  });
  if (names) return names;
  if (!windows) return;
  for (const [index, window] of windows.entries()) {
    inline(window.definition, windows.slice(0, index));
    if (names) return names;
  }
}

/** 记录本块专用的名称位置，改名时不把同名字段或内层窗口算进这个名称空间。 */
function traceNamedWindows(parts: Part[], trace: ReferenceTrace): void {
  const windows = namedWindows(parts);
  if (!windows?.length) return;
  const slots = windows.map(window => window.token);
  const visible = new Map<string, NamedWindow>();
  const record = (target?: PostgresEditorToken, shape?: WindowShape) => {
    if (!target) return;
    slots.push(target);
    const window = visible.get(identifier(target)!);
    if (window && (!shape || acceptsWindowBase(window, shape))) trace.edges.set(target, window.token);
  };
  for (const window of windows) {
    trace.declarations.set(window.token.start, 'window');
    trace.windowSlots.set(window.token.start, slots);
    record(window.parent, windowShape(window.definition.parts));
    visible.set(window.name, window);
  }
  selectWindowCalls(parts, (_over, target) => {
    if (target?.kind === 'group' && target.closing === ')') {
      const shape = windowShape(target.parts);
      record(shape.parent, shape);
    } else record(windowToken(target));
  });
}

/** OLD/NEW 共享目标列，只能作为 RETURNING 的限定名。默认名称让位给已有关系。 */
function returningScope(parts: Part[], refs: ScopedRelation[], outer: ScopedRelation[][],
  target: ScopedRelation, trace?: ReferenceTrace): { refs: ScopedRelation[]; start: number } | undefined {
  const names = new Set([refs, ...outer].flat().map(ref => ref.alias ?? ref.name));
  const visible = [...refs], specified = new Set<string>();
  const addAlias = (alias: string, declaration?: Part) => {
    if (declaration) trace?.declarations.set(declaration.start, 'alias');
    visible.push({ ...target, alias, declaration, qualifiedOnly: true });
  };
  let start = 0;
  if (keyword(parts[0]) === 'WITH') {
    const options = parts[1];
    if (options?.kind !== 'group' || !options.closed || options.closing !== ')' || options.parts.length % 4 !== 3) return;
    for (let i = 0; i < options.parts.length; i += 4) {
      const role = keyword(options.parts[i]), declaration = options.parts[i + 2], alias = identifier(declaration);
      if (!['OLD', 'NEW'].includes(role) || specified.has(role) || keyword(options.parts[i + 1]) !== 'AS' ||
          !alias || stop.has(keyword(declaration)) || names.has(alias) ||
          i + 3 < options.parts.length && !punct(options.parts[i + 3], ',')) return;
      specified.add(role);
      names.add(alias);
      addAlias(alias, declaration);
    }
    start = 2;
  }
  for (const role of ['OLD', 'NEW']) {
    const name = role.toLowerCase();
    if (!specified.has(role) && !names.has(name)) addAlias(name);
  }
  return { refs: visible, start };
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

/** INSERT 的显式 AS 和真实目标表由引用与返回列补全共用。 */
function readInsertTarget(parts: Part[], trace?: ReferenceTrace): { target: ScopedRelation; next: number } | undefined {
  if (keyword(parts[1]) !== 'INTO') return;
  let index = 2, name = identifier(parts[index]), schema: string | undefined;
  if (!name || stop.has(keyword(parts[index++]))) return;
  if (punct(parts[index], '.')) {
    schema = name;
    name = identifier(parts[index + 1]);
    index += 2;
    if (!name || stop.has(keyword(parts[index - 1]))) return;
  }
  trace?.physicalRelations?.push({ name, ...(schema ? { schema } : {}), start: parts[2].start, end: parts[index - 1].end });
  const target: ScopedRelation = { name, schema, physical: true };
  if (keyword(parts[index]) === 'AS') {
    const declaration = parts[index + 1], alias = identifier(declaration);
    if (!alias || stop.has(keyword(declaration))) return;
    target.alias = alias;
    target.declaration = declaration;
    trace?.declarations.set(declaration.start, 'alias');
    index += 2;
  }
  return { target, next: index };
}

/** 括号中的查询属于读取来源，列清单及 OVERRIDING 仍属于 INSERT 自己的头部。 */
function readInsertSource(parts: Part[], start: number, strict = false): { start: number; columns?: Group } | undefined {
  const first = parts[start];
  let columns: Group | undefined;
  if (first?.kind === 'group' && !startsReferenceQuery(first)) {
    if (first.closing !== ')' || strict && !identifier(first.parts[0])) return;
    columns = first;
    start++;
  }
  if (keyword(parts[start]) === 'OVERRIDING') {
    if (['SYSTEM', 'USER'].includes(keyword(parts[start + 1])) && keyword(parts[start + 2]) === 'VALUE') start += 3;
    else if (strict) return;
  }
  return { start, columns };
}

/** 来源的 JOIN 条件也可能写作 ON conflict。只有与动作配对的最后一组关键字才是冲突子句。 */
function readConflictAction(parts: Part[], start: number, end: number): { on: number; action: number } | null | undefined {
  const action = parts.findIndex((_, index) => index >= start && index + 1 < end && mergeKeyword(parts, index) === 'DO' &&
    ['UPDATE', 'NOTHING'].includes(mergeKeyword(parts, index + 1)));
  if (action < 0) return;
  for (let on = action - 2; on >= start; on--) {
    if (mergeKeyword(parts, on) === 'ON' && mergeKeyword(parts, on + 1) === 'CONFLICT') return { on, action };
  }
  return null;
}

/** 没有 DO 动作时，只接受不会被读取来源的 JOIN 吸收的 ON CONFLICT。 */
function pendingConflictOn(parts: Part[], start: number, end: number): number | undefined {
  if (!startsReferenceQuery(parts[start]) && keyword(parts[start]) !== 'DEFAULT') return;
  let awaitingCondition = 0;
  for (let index = start; index < end; index++) {
    const join = mergeJoin(parts, index);
    if (join) {
      if (join.qualified) awaitingCondition++;
      index = join.next - 1;
      continue;
    }
    const word = mergeKeyword(parts, index);
    if (word !== 'ON' && word !== 'USING') continue;
    if (awaitingCondition) awaitingCondition--;
    else if (word === 'ON' && index + 1 < end && keyword(parts[index + 1]) === 'CONFLICT') return index;
  }
}

/** 保护手写表达式和谓词。只在单标识符位置给出完整键组或约束名。 */
function completeConflictTarget(parts: Part[], context: QueryContext, target: ScopedRelation, afterConflict: number,
  allowExclusion: boolean): Query | undefined {
  const { name, schema } = target;
  if (!name || [name, schema].some(value => value && new TextEncoder().encode(value).length > 63)) return;
  const relation = { name, ...(schema ? { schema } : {}) };
  const nameSlot = (items: Part[], open: number) => !items.length ? context.start === context.offset && context.offset >= open
    : items.length === 1 && ['word', 'identifier'].includes(items[0].kind) && items[0].start === context.start;
  const [first, second] = parts;
  if (keyword(first) === 'ON' && keyword(second) === 'CONSTRAINT' && nameSlot(parts.slice(2), second.end)) {
    return { kind: 'conflictTarget', relation, selection: { mode: 'constraint', ...(allowExclusion ? { allowExclusion: true } : {}) } };
  }
  if (parts.length === 1 && first.kind === 'group') {
    const used = activeColumnList(first, context);
    if (used && used.length <= 31) return { kind: 'conflictTarget', relation, selection: { mode: 'key', used } };
  } else if (nameSlot(parts, afterConflict)) {
    return { kind: 'conflictTarget', relation, selection: { mode: 'key', whole: true, used: [] } };
  }
}

/** INSERT 来源独立解析。目标只在冲突索引、更新动作和 RETURNING 的相应范围可见。 */
function traceInsert(parts: Part[], scope: Scope, outer: ScopedRelation[][], trace: ReferenceTrace): Projection | undefined {
  const destination = readInsertTarget(parts, trace);
  if (!destination) return;
  const { target } = destination;
  const header = readInsertSource(parts, destination.next, true);
  if (!header) return;
  const { start: index } = header;
  const returning = parts.findIndex((_, position) => position >= index && mergeKeyword(parts, position) === 'RETURNING');
  const end = returning < 0 ? parts.length : returning;
  const conflict = readConflictAction(parts, index, end);
  if (conflict === null) return;
  const source = parts.slice(index, conflict?.on ?? end);
  const defaults = source.length === 2 && keyword(source[0]) === 'DEFAULT' && keyword(source[1]) === 'VALUES';
  if (!defaults) {
    if (!startsReferenceQuery(source[0])) return;
    parseQuery(source, scope, outer, undefined, trace);
  }
  if (conflict && !trace.unsupported) {
    const { on, action } = conflict;
    const arbiter = parts.slice(on + 2, action);
    if (!traceConflictTarget(arbiter, scope, target, outer, trace)) return;
    if (keyword(parts[action + 1]) === 'UPDATE') {
      if (!arbiter.length || keyword(parts[action + 2]) !== 'SET') return;
      reserveImplicitName(trace, target.declaration, 'excluded');
      traceExpressions(parts.slice(action + 1, end), scope, [target, { ...target, alias: 'excluded', declaration: undefined, qualifiedOnly: true }], outer, new Map(), trace);
    } else if (action + 2 !== end) return;
  }
  if (trace.unsupported) return;
  if (returning < 0) return unknown;
  return parseReturning(parts.slice(returning), [target], target, { scope, outer, trace, names: new Set() })?.projection;
}

interface RelationAlias { declaration?: Part; alias?: string; names?: string[]; next: number; }

/** 读取关系别名。普通关系列表只重命名列，表函数的带类型列定义由调用方读取。 */
function readRelationAlias(parts: Part[], index: number, columns: boolean): RelationAlias | undefined {
  const explicit = keyword(parts[index]) === 'AS';
  if (explicit) index++;
  const declaration = parts[index];
  const alias = stop.has(keyword(declaration)) ? undefined : identifier(declaration);
  if (!alias) return explicit ? undefined : { next: index };
  if (alias.length > limits.name) return;
  index++;
  let names: string[] | undefined;
  if (columns && parts[index]?.kind === 'group') {
    names = nameList(parts[index]);
    if (!names.length) return;
    index++;
  }
  return { declaration, alias, names, next: index };
}

const specialFunctionSyntax = new Set(['CAST', 'COALESCE', 'EXTRACT', 'GREATEST', 'LEAST', 'NULLIF', 'NORMALIZE',
  'OVERLAY', 'POSITION', 'SUBSTRING', 'TRIM', 'XMLCONCAT', 'XMLELEMENT', 'XMLFOREST', 'XMLPARSE', 'XMLPI', 'XMLROOT',
  'XMLSERIALIZE', 'JSON_ARRAY', 'JSON_OBJECT', 'JSON_QUERY', 'JSON_EXISTS', 'JSON_VALUE']);

interface ParsedFunctionCall { name: string; schema?: string; args: Group; next: number; catalog: boolean; }

function readFunctionCall(parts: Part[], start: number): ParsedFunctionCall | undefined {
  let index = start;
  let name = identifier(parts[index]);
  let schema: string | undefined;
  const word = keyword(parts[index++]);
  if (!name || declaredTableSyntax.has(word) || stop.has(word)) return;
  if (punct(parts[index], '.')) {
    schema = name;
    name = identifier(parts[index + 1]);
    index += 2;
  }
  const args = parts[index];
  if (!name || name.length > limits.name || args?.kind !== 'group' || args.closing !== ')') return;
  const catalog = args.closed && (schema ? schema.length <= limits.name : !specialFunctionSyntax.has(keyword(parts[start])));
  return { name, schema, args, next: index + 1, catalog };
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

/** 特殊表来源的投影只来自语句中的列定义和位置别名。 */
function declaredTableSource(parts: Part[], next: number, name: string, names: string[],
  args: Group[]): TableFunctionSource | false {
  const alias = readRelationAlias(parts, next, true);
  if (!alias || alias.names && alias.names.length > names.length || new Set(names).size !== names.length) return false;
  const projection = rename({ names: names.slice(0, limits.items), stars: [], exact: names.length <= limits.items }, alias.names ?? []);
  return { relation: { name, alias: alias.alias, declaration: alias.declaration, projection }, args, next: alias.next };
}

/** 路径是字符串常量，可有名称。路径名不属于 SQL 关系作用域。 */
function jsonTablePathEnd(parts: Part[], start: number): number | undefined {
  let index = start;
  if (['E', 'N'].includes(keyword(parts[index])) && parts[index].end === parts[index + 1]?.start) index++;
  if (keyword(parts[index]) === 'U' && punct(parts[index + 1], '&') && parts[index].end === parts[index + 1].start &&
      parts[index + 1].end === parts[index + 2]?.start) index += 2;
  const literal = parts[index++];
  if (literal?.kind !== 'blocked' || literal.text || literal.open) return;
  if (keyword(parts[index]) === 'UESCAPE') {
    const escape = parts[index + 1];
    if (escape?.kind !== 'blocked' || escape.text || escape.open) return;
    index += 2;
  }
  if (keyword(parts[index]) === 'AS') {
    if (!identifier(parts[index + 1])) return;
    index += 2;
  }
  return index;
}

/** NESTED PATH 的列按声明位置展开，路径、列类型和 DEFAULT 不参与关系绑定。 */
function jsonTableColumns(group: Part | undefined, names: string[]): boolean {
  if (group?.kind !== 'group' || group.closing !== ')' || !group.closed) return false;
  const parts = group.parts;
  let start = 0;
  for (let end = 0; end <= parts.length; end++) {
    if (end < parts.length && !punct(parts[end], ',')) continue;
    const column = parts.slice(start, end);
    const [first, second] = column;
    const path = keyword(first) === 'NESTED' ? jsonTablePathEnd(column, keyword(second) === 'PATH' ? 2 : 1) : undefined;
    if (path !== undefined) {
      if (keyword(column[path]) !== 'COLUMNS' || path + 2 !== column.length || !jsonTableColumns(column[path + 1], names)) return false;
    } else {
      if (keyword(first) === 'NESTED' && column.some(part => keyword(part) === 'COLUMNS')) return false;
      const name = identifier(first);
      if (!name || name.length > limits.name || !identifier(second)) return false;
      if (keyword(second) === 'FOR' && (keyword(column[2]) !== 'ORDINALITY' || column.length !== 3)) return false;
      names.push(name);
    }
    start = end + 1;
  }
  return true;
}

/** 只把文档和 PASSING 的值表达式交给公共表函数的引用与补全逻辑。 */
function readJsonTable(parts: Part[], start: number, partial: boolean): TableFunctionSource | false {
  const body = parts[start + 1];
  if (body?.kind !== 'group' || body.closing !== ')' || !partial && !body.closed) return false;
  const tokens = body.parts;
  const comma = tokens.findIndex(part => punct(part, ','));
  if (comma === 0) return false;
  const args: Group[] = [{ kind: 'group', closing: ')', closed: false, start: body.start,
    end: comma < 0 ? body.end - Number(body.closed) : tokens[comma].start, parts: comma < 0 ? tokens : tokens.slice(0, comma) }];
  let index = comma < 0 ? undefined : jsonTablePathEnd(tokens, comma + 1);
  if (index !== undefined && keyword(tokens[index]) === 'PASSING') {
    index++;
    while (true) {
      const first = index;
      while (index < tokens.length && !punct(tokens[index], ',') &&
          !(keyword(tokens[index]) === 'COLUMNS' && !punct(tokens[index - 1], '.') && keyword(tokens[index - 1]) !== 'AS')) index++;
      const alias = index - 2;
      if (alias <= first || keyword(tokens[alias]) !== 'AS' || !identifier(tokens[alias + 1])) {
        if (!partial || index < tokens.length) return false;
        args.push({ kind: 'group', closing: ')', closed: false, start: tokens[first - 1].end - 1,
          end: body.end - Number(body.closed), parts: tokens.slice(first) });
        break;
      }
      args.push({ kind: 'group', closing: ')', closed: false, start: tokens[first - 1].end - 1,
        end: tokens[alias].start, parts: tokens.slice(first, alias) });
      if (!punct(tokens[index], ',')) break;
      index++;
    }
  }
  const relation: ScopedRelation = { name: 'json_table', projection: unknown };
  if (index === undefined || keyword(tokens[index]) !== 'COLUMNS') return partial ? { relation, args, next: start + 2 } : false;
  const names: string[] = [];
  if (!jsonTableColumns(tokens[index + 1], names)) return false;
  const suffix = tokens.slice(index + 2);
  if (suffix.length && !['ERROR ON ERROR', 'EMPTY ON ERROR', 'EMPTY ARRAY ON ERROR'].includes(suffix.map(keyword).join(' '))) return false;
  return declaredTableSource(parts, start + 2, relation.name, names, args);
}

/** 保留表达式首尾的空白范围，让尚未输入第一个词或未完成限定名时仍可补全。 */
function xmlTableExpression(body: Group, first: number, last: number): Group {
  const { parts } = body;
  return { kind: 'group', closing: ')', closed: false, start: (parts[first - 1]?.end ?? body.start + 1) - 1,
    end: parts[last]?.start ?? body.end - Number(body.closed), parts: parts.slice(first, last) };
}

/** 点号后的同名词和类型限定词仍属于原表达式，不是 XMLTABLE 子句。 */
function xmlClause(parts: Part[], index: number): string {
  return punct(parts[index - 1], '.') || punct(parts[index - 1], ':') || punct(parts[index + 1], '.')
    ? '' : keyword(parts[index]);
}

function findXmlClause(parts: Part[], start: number, clause: string): number {
  let cases = 0;
  for (let i = start; i < parts.length; i++) {
    const word = xmlClause(parts, i);
    if (word === 'CASE') cases++;
    if (word === 'END' && cases) cases--;
    if (!cases && i > start && word === clause) return i;
  }
  return -1;
}

/** PATH 和 DEFAULT 是 SQL 表达式。类型、列名和 NULL 约束保留在声明区域。 */
function xmlTableColumn(column: Group, args: Group[], partial: boolean): string | undefined {
  const { parts } = column;
  const name = identifier(parts[0]);
  if (!name || name.length > limits.name || !identifier(parts[1])) return;
  if (keyword(parts[1]) === 'FOR') return parts.length === 3 && keyword(parts[2]) === 'ORDINALITY' ? name : undefined;
  if (keyword(parts[1]) === 'SETOF') return;
  const options = new Set<string>();
  let first: number | undefined, cases = 0;
  for (let i = 2; i < parts.length; i++) {
    const word = xmlClause(parts, i);
    const preceding = parts[i - 1];
    if (word === 'CASE') cases++;
    if (word === 'END' && cases) { cases--; continue; }
    if (cases || i === first || preceding.kind === 'punct' && expressionOperators.has(preceding.text)) continue;
    const notNull = word === 'NOT' && keyword(parts[i + 1]) === 'NULL';
    const option = notNull ? 'NULL' : word;
    if (option !== 'PATH' && option !== 'DEFAULT' && option !== 'NULL') continue;
    if (options.has(option)) return;
    options.add(option);
    if (first !== undefined) args.push(xmlTableExpression(column, first, i));
    if (notNull) i++;
    first = option === 'NULL' ? undefined : i + 1;
  }
  if (first !== undefined) {
    if (first === parts.length && !partial) return;
    args.push(xmlTableExpression(column, first, parts.length));
  }
  return name;
}

/** 命名空间 URI、行路径、文档、列路径和默认值共用前序 FROM 来源。 */
function readXmlTable(parts: Part[], start: number, partial: boolean): TableFunctionSource | false {
  const body = parts[start + 1];
  if (body?.kind !== 'group' || body.closing !== ')' || !partial && !body.closed) return false;
  const tokens = body.parts;
  const args: Group[] = [];
  const next = start + 2;
  const pending = { relation: { name: 'xmltable', projection: unknown }, args, next };
  let row = 0;
  const namespaces = tokens[1];
  if (keyword(tokens[0]) === 'XMLNAMESPACES' && namespaces?.kind === 'group' && namespaces.closing === ')') {
    let first = 0;
    for (let end = 0; end <= namespaces.parts.length; end++) {
      if (end < namespaces.parts.length && !punct(namespaces.parts[end], ',')) continue;
      const alias = end - 2;
      if (keyword(namespaces.parts[first]) === 'DEFAULT' && end > first + 1) {
        args.push(xmlTableExpression(namespaces, first + 1, end));
      } else if (alias > first && keyword(namespaces.parts[alias]) === 'AS' && identifier(namespaces.parts[alias + 1])) {
        args.push(xmlTableExpression(namespaces, first, alias));
      } else if (partial && end === namespaces.parts.length && !namespaces.closed) {
        const boundary = namespaces.parts.findIndex((part, index) => index >= first && keyword(part) === 'AS');
        args.push(xmlTableExpression(namespaces, first, boundary < 0 ? end : boundary));
      } else return false;
      first = end + 1;
    }
    if (!punct(tokens[2], ',')) return partial ? pending : false;
    row = 3;
  }
  const passing = findXmlClause(tokens, row, 'PASSING');
  args.push(xmlTableExpression(body, row, passing < 0 ? tokens.length : passing));
  if (passing < 0) return partial ? pending : false;
  const by = (index: number) => xmlClause(tokens, index) === 'BY' && ['REF', 'VALUE'].includes(keyword(tokens[index + 1]));
  const document = passing + (by(passing + 1) ? 3 : 1);
  const columns = findXmlClause(tokens, document, 'COLUMNS');
  let end = columns < 0 ? tokens.length : columns;
  if (end - 2 >= document && by(end - 2)) end -= 2;
  args.push(xmlTableExpression(body, document, end));
  if (columns < 0 || end <= document) return partial ? pending : false;

  const names: string[] = [];
  let first = columns + 1, ordinal = false;
  for (let last = first; last <= tokens.length; last++) {
    if (last < tokens.length && !punct(tokens[last], ',')) continue;
    const column = xmlTableExpression(body, first, last);
    const name = xmlTableColumn(column, args, partial);
    if (!name) return partial && last === tokens.length ? pending : false;
    if (keyword(tokens[first + 1]) === 'FOR') {
      if (ordinal) return false;
      ordinal = true;
    }
    names.push(name);
    first = last + 1;
  }
  return declaredTableSource(parts, next, 'xmltable', names, args);
}

/** 未知函数列数时，只有确定越过位置别名的后续声明列才保留原名。 */
function tableFunctionProjection(calls: ParsedFunctionCall[], members: (string[] | undefined)[], aliases: string[],
  ordinal: boolean, scalarAlias?: string): Projection {
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
  type Layout = NonNullable<PostgresCompletionReference['functionLayout']>;
  const layout = calls.map((call, index): Layout['members'][number] => {
    const declared = members[index];
    if (declared) return { kind: 'declared', names: declared };
    const argumentCount = call.args.parts.length ? 1 + call.args.parts.filter(part => punct(part, ',')).length : 0;
    // 多参数 unnest 可能由 PostgreSQL 拆成多个调用，不能使用单次目录签名推断。
    if (!call.catalog || !call.schema && call.name === 'unnest' && argumentCount > 1) return { kind: 'unknown' };
    return { kind: 'function', name: call.name, ...(call.schema ? { schema: call.schema } : {}),
      call: { argumentCount, ...(calls.length === 1 && scalarAlias ? { scalarAlias } : {}) } };
  });
  const routines = layout.filter(member => member.kind === 'function');
  // 有位置别名时保留成员顺序，目录用已确认的最小列数证明哪些名称尚未被覆盖。
  const stars: PostgresCompletionReference[] = aliases.length
    ? layout.length <= limits.relations && routines.length && !members.some(member => member && member.length > limits.items)
      ? [{ name: calls[0].name, functionLayout: { aliasCount: aliases.length, ...(ordinal ? { ordinality: true } : {}), members: layout } }]
      : []
    : routines.map(member => ({ name: member.name, ...(member.schema ? { schema: member.schema } : {}), functionCall: member.call }));
  return { names: names.slice(0, limits.items), stars: stars.length <= limits.relations ? stars : [],
    exact: exact && aliases.length <= knownWidth && knownWidth <= limits.items };
}

/** ROWS FROM 的各个实参共享外部可见关系，函数名和成员列定义不会引入新的关系别名。 */
function readTableFunction(parts: Part[], start: number, partial: boolean): TableFunctionSource | false | undefined {
  const syntax = keyword(parts[start]);
  if (parts[start + 1]?.kind === 'group') {
    if (syntax === 'JSON_TABLE') return readJsonTable(parts, start, partial);
    if (syntax === 'XMLTABLE') return readXmlTable(parts, start, partial);
  }
  const rows = keyword(parts[start]) === 'ROWS' && keyword(parts[start + 1]) === 'FROM';
  const group = parts[start + 2];
  if (rows && (group?.kind !== 'group' || group.closing !== ')')) return false;
  const body = rows && group.kind === 'group' ? group.parts : parts;
  const first = readFunctionCall(body, rows ? 0 : start);
  if (!first) return rows ? false : undefined;
  const calls = [first];
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
      calls.push(member);
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
      if (calls.length !== 1 || members[0] || ordinal || !names) return false;
      members[0] = names;
    }
    next++;
  }
  return { relation: { name: first.name, alias: renamed.alias, declaration: renamed.declaration,
    projection: tableFunctionProjection(calls, members, aliases, ordinal, renamed.alias) }, args: calls.map(call => call.args), next };
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

interface RowLockRelation {
  name: string;
  allowed: boolean;
  declaration?: LocalReferenceRange;
  physical?: PostgresCatalogRelation;
}

interface MergeAnalysis {
  scope: Scope;
  outer: ScopedRelation[][];
  context?: QueryContext;
  trace?: ReferenceTrace;
  active?: Parsed;
  names: Set<string>;
  joinConditionsOnly?: boolean;
  rowLocks?: RowLockRelation[];
}

/** 引用和补全沿用同一作用域，补全只进入包含光标的表达式或子查询。 */
function mergeExpression(parts: Part[], refs: ScopedRelation[], analysis: MergeAnalysis, start: number, end: number,
  options?: { joinCondition?: boolean; outputs?: Projection[] }): void {
  const { context, scope, outer, trace } = analysis;
  if (trace) {
    traceExpressions(parts, scope, refs, outer, new Map(), trace);
  } else if (context && (!analysis.joinConditionsOnly || options?.joinCondition) && !analysis.active && context.offset >= start && context.offset <= end) {
    const cursorGroup = parts.find(part => part.kind === 'group' && contains(part, context.offset));
    let group = cursorGroup;
    while (group?.kind === 'group') {
      if (commands.has(keyword(group.parts[0]))) {
        analysis.active = parseQuery(group.parts, scope, [refs, ...outer], context);
        return;
      }
      group = group.parts.find(part => part.kind === 'group' && contains(part, context.offset));
    }
    const qualifier = punct(context.left.at(-1), '.') ? identifier(context.left.at(-2)) : undefined;
    const routine = !qualifier || !analysis.names.has(qualifier) ? expressionRoutine(parts, context.left, cursorGroup, [refs, ...outer], start) : undefined;
    analysis.active = { projection: unknown,
      query: keyword(context.left.at(-1)) === 'AS' ? undefined : columns(refs, outer, context.left, options?.outputs), routine };
  }
}

function readableColumns(refs: ScopedRelation[]): ScopedRelation[] {
  return refs.map(ref => ({ ...ref, columnAccess: 'select' }));
}

/** RETURNING 的裸星号仅展开可裸用的输入列，旧行与新行的别名只参与限定列和限定星号。 */
function parseReturning(parts: Part[], refs: ScopedRelation[], target: ScopedRelation, analysis: MergeAnalysis,
  joined?: { stars: PostgresCompletionRelation[]; outputs?: Projection[] }): Parsed | undefined {
  const { outer, trace } = analysis;
  const output = returningScope(parts.slice(1), refs, outer, target, trace);
  if (!output) return;
  const expressions = parts.slice(1 + output.start);
  const visible = trace ? output.refs : readableColumns(output.refs);
  mergeExpression(expressions, visible, analysis, parts[output.start].end, Infinity, { outputs: joined?.outputs });
  if (trace?.unsupported) return;
  const stars = joined?.stars ?? refs.filter(ref => !ref.qualifiedOnly);
  const projection = !trace || trace.projected ? project([parts[0], ...expressions], visible, trace ? stars : readableColumns(stars), trace) : unknown;
  return { ...analysis.active, projection };
}

/** 只匹配入口之后的首段名称或 schema 限定符，别名和 JOIN 条件属于各自作用域。 */
function mergeNamePrefix(context: QueryContext, entryEnd: number): { schema?: string } | undefined {
  const { left } = context;
  const dotted = punct(left.at(-1), '.');
  if (left.at(dotted ? -3 : -1)?.end !== entryEnd) return;
  const schema = dotted ? identifier(left.at(-2)) : undefined;
  return dotted ? schema ? { schema } : undefined : {};
}

function completeMergeRelation(parts: Part[], start: number, entryEnd: number, target: boolean, analysis: MergeAnalysis): void {
  const { context, scope } = analysis;
  if (!context || analysis.active || analysis.joinConditionsOnly) return;
  const modifier = keyword(parts[start]);
  const only = modifier === 'ONLY', lateral = modifier === 'LATERAL';
  const index = start + (only || lateral ? 1 : 0);
  const first = parts[index];
  if ((only || lateral) && parts[start].end <= context.start) entryEnd = parts[start].end;
  if (only && first?.kind === 'group' && contains(first, context.offset)) entryEnd = first.start + 1;
  const prefix = mergeNamePrefix(context, entryEnd);
  if (prefix && !(declaredTableSyntax.has(keyword(first)) && parts[index + 1]?.kind === 'group')) {
    const ctes = !target && !prefix.schema ? [...scope.keys()].slice(0, limits.items) : undefined;
    const query: Query | undefined = lateral ? undefined : { kind: 'relations', ...prefix,
      ...(target ? { mergeTarget: true } : {}), ...(ctes?.length ? { ctes } : {}) };
    const routine: PostgresRoutineCompletionTarget | undefined = target || only ? undefined : { context: 'from', ...prefix };
    analysis.active = { projection: unknown, query, routine };
    return;
  }
  // ROWS FROM 的括号内每个成员都从函数名开始，列定义和实参继续走原有作用域。
  const group = parts[index + 2];
  if (!target && !only && keyword(first) === 'ROWS' && keyword(parts[index + 1]) === 'FROM' &&
      group?.kind === 'group' && contains(group, context.offset)) {
    let memberStart = group.start + 1;
    for (const part of group.parts) {
      if (part.end > context.start) break;
      if (punct(part, ',')) memberStart = part.end;
    }
    const member = mergeNamePrefix(context, memberStart);
    if (member) analysis.active = { projection: unknown, routine: { context: 'from', ...member } };
  }
}

/** 目标在外层 MERGE ON 前尚未进入作用域。表函数和 LATERAL 子查询可以看到允许关联的 JOIN 左侧。 */
function readMergeRelation(parts: Part[], start: number, entryEnd: number, target: boolean, preceding: ScopedRelation[],
  analysis: MergeAnalysis): { relation: ScopedRelation; next: number } | undefined {
  const { scope, outer, trace, context } = analysis;
  completeMergeRelation(parts, start, entryEnd, target, analysis);
  const modifier = keyword(parts[start]);
  const only = modifier === 'ONLY', lateral = modifier === 'LATERAL';
  let next = start + (only || lateral ? 1 : 0);
  const call = !target && !only ? readTableFunction(parts, next, !trace) : undefined;
  if (call === false) return;
  if (call) {
    analysis.names.add(call.relation.alias ?? call.relation.name);
    analysis.rowLocks?.push({ name: call.relation.alias ?? call.relation.name, allowed: false });
    if (trace) traceTableFunction(call, scope, preceding, outer, trace);
    else for (const args of call.args) mergeExpression(args.parts, preceding, analysis, args.start + 1, args.end - Number(args.closed));
    return call;
  }
  const first = parts[next];
  let name = '', schema: string | undefined, cte: LocalReferenceRange | undefined;
  let projection: Projection | undefined;
  if (!target && !only && first?.kind === 'group' && isMergeSourceQuery(first)) {
    const active = context && contains(first, context.offset) ? context : undefined;
    const parsed = parseQuery(first.parts, scope, lateral ? [preceding, ...outer] : outer, active, trace);
    if (active) analysis.active = parsed;
    projection = parsed.projection;
    next++;
  } else {
    const wrapped = only && first?.kind === 'group' && first.closing === ')' ? first : undefined;
    const names = wrapped?.parts ?? parts;
    let index = wrapped ? 0 : next;
    let token = names[index++];
    name = identifier(token) ?? '';
    if (!name || stop.has(keyword(token))) return;
    const nameStart = token.start;
    if (punct(names[index], '.')) {
      schema = name;
      token = names[index + 1];
      name = identifier(token) ?? '';
      if (!name) return;
      index += 2;
    }
    if (wrapped && index !== names.length) return;
    next = wrapped ? next + 1 : index;
    if (lateral) return;
    const explicitDescendants = !only && punct(parts[next], '*');
    if (explicitDescendants) next++;
    if (!target && !schema) projection = scope.get(name);
    cte = only || explicitDescendants ? undefined : projection?.declaration;
    if (cte && token.kind !== 'group') trace?.edges.set(token, cte);
    if (!projection) trace?.physicalRelations?.push({ name, ...(schema ? { schema } : {}), start: nameStart, end: token.end });
  }
  if (name.length > limits.name || schema && schema.length > limits.name) return;
  const renamed = readRelationAlias(parts, next, !target);
  if (!renamed) return;
  const { alias, declaration } = renamed;
  if (analysis.rowLocks && (alias || name)) {
    const physical = name && !projection ? { name, schema } : undefined;
    const subquery = first?.kind === 'group' && supportsRowLocking(first.parts);
    analysis.rowLocks.push({ name: alias ?? name, allowed: !!physical || subquery, declaration,
      ...(!alias && physical ? { physical } : {}) });
  }
  if (alias || name) analysis.names.add(alias ?? name);
  if (declaration) trace?.declarations.set(declaration.start, 'alias');
  if (renamed.names) {
    const columns = parts[renamed.next - 1];
    if (trace) recordJoinColumnTokens(columns, trace);
    projection = rename(projection ?? (trace ? unknown : relationProjection({ name, schema })),
      renamed.names, trace?.projected ? columns : undefined, trace);
  }
  next = renamed.next;
  // 抽样只改变输入行。跳过抽样方法和种子，后面的 JOIN 仍使用原表列目录。
  if (!trace && !target && name && keyword(parts[next]) === 'TABLESAMPLE') {
    const method = readFunctionCall(parts, next + 1);
    if (!method) return;
    next = method.next;
    if (keyword(parts[next]) === 'REPEATABLE') {
      const seed = parts[next + 1];
      if (seed?.kind !== 'group' || seed.closing !== ')') return;
      next += 2;
    }
  }
  return { relation: { name, schema, alias, projection, declaration: declaration ?? cte,
    ...(name && !projection ? { physical: true as const } : {}) }, next };
}

interface MergeSource { relations: ScopedRelation[]; root?: ScopedRelation; projection: Projection; next: number; joined: boolean; }

function relationProjection(ref: ScopedRelation): Projection {
  if (ref.projection) return ref.projection;
  const projection = { names: [], stars: [{ name: ref.name, ...(ref.schema ? { schema: ref.schema } : {}) }], exact: false };
  const source = relationJoinSource(ref);
  if (source) joinSources.set(projection, source);
  return projection;
}

/** 合并键的输出位置在输入列之前。无法确定 NATURAL 或 USING 的目录列顺序时只保留已知名称。 */
function mergeJoinProjection(left: Projection, right: Projection, natural: boolean, keys?: string[], trace?: ReferenceTrace): Projection {
  const output: Projection = { ...unknown };
  if (!trace) {
    const leftSource = projectedJoinSource(left), rightSource = projectedJoinSource(right);
    joinedOutputs.add(output);
    if (leftSource && rightSource) joinSources.set(output, { kind: 'join', left: leftSource, right: rightSource, keys, natural });
  }
  if (natural && (!knownProjection(left) || !knownProjection(right))) return output;
  const merged = keys ?? (natural ? left.names.filter((name): name is string => !!name && right.names.includes(name)) : []);
  const mergedNames = new Set(merged);
  const unmerged = [left, right].flatMap(projection => projection.names.flatMap((name, index) => name !== null && mergedNames.has(name)
    ? [] : [{name, origin: projection.origins?.[index] ?? null}]));
  const names = [...merged, ...unmerged.map(column => column.name)];
  const stars = keys ? [] : [...left.stars, ...right.stars];
  const knownKeys = merged.length === mergedNames.size && merged.every(key =>
    left.names.filter(name => name === key).length === 1 && right.names.filter(name => name === key).length === 1);
  const exact = left.exact && right.exact && knownKeys && names.length <= limits.items;
  // 合并键可能来自左右两边，保留一个输出位置，避免给它猜测单侧声明。
  const origins = trace?.projected ? [...merged.map(() => null), ...unmerged.map(column => column.origin)] : undefined;
  // 即使顺序有未知目录，保留已知来源供实际的星号投影或位置改名标记歧义。
  return Object.assign(output, { names: names.slice(0, limits.items), stars: stars.length <= limits.relations ? stars : [],
    exact, ...(origins ? {origins: origins.slice(0, limits.items)} : {}) });
}

/** 点号后的保留词仍可作为列名，例如 s.on。 */
const mergeKeyword = (parts: Part[], index: number) => punct(parts[index - 1], '.') ? '' : keyword(parts[index]);

function mergeJoin(parts: Part[], start: number): { next: number; qualified: boolean; lateral: boolean; natural: boolean; type: string } | undefined {
  let index = start;
  const natural = mergeKeyword(parts, index) === 'NATURAL';
  if (natural) index++;
  const type = mergeKeyword(parts, index);
  if (type === 'CROSS' && natural) return;
  if (['CROSS', 'INNER', 'LEFT', 'RIGHT', 'FULL'].includes(type)) index++;
  if (['LEFT', 'RIGHT', 'FULL'].includes(type) && keyword(parts[index]) === 'OUTER') index++;
  if (mergeKeyword(parts, index) !== 'JOIN') return;
  return { next: index + 1, qualified: !natural && type !== 'CROSS', lateral: type !== 'RIGHT' && type !== 'FULL', natural, type };
}

function readMergeOperand(parts: Part[], start: number, entryEnd: number, preceding: ScopedRelation[], analysis: MergeAnalysis,
  depth: number): MergeSource | undefined {
  const part = parts[start];
  if (part?.kind === 'group' && part.closing === ')' && !isMergeSourceQuery(part)) {
    const inner = readMergeSource(part.parts, 0, part.start + 1, preceding, analysis, depth + 1, part.end - Number(part.closed));
    if (!inner?.joined || inner.next !== part.parts.length) return;
    const renamed = readRelationAlias(parts, start + 1, true);
    if (!renamed) return;
    if (!renamed.declaration) return { ...inner, next: renamed.next };
    // 整个 JOIN 的别名会遮蔽输入表，只保留已收集的内部引用。
    analysis.trace?.declarations.set(renamed.declaration.start, 'alias');
    analysis.trace?.joinAliases.add(renamed.declaration.start);
    analysis.names.add(renamed.alias!);
    analysis.rowLocks?.push({ name: renamed.alias!, allowed: false });
    if (renamed.names && !inner.projection.exact && analysis.trace?.projectionRename)
      for (const origin of inner.projection.origins ?? []) if (origin) analysis.trace.projectionRename.uncertain.add(origin.start);
    const projection = rename(inner.projection, renamed.names ?? [],
      analysis.trace?.projected && renamed.names ? parts[renamed.next - 1] : undefined, analysis.trace);
    if (analysis.trace && renamed.names) recordJoinColumnTokens(parts[renamed.next - 1], analysis.trace);
    const root = { name: renamed.alias!, declaration: renamed.declaration, projection };
    return { relations: [root], root, projection, next: renamed.next, joined: true };
  }
  const atom = readMergeRelation(parts, start, entryEnd, false, preceding, analysis);
  if (atom) return { relations: [atom.relation], root: atom.relation, projection: relationProjection(atom.relation), next: atom.next, joined: false };
}

/** 列清单的项属于列命名空间，即使拼写和 JOIN 别名相同也无需改写。 */
function recordJoinColumnTokens(group: Part | undefined, trace: ReferenceTrace): void {
  if (group?.kind === 'group') for (const token of group.parts) if (identifier(token)) trace.joinColumnTokens.add(token.start);
}

/** 唯一活动项可替换，其余项必须是完整、互异的列名。 */
function activeNameList(parts: Part[], open: number, right: number, context: QueryContext): string[] | undefined {
  const names = new Set<string>();
  let active = false, start = 0;
  for (let end = 0; end <= parts.length; end++) {
    if (end < parts.length && !punct(parts[end], ',')) continue;
    const close = parts[end]?.start ?? right;
    const token = parts[start];
    if (open <= context.offset && context.offset <= close) {
      if (end > start + 1 || end === start + 1 &&
        (token.start !== context.start || !['word', 'identifier'].includes(token.kind))) return;
      active = true;
    } else {
      const name = end === start + 1 ? identifier(token) : undefined;
      if (!name || names.has(name) || new TextEncoder().encode(name).length > 63) return;
      names.add(name);
    }
    start = end + 1;
    open = close + 1;
  }
  if (active) return [...names];
}

function activeColumnList(group: Group, context: QueryContext): string[] | undefined {
  if (group.closing === ')') return activeNameList(group.parts, group.start + 1, group.end - Number(group.closed), context);
}

/** USING 的两侧输入均按当前 JOIN 的实际操作数读取。 */
function joinUsingQuery(group: Group, context: QueryContext, left: Projection, right: Projection): PostgresUsingColumns {
  const excluded = activeColumnList(group, context);
  return excluded ? { kind: 'using', left: projectedJoinSource(left), right: projectedJoinSource(right), excluded }
    : { kind: 'using', excluded: [] };
}

/** JOIN ON 只可见当前两个操作数。右侧尚未遇到 ON／USING 时，继续解析其未加括号的 JOIN。 */
function readMergeSource(parts: Part[], start: number, entryEnd: number, preceding: ScopedRelation[], analysis: MergeAnalysis,
  depth = 0, end = Infinity): MergeSource | undefined {
  const { trace } = analysis;
  const lockStart = analysis.rowLocks?.length ?? 0;
  if (depth >= 24 || trace?.unsupported) return;
  const first = readMergeOperand(parts, start, entryEnd, preceding, analysis, depth);
  if (!first) return;
  let left: MergeSource = first;
  for (let join = mergeJoin(parts, left.next); join && !trace?.unsupported; join = mergeJoin(parts, left.next)) {
    const rightLockStart = analysis.rowLocks?.length ?? 0;
    const lateral: ScopedRelation[] = join.lateral ? [...preceding, ...left.relations] : preceding;
    const joinEnd = parts[join.next - 1].end;
    const right = join.qualified ? readMergeSource(parts, join.next, joinEnd, lateral, analysis, depth + 1, end)
      : readMergeOperand(parts, join.next, joinEnd, lateral, analysis, depth);
    if (!right) return;
    if (analysis.rowLocks && ['LEFT', 'RIGHT', 'FULL'].includes(join.type)) {
      const begin = join.type === 'LEFT' ? rightLockStart : lockStart;
      const end = join.type === 'RIGHT' ? rightLockStart : analysis.rowLocks.length;
      for (const input of analysis.rowLocks.slice(begin, end)) input.allowed = false;
    }
    let next = right.next;
    const relations = [...left.relations, ...right.relations];
    let root: ScopedRelation | undefined;
    let keys: string[] | undefined;
    if (join.qualified) {
      const qualifier = mergeKeyword(parts, next++);
      if (qualifier === 'USING') {
        const group = parts[next++];
        const context = analysis.context;
        if (!trace && !analysis.active && context && group?.kind === 'group' && contains(group, context.offset)) {
          analysis.active = { projection: unknown, query: joinUsingQuery(group, context, left.projection, right.projection) };
        }
        keys = nameList(group);
        if (!keys.length || trace && new Set(keys).size !== keys.length) return;
        if (trace) recordJoinColumnTokens(group, trace);
        if (keyword(parts[next]) === 'AS') {
          const declaration = parts[next + 1], name = identifier(declaration);
          if (!name || name.length > limits.name || stop.has(keyword(declaration))) return;
          trace?.declarations.set(declaration.start, 'alias');
          trace?.joinAliases.add(declaration.start);
          analysis.names.add(name);
          analysis.rowLocks?.push({ name, allowed: false });
          root = { name, declaration, usingColumns: keys, qualifiedOnly: true, projection: { names: keys, stars: [], exact: true } };
          if (!trace && root.projection) joinedOutputs.add(root.projection);
          relations.push(root);
          next += 2;
        }
      } else if (qualifier === 'ON') {
        const condition = next;
        while (next < parts.length && !punct(parts[next], ',') &&
          !['ON', 'USING'].includes(mergeKeyword(parts, next)) && !mergeJoin(parts, next)) next++;
        if (trace && next === condition) return;
        // 如果操作数已经包含 JOIN，沿用它的输出形状，让前序合并的键只计一次。
        const outputs = left.joined || right.joined ? [left.projection, right.projection] : undefined;
        mergeExpression(parts.slice(condition, next), relations, analysis, parts[condition - 1].end,
          parts[next]?.start ?? end, { joinCondition: true, outputs });
      } else return;
    }
    const projection = !trace || trace.projected ? mergeJoinProjection(left.projection, right.projection, join.natural, keys, trace) : unknown;
    left = { relations, root, projection, next, joined: true };
  }
  return left;
}

interface JoinedFrom { start: number; end: number; refs: ScopedRelation[]; outputs: Projection[]; rowLocks?: RowLockRelation[]; }

/** 同一棵来源树负责 JOIN 条件补全及星号展开。每个顶层 FROM 项贡献一个独立输出。 */
function readQueryJoinSources(parts: Part[], scope: Scope, outer: ScopedRelation[][], context?: QueryContext, trace?: ReferenceTrace,
  writeOutput = false, readRowLocks = false):
  { active: Parsed } | JoinedFrom | undefined {
  const command = keyword(parts[0]);
  if (!['SELECT', 'UPDATE', 'DELETE'].includes(command)) return;
  const start = parts.findIndex((part, index) => {
    if (command === 'DELETE') return mergeKeyword(parts, index) === 'USING';
    if (keyword(part) !== 'FROM' || !relationEntry(parts, index)) return false;
    const previous = parts[index - 1];
    // 光标可停在尚未写列名的 q. 后，后面的 FROM 仍属于查询。
    return !punct(previous, '.') || !!context && previous.end <= context.offset && context.offset < part.start;
  });
  if (start < 0) return;
  const boundary = parts.findIndex((_, index) => index > start && endsFrom.has(mergeKeyword(parts, index)));
  const end = boundary < 0 ? parts.length : boundary;
  const sources = parts.slice(start + 1, end);
  function hasMergedOrGroupedJoin(items: Part[], grouped = false): boolean {
    return items.some((part, index) => ['NATURAL', 'USING'].includes(mergeKeyword(items, index)) ||
      grouped && mergeKeyword(items, index) === 'JOIN' || part.kind === 'group' &&
      part.closing === ')' && !isMergeSourceQuery(part) && hasMergedOrGroupedJoin(part.parts, true));
  }
  const sourceEnd = parts[end]?.start ?? Infinity;
  const inside = !!context && context.offset >= parts[start].end && context.offset < sourceEnd;
  // 条件补全解析普通 JOIN；表达式在来源外时，只对会改变输出或作用域的 JOIN 采用树形分析。
  if (!readRowLocks && (!hasMergedOrGroupedJoin(sources, inside) || !inside && !trace && !writeOutput && command !== 'SELECT')) return;
  const rowLocks = readRowLocks ? [] : undefined;
  const analysis: MergeAnalysis = { scope, outer, trace, context: inside ? context : undefined, names: new Set(), joinConditionsOnly: true, rowLocks };
  const preceding: ScopedRelation[] = [];
  const outputs: Projection[] = [];
  for (let index = 0, entry = parts[start].end; index < sources.length;) {
    const source = readMergeSource(sources, index, entry, preceding, analysis, 0, sourceEnd);
    if (analysis.active) return { active: analysis.active };
    if (!source) break;
    preceding.push(...source.relations);
    outputs.push(source.projection);
    if (source.next === sources.length) return (trace || !inside && (writeOutput || command === 'SELECT'))
      ? { start, end, refs: preceding, outputs, rowLocks } : undefined;
    if (!punct(sources[source.next], ',')) break;
    entry = sources[source.next].end;
    index = source.next + 1;
  }
  // 复杂来源已经按树修改引用表，解析失败不能回退到平铺的关系作用域。
  if (trace) trace.unsupported = true;
}

/** 只排除草稿已能确认的冲突结构，真实关系权限和表达式语义由服务器判定。 */
function supportsRowLocking(parts: Part[]): boolean {
  if (parts.length === 1 && parts[0].kind === 'group') return supportsRowLocking(parts[0].parts);
  return parts.some(part => ['SELECT', 'TABLE'].includes(keyword(part))) && !parts.some((_, index) => {
    const word = mergeKeyword(parts, index);
    return setOperators.has(word) || word === 'HAVING' || word === 'GROUP' && keyword(parts[index + 1]) === 'BY' ||
      word === 'SELECT' && keyword(parts[index + 1]) === 'DISTINCT' || word === 'WINDOW' && keyword(parts[index + 2]) === 'AS';
  });
}

interface RowLockList { parts: Part[]; start: number; end: number; }

const rowLockModes = [['UPDATE'], ['NO', 'KEY', 'UPDATE'], ['SHARE'], ['KEY', 'SHARE']] as const;
const rowLockModeWords = new Set<string>(rowLockModes.flat());
const rowLockWaitWords = new Set(['OF', 'NOWAIT', 'SKIP', 'LOCKED']);
const beforeRowLock = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', 'ORDER']);

function isRowLockNameList(parts: Part[]): boolean {
  return parts.length % 2 === 1 && parts.every((part, index) => index % 2 ? punct(part, ',') : !!identifier(part));
}

/** 替换当前单词并保留已写在右侧的短语，不重复插入 KEY、UPDATE 或 LOCKED。 */
function rowLockPhrase(words: readonly string[], prefix: string, following: Part[], phraseWords: ReadonlySet<string>): string | undefined {
  if (!words[0]?.startsWith(prefix)) return;
  const next = keyword(following[0]);
  if (!phraseWords.has(next)) return words.join(' ');
  const split = words.indexOf(next, 1);
  if (split < 0 || words.slice(split).some((word, index) => following[index] && keyword(following[index]) !== word)) return;
  return words.slice(0, split).join(' ');
}

/** 已明确进入 FOR 子句才提供模式。OF 后必须先有完整裸名称清单，才进入等待策略。 */
function completeRowLockKeywords(parts: Part[], context: QueryContext): Query | undefined {
  const { start, end, keywordPrefix } = context;
  if (keywordPrefix === undefined) return;
  const before = parts.filter(part => part.end <= start && part.start < start);
  const anchor = before.map((_, index) => mergeKeyword(before, index)).lastIndexOf('FOR');
  if (anchor < 0) return;
  const tail = before.slice(anchor + 1);
  if (tail.some((_, index) => ['LIMIT', 'OFFSET', 'FETCH'].includes(mergeKeyword(tail, index)))) return;
  if (parts.some((part, index) => part.start >= before[anchor].end && beforeRowLock.has(mergeKeyword(parts, index)))) return;
  const following = parts.filter(part => part.start >= end && part.end > start);
  const mode = rowLockModes.find(words => words.every((word, index) => keyword(tail[index]) === word));
  if (!mode) {
    const items = rowLockModes.filter(words => tail.length < words.length && tail.every((part, i) => keyword(part) === words[i]))
      .flatMap(words => rowLockPhrase(words.slice(tail.length), keywordPrefix, following, rowLockModeWords) ?? []);
    return { kind: 'lockKeywords', items };
  }

  const options = tail.slice(mode.length);
  const of = keyword(options[0]) === 'OF';
  const names = of ? options.slice(1) : [];
  const skip = keyword(options.at(-1)) === 'SKIP' && (of ? isRowLockNameList(names.slice(0, -1)) : options.length === 1);
  if (of && !skip && (!isRowLockNameList(names) || punct(following[0], ',') || punct(following[0], '.'))) return;
  if (!of && !skip && options.length) return;

  const ties = parts.some((_, index) => mergeKeyword(parts, index) === 'WITH' && keyword(parts[index + 1]) === 'TIES');
  const choices = skip ? (ties ? [] : [['LOCKED']]) : [['NOWAIT'], ...(of ? [] : [['OF']]), ...(ties ? [] : [['SKIP', 'LOCKED']])];
  const items = choices.flatMap(words => rowLockPhrase(words, keywordPrefix, following, rowLockWaitWords) ?? []);
  return { kind: 'lockKeywords', items };
}

function rowLockLists(parts: Part[]): RowLockList[] {
  const lists: RowLockList[] = [];
  for (let index = 0; index < parts.length; index++) {
    if (mergeKeyword(parts, index) !== 'FOR') continue;
    const strength = rowLockModes.find(mode => mode.every((word, step) => keyword(parts[index + 1 + step]) === word));
    if (!strength) continue;
    const of = index + strength.length + 1;
    if (keyword(parts[of]) !== 'OF') continue;
    const first = of + 1;
    let end = first;
    for (; end < parts.length; end++) {
      const word = mergeKeyword(parts, end);
      if (['FOR', 'LIMIT', 'OFFSET', 'FETCH'].includes(word)) break;
      if (word === 'SKIP' && keyword(parts[end + 1]) === 'LOCKED' ||
          word === 'NOWAIT' && end > first && identifier(parts[end - 1])) break;
    }
    lists.push({ parts: parts.slice(first, end), start: parts[of].end, end: parts[end]?.start ?? Infinity });
    index = end - 1;
  }
  return lists;
}

/** PostgreSQL 按范围表顺序匹配裸名称。无效对象也可能先于同名物理表命中。 */
function rowLockTargets(rows: RowLockRelation[], lists: RowLockList[], active: RowLockList | undefined,
  context?: QueryContext, trace?: ReferenceTrace): Query | undefined {
  const targets = new Map<string, RowLockRelation>();
  for (const row of rows) if (!targets.has(row.name)) targets.set(row.name, row);
  if (context && active) {
    const used = activeNameList(active.parts, active.start, active.end, context);
    const names = used ? [...targets.values()].filter(row => row.allowed && !used.includes(row.name)).map(row => row.name) : [];
    return { kind: 'lockTargets', names };
  }
  if (!trace) return;
  for (const list of lists) {
    if (!isRowLockNameList(list.parts)) continue;
    for (let i = 0; i < list.parts.length; i += 2) {
      const token = list.parts[i], row = targets.get(identifier(token)!);
      if (token.kind === 'group' || !row?.allowed) continue;
      if (row.declaration) trace.edges.set(token, row.declaration);
      if (row.physical) trace.physicalRelations?.push({ ...row.physical, start: token.start, end: token.end });
    }
  }
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

/** 只补全清单项的基础列，避免把表列插入复合字段名或数组下标。 */
function startsTargetColumn(list: Group, context: QueryContext): boolean {
  const previous = context.left.at(-1);
  return !!previous && (punct(previous, '(') && previous.end === list.start + 1 ||
    punct(previous, ',') && list.parts.includes(previous));
}

/** 左侧的数组下标会读已有值，与同一动作的值表达式使用相同的来源。 */
function completeWriteSubscript(parts: Part[], refs: ScopedRelation[], analysis: MergeAnalysis, context: QueryContext,
  outputs?: Projection[]): void {
  let group = parts.find(part => part.kind === 'group' && contains(part, context.offset));
  while (group?.kind === 'group') {
    if (group.closing === ']') {
      mergeExpression(group.parts, refs, analysis, group.start + 1, group.end - Number(group.closed), { outputs });
      return;
    }
    group = group.parts.find(part => part.kind === 'group' && contains(part, context.offset));
  }
}

/** 写入列来自目标；赋值右侧、谓词和 VALUES 表达式使用调用方限定的关系。 */
function completeWriteAction(parts: Part[], refs: ScopedRelation[], target: ScopedRelation, analysis: MergeAnalysis, end: number,
  outputs?: Projection[]): void {
  const { context } = analysis;
  if (!context || analysis.active || context.offset > end) return;
  const targetColumns = () => {
    if (!punct(context.left.at(-1), '.')) analysis.active = { projection: unknown, query: columns([target], [], context.left) };
  };
  if (keyword(parts[0]) === 'UPDATE' && keyword(parts[1]) === 'SET' && context.offset >= parts[1].end) {
    const where = parts.findIndex((_, index) => index > 1 && mergeKeyword(parts, index) === 'WHERE');
    if (where >= 0 && context.offset >= parts[where].start) {
      mergeExpression(parts.slice(where + 1), refs, analysis, parts[where].end, end, { outputs });
      return;
    }
    let first = 2, equals = -1;
    for (let i = 2; i < parts.length && parts[i].end <= context.start; i++) {
      if (punct(parts[i], ',')) { first = i + 1; equals = -1; }
      if (equals < 0 && punct(parts[i], '=')) equals = i;
    }
    if (equals >= 0) {
      mergeExpression(parts.slice(equals + 1), refs, analysis, parts[equals].end, end, { outputs });
      return;
    }
    const tuple = parts[first];
    if (context.left.at(-1)?.end === parts[first - 1].end ||
        tuple?.kind === 'group' && tuple.closing === ')' && contains(tuple, context.offset) && startsTargetColumn(tuple, context)) {
      targetColumns();
      return;
    }
    completeWriteSubscript(parts.slice(first), refs, analysis, context, outputs);
  } else if (keyword(parts[0]) === 'INSERT') {
    const list = parts[1];
    if (list?.kind === 'group' && list.closing === ')' && contains(list, context.offset)) {
      if (startsTargetColumn(list, context)) targetColumns();
      else completeWriteSubscript(list.parts, refs, analysis, context, outputs);
      return;
    }
    const valuesAt = parts.findIndex(part => keyword(part) === 'VALUES');
    const values = valuesAt < 0 ? undefined : parts[valuesAt + 1];
    if (values?.kind === 'group' && values.closing === ')' && contains(values, context.offset)) {
      mergeExpression([values], refs, analysis, values.start + 1, values.end, { outputs });
    }
  }
}

/** INSERT 的目标列、来源、冲突动作和返回列表拥有不同的可见关系。 */
function completeInsert(parts: Part[], scope: Scope, outer: ScopedRelation[][], context: QueryContext | undefined,
  returning: number): Parsed | undefined {
  const destination = readInsertTarget(parts);
  if (returning >= 0 && (!context || context.offset >= parts[returning].end)) {
    if (!destination) return { projection: unknown };
    const { target } = destination;
    return parseReturning(parts.slice(returning), [target], target, { scope, outer, context, names: new Set() }) ?? { projection: unknown };
  }
  if (!context) return { projection: unknown };
  if (!destination) return;
  const { target } = destination;
  const header = readInsertSource(parts, destination.next);
  if (!header) return;
  const list = header.columns;
  if (list && contains(list, context.offset)) {
    const query = startsTargetColumn(list, context) ? columns([{ ...target, columnAccess: 'insert' }], [], context.left) : undefined;
    return { projection: unknown, query };
  }
  const end = returning < 0 ? parts.length : returning;
  const conflict = readConflictAction(parts, header.start, end);
  const boundary = parts[end]?.start ?? Infinity;
  if (conflict && context.offset >= parts[conflict.action].end && context.offset < boundary) {
    const analysis: MergeAnalysis = { scope, outer, context, names: new Set() };
    // EXCLUDED 读取目标目录，只有动作表达式可见。写入位置使用独立的 UPDATE 列权限。
    const current: ScopedRelation = { ...target, columnAccess: 'select' };
    const pending: ScopedRelation = { ...current, alias: 'excluded', declaration: undefined, qualifiedOnly: true };
    completeWriteAction(parts.slice(conflict.action + 1, end), [current, pending], { ...target, columnAccess: 'update' }, analysis, boundary);
    return analysis.active ?? { projection: unknown };
  }
  const on = conflict?.on ?? pendingConflictOn(parts, header.start, end);
  if (on !== undefined && context.offset >= parts[on + 1].end && context.offset < (parts[conflict?.action ?? end]?.start ?? Infinity)) {
    const query = completeConflictTarget(parts.slice(on + 2, conflict?.action ?? end), context, target,
      parts[on + 1].end, !!conflict && keyword(parts[conflict.action + 1]) === 'NOTHING');
    return { projection: unknown, query };
  }
  const sourceEnd = on ?? end;
  const first = parts[header.start];
  if (first && startsReferenceQuery(first) && context.offset >= first.start && context.offset < (parts[sourceEnd]?.start ?? Infinity)) {
    // 查询来源只继承 WITH 和真实外层，写入目标与冲突动作不参与 SELECT 的名称绑定。
    return parseQuery(parts.slice(header.start, sourceEnd), scope, outer, context);
  }
}

/** WHEN 条件和动作共用分支作用域，CASE 中的 WHEN/THEN 仍属于所在表达式。 */
function parseMerge(parts: Part[], analysis: MergeAnalysis): Parsed | undefined {
  const { scope, outer, trace, context } = analysis;
  if (keyword(parts[1]) !== 'INTO') return;
  const target = readMergeRelation(parts, 2, parts[1].end, true, [], analysis);
  if (!target || keyword(parts[target.next]) !== 'USING') return analysis.active;
  const sourceStart = target.next + 1;
  const usingEnd = parts[target.next].end;
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
      if (!clause || clause.then !== undefined) return trace ? undefined : analysis.active;
      clause.then = i;
    } else if (!depth && word === 'RETURNING') {
      end = i;
      break;
    }
  }
  if (trace && (depth || !clauses.length || clauses[0].when <= join + 1)) return;
  const sourceParts = parts.slice(sourceStart, join < 0 ? parts.length : join);
  const source = readMergeSource(sourceParts, 0, usingEnd, [], analysis, 0, parts[join]?.start);
  if (!source || source.next !== sourceParts.length || join <= sourceStart) {
    // 尚未写外层 ON 时，最后一个 ON 仍可能是来源 JOIN 的条件。
    if (!trace && !clauses.length && join >= sourceStart) readMergeSource(parts.slice(sourceStart), 0, usingEnd, [], analysis);
    return analysis.active;
  }
  const { relation } = target;
  const rootName = source.root?.alias ?? source.root?.name;
  const implicit = rootName ? undefined : source.joined ? 'unnamed_join' : 'unnamed_subquery';
  if ((relation.alias ?? relation.name) === (rootName || implicit)) return trace ? undefined : analysis.active;
  if (implicit) analysis.names.add(implicit);
  const refs = [relation, ...source.relations];
  if (implicit && trace) for (const ref of refs) reserveImplicitName(trace, ref.declaration, implicit);
  // 自动生成的来源名由服务器在处理匹配动作时打开，没有可跳转的原文声明。
  const actionSource = implicit ? [...source.relations, { name: implicit, projection: source.projection, qualifiedOnly: true }] : source.relations;
  const matched = implicit ? [relation, ...actionSource] : refs;
  // PostgreSQL 17/18 只切换来源 JOIN 的首个根命名空间项，未遮蔽的输入别名仍可解析。
  const withoutSource = refs.filter(ref => ref !== source.root);
  const sourceOutputs = source.joined ? [source.projection] : undefined;
  const targetOutput = source.joined ? relationProjection(relation) : undefined;
  const matchedOutputs = targetOutput ? [targetOutput, source.projection] : undefined;
  const firstClause = clauses[0]?.when ?? end;
  mergeExpression(parts.slice(join + 1, firstClause), trace ? refs : readableColumns(refs), analysis,
    parts[join].end, parts[firstClause]?.start ?? Infinity, { outputs: matchedOutputs });
  for (const [i, { when, then }] of clauses.entries()) {
    if (trace && then === undefined) return;
    let index = when + 1;
    const unmatched = keyword(parts[index]) === 'NOT';
    if (unmatched) index++;
    if (keyword(parts[index++]) !== 'MATCHED') {
      if (trace) return;
      continue;
    }
    let side = '';
    if (unmatched && keyword(parts[index]) === 'BY') {
      side = keyword(parts[index + 1]);
      if (side !== 'SOURCE' && side !== 'TARGET') {
        if (trace) return;
        continue;
      }
      index += 2;
    }
    const inserts = unmatched && side !== 'SOURCE';
    const visible = unmatched ? inserts ? actionSource : withoutSource : matched;
    const readable = trace ? visible : readableColumns(visible);
    const outputs = unmatched ? inserts ? sourceOutputs : undefined : matchedOutputs;
    const nextClause = clauses[i + 1]?.when ?? end;
    const conditionEnd = then ?? nextClause;
    if (index !== conditionEnd) {
      if (keyword(parts[index]) === 'AND' && (!trace || index + 1 < conditionEnd)) {
        mergeExpression(parts.slice(index + 1, conditionEnd), readable, analysis,
          parts[index].end, parts[conditionEnd]?.start ?? Infinity, { outputs });
      } else if (trace) return;
    }
    if (then !== undefined) {
      const action = parts.slice(then + 1, nextClause);
      if (trace) {
        if (!traceMergeAction(action, inserts, scope, visible, outer, trace)) return;
      } else if (context && context.offset >= parts[then].end && keyword(action[0]) === (inserts ? 'INSERT' : 'UPDATE')) {
        // 目标目录选择动作要求的列权限，VALUES 和赋值表达式遵循各自的分支读取权限。
        completeWriteAction(action, readable, { ...relation, columnAccess: inserts ? 'insert' : 'update' }, analysis,
          parts[nextClause]?.start ?? Infinity, outputs);
      }
    }
  }
  let projection = unknown;
  if (end < parts.length) {
    // MERGE RETURNING * 先展开来源的输出（含 JOIN 合并键），再展开目标，排除仅可限定访问的 OLD/NEW。
    if (trace && end + 1 === parts.length) return;
    const output = parseReturning(parts.slice(end), refs, relation, analysis,
      { stars: [{ name: '', projection: source.projection }, relation],
        outputs: targetOutput ? [source.projection, targetOutput] : undefined });
    if (!output) return trace ? undefined : analysis.active;
    projection = output.projection;
  }
  return trace?.unsupported ? undefined : { ...analysis.active, projection };
}

/** 在同一作用域树内推导查询输出。递归项在首分支解析完后才能引用已确认的列。 */
function parseQuery(parts: Part[], inherited: Scope, outer: ScopedRelation[][], context?: QueryContext, trace?: ReferenceTrace,
  firstBranch?: (projection: Projection) => void): Parsed {
  if (trace?.unsupported) return { projection: unknown };
  if (parts.length === 1 && parts[0].kind === 'group') {
    return parseQuery(parts[0].parts, inherited, outer, context && contains(parts[0], context.offset) ? context : undefined, trace, firstBranch);
  }
  const unsupported = (): Parsed => { if (trace) trace.unsupported = true; return { projection: unknown }; };
  const first = keyword(parts[0]);
  if (parts.length && parts[0].kind !== 'group' && !commands.has(first) && first !== 'MERGE') return unsupported();
  let start = 0;
  let scope = inherited;
  if (keyword(parts[0]) === 'WITH') {
    const ctes = new Map(inherited);
    scope = ctes;
    const recursive = keyword(parts[1]) === 'RECURSIVE';
    const definitions: { name: string; names: string[]; aliases?: Part; body: Group; declaration: Part }[] = [];
    start = recursive ? 2 : 1;
    do {
      const declaration = parts[start++];
      const name = identifier(declaration);
      if (!name || name.length > limits.name || trace && definitions.some(item => item.name === name)) return unsupported();
      const names = nameList(parts[start]), aliases = names.length ? parts[start] : undefined;
      if (aliases && trace) recordJoinColumnTokens(aliases, trace);
      if (parts[start]?.kind === 'group') {
        if (trace && !names.length) return unsupported();
        start++;
      }
      if (keyword(parts[start++]) !== 'AS') return unsupported();
      if (keyword(parts[start]) === 'NOT') start++;
      if (keyword(parts[start]) === 'MATERIALIZED') start++;
      const body = parts[start++];
      if (body?.kind !== 'group') return unsupported();
      definitions.push({ name, names, aliases, body, declaration });
      trace?.declarations.set(declaration.start, 'cte');
    } while (punct(parts[start], ',') && ++start);
    // 递归 WITH 中先占住所有声明名，避免自引用或后置定义落到同名物理表。
    if (recursive) for (const { name, names, declaration } of definitions)
      ctes.set(name, trace ? { ...unknown, declaration } : rename(unknown, names));
    for (const { name, names, aliases, body, declaration } of definitions) {
      const active = context && contains(body, context.offset) ? context : undefined;
      const anchorEnd = recursive ? body.parts.findIndex(part => keyword(part) === 'UNION') : -1;
      if (active && anchorEnd > 0 && body.parts[anchorEnd].end <= active.offset) {
        const anchor = parseQuery(body.parts.slice(0, anchorEnd), ctes, outer);
        ctes.set(name, rename(anchor.projection, names));
      }
      const projected = (projection: Projection) => ({ ...rename(projection, names, aliases, trace), declaration });
      const parsed = parseQuery(body.parts, ctes, outer, active, trace,
        trace?.projected && anchorEnd > 0 ? projection => ctes.set(name, projected(projection)) : undefined);
      if (active) return parsed;
      ctes.set(name, trace?.projected ? projected(parsed.projection) : trace ? { ...unknown, declaration } : rename(parsed.projection, names));
    }
  }
  const main = parts.slice(start);
  const command = keyword(main[0]);
  const write = command === 'UPDATE' || command === 'DELETE';
  const returning = write || command === 'INSERT' ? main.findIndex((_, index) => mergeKeyword(main, index) === 'RETURNING') : -1;
  const returningHere = returning >= 0 && (!context || context.offset >= main[returning].end);
  if (command === 'INSERT') {
    if (trace) {
      const projection = traceInsert(main, scope, outer, trace);
      return projection ? { projection } : unsupported();
    }
    const completion = completeInsert(main, scope, outer, context, returning);
    if (completion) return completion;
  }
  if (command === 'MERGE') {
    if (first === 'WITH' && keyword(parts[1]) === 'RECURSIVE') return unsupported();
    return parseMerge(main, { scope, outer, trace, context, names: new Set() }) ?? unsupported();
  }
  if (trace && main.some(part => unsupportedReferenceSyntax.has(keyword(part)) || keyword(part) === 'INTO')) return unsupported();
  const firstSet = main.findIndex(part => setOperators.has(keyword(part)));
  if (firstSet >= 0) {
    let output = unknown, branchStart = 0, query: Query | undefined, routine: PostgresRoutineCompletionTarget | undefined;
    let windows: Parsed['windows'];
    for (let i = 0; i <= main.length; i++) {
      if (i < main.length && !setOperators.has(keyword(main[i]))) continue;
      const branch = main.slice(branchStart, i);
      const active = context && (main[branchStart - 1]?.end ?? 0) <= context.offset &&
        (main[i]?.start ?? Infinity) >= context.offset ? context : undefined;
      // 最后一个分支后的 ORDER BY 归组合结果，不能看到该分支的表。
      const order = branchStart > 0 && i === main.length ? branch.findIndex((_, index) => trace
        ? ['ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR'].includes(mergeKeyword(branch, index))
        : ['ORDER', 'FOR'].includes(mergeKeyword(branch, index))) : -1;
      const inOrder = active && order >= 0 && active.offset >= branch[order].start;
      const parsed = parseQuery(order >= 0 ? branch.slice(0, order) : branch, scope, outer, inOrder ? undefined : active, trace);
      if (branchStart === 0) { output = parsed.projection; firstBranch?.(output); }
      if (trace?.projected && order >= 0) traceProjectionOrder(branch.slice(order), output, trace);
      if (inOrder) query = keyword(branch[order]) === 'FOR' || rowLockLists(branch.slice(order)).some(list => list.start <= active.offset)
        ? { kind: 'lockTargets', names: [] } : columns([{ name: '', projection: output }], [], active.left);
      else if (active) { query = parsed.query; routine = parsed.routine; windows = parsed.windows; }
      if (['ALL', 'DISTINCT'].includes(keyword(main[i + 1]))) i++;
      branchStart = i + 1;
    }
    return { projection: output, query, routine, windows };
  }

  const set = command === 'UPDATE' && context && !trace ? main.findIndex((_, index) => mergeKeyword(main, index) === 'SET') : -1;
  const setEnd = set < 0 ? -1 : main.findIndex((_, index) => index > set &&
    (['WHERE', 'RETURNING'].includes(mergeKeyword(main, index)) || mergeKeyword(main, index) === 'FROM' && relationEntry(main, index)));
  const assignmentBoundary = main[setEnd]?.start ?? Infinity;
  const inAssignments = !!context && set >= 0 && context.offset >= main[set].end && context.offset < assignmentBoundary;
  const where = write ? main.findIndex((_, index) => mergeKeyword(main, index) === 'WHERE') : -1;
  const predicateBoundary = main[returning]?.start ?? Infinity;
  const inPredicate = !trace && !!context && where >= 0 && context.offset >= main[where].end && context.offset < predicateBoundary;
  const completeWrite = returningHere || inAssignments || inPredicate;
  const tableSource = command === 'TABLE';
  if (!trace && context && (tableSource || command === 'SELECT') && context.left.some(part => keyword(part) === 'FOR') && supportsRowLocking(main)) {
    const keywords = completeRowLockKeywords(main, context);
    if (keywords) return { projection: unknown, query: keywords };
  }
  const lockLists = (context || trace) && (tableSource || command === 'SELECT') ? rowLockLists(main) : [];
  const activeLock = context && lockLists.find(list => list.start <= context.offset && context.offset <= list.end);
  const readLocks = (!!activeLock || !!trace && lockLists.length > 0) && supportsRowLocking(main);
  const joined = readQueryJoinSources(main, scope, outer, context, trace, completeWrite, readLocks);
  if (trace?.unsupported) return unsupported();
  if (joined && 'active' in joined) return joined.active;
  if (trace && !write && !['SELECT', 'VALUES', 'TABLE'].includes(command)) return unsupported();
  if (write && command === 'DELETE' && keyword(main[1]) !== 'FROM') return unsupported();
  const refs: ScopedRelation[] = [];
  let writeRelation: ScopedRelation | undefined;
  const spans = trace ? new Map<number, RelationSpan>() : undefined;
  const commas = new Set<number>();
  let from = false, deleteUsing = -1;
  let joinChainStart = 0;
  let argumentRefs: ScopedRelation[] | undefined;
  let argumentStart: number | undefined;
  let inFunctionMetadata = false;
  for (let i = 0; i < (!write || returning < 0 ? main.length : returning); i++) {
    if (joined?.start === i) {
      spans?.set(i, {end: joined.end, relation: refs.length, joined: true});
      if (trace?.projected) {
        // 输入限定名仍可见，裸列按每个 JOIN 的合并输出查找，不能再把 USING 键按两个输入计数。
        refs.push(...joined.refs.map(ref => ({...ref, qualifiedOnly: true})),
          ...joined.outputs.map(projection => ({name: '', projection})));
      } else refs.push(...joined.refs);
      i = joined.end - 1;
      continue;
    }
    const word = keyword(main[i]);
    if (endsFrom.has(word)) from = false;
    const usingSource = command === 'DELETE' && word === 'USING' && deleteUsing < 0 && !from && (where < 0 || i < where);
    if (usingSource) deleteUsing = i;
    if (from && punct(main[i], ',')) commas.add(i);
    if (!usingSource && !(tableSource && i === 0) && !relationEntry(main, i) && !commas.has(i)) continue;
    const target = writeTarget(main, i);
    if (!trace && write && target && completeWrite) {
      const destination = readMergeRelation(main, i + 1, main[i].end, true, [], { scope, outer, names: new Set() });
      if (!destination) return { projection: unknown };
      writeRelation = destination.relation;
      refs.push(writeRelation);
      i = destination.next - 1;
      continue;
    }
    if (!target && (word === 'FROM' || word === 'JOIN' || usingSource)) from = true;
    if (!target && word !== 'JOIN') joinChainStart = refs.length;
    let next = i + 1;
    const modifier = keyword(main[next]);
    if (modifier === 'ONLY' || modifier === 'LATERAL') next++;
    // PostgreSQL 的 FROM/USING 来源子查询及表函数不能引用本语句的写入目标。
    const joinType = keyword(main[i - (keyword(main[i - 1]) === 'OUTER' ? 2 : 1)]);
    const available = word === 'JOIN' && ['RIGHT', 'FULL'].includes(joinType) ? refs.slice(0, joinChainStart) : refs;
    const preceding = write ? available.slice(1) : available;
    const call = !target && !tableSource && modifier !== 'ONLY' ? readTableFunction(main, next, !trace) : undefined;
    if (call === false) return unsupported();
    if (call) {
      if (trace) {
        traceTableFunction(call, scope, preceding, outer, trace);
        spans!.set(i, { end: call.next, relation: refs.length });
      }
      if (context && context.offset <= main[call.next - 1].end) {
        const argument = call.args.find(args => contains(args, context.offset));
        if (argument) {
          argumentRefs = preceding.slice();
          argumentStart = argument.start + 1;
        }
        else if (declaredTableSyntax.has(keyword(main[next])) && context.start >= main[next].end ||
            context.start >= (call.args[0]?.end ?? Infinity) || keyword(main[next]) === 'ROWS' && context.start >= main[next + 1].end) {
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
      if (!projection) trace?.physicalRelations?.push({ name, ...(schema ? { schema } : {}), start: part.start, end: main[next - 1].end });
      if (trace && punct(main[next], '*')) next++;
    }
    const explicitAlias = keyword(main[next]) === 'AS';
    if (explicitAlias) next++;
    part = main[next];
    const alias = !stop.has(keyword(part)) ? identifier(part) : undefined;
    if (alias) {
      const columns = main[next + 1], renamed = nameList(columns);
      if (trace && renamed.length) recordJoinColumnTokens(columns, trace);
      if (renamed.length) projection = rename(projection ?? (trace ? unknown : relationProjection({ name, schema })),
        renamed, trace?.projected ? columns : undefined, trace);
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
      const relation: ScopedRelation = { name, alias, schema, declaration: alias ? part : cte,
        ...(trace.projected && projection ? { projection } : {}), ...(name && !projection ? { physical: true } : {}) };
      if (target && write) writeRelation = relation;
      refs.push(relation);
      i = end - 1;
      continue;
    }
    refs.push({ name, ...(schema ? { schema } : {}), ...(alias ? { alias } : {}), ...(projection ? { projection } : {}) });
  }
  let lockQuery: Query | undefined;
  if (activeLock || readLocks) {
    const table = tableSource && refs[0];
    const rows = !readLocks ? [] : table && (table.schema || !scope.has(table.name))
      ? [{ name: table.name, allowed: true, physical: { name: table.name, schema: table.schema } }]
      : joined?.rowLocks ?? [];
    lockQuery = rowLockTargets(rows, lockLists, activeLock, context, trace);
  }
  if (trace) {
    traceExpressions(returning < 0 ? main : main.slice(0, returning), scope, refs, outer, spans!, trace);
    if (command === 'SELECT' && !trace.field && !trace.physicalRelations) traceNamedWindows(main, trace);
    if (returning >= 0) {
      if (trace.unsupported || !writeRelation) return unsupported();
      return parseReturning(main.slice(returning), refs, writeRelation, { scope, outer, trace, names: new Set() }) ?? unsupported();
    }
    if (!trace.projected) return { projection: unknown };
    const projection = tableSource ? refs[0]?.projection ?? unknown : project(main, refs,
      command === 'SELECT' ? joined?.outputs.map(projection => ({name: '', projection})) : undefined, trace);
    if (command === 'SELECT' || tableSource) {
      const input = [refs, ...outer].map(level => level.filter(ref => !ref.qualifiedOnly));
      traceProjectionOrder(main, projection, trace, input);
      if (command === 'SELECT') {
        traceProjectionGrouping(main, projection, input, trace);
        traceDistinctOn(main, projection, input, trace);
      }
    }
    return { projection };
  }
  if (completeWrite) {
    if (!writeRelation) return { projection: unknown };
    const outputs = joined ? [relationProjection(writeRelation), ...joined.outputs] : undefined;
    const analysis: MergeAnalysis = { scope, outer, context, names: new Set() };
    if (returningHere) {
      const result = outputs ? { outputs, stars: outputs.map(projection => ({ name: '', projection })) } : undefined;
      return parseReturning(main.slice(returning), refs, writeRelation, analysis, result) ?? { projection: unknown };
    }
    const sources = readableColumns(refs);
    if (inPredicate) {
      // CURRENT OF 接的是游标名，普通布尔条件才查字段与例程目录。
      if (keyword(main[where + 1]) === 'CURRENT' && keyword(main[where + 2]) === 'OF') return { projection: unknown };
      const predicate = main.slice(where + 1, returning < 0 ? undefined : returning);
      mergeExpression(predicate, sources, analysis, main[where].end, predicateBoundary, { outputs });
    } else {
      completeWriteAction([main[0], ...main.slice(set, setEnd < 0 ? undefined : setEnd)], sources,
        { ...writeRelation, columnAccess: 'update' }, analysis, assignmentBoundary, outputs);
    }
    return analysis.active ?? { projection: unknown };
  }
  const projection = tableSource && refs[0] ? relationProjection(refs[0]) : project(main, refs, joined?.outputs.map(projection => ({name: '', projection})));
  if (lockQuery) return { projection, query: lockQuery };
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
    if (position >= 0 && (!dotted || qualifier) && (tableSource && position === 0 ||
        relationEntry(main, position) || commas.has(position) || position === deleteUsing)) {
      const ctes = qualifier || writeTarget(main, position) ? [] : [...scope.keys()].slice(0, limits.items);
      const routine: PostgresRoutineCompletionTarget | undefined = !tableSource && modifier !== 'ONLY' && !writeTarget(main, position)
        ? { context: 'from', ...(qualifier ? { schema: qualifier } : {}) } : undefined;
      return { projection, query: modifier === 'LATERAL' ? undefined :
        { kind: 'relations', ...(qualifier ? { schema: qualifier } : {}), ...(ctes.length ? { ctes } : {}) }, routine };
    }
  }
  const windows = command === 'SELECT' ? completeWindowNames(main, context) : undefined;
  if (windows) return { projection, windows };
  return { projection, query: keyword(left.at(-1)) === 'AS' ? undefined : columns(visible, outer, left, joined?.outputs),
    routine: expressionRoutine(main, left, cursorGroup, [visible, ...outer], argumentStart) };
}

const noLocalReference = { status: 'blocked', reason: 'syntax' } as const;
const rangeOf = ({ start, end }: LocalReferenceRange): LocalReferenceRange => ({ start, end });

/** 递归视图的裸同名关系等价于递归 CTE。显式 schema 仍按物理关系解析。 */
function parseStatementQuery(query: StatementQuery, context?: QueryContext, trace?: ReferenceTrace): Parsed {
  const scope = new Map<string, Projection>();
  const view = query.recursiveView;
  if (!view) return parseQuery(query.parts, scope, [], context, trace);

  const { name, declaration, columns, names } = view;
  const self = { ...rename(unknown, names), declaration };
  scope.set(name, self);
  // WITH 子句会复制作用域。更新同一个投影，让后续分支沿用锚点列，同时保留内层同名 CTE 的遮蔽。
  // 视图名和显式列名可定位到声明，但属于持久对象接口，不能由局部改名修改。
  return parseQuery(query.parts, scope, [], context, trace,
    anchor => Object.assign(self, rename(anchor, names, trace?.projected ? columns : undefined)));
}

/** 声明及物理对象共用严格作用域分析，不能将引用截断或猜作同名关系。 */
function tracePostgresStatement(source: string, offset: number, mode: boolean,
  intent: 'binding' | 'references' | 'projectionRename' | 'relation' | 'field' = 'binding'):
  { tokens: PostgresEditorToken[]; trace: ReferenceTrace } | Extract<LocalBindingReferences, { status: 'blocked' }> {
  let statement: ReturnType<typeof currentPostgresStatement>;
  try { statement = currentPostgresStatement(source, offset, mode, intent !== 'binding'); }
  catch { return noLocalReference; }
  const scanned = scanPostgresEditorTokens(statement.sql, limits.tokens, mode);
  if (!scanned) return { status: 'blocked', reason: 'budget' } as const;
  const encoder = new TextEncoder();
  // 目录未知时不能猜测长名截断或 U& 转义后与哪个声明同名。
  if (scanned.some(token => (token.kind === 'word' || token.kind === 'identifier') &&
    (encoder.encode(token.text).length > 63 || token.kind === 'identifier' &&
      (token.open || !token.text || /u&$/i.test(statement.sql.slice(Math.max(0, token.start - 2), token.start)))))) return noLocalReference;
  const tokens = scanned.map(token => ({ ...token, start: token.start + statement.start, end: token.end + statement.start }));
  if (intent !== 'relation' && !tokens.some(token => identifier(token) && offset >= token.start && offset <= token.end)) return noLocalReference;
  const parts = groupStatement(tokens, offset, statement.end, true);
  const query = parts && statementQuery(parts, offset);
  if (!query) return noLocalReference;
  const trace: ReferenceTrace = { edges: new Map(), declarations: new Map(), implicitNames: new Map(), windowSlots: new Map(),
    joinAliases: new Set(), joinColumnTokens: new Set(), unsupported: false,
    ...(intent === 'relation' ? { physicalRelations: [] } : intent === 'field' ? { field: { offset } } :
      intent === 'references' || intent === 'projectionRename' ? { projected: true } : {}),
    ...(intent === 'projectionRename' ? { projectionRename: { explicit: new Set(), separate: new Set(), uncertain: new Set(), outputs: [] } } : {}) };
  parseStatementQuery(query, undefined, trace);
  return trace.unsupported ? noLocalReference : { tokens, trace };
}

/** 只读取光标所在语句，为导航和重命名提供同一套原文绑定。 */
function analyzePostgresBinding<T extends LocalBindingReferences | LocalRename>(source: string, offset: number, standardStrings: boolean | undefined,
  plan: (references: DeclaredLocalReferences, target: PostgresEditorToken,
    tokens: PostgresEditorToken[], trace: ReferenceTrace, mode: boolean) => T,
  intent: 'binding' | 'references' | 'projectionRename' = 'binding'): T | Extract<LocalBindingReferences, { status: 'blocked' }> {
  if (source.length > limits.source) return { status: 'blocked', reason: 'budget' };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length || /[\uD800-\uDFFF]/u.test(source)) return noLocalReference;

  function analyze(mode: boolean): T | Extract<LocalBindingReferences, { status: 'blocked' }> {
    const analyzed = tracePostgresStatement(source, offset, mode, intent);
    if ('status' in analyzed) return analyzed;
    const { tokens, trace } = analyzed;
    const target = tokens.find(token => identifier(token) && offset >= token.start && offset <= token.end);
    if (!target) return noLocalReference;
    const declaration = trace.edges.get(target) ?? target;
    const references = [...trace.edges].filter(([, binding]) => binding.start === declaration.start)
      .map(([token]) => rangeOf(token)).sort((a, b) => a.start - b.start);
    if (!references.length && !trace.projectionRename?.explicit.has(declaration.start) &&
      !trace.windowSlots.has(declaration.start)) return noLocalReference;
    if (references.length > limits.items) return { status: 'blocked', reason: 'budget' };
    return plan({ status: 'ready', target: rangeOf(target), declaration: rangeOf(declaration), references }, target, tokens, trace, mode);
  }

  const result = analyze(standardStrings ?? true);
  // 离线编辑时两种字符串模式必须确认同一结果，包括重命名的每一处编辑。
  return standardStrings === undefined && source.includes('\\') && result.status === 'ready' && JSON.stringify(result) !== JSON.stringify(analyze(false))
    ? noLocalReference : result;
}

/** 光标必须位于确切关系名称或其 schema，CTE、别名及表函数不是物理对象。 */
export function analyzePostgresObjectDefinition(source: string, offset: number, standardStrings?: boolean): PhysicalRelation | undefined {
  if (source.length > limits.source || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || /[\uD800-\uDFFF]/u.test(source)) return;
  const find = (mode: boolean) => {
    const analysis = tracePostgresStatement(source, offset, mode, 'relation');
    if ('status' in analysis) return;
    return analysis.trace.physicalRelations?.find(relation => relation.start <= offset && offset <= relation.end);
  };
  const result = find(standardStrings ?? true);
  if (result && (standardStrings !== undefined || !source.includes('\\') || JSON.stringify(result) === JSON.stringify(find(false)))) return result;
}

/** 未连接时两种字符串规则必须确认同一字段范围及同一组关系。 */
export function analyzePostgresFieldHover(source: string, offset: number, standardStrings?: boolean): PostgresFieldTarget | undefined {
  if (source.length > limits.source || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || /[\uD800-\uDFFF]/u.test(source)) return;
  const find = (mode: boolean) => {
    const result = tracePostgresStatement(source, offset, mode, 'field');
    return 'status' in result ? undefined : result.trace.field?.target;
  };
  const result = find(standardStrings ?? true);
  if (result && (standardStrings !== undefined || !source.includes('\\') || JSON.stringify(result) === JSON.stringify(find(false)))) return result;
}

/** 命名参数沿用执行时的全稿绑定，其余引用沿用当前语句的作用域。 */
export function analyzePostgresLocalReferences(source: string, offset: number, standardStrings?: boolean): LocalReferences {
  return postgresNamedParameterReferences(source, offset, standardStrings) ??
    analyzePostgresBinding(source, offset, standardStrings, references => references, 'references');
}

function projectionNameProblem(facts: ProjectionRenameFacts, declaration: number, name: string): 'unresolved' | 'collision' | undefined {
  if (facts.uncertain.has(declaration)) return 'unresolved';
  if (facts.outputs.some(output => output.origins?.some(origin => origin?.start === declaration) && projectedMatches(output, name).length !== 1))
    return 'collision';
}

/** 检查改名后的局部引用图，已有声明和引用必须仍逐一对应原始位置。 */
function projectionRenamePreservesBindings(source: string, mode: boolean, tokens: PostgresEditorToken[], trace: ReferenceTrace,
  result: Extract<LocalRename, { status: 'ready' }>, declaration: number, newName: string): boolean {
  const fragments: string[] = [];
  let end = 0;
  for (const edit of result.edits) {
    fragments.push(source.slice(end, edit.start), edit.text);
    end = edit.end;
  }
  const updated = fragments.join('') + source.slice(end);
  if (updated.length > limits.source) return false;

  let shift = 0, index = 0;
  const mapped = new Map<number, number>();
  for (const token of tokens) {
    for (let edit = result.edits[index]; edit && edit.end <= token.start; edit = result.edits[++index]) {
      shift += edit.text.length - (edit.end - edit.start);
    }
    mapped.set(token.start, token.start + shift);
  }
  const after = tracePostgresStatement(updated, mapped.get(result.target.start)!, mode, 'projectionRename');
  if ('status' in after || trace.edges.size !== after.trace.edges.size) return false;
  const newDeclaration = mapped.get(declaration)!;
  const facts = after.trace.projectionRename!;
  if (!facts.explicit.has(newDeclaration) || projectionNameProblem(facts, newDeclaration, newName)) return false;
  const destinations = new Map([...after.trace.edges].map(([reference, owner]) => [reference.start, owner.start]));
  return [...trace.edges].every(([reference, owner]) => {
    const start = mapped.get(reference.start), expectedOwner = mapped.get(owner.start);
    return start !== undefined && expectedOwner !== undefined && destinations.get(start) === expectedOwner;
  });
}

/** 只改写显式列声明及完整的已确认引用。裸物理字段与其它已定位的同名声明保留。 */
function planPostgresProjectionRename(source: string, references: DeclaredLocalReferences, token: PostgresEditorToken,
  tokens: PostgresEditorToken[], trace: ReferenceTrace, mode: boolean, newName?: string): LocalRename {
  const facts = trace.projectionRename!, name = identifier(token)!, declaration = references.declaration.start;
  if (!facts.explicit.has(declaration)) return noLocalReference;
  const problem = projectionNameProblem(facts, declaration, name);
  if (problem) return { status: 'blocked', reason: problem };
  const group = [references.declaration, ...references.references].sort((left, right) => left.start - right.start);
  const editedStarts = new Set(group.map(range => range.start));
  // NATURAL JOIN 的合并键没有文本范围。未解析的同名标识符也可能是依赖，整组拒绝。
  if (tokens.some(item => keyword(item) === 'NATURAL' || identifier(item) === name &&
      !editedStarts.has(item.start) && !trace.edges.has(item) && !trace.declarations.has(item.start) &&
      !facts.explicit.has(item.start) && !facts.separate.has(item.start))) return { status: 'blocked', reason: 'unresolved' };
  const result: Extract<LocalRename, { status: 'ready' }> = { status: 'ready', kind: 'column', name, target: references.target, edits: [] };
  if (newName === undefined || newName === name) return result;
  const text = quoteLocalRename(newName, 'postgresql');
  if (!text) return { status: 'blocked', reason: 'name' };
  if (tokens.some(item => identifier(item) === newName)) return { status: 'blocked', reason: 'collision' };
  result.edits = group.map(range => ({ ...range, text }));
  return projectionRenamePreservesBindings(source, mode, tokens, trace, result, declaration, newName)
    ? result : { status: 'blocked', reason: 'collision' };
}

/** 同名词只有确定属于另一个绑定才可略过，任何未确认的同名词都会阻止整组修改。 */
export function analyzePostgresLocalRename(source: string, offset: number, standardStrings?: boolean, newName?: string): LocalRename {
  const parameter = postgresNamedParameterRename(source, offset, standardStrings, newName);
  if (parameter) return parameter;
  const relation = analyzePostgresBinding(source, offset, standardStrings, (references, target, tokens, trace) => {
    const name = identifier(target)!;
    const declaration = references.declaration.start;
    if (newName !== undefined && newName !== name && trace.implicitNames.get(declaration)?.has(newName)) return { status: 'blocked', reason: 'collision' };
    const kind = trace.declarations.get(declaration);
    const window = trace.windowSlots.get(declaration);
    if (kind === 'window' && window) {
      const sorted = [...window].sort((left, right) => left.start - right.start);
      return planLocalRename({ status: 'ready', target: { ...rangeOf(target), value: name },
        tokens: sorted.map(token => ({ ...rangeOf(token), value: identifier(token)! })) }, references, 'postgresql', () => kind, newName);
    }
    const localTokens = [];
    for (const token of tokens) {
      const value = identifier(token);
      if (value === undefined) continue;
      const owner = trace.edges.get(token)?.start ?? (trace.declarations.has(token.start) ? token.start : undefined);
      if (value === name && owner !== undefined && owner !== declaration) continue;
      if (value === name && trace.joinAliases.has(declaration) && trace.joinColumnTokens.has(token.start)) continue;
      localTokens.push({ ...rangeOf(token), value });
    }
    return planLocalRename({ status: 'ready', target: { ...rangeOf(target), value: name }, tokens: localTokens },
      references, 'postgresql', () => kind, newName);
  });
  if (relation.status === 'ready') return relation;
  const column = analyzePostgresBinding(source, offset, standardStrings, (references, target, tokens, trace, mode) =>
    planPostgresProjectionRename(source, references, target, tokens, trace, mode, newName), 'projectionRename');
  return column.status === 'blocked' && column.reason === 'syntax' ? relation : column;
}

const nullPlacement = ['FIRST', 'LAST'] as const;
const fetchDirection = ['FIRST', 'NEXT'] as const;
const rowUnits = ['ROW', 'ROWS'] as const;
const clauseStarts = ['NULLS', 'FETCH'] as const;
const paginationWords = [...rowUnits, 'ONLY', 'WITH', 'TIES'];
const paginationCountKeywords = new Set([...paginationWords, ...fetchDirection]);
const unfinishedClause = new Set([...stop, ...expressionEntries, 'IS', 'IN', 'LIKE', 'ILIKE', 'BETWEEN', 'NULLS']
  .filter(word => !['NULL', 'TRUE', 'FALSE'].includes(word)));

/** 识别常用的独立行数写法。复杂表达式放进带括号的一个词法组，内部关键字不参与分页补全。 */
function paginationCount(parts: Part[], source: string): boolean {
  const first = parts[0], last = parts.at(-1);
  if (!first || !last) return false;
  if (parts.length === 1) {
    if (first.kind === 'group') return first.closing === ')' && first.closed && first.parts.length > 0;
    if (first.kind === 'identifier') return !first.open;
    if (first.kind === 'word') return !unfinishedClause.has(keyword(first)) &&
      !paginationCountKeywords.has(keyword(first));
    if (first.kind === 'blocked' && !first.open) return true;
  }
  const count = source.slice(first.start, last.end);
  return /^(?:\$[0-9]+|[+-]?\s*[0-9]+(?:_[0-9]+)*)$/.test(count);
}

/** 仅从当前查询块的分页子句续写，并按当前 ORDER BY 和锁定语法决定是否提供 WITH TIES。 */
function paginationKeywords(source: string, query: Part[], following: Part[]): readonly string[] {
  const words = query.map(keyword);
  const clause = Math.max(words.lastIndexOf('FETCH'), words.lastIndexOf('OFFSET'));
  if (clause <= 0 || punct(query[clause - 1], '.') || unfinishedClause.has(words[clause - 1])) return [];
  const fetch = words[clause] === 'FETCH';
  if (fetch && !fetchDirection.some(word => word === words[clause + 1])) return [];
  const count = query.slice(clause + (fetch ? 2 : 1));
  const withWord = fetch && keyword(count.at(-1)) === 'WITH';
  if (withWord) count.pop();
  if (fetch && rowUnits.some(word => word === keyword(count.at(-1)))) {
    count.pop();
    if (count.length && !paginationCount(count, source)) return [];
    const ordered = words.slice(0, clause).some((word, i) => word === 'ORDER' && words[i + 1] === 'BY');
    const tail = following.map(keyword);
    const skipLocked = [words.slice(0, clause), tail].some(segment =>
      segment.some((word, i) => word === 'SKIP' && segment[i + 1] === 'LOCKED'));
    const ties = ordered && !skipLocked;
    if (withWord) return ties ? ['TIES'] : [];
    if (tail[0] === 'TIES') return ties ? ['WITH'] : [];
    return ties ? ['ONLY', 'WITH TIES'] : ['ONLY'];
  }
  if (withWord || !(fetch && !count.length || paginationCount(count, source))) return [];
  return rowUnits;
}

/** 按当前查询块判断排序和分页短语。集中处理两个词的插入范围，已写好的另一半留在原处。 */
function selectClauseKeywords(source: string, parts: Part[], position: { start: number; end: number; offset: number; prefix: string }):
  { items: readonly string[]; continuation: boolean } | undefined {
  const { start, end, offset, prefix } = position;
  const nested = parts.find((part): part is Group => part.kind === 'group' && contains(part, offset));
  if (nested) return selectClauseKeywords(source, nested.parts, position);

  const before = parts.filter(part => part.end <= start && part.start < start);
  const command = keyword(before[0]);
  if (command !== 'SELECT' && command !== 'WITH' && !(before[0]?.kind === 'group' && before.some(part => setOperators.has(keyword(part))))) return;
  const branch = before.map(part => setOperators.has(keyword(part))).lastIndexOf(true);
  const query = before.slice(branch + 1);
  if (command === 'WITH' && !query.some(part => keyword(part) === 'SELECT') && branch < 0) return;
  if (paginationWords.some(word => word.startsWith(prefix))) {
    const following = parts.filter(part => part.start >= end && part.end > start);
    const items = paginationKeywords(source, query, following).filter(word => word.startsWith(prefix));
    const next = keyword(following[0]);
    if (items.length && (start !== end || !items.some(item => item.split(' ')[0] === next))) return { items, continuation: true };
  }
  const previous = keyword(query.at(-1));
  const continuation = previous === 'NULLS' || previous === 'FETCH';
  const head = continuation ? previous : prefix && clauseStarts.find(word => word.startsWith(prefix));
  if (!head) return;
  if (continuation) query.pop();
  const last = query.at(-1);
  const lastWord = keyword(last);
  // 编辑器词法把数字按单字符记为标点，数字仍可结束排序表达式或偏移量。
  if (!last || last.kind === 'punct' && !/^[0-9]$/.test(last.text) || unfinishedClause.has(lastWord)) return;

  if (head === 'NULLS') {
    const order = query.map((part, index) => keyword(part) === 'ORDER' && keyword(query[index + 1]) === 'BY').lastIndexOf(true);
    if (order < 0) return;
    const tail = query.slice(order + 2);
    const sortItem = tail.slice(tail.map(part => punct(part, ',')).lastIndexOf(true) + 1);
    if (!sortItem.length || tail.some(part => endsFrom.has(keyword(part))) || sortItem.some(part => keyword(part) === 'NULLS')) return;
  } else if (query.some(part => ['LIMIT', 'FETCH', 'FOR'].includes(keyword(part)))) return;

  const endings = head === 'NULLS' ? nullPlacement : fetchDirection;
  const next = keyword(parts.find(part => part.start >= end));
  const items = continuation ? endings.filter(word => word.startsWith(prefix))
    : endings.some(word => word === next) ? [head] : endings.map(word => head + ' ' + word);
  return items.length ? { items, continuation } : undefined;
}

/** 定位当前标识符，屏蔽注释、字符串和参数，再解析当前语句的查询作用域。 */
export function analyzePostgresCompletion(source: string, offset: number, standardStrings?: boolean): PostgresCompletionAnalysis | undefined {
  if (source.length > limits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const all = scanPostgresEditorTokens(source, limits.tokens, standardStrings ?? true);
  if (!all || all.some(token => token.kind === 'blocked' && offset > token.start &&
      (offset < token.end || token.open && offset === token.end))) return;
  const target = all.find(token => (token.kind === 'word' || token.kind === 'identifier') && offset >= token.start && offset <= token.end);
  const start = target?.start ?? offset, end = target?.end ?? offset, quoted = target?.kind === 'identifier';
  const raw = source.slice(start, offset);
  const prefix = quoted ? raw.slice(1, !target?.open && offset === end ? -1 : undefined).replaceAll('""', '"') : raw;
  if (prefix.length > limits.name) return;
  const parts = groupStatement(all, offset, source.length);
  const query = parts && statementQuery(parts, offset);
  const queryStart = query?.parts !== parts ? query?.parts[0]?.start ?? 0 : 0;
  const left = all.filter(token => token !== target && token.start >= queryStart && token.end <= start &&
    !(token.kind === 'blocked' && token.text === 'comment'));
  const previous = left.at(-1);
  const prefixUpper = prefix.toUpperCase();
  const clause = query && !quoted && !punct(previous, '.') && (clauseStarts.some(word => word === keyword(previous) ||
    prefix && word.startsWith(prefixUpper)) || paginationWords.some(word => word.startsWith(prefixUpper)) &&
    left.some(part => ['FETCH', 'OFFSET'].includes(keyword(part))))
    ? selectClauseKeywords(source, query.parts, { start, end, offset, prefix: prefixUpper }) : undefined;
  if (clause?.continuation) return { start, end, prefix, quoted, keywords: clause.items };
  const parsed = query && parseStatementQuery(query, { offset, start, end, left,
    keywordPrefix: !quoted && !punct(previous, '.') ? prefixUpper : undefined });
  if (parsed?.query?.kind === 'using' || parsed?.query?.kind === 'conflictTarget' || parsed?.query?.kind === 'lockTargets' ||
      parsed?.query?.kind === 'lockKeywords' ||
      parsed?.query?.kind === 'columns' && parsed.query.joinOutput) {
    // 目录目标和锁子句必须在离线的两种字符串模式下有一致的词法边界。
    if (standardStrings === undefined && source.includes('\\') &&
      JSON.stringify(all) !== JSON.stringify(scanPostgresEditorTokens(source, limits.tokens, false))) return;
    if (parsed.query.kind !== 'columns') return { start, end, prefix, quoted, query: parsed.query };
  }
  if (parsed?.windows) {
    const result = { start, end, prefix, quoted, windows: parsed.windows };
    // 尚未连接时，两种字符串规则必须确认相同位置和同一组窗口。
    return standardStrings === undefined && source.includes('\\') &&
      JSON.stringify(result) !== JSON.stringify(analyzePostgresCompletion(source, offset, false)) ? undefined : result;
  }
  const next = parsed?.routine && all.find(token => token !== target && token.start >= end && !(token.kind === 'blocked' && token.text === 'comment'));
  const existingCall = punct(next, '(');
  const declaredTable = existingCall && declaredTableSyntax.has(keyword(target)) && !punct(left.at(-1), '.');
  const routine = !declaredTable && parsed?.routine && (prefix || parsed.routine.schema) ? parsed.routine : undefined;
  return { start, end, prefix, quoted, ...(clause ? { keywords: clause.items } : {}), ...(!declaredTable && parsed?.query ? { query: parsed.query } : {}),
    ...(routine ? { routine, existingCall } : {}) };
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
    if (declaredTableSyntax.has(keyword(token)) && !punct(tokens[frame.index - 2], '.')) continue;
    const analysis = analyzePostgresCompletion(source, token.end);
    if (!analysis?.routine || !analysis.existingCall) continue;
    return { name, routine: analysis.routine, argument: frame.argument, named: namedAt(frame.start), previousNames: frame.previousNames };
  }
}
