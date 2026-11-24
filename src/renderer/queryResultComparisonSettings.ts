import type { ResultColumn } from '../shared/contracts';
import type { QueryResultComparisonColumnPair } from './queryResultComparison';
import type { SortDialect } from './queryResultSort';

export interface QueryResultComparisonSettings {
  mode: 'strict' | 'name' | 'manual';
  keys: readonly string[];
  pairs: readonly QueryResultComparisonColumnPair[];
}

function sameColumns(expected: readonly ResultColumn[], current: readonly ResultColumn[]): boolean {
  return expected.length === current.length && expected.every(({ key, name, type }, index) =>
    key === current[index].key && name === current[index].name && type === current[index].type);
}

export function sameQueryResultComparisonSettings(left: QueryResultComparisonSettings, right: QueryResultComparisonSettings): boolean {
  return left.mode === right.mode && left.keys.length === right.keys.length && left.keys.every((key, index) => key === right.keys[index]) &&
    left.pairs.length === right.pairs.length && left.pairs.every((pair, index) => pair.left === right.pairs[index].left && pair.right === right.pairs[index].right);
}

/** 仅保留最近一次成功对比的结构及选项，不持有原结果、原值或扫描任务。 */
export class QueryResultComparisonSettingsMemory {
  private saved?: {
    scope: string;
    dialect: SortDialect | undefined;
    left: readonly ResultColumn[];
    right: readonly ResultColumn[];
    settings: QueryResultComparisonSettings;
  };

  remember(scope: string, dialect: SortDialect | undefined, left: readonly ResultColumn[], right: readonly ResultColumn[],
    { mode, keys, pairs }: QueryResultComparisonSettings): void {
    this.saved = {
      scope, dialect, left: left.map(({ key, name, type }) => ({ key, name, type })),
      right: right.map(({ key, name, type }) => ({ key, name, type })),
      settings: Object.freeze({ mode, keys: Object.freeze([...keys]), pairs: Object.freeze(pairs.map(pair => Object.freeze({ ...pair }))) }),
    };
  }

  read(scope: string, dialect: SortDialect | undefined, left: readonly ResultColumn[], right: readonly ResultColumn[]):
    QueryResultComparisonSettings | undefined {
    const saved = this.saved;
    if (saved?.scope === scope && saved.dialect === dialect && sameColumns(saved.left, left) && sameColumns(saved.right, right))
      return saved.settings;
  }
}
