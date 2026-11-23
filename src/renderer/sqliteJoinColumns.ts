import type { SqliteJoinGroup, SqliteJoinOperand } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionColumns, sqliteCompletionLimits, sqliteCompletionSourceKey, type SqliteCompletionEntry, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import type { SqliteCompletionDirectory } from './sqliteCompletionSuggestions';

export interface SqliteJoinColumn {
  name: string;
  hidden: boolean;
  originName?: string;
  originBinding?: string;
  entry?: Extract<SqliteCompletionEntry, { kind: 'column' }>;
  tableFunction?: true;
}
interface JoinColumns { columns: SqliteJoinColumn[]; incomplete: boolean; ambiguousOrigins?: Set<string>; }
type JoinGroupInput = { columns: SqliteJoinColumn[]; merged?: true | string[] };
export const sqliteJoinRowidName = /^(?:rowid|_rowid_|oid)(?::\d+)*:?$/i;

/** 用实际目录推导嵌套 JOIN 的列名。显式引用也可以使用被普通星号省略的分组列。 */
function projectJoinGroup(inputs: JoinGroupInput[], uniqueLeft: boolean): JoinColumns {
  const names = new Map<string, { count: number; visible: boolean }>();
  const mergedNames: string[][] = [];
  for (const input of inputs) {
    const merged = input.merged === true ? input.columns.filter(({ name, hidden }) => !hidden && names.get(fold(name))?.visible).map(({ name }) => name) : input.merged ?? [];
    const matching = new Set(merged.map(fold));
    const right = new Set(input.columns.map(({ name }) => fold(name)));
    if ([...matching].some(key => !names.has(key) || !right.has(key) || uniqueLeft && names.get(key)?.count !== 1)) return { columns: [], incomplete: true };
    mergedNames.push(merged);
    for (const { name, hidden } of input.columns) {
      const key = fold(name), known = names.get(key) ?? { count: 0, visible: false };
      names.set(key, { count: known.count + Number(!matching.has(key)), visible: known.visible || !hidden });
    }
  }
  // SQLite 在左侧来源前放入合并值，然后为重名列分配 :1、:2 等后缀。合并值可能有多条血缘。
  const projected = inputs.flatMap(({ columns }, index) => [
    ...(mergedNames[index + 1] ?? []).map(name => ({ column: { name, hidden: false } as SqliteJoinColumn, merged: true })),
    ...columns.filter(column => !column.hidden).map(column => ({ column, merged: false })),
  ]);
  const occupied = new Map<string, SqliteJoinColumn>(), uncertain = new Set<string>();
  const origins = new Set<string>(), mergedOrigins = new Set<string>(), ambiguousOrigins = new Set<string>();
  const hasBooleanName = projected.some(({ column }) => /^(?:true|false)$/i.test(column.name));
  let incomplete = hasBooleanName;
  for (const { column, merged } of projected) {
    const original = column.name, originName = column.originName ?? original, origin = fold(originName);
    if (!mergedOrigins.has(origin) && origins.has(origin)) ambiguousOrigins.add(origin);
    origins.add(origin);
    if (merged) mergedOrigins.add(origin);
    const base = original.replace(/:\d*$/, '');
    if (sqliteJoinRowidName.test(original) || hasBooleanName && /^(?:true|false|column\d+(?::\d+)*)$/i.test(original)) { incomplete = true; continue; }
    // 随机后缀只会影响同一名称族后续列，已经分配的名称仍可使用。
    if (uncertain.has(fold(base))) continue;
    let name = original, suffix = 0;
    while (occupied.has(fold(name)) && suffix < 4) name = base + ':' + ++suffix;
    if (occupied.has(fold(name)) || name.length > sqliteCompletionLimits.nameUnits) {
      uncertain.add(fold(base));
      incomplete = true;
    } else occupied.set(fold(name), { ...column, name, originName });
  }
  return { columns: [...occupied.values()], incomplete, ambiguousOrigins };
}

/** 按已验证的来源编号读取。只读成员目录，不请求分组名、原 SQL 或任何实参。 */
export function sqliteJoinColumnReader(directory: SqliteCompletionDirectory) {
  const cache = new Map<string, SqliteCompletionOutput>();
  const projectedGroups: JoinColumns[] = [];
  async function readColumns(operand: SqliteJoinOperand, lookupPrefix: string): Promise<JoinColumns> {
    if ('group' in operand) return projectedGroups[operand.group];
    if ('columns' in operand) return { columns: operand.columns.map(name => ({ name, hidden: false })), incomplete: !operand.columns.length };
    const key = sqliteCompletionSourceKey(operand.source);
    const full = cache.get(key + '\0');
    let metadata = full && !full.incomplete ? full : cache.get(key + '\0' + lookupPrefix);
    if (!metadata) {
      metadata = await directory.load(sqliteCompletionColumns(operand.source, lookupPrefix));
      cache.set(key + '\0' + lookupPrefix, metadata);
    }
    const { tableFunction } = operand.source;
    return { columns: metadata.entries.filter(entry => entry.kind === 'column').map(entry => ({ name: entry.name, hidden: entry.hidden, entry, tableFunction })), incomplete: metadata.incomplete };
  }
  async function projectGroups(groups: SqliteJoinGroup[]) {
    for (const group of groups) {
      const inputs: JoinGroupInput[] = [];
      for (const { operand, merged, binding } of group.inputs) {
        const result = await readColumns(operand, '');
        if (result.incomplete) break;
        const originBinding = binding ?? ('source' in operand ? operand.source.name : undefined);
        const columns = originBinding ? result.columns.map(column => ({ ...column, originBinding })) : result.columns;
        inputs.push({ columns, merged });
      }
      projectedGroups.push(inputs.length === group.inputs.length ? projectJoinGroup(inputs, group.uniqueLeft === true) : { columns: [], incomplete: true });
    }
  }
  return { readColumns, projectGroups };
}

/** 组别名与成员同名时，SQLite 优先按照成员的原始字段名解析，再查组输出名。 */
export async function sqliteQualifiedJoinColumns(alias: string, groups: SqliteJoinGroup[], directory: SqliteCompletionDirectory): Promise<JoinColumns> {
  const reader = sqliteJoinColumnReader(directory);
  await reader.projectGroups(groups);
  const result = await reader.readColumns({ group: groups.length - 1 }, '');
  const columns = new Map(result.columns.map(column => [fold(column.name), column]));
  const members = new Map<string, SqliteJoinColumn | undefined>();
  for (const column of result.columns) {
    if (!column.originName || !column.originBinding || fold(column.originBinding) !== fold(alias)) continue;
    const key = fold(column.originName);
    members.set(key, members.has(key) ? undefined : { ...column, name: column.originName });
  }
  for (const [key, column] of members) {
    if (column) columns.set(key, column);
    else columns.delete(key);
  }
  return { columns: [...columns.values()], incomplete: result.incomplete };
}
