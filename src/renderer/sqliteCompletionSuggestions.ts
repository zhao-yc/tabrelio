import { sqliteCompletionRelationMatches, sqliteQueryBodyKeywords, type SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, quoteSqliteCompletionName as quote, sqliteCompletionIndexes, sqliteCompletionLimits, type SqliteCompletionEntry, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import { sqliteCompletionZh as text } from './locales/sqliteCompletion.zh-CN';
import { sqliteJoinRowidName, sqliteJoinStarColumns, sqliteProjectionReader, sqliteQualifiedJoinColumns, sqliteRowidName } from './sqliteJoinColumns';

export interface SqliteCompletionItem { label: string; kind: 'database' | 'table' | 'view' | 'column' | 'index' | 'collation' | 'function' | 'alias' | 'keyword'; insertText: string; detail: string; trigger?: boolean; snippet?: true; }
export interface SqliteCompletionDirectory { load(query: SqliteCompletionLookup): Promise<SqliteCompletionOutput>; }
const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'WITH', 'AS', 'DISTINCT', 'UNION ALL', 'IS NULL', 'IS NOT NULL', 'RETURNING', 'WINDOW', 'OVER', 'FILTER', 'PARTITION BY', 'ROWS', 'RANGE', 'BETWEEN', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT ROW', 'EXPLAIN QUERY PLAN'];
const windowSpecKeywords = ['PARTITION BY', 'ORDER BY', 'ROWS', 'RANGE', 'GROUPS'];

export function sqliteIndexDetails(entry: Extract<SqliteCompletionEntry, { kind: 'index' }>): string[] {
  return [text.indexOrigin[entry.origin], ...(entry.unique ? [text.uniqueIndex] : []), ...(entry.partial ? [text.partialIndex] : [])];
}

const builtinCollations = new Map([['binary', text.collationBinary], ['nocase', text.collationNocase], ['rtrim', text.collationRtrim]]);
export function sqliteCollationDetails(name: string): string[] {
  const detail = builtinCollations.get(fold(name));
  return detail ? [text.collation, detail] : [text.collation];
}

const windowOnlyFunctions = new Set(['row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);
const conditionalDateTime = new Set(['date', 'time', 'datetime', 'strftime', 'julianday', 'unixepoch']);
type FunctionContext = NonNullable<Extract<SqliteCompletionAnalysis, { status: 'ready' }>['functions']>;

/** function_list 将必须带 OVER 的内置窗口函数和可独立使用的聚合都标为 w。 */
export function sqliteFunctionDetails(entry: Extract<SqliteCompletionEntry, { kind: 'function' }>, mode: FunctionContext['mode'], deterministicOnly?: true) {
  const windowOnly = windowOnlyFunctions.has(entry.name);
  if (windowOnly && mode !== 'result') return;
  const signatures = entry.signatures.filter(signature => mode !== 'scalar' || signature.type === 'scalar');
  if (!signatures.length) return;
  const kind = windowOnly ? text.windowFunction : signatures.some(signature => signature.type !== 'scalar') ? text.aggregateFunction : text.scalarFunction;
  // SQLite 内置变参重载可能使用小于 -1 的目录标记，一律显示为可变参数。
  const arities = [...new Set(signatures.map(({ arity }) => Math.max(-1, arity)))].sort((a, b) => a - b);
  const details = [kind, text.functionArity + '：' + arities.map(arity => arity < 0 ? text.variadicFunction : String(arity)).join(' / ')];
  if (deterministicOnly && conditionalDateTime.has(entry.name)) details.push(text.indexDateTime);
  return { windowOnly, needsArguments: arities.some(arity => arity !== 0), details };
}

/** 建议只引用准确目录名；同名字段保留不同别名的限定插入，CTE声明不伪装成FROM绑定。 */
export async function sqliteCompletionSuggestions(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<{ items: SqliteCompletionItem[]; incomplete: boolean }> {
  const items: SqliteCompletionItem[] = [], seen = new Set<string>(), prefix = fold(analysis.target.prefix), qualifiers = analysis.qualifiers;
  let incomplete = false;
  const add = (item: SqliteCompletionItem) => {
    if (!fold(item.label).startsWith(prefix)) return;
    const key = analysis.output || analysis.using ? fold(item.label) : item.kind + '\0' + item.insertText;
    if (seen.has(key)) return;
    if (items.length >= sqliteCompletionLimits.suggestions) { incomplete = true; return; }
    seen.add(key); items.push(item);
  };
  if (analysis.syntax.includes('query-start')) {
    for (const keyword of sqliteQueryBodyKeywords) add({ label: keyword, kind: 'keyword', insertText: keyword, detail: text.keyword });
    return { items, incomplete };
  }
  const addFunctions = async (context: FunctionContext) => {
    const metadata = await directory.load({ kind: 'functions', prefix: analysis.target.prefix, ...(context.deterministicOnly ? { deterministicOnly: true } : {}) });
    incomplete ||= metadata.incomplete;
    for (const entry of metadata.entries) if (entry.kind === 'function') {
      const info = sqliteFunctionDetails(entry, context.mode, context.deterministicOnly);
      if (!info) continue;
      // 通过目录协议的 ASCII 内置函数名可用于固定片段，已有括号时只替换名称。
      const call = info.windowOnly ? (info.needsArguments ? '($1) OVER ($0)' : '() OVER ($0)') : info.needsArguments ? '($0)' : '()';
      const insertText = (analysis.target.quoted ? quote(entry.name) : entry.name) + (context.existingCall ? '' : call);
      add({ label: entry.name, kind: 'function', insertText, detail: info.details.join(' · '), ...(insertText.includes('$') ? { snippet: true } : {}) });
    }
  };
  if (analysis.functions?.existingCall) {
    await addFunctions(analysis.functions);
    return { items, incomplete };
  }
  if (analysis.syntax.includes('collation')) {
    const metadata = await directory.load({ kind: 'collations', prefix: analysis.target.prefix });
    incomplete = metadata.incomplete;
    for (const entry of metadata.entries) if (entry.kind === 'collation') {
      add({ label: entry.name, kind: 'collation', insertText: quote(entry.name), detail: sqliteCollationDetails(entry.name).join(' · ') });
    }
    return { items, incomplete };
  }
  if (analysis.indexSource) {
    const metadata = await directory.load(sqliteCompletionIndexes(analysis.indexSource, analysis.target.prefix));
    incomplete = metadata.incomplete;
    for (const entry of metadata.entries) if (entry.kind === 'index') {
      add({ label: entry.name, kind: 'index', insertText: quote(entry.name), detail: [text.index, entry.schema + '.' + entry.table, ...sqliteIndexDetails(entry)].join(' · ') });
    }
    return { items, incomplete };
  }
  if (analysis.windowNames) {
    // 窗口名只在当前查询块解析。使用名称时不打开会话或读取表字段。
    for (const { name, quote: delimiter } of analysis.windowNames.names) {
      const insertText = delimiter === '"' ? quote(name) : delimiter === '[' ? '[' + name + ']' : delimiter === '`' ? '`' + name.replaceAll('`', '``') + '`' : name;
      const detail = insertText === name ? text.namedWindow : text.namedWindow + ' · ' + insertText;
      add({ label: name, kind: 'alias', insertText, detail });
    }
    if (analysis.windowNames.inline && !analysis.target.quoted) {
      for (const keyword of windowSpecKeywords) add({ label: keyword, kind: 'keyword', insertText: keyword, detail: text.keyword });
    }
    return { items, incomplete };
  }
  // 同一次补全共享目录，局部星号与外层物理来源重合时复用原读取。
  const reader = await sqliteProjectionReader(analysis.localProjections ?? [], directory);
  if (analysis.using) {
    const { left, right, used, uniqueLeft, groups = [], starGroupSides } = analysis.using;
    const { readColumns, projectGroups } = reader;
    await projectGroups(groups);
    const names = new Map<string, { count: number; visible: boolean }>();
    const ambiguous = new Set<string>();
    // 含 RIGHT/FULL JOIN 的查询块按合并后的左侧列消歧。
    for (const { operand, merged } of left) {
      const explicit = new Set(Array.isArray(merged) ? merged.map(fold) : []);
      const result = await readColumns(operand, analysis.target.prefix);
      incomplete ||= result.incomplete;
      if (starGroupSides && starGroupSides !== 'right') for (const name of result.ambiguousOrigins ?? []) ambiguous.add(name);
      for (const { name, hidden } of result.columns) {
        const key = fold(name), known = names.get(key) ?? { count: 0, visible: false };
        const combines = known.count > 0 && (explicit.has(key) || merged === true && !hidden && known.visible);
        names.set(key, { count: known.count + Number(!combines), visible: known.visible || !hidden });
      }
    }
    if (uniqueLeft && incomplete) return { items, incomplete };
    const excluded = new Set(used.map(fold));
    const result = await readColumns(right, analysis.target.prefix);
    incomplete ||= result.incomplete;
    if (starGroupSides && starGroupSides !== 'left') for (const name of result.ambiguousOrigins ?? []) ambiguous.add(name);
    // 隐式 rowid 并非列目录的一部分。若另一侧有同族的显式列，指出候选可能不全。
    const groupedLeft = left.some(({ operand }) => 'group' in operand);
    if ('group' in right && [...names.keys()].some(name => name.startsWith(prefix) && sqliteJoinRowidName.test(name))) incomplete = true;
    for (const { name } of result.columns) {
      const key = fold(name), known = names.get(key);
      if (groupedLeft && key.startsWith(prefix) && sqliteJoinRowidName.test(key)) { incomplete = true; continue; }
      if (known && (!uniqueLeft || known.count === 1) && !excluded.has(key) && !ambiguous.has(key)) {
        add({ label: name, kind: 'column', insertText: quote(name), detail: text.joinColumn });
      }
    }
    return { items, incomplete };
  }
  if (analysis.joinGroup) {
    const { alias, groups } = analysis.joinGroup;
    const projected = await sqliteQualifiedJoinColumns(alias, groups, reader);
    incomplete = projected.incomplete;
    for (const { name, entry } of projected.columns) {
      const info = [alias, text.joinGroup, entry?.declaredType].filter(Boolean).join(' · ');
      add({ label: name, kind: 'column', insertText: quote(name), detail: info });
    }
    return { items, incomplete };
  }
  const bound = analysis.relations.filter(relation => relation.kind === 'physical' || !relation.declaration);
  const declarations = analysis.relations.filter(relation => relation.kind === 'local' && relation.declaration);
  if (analysis.output) {
    incomplete = analysis.output.incomplete === true;
    const addOutput = (name: string) => add({ label: name, kind: 'column', insertText: quote(name), detail: text.outputColumn });
    for (const name of analysis.output.columns) addOutput(name);
    for (const star of analysis.output.joinStars ?? []) {
      const result = await sqliteJoinStarColumns(star, reader);
      incomplete ||= result.incomplete;
      for (const column of result.columns) addOutput(column.name);
    }
    for (const projection of analysis.output.projections ?? []) {
      const result = await reader.readColumns({ projection }, '');
      incomplete ||= result.incomplete;
      for (const column of result.columns) addOutput(column.name);
    }
    for (const source of analysis.output.sources) {
      const metadata = await reader.readColumns({ source }, analysis.target.prefix);
      incomplete ||= metadata.incomplete;
      // 星号包含普通列和生成列，虚拟表的隐藏列仅能显式引用。
      for (const entry of metadata.columns) if (!entry.hidden) addOutput(entry.name);
    }
    return { items, incomplete };
  }
  if (analysis.syntax.includes('relation') && qualifiers.length <= 1) {
    const explicit = qualifiers.length === 1 && ['main', 'temp'].includes(fold(qualifiers[0])) ? fold(qualifiers[0]) as 'main' | 'temp' : undefined;
    const schema = explicit ?? analysis.viewSchema ?? analysis.indexTarget?.schema;
    if (!qualifiers.length || explicit) {
      if (!explicit && !analysis.indexTarget) {
        for (const local of declarations) add({ label: local.name, kind: 'table', insertText: quote(local.name), detail: text.cte });
        for (const namespace of analysis.viewSchema ? [analysis.viewSchema] : ['main', 'temp']) add({ label: namespace, kind: 'database', insertText: quote(namespace) + '.', detail: text.schema, trigger: true });
      }
      const metadata = await directory.load({ kind: 'relations', prefix: analysis.target.prefix, ...(schema ? { schema } : {}),
        ...(analysis.indexTarget ? { indexTable: true } : {}) }); incomplete ||= metadata.incomplete;
      const shadowed = new Set(declarations.map(relation => fold(relation.name)));
      for (const entry of metadata.entries) {
        if (entry.kind !== 'table' && entry.kind !== 'view' || !explicit && shadowed.has(fold(entry.name))) continue;
        add({ label: entry.name, kind: entry.kind, insertText: quote(entry.name), detail: (entry.kind === 'view' ? text.view : text.table) + ' · ' + entry.schema + (entry.schema === 'temp' ? ' · ' + text.temporary : '') });
      }
    }
  }
  if (analysis.syntax.includes('column')) {
    const selected = bound.filter(relation => sqliteCompletionRelationMatches(relation, qualifiers));
    if (qualifiers.length && selected.length > 1) return { items: [], incomplete: true };
    const outputAliases = analysis.outputAliases, sourceNames = new Set<string>();
    const addOutputAlias = (name: string) => add({ label: name, kind: 'column', insertText: quote(name), detail: text.outputAlias });
    let aliasSourcesIncomplete = outputAliases?.sourcesIncomplete === true;
    let aliasMayResolveToRowid = false;
    incomplete ||= aliasSourcesIncomplete;
    if (outputAliases?.outputFirst) for (const name of outputAliases.names) addOutputAlias(name);
    for (const relation of selected) {
      const binding = relation.alias ?? relation.name;
      const aliasSource = !!outputAliases && relation.scopeDepth === outputAliases.scopeDepth;
      if (relation.afterOuterJoin && !aliasSource) continue;
      // INSERT列清单由分析器仅投影目标表；已有点限定时只替换最后的字段。
      const insert = (name: string) => qualifiers.length || analysis.unqualifiedColumns ? quote(name) : quote(binding) + '.' + quote(name);
      const addSourceColumn = (name: string, detail: string) => {
        if (aliasSource) sourceNames.add(fold(name));
        if (!relation.afterOuterJoin) add({ label: name, kind: 'column', insertText: insert(name), detail });
      };
      if (relation.kind === 'local') {
        const kind = relation.source === 'cte' ? text.cte : text.derived;
        if (relation.projection === undefined) {
          for (const name of relation.columns) addSourceColumn(name, binding + ' · ' + kind);
        } else {
          const projection = await reader.readColumns({ projection: relation.projection }, '');
          incomplete ||= projection.incomplete;
          aliasSourcesIncomplete ||= aliasSource && projection.incomplete;
          for (const { name, entry } of projection.columns) {
            const detail = [binding, kind, entry?.declaredType].filter(Boolean).join(' · ');
            addSourceColumn(name, detail);
          }
        }
      } else {
        const metadata = await reader.readColumns({ source: relation }, analysis.target.prefix);
        incomplete ||= metadata.incomplete;
        aliasSourcesIncomplete ||= aliasSource && metadata.incomplete;
        aliasMayResolveToRowid ||= aliasSource;
        const source = relation.dmlRole === 'excluded' ? text.excludedRow : relation.tableFunction ? text.tableFunction : undefined;
        for (const { entry } of metadata.columns) if (entry && !(relation.visibleColumnsOnly && entry.hidden) &&
          !(analysis.writableColumns && (entry.generated || entry.hidden)) && (qualifiers.length !== 2 || entry.schema === fold(qualifiers[0]))) {
          addSourceColumn(entry.name, binding + ' · ' + (source ?? entry.schema) + ' · ' + (entry.declaredType || text.column) + (entry.generated ? ' · ' + text.generated : '') + (entry.hidden ? ' · ' + text.hidden : ''));
        }
      }
      if (!qualifiers.length && !relation.afterOuterJoin && !analysis.unqualifiedColumns) {
        const detail = relation.kind === 'physical' && relation.dmlRole === 'excluded' ? text.excludedRow : relation.kind === 'local' && relation.source === 'group' ? text.joinGroup : text.alias;
        add({ label: binding, kind: 'alias', insertText: quote(binding) + '.', detail, trigger: true });
      }
    }
    // 当前查询块的来源列优先于输出别名，外层列在输出别名之后。目录无法确认隐式 rowid。
    if (outputAliases && !outputAliases.outputFirst && !aliasSourcesIncomplete) {
      for (const name of outputAliases.names) {
        if (sourceNames.has(fold(name))) continue;
        if (aliasMayResolveToRowid && sqliteRowidName.test(name)) { incomplete = true; continue; }
        addOutputAlias(name);
      }
    }
  }
  if (analysis.functions) await addFunctions(analysis.functions);
  if (analysis.syntax.includes('keyword') && !analysis.target.quoted && !qualifiers.length) for (const keyword of keywords) add({ label: keyword, kind: 'keyword', insertText: keyword, detail: text.keyword });
  return { items, incomplete };
}
