const prefixes = { postgres: 'postgres-preset:', sqlite: 'sqlite-preset:' } as const;
export type TablePresetTabKind = keyof typeof prefixes;

/** 标签仅保存方案和标签编号，条件值仍由本机方案库保存。 */
export function tablePresetTabId(kind: TablePresetTabKind, presetId: string, nonce: string): string {
  return `${prefixes[kind]}${presetId}:${nonce}`;
}

export function isTablePresetTabId(kind: TablePresetTabKind, id: string | undefined): boolean {
  return !!id?.startsWith(prefixes[kind]);
}

export function tablePresetIdFromTab(kind: TablePresetTabKind, id: string | undefined): string | undefined {
  if (!id?.startsWith(prefixes[kind])) return;
  const pair = id.slice(prefixes[kind].length).split(':');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return pair.length === 2 && pair.every(part => uuid.test(part)) ? pair[0] : undefined;
}
