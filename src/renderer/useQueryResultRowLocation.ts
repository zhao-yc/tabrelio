import { useEffect, useState } from 'react';
import type { QueryResult, ResultColumn } from '../shared/contracts';
import type { QueryResultComparisonLocation } from './queryResultComparison';
import { queryResultComparisonZh as text } from './locales/queryResultComparison.zh-CN';

/** 目标组切换提交后，只在原行仍属于当前可见投影时发出一次网格定位。 */
export function useQueryResultRowLocation(source: QueryResult | undefined, displayed: QueryResult | undefined,
  columns: readonly ResultColumn[] | undefined, active: boolean, notify: (message: string) => void) {
  const [location, locate] = useState<QueryResultComparisonLocation>();
  const current = active && !!location && location.source === source && source.rows.includes(location.row);
  const first = columns?.[0];
  const cell = current && first && displayed?.rows.includes(location.row) ? { row: location.row, key: first.key } : undefined;
  useEffect(() => {
    if (!location) return;
    locate(undefined);
    if (current && !cell) notify(text.rowHidden);
  }, [location, current, cell, notify]);
  return [cell, locate] as const;
}
