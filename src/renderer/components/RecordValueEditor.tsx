import { useEffect, useId, useRef, useState } from 'react';
import type { ColumnInfo } from '../../shared/contracts';
import type { RecordInput, RecordMode } from '../recordViews';
import { recordInputLimits } from '../recordViews';
import { recordViewZh as text } from '../locales/recordViews.zh-CN';
import { columnEnumerationZh as enumerationText } from '../locales/columnEnumeration.zh-CN';
import { RecordEnumerationPicker } from './RecordEnumerationPicker';
import { recordTemporalSpec } from '../recordTemporal';
import { RecordTemporalControls } from './RecordTemporalControls';
import { BinaryCellViewer } from './BinaryCellViewer';
import { HtmlCellPreviewToggle } from './HtmlCellPreview';

/** 文本域保留词法内容与输入法行为，只读模式仍可聚焦、选择和复制。 */
export function RecordValueEditor({ column, input, inserted, reason, focus, selectOnFocus, binaryStale = false, source, isCurrent, onChange }: { column: ColumnInfo; input: RecordInput; inserted: boolean; reason: string; focus: boolean; selectOnFocus?: boolean; binaryStale?: boolean; source?: readonly unknown[]; isCurrent?(): boolean; onChange(input: RecordInput): void }) {
  const id = useId(); const field = useRef<HTMLTextAreaElement>(null);
  const [rawEnumeration, setRawEnumeration] = useState(false);
  const enumeration = input.mode === 'text' && !reason ? column.enumeration : undefined;
  const chooser = rawEnumeration ? undefined : enumeration;
  const temporal = input.mode === 'text' && !reason ? recordTemporalSpec(column.type, 'mysql') : undefined;
  const binaryColumn = /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(column.type);
  useEffect(() => {
    if (focus && !chooser) { field.current?.focus(); if (selectOnFocus) field.current?.select(); }
  }, [focus, selectOnFocus, chooser]);
  if (binaryStale && (binaryColumn || input.mode === 'binary')) return <p role="alert">{text.changed}</p>;
  return <div className="record-value-editor">
    <label htmlFor={`${id}-mode`}>{text.mode}</label>
    <select id={`${id}-mode`} value={input.mode} disabled={!!reason} onChange={event => onChange({ ...input, mode: event.target.value as RecordMode })}>
      <option value="text" disabled={binaryColumn}>{text.text}</option><option value="json" disabled={binaryColumn}>{text.json}</option><option value="binary">{text.binary}</option>
      <option value="null" disabled={!column.nullable}>{text.null}</option><option value="default" disabled={!inserted}>{text.default}</option>
    </select>
    {enumeration && <button type="button" onClick={() => setRawEnumeration(current => !current)}>{chooser ? enumerationText.raw : enumerationText.choose}</button>}
    {chooser ? <RecordEnumerationPicker key={column.name} enumeration={chooser} value={input.text} focus={focus} onChange={value => onChange({ mode: 'text', text: value })}/> : input.mode === 'binary' ? <BinaryCellViewer value={{ type: 'binary', base64: '' }} source={[...(source ?? []), column, input]} isCurrent={isCurrent} hexInput={input.text} label={`${column.name} · ${text.value}`} reason={reason} focus={focus} onHexChange={value => onChange({ mode: 'binary', text: value })}/> : <><label htmlFor={`${id}-value`}>{column.name} · {text.value}</label><textarea id={`${id}-value`} ref={field} className="record-field-input" aria-describedby={`${id}-reason`} readOnly={!!reason || input.mode === 'null' || input.mode === 'default'} value={input.text} onChange={event => onChange({ ...input, text: event.target.value })}/>{binaryColumn && (input.mode === 'null' || input.mode === 'default') && <BinaryCellViewer value={input.mode === 'null' ? null : undefined} reason={reason} source={[...(source ?? []), column, input]} isCurrent={isCurrent}/>}</>}
    {temporal && <RecordTemporalControls spec={temporal} value={input.text} onChange={value => onChange({ mode: 'text', text: value })}/>}
    {input.mode === 'text' && !chooser && <HtmlCellPreviewToggle value={input.text}/>}
    <span id={`${id}-reason`} className="muted small">{reason || (input.mode === 'null' ? text.null : input.mode === 'default' ? text.default : `${input.text.length} / ${recordInputLimits.field}`)}</span>
  </div>;
}
