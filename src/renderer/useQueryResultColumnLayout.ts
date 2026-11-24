import { useState } from 'react';
import type { QueryResult } from '../shared/contracts';

/** 布局绑定本标签的原结果和连接修订。结果释放后，布局缓存不会延长行数据的寿命。 */
export function useQueryResultColumnLayout<Layout>(result: QueryResult | undefined, connectionId: string, version: number):
  [Layout | undefined, (layout: Layout) => void, (source: QueryResult) => Layout | undefined] {
  const [layouts] = useState(() => new WeakMap<QueryResult, {
    connectionId: string;
    version: number;
    columns: QueryResult['columns'];
    layout: Layout;
  }>());
  const [, refresh] = useState(0);
  function read(source: QueryResult): Layout | undefined {
    const saved = layouts.get(source);
    return saved && saved.columns === source.columns && saved.connectionId === connectionId && saved.version === version
      ? saved.layout : undefined;
  }

  function store(next: Layout): void {
    if (!result) return;
    layouts.set(result, { connectionId, version, columns: result.columns, layout: next });
    refresh(value => value + 1);
  }

  return [result && read(result), store, read];
}
