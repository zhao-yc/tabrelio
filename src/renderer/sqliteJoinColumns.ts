import type { SqliteJoinGroup, SqliteJoinOperand, SqliteJoinStars, SqliteLocalProjection } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionColumns, sqliteCompletionLimits, sqliteCompletionSourceKey, type SqliteCompletionEntry, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import type { SqliteCompletionDirectory } from './sqliteCompletionSuggestions';

export interface SqliteJoinColumn {
  name: string;
  hidden: boolean;
  originName?: string;
  originBinding?: string;
  entry?: Extract<SqliteCompletionEntry, { kind: 'column' }>;
  tableFunction?: true;
  noStar?: true;
}
interface JoinColumns { columns: SqliteJoinColumn[]; incomplete: boolean; ambiguousOrigins?: Set<string>; }
type JoinGroupInput = { columns: SqliteJoinColumn[]; merged?: true | string[] };
export const sqliteJoinRowidName = /^(?:rowid|_rowid_|oid)(?::\d+)*:?$/i;
const duplicateBase = (name: string) => name.replace(/:\d*$/, '');

/** SQLite 在确定的四个数字后缀用尽后转入随机名称。 */
function projectedName(original: string, occupied: Map<string, SqliteJoinColumn>, onCollision?: (key: string) => void): string | undefined {
  const base = duplicateBase(original);
  let name = original, suffix = 0;
  while (occupied.has(fold(name)) && suffix < 4) {
    onCollision?.(fold(name));
    name = base + ':' + ++suffix;
  }
  return occupied.has(fold(name)) || name.length > sqliteCompletionLimits.nameUnits ? undefined : name;
}

/** 计算每次连接实际合并的名称，保留隐藏列对显式 USING 的影响。 */
function joinNames(inputs: JoinGroupInput[], uniqueLeft: boolean): string[][] | undefined {
  const names = new Map<string, { count: number; visible: boolean }>();
  const mergedNames: string[][] = [];
  for (const input of inputs) {
    const merged = input.merged === true ? input.columns.filter(({ name, hidden }) => !hidden && names.get(fold(name))?.visible).map(({ name }) => name) : input.merged ?? [];
    const matching = new Set(merged.map(fold));
    const right = new Set(input.columns.map(({ name }) => fold(name)));
    if ([...matching].some(key => !names.has(key) || !right.has(key) || uniqueLeft && names.get(key)?.count !== 1)) return;
    mergedNames.push(merged);
    for (const { name, hidden } of input.columns) {
      const key = fold(name), known = names.get(key) ?? { count: 0, visible: false };
      names.set(key, { count: known.count + Number(!matching.has(key)), visible: known.visible || !hidden });
    }
  }
  return mergedNames;
}

/** 用实际目录推导嵌套 JOIN 的列名。显式引用也可以使用被普通星号省略的分组列。 */
function projectJoinGroup(inputs: JoinGroupInput[], uniqueLeft: boolean): JoinColumns {
  const mergedNames = joinNames(inputs, uniqueLeft);
  if (!mergedNames) return { columns: [], incomplete: true };
  // SQLite 在左侧来源前放入合并值，然后为重名列分配 :1、:2 等后缀。合并值可能有多条血缘。
  const projected = inputs.flatMap(({ columns }, index) => {
    const following = mergedNames[index + 1] ?? [];
    const suppress = new Set([...mergedNames[index], ...following].map(fold));
    return [
      ...following.map(name => ({ column: { name, hidden: false } as SqliteJoinColumn, merged: true })),
      ...columns.filter(column => !column.hidden).map(column => ({
        column: suppress.has(fold(column.name)) ? { ...column, noStar: true as const } : column, merged: false,
      })),
    ];
  });
  const occupied = new Map<string, SqliteJoinColumn>(), uncertain = new Set<string>();
  const origins = new Set<string>(), mergedOrigins = new Set<string>(), ambiguousOrigins = new Set<string>(), mergedOutputs = new Set<string>();
  const hasBooleanName = projected.some(({ column }) => /^(?:true|false)$/i.test(column.name));
  let incomplete = hasBooleanName;
  for (const { column, merged } of projected) {
    const original = column.name, originName = column.originName ?? original, origin = fold(originName);
    if (!mergedOrigins.has(origin) && origins.has(origin)) ambiguousOrigins.add(origin);
    origins.add(origin);
    if (merged) mergedOrigins.add(origin);
    const base = duplicateBase(original);
    if (sqliteJoinRowidName.test(original) || hasBooleanName && /^(?:true|false|column\d+(?::\d+)*)$/i.test(original)) { incomplete = true; continue; }
    // 随机后缀只会影响同一名称族后续列，已经分配的名称仍可使用。
    if (uncertain.has(fold(base))) continue;
    let noStar = column.noStar;
    const name = projectedName(original, occupied, key => { if (mergedOutputs.has(key)) noStar = true; });
    if (name === undefined) {
      uncertain.add(fold(base));
      incomplete = true;
    } else {
      occupied.set(fold(name), { ...column, name, originName, ...(noStar ? { noStar } : {}) });
      if (merged) mergedOutputs.add(fold(name));
    }
  }
  return { columns: [...occupied.values()], incomplete, ambiguousOrigins };
}

/** 按已验证的来源编号读取。只读成员目录，不请求分组名、原 SQL 或任何实参。 */
export function sqliteJoinColumnReader(directory: SqliteCompletionDirectory, localResults: JoinColumns[] = []) {
  const cache = new Map<string, SqliteCompletionOutput>();
  const projectedGroups: JoinColumns[] = [];
  async function readColumns(operand: SqliteJoinOperand, lookupPrefix: string): Promise<JoinColumns> {
    if ('group' in operand) return projectedGroups[operand.group];
    if ('projection' in operand) return localResults[operand.projection];
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
    projectedGroups.length = 0;
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

/** 局部投影逐层展开并保留槽位顺序，已有列的名称不受后方未知表达式影响。 */
export async function sqliteLocalProjectionColumns(projections: SqliteLocalProjection[], directory: SqliteCompletionDirectory): Promise<JoinColumns[]> {
  const results: JoinColumns[] = [], reader = sqliteJoinColumnReader(directory, results);
  for (const projection of projections) {
    const ordered: SqliteJoinColumn[] = [];
    let incomplete = false;
    for (const slot of projection) {
      if ('unknown' in slot) { incomplete = true; break; }
      if ('name' in slot) ordered.push({ name: slot.name, hidden: false });
      else {
        const star = await sqliteJoinStarColumns(slot.star, reader);
        // 未知槽可能改变后续重名后缀。只交付已确定的前序投影。
        if (star.incomplete) { incomplete = true; break; }
        ordered.push(...star.columns);
      }
      if (ordered.length > sqliteCompletionLimits.entries) { incomplete = true; break; }
    }
    const names = new Map<string, SqliteJoinColumn>(), uncertain = new Set<string>();
    for (const [index, column] of ordered.slice(0, sqliteCompletionLimits.entries).entries()) {
      const original = /^(?:true|false)$/i.test(column.name) ? 'column' + (index + 1) : column.name;
      const family = fold(duplicateBase(original));
      if (uncertain.has(family)) continue;
      const name = projectedName(original, names);
      if (name === undefined) { incomplete = true; uncertain.add(family); continue; }
      // CTE／派生表成为新来源，外层星号看到的是该投影自己的列名和类型。
      names.set(fold(name), { name, hidden: false, entry: column.entry, tableFunction: column.tableFunction });
    }
    results.push({ columns: [...names.values()], incomplete });
  }
  return results;
}

/** 仅展开实际结果列表。未限定 * 隐藏合并副本，成员.* 仍可输出这些有确定名称的列。 */
export async function sqliteJoinStarColumns(star: SqliteJoinStars, reader: ReturnType<typeof sqliteJoinColumnReader>): Promise<JoinColumns> {
  await reader.projectGroups(star.groups);
  let incomplete = false;
  const columns: SqliteJoinColumn[] = [];
  const acceptsSole = (selected: SqliteJoinColumn[], result: JoinColumns) => !star.sole || selected.every(column =>
    fold(column.name) === fold(column.originName ?? column.name) && !result.ambiguousOrigins?.has(fold(column.name)));
  if (star.all) {
    const all = star.all;
    const inputs: JoinGroupInput[] = [];
    const resolved: JoinColumns[] = [];
    for (const { operand, merged } of all) {
      const result = await reader.readColumns(operand, '');
      incomplete ||= result.incomplete;
      resolved.push(result);
      inputs.push({ columns: result.columns, merged });
    }
    const mergedNames = joinNames(inputs, star.uniqueLeft === true);
    // RIGHT/FULL 可让星号把合并项作为未限定名称解析，组内原始重名会引发歧义。
    const ambiguous = star.uniqueLeft && mergedNames?.some((names, index) => {
      if (!names.length) return false;
      const later = all.slice(index + 1).some(input => input.outer);
      const left = all[index].outer === 'full' || later, right = !!all[index].outer || later;
      return resolved.some((result, member) => (member < index && left || member === index && right) &&
        names.some(name => result.ambiguousOrigins?.has(fold(name))));
    });
    if (!mergedNames || ambiguous) incomplete = true;
    else for (const [index, result] of resolved.entries()) {
      const suppressed = new Set(mergedNames[index].map(fold));
      const visible = result.columns.filter(column => !column.hidden && !column.noStar && !suppressed.has(fold(column.name)));
      if (acceptsSole(visible, result)) columns.push(...visible);
      else incomplete = true;
    }
  }
  for (const { group, binding } of star.members ?? []) {
    const result = await reader.readColumns({ group }, '');
    const visible = result.columns.filter(column => column.originBinding && fold(column.originBinding) === fold(binding));
    incomplete ||= result.incomplete;
    if (visible.length && acceptsSole(visible, result)) columns.push(...visible);
    else incomplete = true;
  }
  return { columns, incomplete };
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
