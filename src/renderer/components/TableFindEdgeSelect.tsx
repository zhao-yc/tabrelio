import type { TableFindEdge } from '../tableFindPattern';
import { tableFindFilterZh as text } from '../locales/tableFindFilter.zh-CN';

export function TableFindEdgeSelect({ edge, disabled, onChange }: { edge?: TableFindEdge; disabled: boolean; onChange(edge?: TableFindEdge): void }) {
  return <select aria-label={text.edge} title={text.edge} value={edge ?? ''} disabled={disabled} style={{ width: 'auto' }}
    onChange={event => {
      const value = event.target.value;
      if (value === '' || value === 'start' || value === 'end') onChange(value || undefined);
    }}>
    <option value="">{text.positions.anywhere}</option><option value="start">{text.positions.start}</option><option value="end">{text.positions.end}</option>
  </select>;
}
