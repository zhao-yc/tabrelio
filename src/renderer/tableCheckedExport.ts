import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ResultExportData } from '../shared/contracts';
import { validateResultExportData } from '../shared/resultExport';
import { tableCheckedExportZh as text } from './locales/tableCheckedExport.zh-CN';

export interface TableCheckedExport {
  readonly scope: object;
  readonly signature: string;
  readonly pages: ReadonlyMap<number, ResultExportData>;
  readonly result: ResultExportData;
}

/** 按原页位置合并已验证的独立快照。超预算或列投影不一致时保留原收集。 */
export function replaceTableCheckedExport(scope: object, signature: string, current: TableCheckedExport | undefined, position: number, snapshot?: ResultExportData): TableCheckedExport | undefined {
  if (current && (current.scope !== scope || current.signature !== signature ||
    snapshot && JSON.stringify(snapshot.columns) !== JSON.stringify(current.result.columns))) throw Error(text.invalid);
  const pages = new Map(current?.pages);
  if (snapshot) pages.set(position, snapshot);
  else pages.delete(position);
  if (!pages.size) return;
  const ordered = [...pages].sort(([left], [right]) => left - right).map(([, value]) => value);
  const result = { columns: ordered[0].columns, rows: ordered.flatMap(value => value.rows), truncated: ordered.some(value => value.truncated) };
  validateResultExportData(result);
  return { scope, signature, pages, result };
}

/** 翻页可暂缺列签名，但旧范围事件只能操作自己渲染时持有的收集。 */
export function useTableCheckedExport(scope: object, signature: string | undefined) {
  const [saved, setSaved] = useState<TableCheckedExport>();
  const live = useRef<TableCheckedExport | undefined>(undefined);
  const value = saved?.scope === scope && (signature === undefined || saved.signature === signature) ? saved : undefined;
  const publish = useCallback((next?: TableCheckedExport) => {
    if (live.current === next) return;
    live.current = next;
    setSaved(next);
  }, []);
  useLayoutEffect(() => {
    if (live.current === saved && saved && !value) publish();
  }, [saved, value, publish]);
  return {
    value,
    current: () => live.current === saved,
    clear: () => publish(),
    replace(position: number, snapshot?: ResultExportData) {
      if (live.current !== saved || signature === undefined) return;
      publish(replaceTableCheckedExport(scope, signature, value, position, snapshot));
    },
  };
}
