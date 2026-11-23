import type { SqliteCompletionAnalysis, SqliteCompletionRelation } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, quoteSqliteCompletionName as quote, sqliteCompletionLimits, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import { sqliteCompletionZh as text } from './locales/sqliteCompletion.zh-CN';
import { sqliteJoinRowidName, sqliteJoinStarColumns, sqliteProjectionReader, sqliteQualifiedJoinColumns } from './sqliteJoinColumns';

export interface SqliteCompletionItem { label: string; kind: 'database' | 'table' | 'view' | 'column' | 'alias' | 'keyword'; insertText: string; detail: string; trigger?: boolean; }
export interface SqliteCompletionDirectory { load(query: SqliteCompletionLookup): Promise<SqliteCompletionOutput>; }
const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'WITH', 'AS', 'DISTINCT', 'UNION ALL', 'IS NULL', 'IS NOT NULL', 'RETURNING', 'WINDOW', 'OVER', 'FILTER', 'PARTITION BY', 'ROWS', 'RANGE', 'BETWEEN', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT ROW'];

/** 建议只引用准确目录名；同名字段保留不同别名的限定插入，CTE声明不伪装成FROM绑定。 */
export async function sqliteCompletionSuggestions(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<{ items: SqliteCompletionItem[]; incomplete: boolean }> {
  const items: SqliteCompletionItem[] = [], seen = new Set<string>(), prefix = fold(analysis.target.prefix), qualifiers = analysis.qualifiers;
  // 同一次补全共享目录，局部星号与外层物理来源重合时复用原读取。
  const reader = await sqliteProjectionReader(analysis.localProjections ?? [], directory);
  let incomplete = false;
  const add = (item: SqliteCompletionItem) => {
    if (!fold(item.label).startsWith(prefix)) return;
    const key = analysis.output || analysis.using ? fold(item.label) : item.kind + '\0' + item.insertText;
    if (seen.has(key)) return;
    if (items.length >= sqliteCompletionLimits.suggestions) { incomplete = true; return; }
    seen.add(key); items.push(item);
  };
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
    const schema = qualifiers.length === 1 && ['main', 'temp'].includes(fold(qualifiers[0])) ? fold(qualifiers[0]) as 'main' | 'temp' : undefined;
    if (!qualifiers.length || schema) {
      if (!schema) {
        for (const local of declarations) add({ label: local.name, kind: 'table', insertText: quote(local.name), detail: text.cte });
        for (const namespace of ['main', 'temp']) add({ label: namespace, kind: 'database', insertText: quote(namespace) + '.', detail: text.schema, trigger: true });
      }
      const metadata = await directory.load({ kind: 'relations', prefix: analysis.target.prefix, ...(schema ? { schema } : {}) }); incomplete ||= metadata.incomplete;
      const shadowed = new Set(declarations.map(relation => fold(relation.name)));
      for (const entry of metadata.entries) {
        if (entry.kind === 'column' || !schema && shadowed.has(fold(entry.name))) continue;
        add({ label: entry.name, kind: entry.kind, insertText: quote(entry.name), detail: (entry.kind === 'view' ? text.view : text.table) + ' · ' + entry.schema + (entry.schema === 'temp' ? ' · ' + text.temporary : '') });
      }
    }
  }
  /** 名称限定采用SQLite的ASCII比较；别名一旦存在，不把旧表名再当别名。 */
  const matches = (relation: SqliteCompletionRelation) => !qualifiers.length || qualifiers.length === 1 && fold(relation.alias ?? relation.name) === fold(qualifiers[0]) || qualifiers.length === 2 && relation.kind === 'physical' && !relation.alias && relation.schema !== undefined && fold(relation.schema) === fold(qualifiers[0]) && fold(relation.name) === fold(qualifiers[1]);
  if (analysis.syntax.includes('column')) {
    const selected = bound.filter(matches);
    if (qualifiers.length && selected.length > 1) return { items: [], incomplete: true };
    for (const relation of selected) {
      const binding = relation.alias ?? relation.name;
      // INSERT列清单由分析器仅投影目标表；已有点限定时只替换最后的字段。
      const insert = (name: string) => qualifiers.length || analysis.unqualifiedColumns ? quote(name) : quote(binding) + '.' + quote(name);
      if (relation.kind === 'local') {
        const kind = relation.source === 'cte' ? text.cte : text.derived;
        if (relation.projection === undefined) {
          for (const name of relation.columns) add({ label: name, kind: 'column', insertText: insert(name), detail: binding + ' · ' + kind });
        } else {
          const projection = await reader.readColumns({ projection: relation.projection }, '');
          incomplete ||= projection.incomplete;
          for (const { name, entry } of projection.columns) {
            const detail = [binding, kind, entry?.declaredType].filter(Boolean).join(' · ');
            add({ label: name, kind: 'column', insertText: insert(name), detail });
          }
        }
      } else {
        const metadata = await reader.readColumns({ source: relation }, analysis.target.prefix); incomplete ||= metadata.incomplete;
        const source = relation.tableFunction ? text.tableFunction : undefined;
        for (const { entry } of metadata.columns) if (entry && !(relation.visibleColumnsOnly && entry.hidden)) add({ label: entry.name, kind: 'column', insertText: insert(entry.name), detail: binding + ' · ' + (source ?? entry.schema) + ' · ' + (entry.declaredType || text.column) + (entry.generated ? ' · ' + text.generated : '') + (entry.hidden ? ' · ' + text.hidden : '') });
      }
      if (!qualifiers.length) add({ label: binding, kind: 'alias', insertText: quote(binding) + '.', detail: relation.kind === 'local' && relation.source === 'group' ? text.joinGroup : text.alias, trigger: true });
    }
  }
  if (analysis.syntax.includes('keyword') && !analysis.target.quoted && !qualifiers.length) for (const keyword of keywords) add({ label: keyword, kind: 'keyword', insertText: keyword, detail: text.keyword });
  return { items, incomplete };
}
