/** 复制一个本地字段，保留原行身份及位置，副本用各方言现有标识符规则选名。 */
export function duplicateNewTableColumn<T extends { name: string }>(
  columns: readonly T[], source: T, acceptsName: (name: string) => boolean, overrides: Partial<T> = {},
): { copy: T; columns: T[] } | undefined {
  const index = columns.indexOf(source);
  if (index < 0) return;
  const names = new Set(columns.map(column => column.name.toLowerCase()));
  const base = source.name.trim() || 'column';
  for (let sequence = 1; sequence <= columns.length + 1; sequence++) {
    const suffix = sequence === 1 ? '_copy' : '_copy_' + sequence;
    let prefix = '';
    for (const character of base) {
      if (!acceptsName(prefix + character + suffix)) break;
      prefix += character;
    }
    const name = (prefix || 'column') + suffix;
    if (names.has(name.toLowerCase()) || !acceptsName(name)) continue;
    const copy = { ...structuredClone(source), ...overrides, name };
    return { copy, columns: [...columns.slice(0, index + 1), copy, ...columns.slice(index + 1)] };
  }
}
