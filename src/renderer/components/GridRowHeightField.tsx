import { useState } from 'react';
import { gridRowHeightLimits, gridRowHeights, isGridRowHeight, readGridRowHeight, type GridRowHeight } from '../../shared/gridRowHeight';
import { gridRowHeightZh as text } from '../locales/gridRowHeight.zh-CN';
import '../gridRowHeight.css';

/** 预设与精确像素共用布局入口，未确认的输入不修改当前视图。 */
export function GridRowHeightField({ value, disabled, onChange }: { value?: GridRowHeight; disabled: boolean; onChange(value: GridRowHeight): void }) {
  const height = readGridRowHeight(value);
  return <div className="inline-field">
    <label className="inline-field">{text.label}<select aria-label={text.label} value={height} disabled={disabled} onChange={event => {
      const next = Number(event.target.value);
      if (!disabled && isGridRowHeight(next)) onChange(next);
    }}>
      {gridRowHeights.map(preset => <option key={preset} value={preset}>{text.options[preset]}</option>)}
      {!gridRowHeights.some(preset => preset === height) && <option value={height}>{text.custom(height)}</option>}
    </select></label>
    <GridCustomRowHeightField key={height} height={height} disabled={disabled} onChange={onChange}/>
  </div>;
}

function GridCustomRowHeightField({ height, disabled, onChange }: { height: GridRowHeight; disabled: boolean; onChange(value: GridRowHeight): void }) {
  const [input, setInput] = useState(String(height));
  const next = Number(input), valid = /^\d+$/.test(input) && isGridRowHeight(next);
  const hint = text.range(gridRowHeightLimits.min, gridRowHeightLimits.max);
  return <>
    <label className="inline-field">{text.exact}<input aria-label={text.exact} aria-invalid={!valid} title={hint} size={5} maxLength={8}
      inputMode="numeric" disabled={disabled} value={input} onChange={event => setInput(event.target.value)}/></label>
    <button type="button" title={hint} disabled={disabled || !valid || next === height}
      onClick={() => { if (!disabled && valid) onChange(next); }}>{text.apply}</button>
  </>;
}
