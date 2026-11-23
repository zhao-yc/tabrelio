import { sqliteCompletionRelationMatches, type SqliteCompletionAnalysis, type SqliteCompletionRelation } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionIndexes, sqliteCompletionLimits, type SqliteCompletionEntry } from '../shared/sqliteCompletion';
import { sqliteCollationDetails, sqliteColumnTypeDetails, sqliteColumnTypeMode, sqliteForeignKeyCatalog, sqliteFunctionDetails, sqliteIndexDetails, type SqliteCompletionDirectory } from './sqliteCompletionSuggestions';
import { sqliteFieldHoverZh as text } from './locales/sqliteFieldHover.zh-CN';
import { sqliteCompletionZh } from './locales/sqliteCompletion.zh-CN';
import { sqliteProjectionReader, sqliteQualifiedJoinColumns, sqliteRowidName } from './sqliteJoinColumns';

/** 仅显示代码块纯文本；名称及声明类型不能变成HTML、外链或可执行Monaco命令。 */
function markdown(lines: string[]): string { return lines.join('\n').split(/\r\n|\r|\n/).map(line => '    ' + line).join('\n'); }
const display = (value: string) => JSON.stringify(value);

function fieldHover(binding: string, column: string, entry: Extract<SqliteCompletionEntry, { kind: 'column' }> | undefined, tableFunction: boolean, localSource?: string, excluded = false) {
  const lines = [text.title, text.column + '：' + display(column), text.binding + '：' + display(binding)];
  if (entry) {
    if (excluded) lines.push(sqliteCompletionZh.excludedRow);
    const sourceKind = tableFunction ? sqliteCompletionZh.tableFunction : entry.schema === 'temp' ? text.temporary : text.permanent;
    lines.push(text.source + '：' + display(entry.schema) + '.' + display(entry.table), sourceKind,
      text.declaredType + '：' + (entry.declaredType ? display(entry.declaredType) : text.noDeclaredType), text.generated + '：' + (entry.generated ? text.yes : text.no), text.hidden + '：' + (entry.hidden ? text.yes : text.no), text.dynamic);
  } else if (localSource) lines.push(text.source + '：' + localSource, text.unknown);
  return markdown(lines);
}

/** 精确字段解析须检查全部可见绑定；目录不完整或同名歧义时不猜测某个物理来源。 */
export async function sqliteFieldHover(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<string | undefined> {
  if (!analysis.target.prefix) return;
  const name = analysis.target.prefix, qualifiers = analysis.qualifiers;
  let prefix = name.slice(0, sqliteCompletionLimits.prefixUnits);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  if (analysis.columnType) {
    const { strict } = await sqliteColumnTypeMode(analysis.columnType, directory);
    if (strict === undefined) return;
    const details = sqliteColumnTypeDetails(name.replace(/[\t ]+/g, ' ').toUpperCase(), strict);
    if (details.length) return markdown([display(name), ...details]);
    return;
  }
  if (analysis.foreignKey) {
    const context = analysis.foreignKey, sameName = (value: string) => fold(value) === fold(name);
    if (context.kind === 'local-column') {
      if (!context.columns.some(sameName)) return;
      return markdown([context.self ? sqliteCompletionZh.foreignParentColumn : sqliteCompletionZh.foreignChildColumn, display(name), sqliteCompletionZh.foreignSelf]);
    }
    if (context.kind === 'parent' && context.self && sameName(context.self)) {
      return markdown([sqliteCompletionZh.foreignParent, display(name), sqliteCompletionZh.foreignSelf]);
    }
    const result = await sqliteForeignKeyCatalog(context, prefix, directory, true);
    if (result.incomplete) return;
    const entry = result.entries.find(entry => sameName(entry.name));
    if (context.kind === 'parent' && entry?.kind === 'table') {
      return markdown([sqliteCompletionZh.foreignParent, display(entry.schema) + '.' + display(entry.name)]);
    }
    if (context.kind === 'parent-column' && entry?.kind === 'column' && !entry.hidden) {
      return markdown([sqliteCompletionZh.foreignParentColumn, display(entry.schema) + '.' + display(entry.table) + '.' + display(entry.name),
        text.declaredType + '：' + (entry.declaredType ? display(entry.declaredType) : text.noDeclaredType)]);
    }
    return;
  }
  if (analysis.syntax.includes('collation')) {
    const result = await directory.load({ kind: 'collations', prefix });
    if (result.incomplete) return;
    const entry = result.entries.find(entry => entry.kind === 'collation' && fold(entry.name) === fold(name));
    if (entry) return markdown([display(entry.name), ...sqliteCollationDetails(entry.name)]);
    return;
  }
  if (analysis.functions) {
    const result = await directory.load({ kind: 'functions', prefix, ...(analysis.functions.deterministicOnly ? { deterministicOnly: true } : {}) });
    if (result.incomplete) return;
    const entry = result.entries.find(entry => entry.kind === 'function' && fold(entry.name) === fold(name));
    if (entry?.kind === 'function') {
      const info = sqliteFunctionDetails(entry, analysis.functions.mode, analysis.functions.deterministicOnly);
      if (info) return markdown([entry.name + '(…)', ...info.details]);
    }
    return;
  }
  if (analysis.indexSource) {
    const result = await directory.load(sqliteCompletionIndexes(analysis.indexSource, prefix));
    if (result.incomplete) return;
    const entry = result.entries.find(entry => entry.kind === 'index' && fold(entry.name) === fold(name));
    if (entry?.kind === 'index') return markdown([sqliteCompletionZh.index, display(entry.name),
      text.source + '：' + display(entry.schema) + '.' + display(entry.table), ...sqliteIndexDetails(entry)]);
    return;
  }
  if (!analysis.syntax.includes('column')) return;
  const hints = analysis.outputAliases;
  const alias = hints?.names.find(alias => fold(alias) === fold(name));
  const aliasHover = () => alias && fieldHover(alias, alias, undefined, false, sqliteCompletionZh.outputAlias);
  if (alias && hints?.outputFirst) return aliasHover();
  const reader = await sqliteProjectionReader(analysis.localProjections ?? [], directory);
  if (analysis.joinGroup) {
    const { alias, groups } = analysis.joinGroup;
    const result = await sqliteQualifiedJoinColumns(alias, groups, reader);
    if (result.incomplete) return;
    const column = result.columns.find(column => fold(column.name) === fold(name));
    if (column) return fieldHover(alias, column.name, column.entry, column.tableFunction === true, sqliteCompletionZh.joinGroup);
    return;
  }
  const bound = analysis.relations.filter(relation => relation.kind === 'physical' || !relation.declaration);
  const selected = bound.filter(relation => sqliteCompletionRelationMatches(relation, qualifiers) &&
    (qualifiers.length || relation.kind !== 'physical' || relation.dmlRole !== 'excluded'));
  if (qualifiers.length && selected.length !== 1) return;
  const candidates: { relation: SqliteCompletionRelation; column: string; entry?: Extract<SqliteCompletionEntry, { kind: 'column' }>; tableFunction?: true }[] = [];
  // 先查当前查询块的字段，再查该块的输出别名，最后才查相关子查询的外层字段。
  const depths = new Set(selected.map(relation => relation.scopeDepth ?? 0));
  if (hints) depths.add(hints.scopeDepth);
  for (const depth of [...depths].sort((a, b) => b - a)) {
    const bindings = selected.filter(relation => (relation.scopeDepth ?? 0) === depth);
    for (const relation of bindings) {
      if (relation.kind === 'local') {
        if (relation.projection === undefined) {
          for (const column of relation.columns) if (fold(column) === fold(name)) candidates.push({ relation, column });
        } else {
          const projection = await reader.readColumns({ projection: relation.projection }, '');
          if (projection.incomplete) return;
          for (const column of projection.columns) if (fold(column.name) === fold(name)) {
            candidates.push({ relation, column: column.name, entry: column.entry, tableFunction: column.tableFunction });
          }
        }
      } else {
        const result = await reader.readColumns({ source: relation }, prefix);
        if (result.incomplete) return;
        for (const { entry } of result.columns) if (entry && !(relation.visibleColumnsOnly && entry.hidden) &&
          !(analysis.writableColumns && (entry.generated || entry.hidden)) && (qualifiers.length !== 2 || entry.schema === fold(qualifiers[0])) &&
          fold(entry.name) === fold(name)) candidates.push({ relation, column: entry.name, entry });
      }
    }
    if (depth === hints?.scopeDepth && hints?.sourcesIncomplete) return;
    if (candidates.length) break;
    if (alias && depth === hints?.scopeDepth) {
      if (sqliteRowidName.test(name) && bindings.some(relation => relation.kind === 'physical')) return;
      return aliasHover();
    }
  }
  if (candidates.length !== 1) return;
  const { relation, column, entry, tableFunction } = candidates[0];
  if (relation.afterOuterJoin) return;
  const localSource = relation.kind === 'local' ? relation.source === 'cte' ? text.cte : text.derived : undefined;
  return fieldHover(relation.alias ?? relation.name, column, entry, tableFunction === true || relation.kind === 'physical' && relation.tableFunction === true,
    localSource, relation.kind === 'physical' && relation.dmlRole === 'excluded');
}
