import { useId } from 'react';
import { gridRangePasteZh as text } from '../locales/gridRangePaste.zh-CN';
import { zh } from '../locales/zh-CN';
import { gridDialogCurrent } from '../modalSelectors';
import '../gridEmptyState.css';

/** 没有活动数据格时，只接收空网格焦点上的粘贴事件。 */
export function GridEmptyState({ onPaste }: { onPaste?(data: DataTransfer): void }) {
  const hintId = useId();
  return <div className="grid-empty">{onPaste ? <div role="group" aria-label={text.emptyGrid} tabIndex={0}
    aria-describedby={hintId} className="grid-empty-paste" data-grid-empty-paste onPaste={event => {
      const target = event.currentTarget;
      if (event.defaultPrevented || event.target !== target || target.ownerDocument.activeElement !== target ||
          !gridDialogCurrent(target)) return;
      event.preventDefault();
      event.stopPropagation();
      onPaste(event.clipboardData);
    }}>
    <div>{zh.common.noMatchingData}</div>
    <div id={hintId}>{text.emptyGridPaste}</div>
  </div> : zh.common.noMatchingData}</div>;
}
