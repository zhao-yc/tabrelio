import { useState } from 'react';
import { errorMessage } from '../lib';
import type { GridRangeFillInput, GridRangeFillKind } from '../gridRangeFill';
import { gridRangeFillZh as text } from '../locales/gridRangeFill.zh-CN';
import { zh } from '../locales/zh-CN';
import type { GridCellRectangle } from '../useGridCellRange';
import { ErrorBox, Field } from './ui';

/** 输入只授权当前矩形，提交仍由表页复核并一次性暂存。 */
export function GridRangeFill({ rectangle, typed, onStage }: {
  rectangle: GridCellRectangle;
  typed?: boolean;
  onStage(rectangle: GridCellRectangle, input: GridRangeFillInput): void;
}) {
  const [open, setOpen] = useState<GridCellRectangle>();
  const [kind, setKind] = useState<GridRangeFillKind>('text'), [value, setValue] = useState(''), [error, setError] = useState('');
  const [start, setStart] = useState('1'), [step, setStep] = useState('1');
  const [onlyNull, setOnlyNull] = useState(false);
  const constant = kind === 'text' || kind === 'integer' || kind === 'real';
  if (open !== rectangle) return <button type="button" onClick={() => {
    setKind('text'); setValue(''); setStart('1'); setStep('1'); setOnlyNull(false); setError(''); setOpen(rectangle);
  }}>{text.open}</button>;
  return <section aria-label={text.open} className="grid-range-fill">
    <span>{text.scope(rectangle.bottom - rectangle.top + 1, rectangle.right - rectangle.left + 1)}</span>
    <Field label={text.kind}><select value={kind} onChange={event => setKind(event.target.value as GridRangeFillKind)}>
      <option value="text">{text.text}</option><option value="null">{text.null}</option>
      {typed && <><option value="integer">{text.integer}</option><option value="real">{text.real}</option></>}
      {rectangle.bottom > rectangle.top && rectangle.left === rectangle.right && <option value="sequence">{text.sequence}</option>}
      {rectangle.bottom > rectangle.top && <><option value="down">{text.down}</option><option value="up">{text.up}</option></>}
      {rectangle.right > rectangle.left && <><option value="right">{text.right}</option><option value="left">{text.left}</option></>}
    </select></Field>
    {constant && <>
      <Field label={text.value}><textarea autoFocus value={value} onChange={event => setValue(event.target.value)}/></Field>
      <label><input type="checkbox" checked={onlyNull} onChange={event => setOnlyNull(event.target.checked)}/>{text.onlyNull}</label>
    </>}
    {kind === 'sequence' && <>
      <Field label={text.sequenceStart}><input value={start} onChange={event => setStart(event.target.value)}/></Field>
      <Field label={text.sequenceStep}><input value={step} onChange={event => setStep(event.target.value)}/></Field>
    </>}
    <button type="button" onClick={() => {
      try {
        onStage(rectangle, kind === 'sequence' ? { kind, value: start, step } :
          { kind, value, ...(constant && onlyNull ? { onlyNull: true } : {}) });
        setOpen(undefined);
      }
      catch (reason) { setError(errorMessage(reason)); }
    }}>{text.stage}</button>
    <button type="button" onClick={() => setOpen(undefined)}>{zh.common.cancel}</button>
    <ErrorBox message={error}/>
  </section>;
}
