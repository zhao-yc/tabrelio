import type { TableCheckedExport } from '../tableCheckedExport';
import { tableCheckedExportZh as text } from '../locales/tableCheckedExport.zh-CN';

interface Props {
  collection?: TableCheckedExport;
  position: number;
  selected: number;
  ready: boolean;
  hasDrafts: boolean;
  onCollect(): void;
  onExport(): void;
  onClear(): void;
}

export function TableCheckedExportActions({ collection, position, selected, ready, hasDrafts, onCollect, onExport, onClear }: Props) {
  const collectedPage = collection?.pages.has(position);
  return <div className="query-row-details-actions" role="group" aria-label={text.region} title={hasDrafts ? text.clean : text.hint}>
    <button type="button" disabled={!ready || !collectedPage && !selected} onClick={onCollect}>{collectedPage ? text.replace : text.collect}</button>
    <button type="button" disabled={!ready || !collection} onClick={onExport}>{text.export}</button>
    <button type="button" disabled={!ready || !collection} onClick={onClear}>{text.clear}</button>
    {collection && <span role="status">{text.summary(collection.pages.size, collection.result.rows.length)}</span>}
  </div>;
}
