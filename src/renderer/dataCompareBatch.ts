import { postgresRelationName } from '../shared/postgresSql';

export type ComparePair = { source: string; target: string };
export const batchPairLimit = 32;

/** 先匹配准确全名。PostgreSQL 两端仅在同一个短名各自唯一时才跨 Schema 建议映射。 */
export function suggestComparePairs(left: string[], right: string[], postgres: boolean, sameScope: boolean): ComparePair[] {
  if (sameScope) return [];
  const available = new Set(right);
  const exact = left.filter(name => available.has(name)).map(name => ({ source: name, target: name }));
  if (!postgres) return exact;
  const byName = (items: string[]) => {
    const index = new Map<string, string | undefined>();
    for (const relation of items) {
      const { name } = postgresRelationName(relation);
      index.set(name, index.has(name) ? undefined : relation);
    }
    return index;
  };
  const leftNames = byName(left), rightNames = byName(right);
  for (const [name, source] of leftNames) {
    const target = rightNames.get(name);
    if (source && target && source !== target) exact.push({ source, target });
  }
  return exact;
}
