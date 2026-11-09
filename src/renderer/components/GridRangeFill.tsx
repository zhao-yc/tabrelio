import { useState } from 'react';
import { errorMessage } from '../lib';
import { gridRangeFillZh as text } from '../locales/gridRangeFill.zh-CN';
import { zh } from '../locales/zh-CN';
import type { GridCellRectangle } from '../useGridCellRange';
import { ErrorBox, Field } from './ui';

export type GridRangeFillKind = 'text' | 'null' | 'integer' | 'real';
export interface GridRangeFillInput { kind: GridRangeFillKind; value: string; }

/** 输入只授权当前矩形，提交仍由表页复核并一次性暂存。 */
export function GridRangeFill({ rectangle, typed, onStage }: {
  rectangle: GridCellRectangle;
  typed?: boolean;
  onStage(rectangle: GridCellRectangle, input: GridRangeFillInput): void;
}) {
  const [open, setOpen] = useState<GridCellRectangle>();
  const [kind, setKind] = useState<GridRangeFillKind>('text'), [value, setValue] = useState(''), [error, setError] = useState('');
  if (open !== rectangle) return <button type="button" onClick={() => {
    setKind('text'); setValue(''); setError(''); setOpen(rectangle);
  }}>{text.open}</button>;
  return <section aria-label={text.open} className="grid-range-fill">
    <span>{text.scope(rectangle.bottom - rectangle.top + 1, rectangle.right - rectangle.left + 1)}</span>
    <Field label={text.kind}><select value={kind} onChange={event => setKind(event.target.value as GridRangeFillKind)}>
      <option value="text">{text.text}</option><option value="null">{text.null}</option>
      {typed && <><option value="integer">{text.integer}</option><option value="real">{text.real}</option></>}
    </select></Field>
    {kind !== 'null' && <Field label={text.value}><textarea autoFocus value={value} onChange={event => setValue(event.target.value)}/></Field>}
    <button type="button" onClick={() => {
      try { onStage(rectangle, { kind, value }); setOpen(undefined); }
      catch (reason) { setError(errorMessage(reason)); }
    }}>{text.stage}</button>
    <button type="button" onClick={() => setOpen(undefined)}>{zh.common.cancel}</button>
    <ErrorBox message={error}/>
  </section>;
}
