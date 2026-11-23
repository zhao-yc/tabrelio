import type { SqliteCompletionAnalysis, SqliteCompletionRelation } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionColumns, sqliteCompletionLimits, type SqliteCompletionEntry } from '../shared/sqliteCompletion';
import type { SqliteCompletionDirectory } from './sqliteCompletionSuggestions';
import { sqliteFieldHoverZh as text } from './locales/sqliteFieldHover.zh-CN';
import { sqliteCompletionZh } from './locales/sqliteCompletion.zh-CN';
import { sqliteLocalProjectionColumns, sqliteQualifiedJoinColumns } from './sqliteJoinColumns';

/** 仅显示代码块纯文本；名称及声明类型不能变成HTML、外链或可执行Monaco命令。 */
function markdown(lines: string[]): string { return lines.join('\n').split(/\r\n|\r|\n/).map(line => '    ' + line).join('\n'); }
const display = (value: string) => JSON.stringify(value);

function fieldHover(binding: string, column: string, entry: Extract<SqliteCompletionEntry, { kind: 'column' }> | undefined, tableFunction: boolean, localSource?: string) {
  const lines = [text.title, text.column + '：' + display(column), text.binding + '：' + display(binding)];
  if (entry) {
    const sourceKind = tableFunction ? sqliteCompletionZh.tableFunction : entry.schema === 'temp' ? text.temporary : text.permanent;
    lines.push(text.source + '：' + display(entry.schema) + '.' + display(entry.table), sourceKind,
      text.declaredType + '：' + (entry.declaredType ? display(entry.declaredType) : text.noDeclaredType), text.generated + '：' + (entry.generated ? text.yes : text.no), text.hidden + '：' + (entry.hidden ? text.yes : text.no), text.dynamic);
  } else if (localSource) lines.push(text.source + '：' + localSource, text.unknown);
  return markdown(lines);
}

/** 精确字段解析须检查全部可见绑定；目录不完整或同名歧义时不猜测某个物理来源。 */
export async function sqliteFieldHover(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<string | undefined> {
  if (!analysis.syntax.includes('column') || !analysis.target.prefix) return;
  const name = analysis.target.prefix, qualifiers = analysis.qualifiers;
  if (analysis.joinGroup) {
    const { alias, groups } = analysis.joinGroup;
    const result = await sqliteQualifiedJoinColumns(alias, groups, directory);
    if (result.incomplete) return;
    const column = result.columns.find(column => fold(column.name) === fold(name));
    if (column) return fieldHover(alias, column.name, column.entry, column.tableFunction === true, sqliteCompletionZh.joinGroup);
    return;
  }
  const bound = analysis.relations.filter(relation => relation.kind === 'physical' || !relation.declaration);
  const matches = (relation: SqliteCompletionRelation) => !qualifiers.length || qualifiers.length === 1 && fold(relation.alias ?? relation.name) === fold(qualifiers[0]) || qualifiers.length === 2 && relation.kind === 'physical' && !relation.alias && relation.schema !== undefined && fold(relation.schema) === fold(qualifiers[0]) && fold(relation.name) === fold(qualifiers[1]);
  const selected = bound.filter(matches);
  if (!selected.length || qualifiers.length && selected.length !== 1) return;
  const candidates: { relation: SqliteCompletionRelation; column: string; entry?: Extract<SqliteCompletionEntry, { kind: 'column' }>; tableFunction?: true }[] = [];
  const projections = await sqliteLocalProjectionColumns(analysis.localProjections ?? [], directory);
  let prefix = name.slice(0, sqliteCompletionLimits.prefixUnits);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  // 未限定字段按最近查询块逐层找；内层已存在的字段不会被同名外层字段误报为歧义。
  const depths = [...new Set(selected.map(relation => relation.scopeDepth ?? 0))].sort((a, b) => b - a);
  for (const depth of depths) {
  for (const relation of selected.filter(relation => (relation.scopeDepth ?? 0) === depth)) {
    if (relation.kind === 'local') {
      if (relation.projection === undefined) {
        for (const column of relation.columns) if (fold(column) === fold(name)) candidates.push({ relation, column });
      } else {
        const projection = projections[relation.projection];
        if (projection.incomplete) return;
        for (const column of projection.columns) if (fold(column.name) === fold(name)) {
          candidates.push({ relation, column: column.name, entry: column.entry, tableFunction: column.tableFunction });
        }
      }
    } else {
      const result = await directory.load(sqliteCompletionColumns(relation, prefix));
      if (result.incomplete) return;
      for (const entry of result.entries) if (entry.kind === 'column' && !(relation.visibleColumnsOnly && entry.hidden) && fold(entry.name) === fold(name)) candidates.push({ relation, column: entry.name, entry });
    }
  }
  if (candidates.length) break;
  }
  if (candidates.length !== 1) return;
  const { relation, column, entry, tableFunction } = candidates[0];
  const localSource = relation.kind === 'local' ? relation.source === 'cte' ? text.cte : text.derived : undefined;
  return fieldHover(relation.alias ?? relation.name, column, entry, tableFunction === true || relation.kind === 'physical' && relation.tableFunction === true, localSource);
}
