import { useId } from 'react';
import { gridRangePasteZh as text } from '../locales/gridRangePaste.zh-CN';
import { zh } from '../locales/zh-CN';
import { gridDialogCurrent } from '../modalSelectors';
import { handleGridRecordKey } from '../gridRecordActions';
import '../gridEmptyState.css';

/** 没有活动数据格时，粘贴和快捷新增只属于实际聚焦的空网格。 */
export function GridEmptyState({ onPaste, onAddRow }: { onPaste?(data: DataTransfer): void; onAddRow?(): void }) {
  const hintId = useId();
  return <div className="grid-empty">{onPaste || onAddRow ? <div role="group" aria-label={text.emptyGrid} tabIndex={0}
    aria-describedby={onPaste ? hintId : undefined} className="grid-empty-paste" data-grid-empty-paste
    onKeyDown={event => {
      if (event.target === event.currentTarget && event.currentTarget.ownerDocument.activeElement === event.currentTarget &&
          gridDialogCurrent(event.currentTarget)) handleGridRecordKey(event, key => key === 'add' ? onAddRow : undefined);
    }} onPaste={event => {
      const target = event.currentTarget;
      if (!onPaste || event.defaultPrevented || event.target !== target || target.ownerDocument.activeElement !== target ||
          !gridDialogCurrent(target)) return;
      event.preventDefault();
      event.stopPropagation();
      onPaste(event.clipboardData);
    }}>
    <div>{zh.common.noMatchingData}</div>
    {onPaste && <div id={hintId}>{text.emptyGridPaste}</div>}
  </div> : zh.common.noMatchingData}</div>;
}
