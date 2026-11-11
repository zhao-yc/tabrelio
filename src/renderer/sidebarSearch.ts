import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';

export interface SidebarCatalog {
  databases: readonly string[];
  objects: ReadonlyMap<string, { version: number; items: DatabaseObject[] }>;
}

export interface SidebarDatabaseMatch {
  reveal: boolean;
  items?: DatabaseObject[];
}

export interface SidebarSearchMatch {
  visible: boolean;
  reveal: boolean;
  databases: ReadonlyMap<string, SidebarDatabaseMatch>;
}

export const emptySidebarCatalog: SidebarCatalog = { databases: [], objects: new Map() };
const emptyObjects: DatabaseObject[] = [];

/** 库目录仅属于对应连接及刷新代次，旧缓存不能参与搜索或成为右键动作目标。 */
export function sidebarCatalogObjects(catalog: SidebarCatalog, database: string, version: number): DatabaseObject[] {
  const entry = catalog.objects.get(database);
  return entry?.version === version ? entry.items : emptyObjects;
}

/** 只检索已读目录，并为命中对象保留完整父路径。祖先直接命中时保留其可见子项。 */
export function sidebarSearchMatch(profile: ConnectionProfile, catalog: SidebarCatalog, needle: string,
  refreshVersions: Record<string, number>): SidebarSearchMatch | undefined {
  if (!needle) return;
  const includes = (name: string) => name.toLowerCase().includes(needle);
  const parent = includes(profile.name) || includes(profile.group ?? '');
  const databases = new Map<string, SidebarDatabaseMatch>();
  let reveal = false;
  for (const name of catalog.databases) {
    const direct = includes(name);
    const items = sidebarCatalogObjects(catalog, name, refreshVersions[JSON.stringify([profile.id, name])] ?? 0)
      .filter(object => includes(object.name));
    if (direct || items.length) reveal = true;
    if (parent || direct || items.length) databases.set(name, { reveal: items.length > 0, items: parent || direct ? undefined : items });
  }
  return { visible: parent || reveal, reveal, databases };
}
