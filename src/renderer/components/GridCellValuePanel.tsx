import { useLayoutEffect, useRef } from 'react';
import type { CellValue } from '../../shared/contracts';
import { binaryCellZh } from '../locales/binaryCell.zh-CN';
import { gridCellValueZh as text } from '../locales/gridCellValue.zh-CN';
import { zh } from '../locales/zh-CN';
import { maxClipboardCharacters, writeTableClipboardEvent } from '../gridClipboard';
import { cellText, errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { BinaryCellViewer } from './BinaryCellViewer';
import { SqlTextPreview } from './SqlTextPreview';
import '../gridCellValue.css';

/** 只查看已载入的值。长文本只渲染当前段，复制原文不经过网格的 TSV 编码。 */
export function GridCellValuePanel({ column, value, current, onClose }: {
  column: string; value: CellValue | undefined; current(): boolean; onClose(): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  const title = text.title(column);
  const status = value === undefined ? text.defaultValue : value === null ? text.nullValue : value === '' ? text.emptyValue : undefined;
  const raw = status || typeof value === 'object' ? undefined : Object.is(value, -0) ? '-0' : cellText(value);

  function copy() {
    if (raw === undefined || !current()) return;
    try {
      if (raw.length > maxClipboardCharacters) throw Error(zh.clipboard.copySizeLimit);
      writeTableClipboardEvent(current, data => data.setData('text/plain', raw));
      useWorkspace.getState().notify(text.copied);
    } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
  }

  return <section className="grid-cell-value-panel" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); onClose();
    }
  }}>
    <header><strong title={title}>{title}</strong>
      {raw !== undefined && <button type="button" onClick={copy}>{text.copy}</button>}
      <button ref={close} type="button" onClick={onClose}>{text.close}</button>
    </header>
    {status ? <p role="status">{status}</p> : raw !== undefined
      ? <SqlTextPreview title={text.content} sql={raw} partLabels={text}/>
      : <BinaryCellViewer value={value} reason={binaryCellZh.readonly}/>}
  </section>;
}
