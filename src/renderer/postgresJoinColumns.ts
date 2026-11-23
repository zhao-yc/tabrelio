import { postgresCompletionLimits as limits, postgresJoinColumnLimit, type PostgresCatalogRelation,
  type PostgresCompletionResult } from '../shared/postgresCompletion';

export type PostgresJoinSource =
  | { kind: 'names'; names: string[] }
  | { kind: 'relation'; relation: PostgresCatalogRelation }
  | { kind: 'projection'; parts: PostgresJoinSource[] }
  | { kind: 'alias'; input: PostgresJoinSource; names: string[] }
  | { kind: 'join'; left: PostgresJoinSource; right: PostgresJoinSource; keys?: string[]; natural: boolean };

export interface PostgresUsingColumns {
  kind: 'using';
  left?: PostgresJoinSource;
  right?: PostgresJoinSource;
  excluded: string[];
}

const relationKey = ({ schema, name }: PostgresCatalogRelation) => JSON.stringify([schema ?? null, name]);
const maxWidth = limits.relations * postgresJoinColumnLimit;
const encoder = new TextEncoder();
const columnName = (name: unknown): name is string => typeof name === 'string' && !!name &&
  !/[\u0000\uD800-\uDFFF]/u.test(name) && encoder.encode(name).length <= 63;

/** 有界遍历来源树，重复引用的目录目标只读一次，输出仍按每个操作数独立计数。 */
export function joinCatalogRelations(using: PostgresUsingColumns): PostgresCatalogRelation[] | undefined {
  const catalog = new Map<string, PostgresCatalogRelation>();
  let budget = limits.tokens;
  function visit(source: PostgresJoinSource | undefined, depth: number): boolean {
    if (!source || --budget < 0 || depth >= 24) return false;
    switch (source.kind) {
      case 'relation':
        catalog.set(relationKey(source.relation), source.relation);
        return catalog.size <= limits.relations;
      case 'names': return source.names.every(columnName);
      case 'alias': return source.names.every(columnName) && visit(source.input, depth + 1);
      case 'join': return (!source.keys || source.keys.every(columnName)) &&
        visit(source.left, depth + 1) && visit(source.right, depth + 1);
      case 'projection': return source.parts.every(part => visit(part, depth + 1));
    }
  }
  if (visit(using.left, 0) && visit(using.right, 0)) return [...catalog.values()];
}

function columnCounts(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

/** 先重建有序 JOIN 输出，再判断当前两个操作数中的名称是否各自唯一。 */
export function sharedJoinColumns(using: PostgresUsingColumns, relations: PostgresCatalogRelation[],
  result: PostgresCompletionResult): string[] | undefined {
  if (result.incomplete || result.deferred || result.items.length !== relations.length) return;
  const catalog = new Map<string, string[]>();
  for (const item of result.items) {
    if (item.kind !== 'joinColumns' || !relations[item.reference] || !Array.isArray(item.names) ||
      item.names.length > postgresJoinColumnLimit || new Set(item.names).size !== item.names.length ||
      !item.names.every(columnName)) return;
    catalog.set(relationKey(relations[item.reference]), item.names);
  }
  if (catalog.size !== relations.length) return;
  function resolve(source?: PostgresJoinSource): string[] | undefined {
    if (!source) return;
    switch (source.kind) {
      case 'names': return source.names;
      case 'relation': return catalog.get(relationKey(source.relation));
      case 'alias': {
        const input = resolve(source.input);
        if (input && source.names.length <= input.length) return [...source.names, ...input.slice(source.names.length)];
        return;
      }
      case 'projection': {
        const names: string[] = [];
        for (const part of source.parts) {
          const columns = resolve(part);
          if (!columns || names.length + columns.length > maxWidth) return;
          names.push(...columns);
        }
        return names;
      }
      case 'join': {
        const left = resolve(source.left), right = resolve(source.right);
        if (!left || !right || left.length + right.length > maxWidth) return;
        if (!source.natural && !source.keys) return [...left, ...right];
        const leftCounts = columnCounts(left), rightCounts = columnCounts(right);
        const keys = source.keys ?? [...leftCounts.keys()].filter(name => rightCounts.has(name));
        const merged = new Set(keys);
        if (merged.size !== keys.length || keys.some(name => leftCounts.get(name) !== 1 || rightCounts.get(name) !== 1)) return;
        return [...keys, ...left.filter(name => !merged.has(name)), ...right.filter(name => !merged.has(name))];
      }
    }
  }
  const left = resolve(using.left), right = resolve(using.right);
  if (!left || !right) return;
  const leftCounts = columnCounts(left), rightCounts = columnCounts(right), excluded = new Set(using.excluded);
  return [...leftCounts.keys()].filter(name => leftCounts.get(name) === 1 && rightCounts.get(name) === 1 && !excluded.has(name));
}
