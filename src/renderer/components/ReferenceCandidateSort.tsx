import type { ReferenceCandidateSort as CandidateSort } from '../../shared/referenceCandidateSort';
import { referenceCandidateSortZh as text } from '../locales/referenceCandidateSort.zh-CN';

/** 保持排序控件独立于候选回包，数据库拒绝某字段排序后仍可清除。 */
export function ReferenceCandidateSort({ columns, sort, disabled, onChange }: {
  columns: readonly string[]; sort: CandidateSort | null; disabled: boolean; onChange(sort: CandidateSort | null): void;
}) {
  if (!columns.length) return null;
  return <div className="reference-candidate-sort">
    <label>{text.column}<select aria-label={text.column} value={sort?.column ?? ''} disabled={disabled} onChange={event => {
      const column = event.target.value;
      if (!column) onChange(null);
      else if (columns.includes(column)) onChange({ column, direction: sort?.direction ?? 'ASC' });
    }}>
      <option value="">{text.default}</option>
      {columns.map(column => <option key={column} value={column}>{column}</option>)}
    </select></label>
    <label>{text.direction}<select aria-label={text.direction} value={sort?.direction ?? 'ASC'} disabled={disabled || !sort}
      onChange={event => { if (sort) onChange({ ...sort, direction: event.target.value === 'DESC' ? 'DESC' : 'ASC' }); }}>
      <option value="ASC">{text.asc}</option><option value="DESC">{text.desc}</option>
    </select></label>
  </div>;
}
