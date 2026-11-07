import { importRecordRange, importRecordRangeZh as text, type ImportRecordRange } from '../../shared/importRecordRange';
import { Field } from './ui';

/** 表头位置跟随表头开关，首末数据设置可在切换时保留。 */
export function importRangeAfterHeaderChange(hasHeader: boolean, range?: ImportRecordRange) {
  return hasHeader || range?.headerRow === undefined ? range : {
    firstDataRow: range.firstDataRow, lastDataRow: range.lastDataRow,
  };
}

export function ImportRecordRangeFields({ hasHeader, range, disabled, onChange }: {
  hasHeader: boolean; range?: ImportRecordRange; disabled: boolean; onChange(range: ImportRecordRange): void;
}) {
  const positions = importRecordRange(hasHeader, range);
  const fields = [
    { key: 'headerRow', placeholder: '1' },
    { key: 'firstDataRow', placeholder: String(positions.headerRow + 1) },
    { key: 'lastDataRow', placeholder: text.throughEnd },
  ] as const;
  return <>{fields.filter(({ key }) => key !== 'headerRow' || hasHeader).map(({ key, placeholder }) =>
    <Field key={key} label={text[key]}><input aria-label={text[key]} type="number" min={1} step={1}
      placeholder={placeholder} value={range?.[key] ?? ''} disabled={disabled}
      onChange={event => onChange({ ...range, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber })}/></Field>)}<p className="muted small">{text.rangeHint}</p></>;
}
