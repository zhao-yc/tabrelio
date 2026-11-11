import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { errorMessage } from '../lib';
import type { GridRangeFillInput, GridRangeFillKind } from '../gridRangeFill';
import { gridRangeFillZh as text } from '../locales/gridRangeFill.zh-CN';
import { zh } from '../locales/zh-CN';
import type { GridCellRectangle } from '../useGridCellRange';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';
import { ErrorBox, Field } from './ui';

export interface GridRangeFillHandle {
  beginText(rectangle: GridCellRectangle, value: string, returnFocus: () => void): void;
}

/** 输入只授权当前矩形，提交仍由表页复核并一次性暂存。 */
export function GridRangeFill({ ref, rectangle, typed, onStage }: {
  ref?: Ref<GridRangeFillHandle>;
  rectangle: GridCellRectangle;
  typed?: boolean;
  onStage(rectangle: GridCellRectangle, input: GridRangeFillInput): void;
}) {
  const [open, setOpen] = useState<{ rectangle: GridCellRectangle; returnFocus?: () => void }>();
  const [kind, setKind] = useState<GridRangeFillKind>('text'), [value, setValue] = useState(''), [error, setError] = useState('');
  const [start, setStart] = useState('1'), [step, setStep] = useState('1');
  const [onlyNull, setOnlyNull] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), stageButton = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const constant = kind === 'text' || kind === 'integer' || kind === 'real';
  function begin(initialValue = '', returnFocus?: () => void) {
    composing.current = false;
    setKind('text'); setValue(initialValue); setStart('1'); setStep('1'); setOnlyNull(false); setError('');
    setOpen({ rectangle, returnFocus });
  }
  useImperativeHandle(ref, () => ({ beginText(selected, initialValue, returnFocus) {
    if (selected !== rectangle) return;
    if (open?.rectangle === rectangle) (input.current ?? stageButton.current)?.focus();
    else begin(initialValue, returnFocus);
  } }));
  useLayoutEffect(() => {
    const field = input.current;
    if (open?.rectangle !== rectangle || !open.returnFocus || !field) return;
    // 首字符已放入草稿，光标从末尾接收后续打字或输入法输入。
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [open, rectangle]);
  if (open?.rectangle !== rectangle) return <button type="button" onClick={() => begin()}>{text.open}</button>;

  const close = () => { setOpen(undefined); open.returnFocus?.(); };
  function stage() {
    try {
      onStage(rectangle, kind === 'sequence' ? { kind, value: start, step } :
        { kind, value, ...(constant && onlyNull ? { onlyNull: true } : {}) });
      close();
    }
    catch (reason) { setError(errorMessage(reason)); }
  }
  return <section aria-label={text.open} className="grid-range-fill"
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (!open.returnFocus || event.defaultPrevented || composing.current || tableCellKeyIsComposing(event.nativeEvent) ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'Escape' && !(event.key === 'Enter' && event.target === input.current)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) {
        if (event.key === 'Escape') close();
        else stage();
      }
    }}>
    <span>{text.scope(rectangle.bottom - rectangle.top + 1, rectangle.right - rectangle.left + 1)}</span>
    <Field label={text.kind}><select value={kind} onChange={event => setKind(event.target.value as GridRangeFillKind)}>
      <option value="text">{text.text}</option><option value="null">{text.null}</option>
      {typed && <><option value="integer">{text.integer}</option><option value="real">{text.real}</option></>}
      {rectangle.bottom > rectangle.top && rectangle.left === rectangle.right && <option value="sequence">{text.sequence}</option>}
      {rectangle.bottom > rectangle.top && <><option value="down">{text.down}</option><option value="up">{text.up}</option></>}
      {rectangle.right > rectangle.left && <><option value="right">{text.right}</option><option value="left">{text.left}</option></>}
    </select></Field>
    {constant && <>
      <Field label={text.value}><textarea ref={input} autoFocus value={value} onChange={event => setValue(event.target.value)}/></Field>
      <label><input type="checkbox" checked={onlyNull} onChange={event => setOnlyNull(event.target.checked)}/>{text.onlyNull}</label>
    </>}
    {kind === 'sequence' && <>
      <Field label={text.sequenceStart}><input value={start} onChange={event => setStart(event.target.value)}/></Field>
      <Field label={text.sequenceStep}><input value={step} onChange={event => setStep(event.target.value)}/></Field>
    </>}
    <button ref={stageButton} type="button" onClick={stage}>{text.stage}</button>
    <button type="button" onClick={close}>{zh.common.cancel}</button>
    <ErrorBox message={error}/>
  </section>;
}
