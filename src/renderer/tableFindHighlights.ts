/** 只索引原查找返回的单元格坐标，保持行标识和字段键分离，不再扫描数据。 */
export function tableFindHighlights<Match extends { rowId: string }, Key>(matches: readonly Match[], keyFor: (match: Match) => Key): ReadonlyMap<string, ReadonlySet<Key>> {
  const rows = new Map<string, Set<Key>>();
  for (const match of matches) {
    let keys = rows.get(match.rowId);
    if (!keys) rows.set(match.rowId, keys = new Set());
    keys.add(keyFor(match));
  }
  return rows;
}
