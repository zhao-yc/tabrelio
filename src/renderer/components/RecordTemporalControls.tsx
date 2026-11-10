import { isCivilDate } from '../../shared/civilDate';
import { readRecordTemporal, writeRecordTemporal, type RecordTemporalParts, type RecordTemporalSpec } from '../recordTemporal';
import { recordTemporalZh as text } from '../locales/recordTemporal.zh-CN';
import './RecordTemporalControls.css';

/** 结构化控件只编辑原缓冲中的一个分量，不产生新日期对象或额外提交路径。 */
export function RecordTemporalControls({ spec, value, disabled, onChange }: {
  spec: RecordTemporalSpec; value: string; disabled?: boolean; onChange(value: string): void;
}) {
  const parts = readRecordTemporal(value, spec);
  if (!parts) return <p className="muted small">{text.rawOnly}</p>;
  const withDate = spec.kind === 'date' || spec.kind === 'datetime';
  const clockDisabled = disabled || spec.kind === 'datetime' && !parts.date;
  const clock = parts.clock.startsWith('24:') ? '' : parts.clock;
  const segments = (parts.clock || '00:00:00').split(':');

  function replace(patch: Partial<RecordTemporalParts>) {
    if (!disabled && parts) onChange(writeRecordTemporal(spec, { ...parts, ...patch }));
  }

  return <fieldset className="record-temporal-controls" disabled={disabled}>
    <legend>{text.title}</legend>
    {withDate && <label>{text.date}<input type="date" value={parts.date}
      min={String(spec.minimumYear).padStart(4, '0') + '-01-01'} max="9999-12-31"
      onChange={event => {
        const next = event.target.value;
        if (isCivilDate(next, spec.minimumYear)) replace({ date: next });
      }}/></label>}
    {spec.kind === 'duration' ? <>
      {([text.hours, text.minutes, text.seconds] as const).map((label, index) => {
        const max = index === 0 ? 838 : 59;
        return <label key={label}>{label}<input type="number" min={0} max={max} step={1} value={segments[index]} onChange={event => {
          const next = event.target.value;
          if (!/^\d{1,3}$/.test(next) || Number(next) > max) return;
          const fields = [...segments];
          fields[index] = String(Number(next)).padStart(2, '0');
          replace({ clock: fields.join(':') });
        }}/></label>;
      })}
      <label className="record-temporal-sign"><input type="checkbox" checked={parts.negative} onChange={event => replace({ negative: event.target.checked })}/>{text.negative}</label>
    </> : spec.kind !== 'date' && <label>{text.clock}<input type="time" step={1} value={clock} disabled={clockDisabled}
      onChange={event => {
        const next = event.target.value;
        if (!clockDisabled && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(next)) replace({ clock: next.length === 5 ? next + ':00' : next });
      }}/></label>}
    {spec.fractionDigits > 0 && <label>{text.fraction}<input type="text" inputMode="numeric" value={parts.fraction}
      maxLength={spec.fractionDigits} disabled={clockDisabled || parts.clock.startsWith('24:')} onChange={event => {
        const next = event.target.value;
        if (!clockDisabled && /^\d*$/.test(next) && next.length <= spec.fractionDigits) replace({ fraction: next });
      }}/></label>}
    {parts.offset && <span className="muted small">{text.offset} {parts.offset}</span>}
  </fieldset>;
}
