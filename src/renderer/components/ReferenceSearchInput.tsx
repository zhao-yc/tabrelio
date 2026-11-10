import { useRef } from 'react';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';

/** 加载时保持焦点，等当前结果可用后才能从搜索框进入候选。 */
export function ReferenceSearchInput({ label, value, limit, disabled, pending, onChange, onSearch, onCandidates }: {
  label: string; value: string; limit: number; disabled: boolean; pending?: boolean;
  onChange(value: string): void; onSearch(): void; onCandidates?(): boolean;
}) {
  const composing = useRef(false);
  return <input type="search" aria-label={label} placeholder={label} maxLength={limit} value={value} disabled={disabled}
    readOnly={pending} aria-keyshortcuts={onCandidates ? 'Enter ArrowDown' : 'Enter'}
    onChange={event => onChange(event.target.value)}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.defaultPrevented || disabled || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          composing.current || tableCellKeyIsComposing(event.nativeEvent)) return;
      if (event.key === 'ArrowDown' && !event.repeat && !pending && onCandidates?.()) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !pending) onSearch();
    }}/>;
}
