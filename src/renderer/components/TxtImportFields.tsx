import { useState } from 'react';
import { txtImportRange, txtImportZh as text, type TxtImportOptions } from '../../shared/txtImport';
import { Field } from './ui';

const separators = new Map([['\t', text.tab], [',', text.comma], [';', text.semicolon], ['|', text.pipe], [' ', text.space]]);

type DelimiterOptions = Pick<Extract<TxtImportOptions, { mode: 'delimited' }>, 'delimiter' | 'quote'>;

export function TxtDelimiterFields({ options, disabled, onChange }: {
  options: DelimiterOptions; disabled: boolean; onChange(options: DelimiterOptions): void;
}) {
  const [custom, setCustom] = useState(false);
  const customDelimiter = custom || !separators.has(options.delimiter);
  return <>
    <Field label={text.delimiter}><select aria-label={text.delimiter} disabled={disabled}
      value={customDelimiter ? '' : options.delimiter} onChange={event => {
        setCustom(!event.target.value); onChange({ ...options, delimiter: event.target.value });
      }}>
      {[...separators].map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="">{text.custom}</option>
    </select></Field>
    {customDelimiter && <Field label={text.custom}><input aria-label={text.custom} maxLength={16}
      disabled={disabled} value={options.delimiter} onChange={event => onChange({ ...options, delimiter: event.target.value })}/></Field>}
    <Field label={text.quote}><select aria-label={text.quote} disabled={disabled} value={options.quote}
      onChange={event => onChange({ ...options, quote: event.target.value as typeof options.quote })}>
      <option value="double">{text.double}</option><option value="single">{text.single}</option><option value="none">{text.none}</option>
    </select></Field>
  </>;
}

/** 与所有导入入口共用原解释配置，改动由各向导撤销旧映射及预检。 */
export function TxtImportFields({ options, disabled, onChange }: {
  options: TxtImportOptions; disabled: boolean; onChange(options: TxtImportOptions): void;
}) {
  const { recordDelimiter, hasHeader, headerRow, firstDataRow, lastDataRow } = options;
  const shared = { recordDelimiter, hasHeader, headerRow, firstDataRow, lastDataRow };
  const range = txtImportRange(options);
  const fields = [
    { key: 'headerRow', placeholder: '1' },
    { key: 'firstDataRow', placeholder: String(range.headerRow + 1) },
    { key: 'lastDataRow', placeholder: text.throughEnd },
  ] as const;
  return <>
    <Field label={text.layout}><select aria-label={text.layout} disabled={disabled} value={options.mode} onChange={event => {
      onChange(event.target.value === 'fixed' ? { ...shared, mode: 'fixed', widths: '', trimPadding: true }
        : { ...shared, mode: 'delimited', delimiter: '\t', quote: 'double' });
    }}><option value="delimited">{text.delimited}</option><option value="fixed">{text.fixed}</option></select></Field>
    <Field label={text.record}><select aria-label={text.record} disabled={disabled} value={recordDelimiter}
      onChange={event => onChange({ ...options, recordDelimiter: event.target.value as typeof recordDelimiter })}>
      <option value="auto">{text.auto}</option><option value="lf">LF</option><option value="crlf">CRLF</option><option value="cr">CR</option>
    </select></Field>
    {options.mode === 'delimited' ? <TxtDelimiterFields options={options} disabled={disabled}
      onChange={fields => onChange({ ...options, ...fields })}/> : <>
      <Field label={text.widths}><input aria-label={text.widths} title={text.widthHint} maxLength={8192} placeholder="4,8,12"
        disabled={disabled} value={options.widths} onChange={event => onChange({ ...options, widths: event.target.value })}/></Field>
      <label className="check"><input type="checkbox" disabled={disabled} checked={options.trimPadding}
        onChange={event => onChange({ ...options, trimPadding: event.target.checked })}/>{text.trim}</label>
    </>}
    <label className="check"><input type="checkbox" disabled={disabled} checked={hasHeader}
      onChange={event => onChange({ ...options, hasHeader: event.target.checked, headerRow: event.target.checked ? headerRow : undefined })}/>{text.hasHeader}</label>
    {fields.filter(({ key }) => key !== 'headerRow' || hasHeader).map(({ key, placeholder }) =>
      <Field key={key} label={text[key]}><input aria-label={text[key]} type="number" min={1} step={1}
        placeholder={placeholder} value={options[key] ?? ''} disabled={disabled}
        onChange={event => onChange({ ...options, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber })}/></Field>)}
    <p className="muted small">{options.mode === 'fixed' ? text.widthHint + ' ' : ''}{text.hint} {text.rangeHint}</p>
  </>;
}
