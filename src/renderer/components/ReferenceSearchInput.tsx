import { useRef } from 'react';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';

/** 只消费搜索框中无修饰的 Enter，组词确认和长按不发送查询。 */
export function ReferenceSearchInput({ label, value, limit, disabled, onChange, onSearch }: {
  label: string; value: string; limit: number; disabled: boolean; onChange(value: string): void; onSearch(): void;
}) {
  const composing = useRef(false);
  return <input type="search" aria-label={label} placeholder={label} maxLength={limit} value={value} disabled={disabled}
    onChange={event => onChange(event.target.value)}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.defaultPrevented || disabled || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          composing.current || tableCellKeyIsComposing(event.nativeEvent)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) onSearch();
    }}/>;
}
