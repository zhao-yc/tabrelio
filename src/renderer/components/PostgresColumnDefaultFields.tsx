import { acceptsPostgresDefaultPreset, postgresDefaultPresets, type PostgresColumnDefault } from '../../shared/postgresCreateTable';
import { postgresCreateTableZh as text } from '../locales/postgresCreateTable.zh-CN';
import { Field } from './ui';

/** 只显示当前类型可使用的预设，修改已有字段时由用户明确选择是否清除。 */
export function PostgresColumnDefaultFields({ type, value, onChange, disabled, removeLabel }: {
  type: string; value?: PostgresColumnDefault; onChange(value: PostgresColumnDefault): void;
  disabled?: boolean; removeLabel?: string;
}) {
  return <>
    <Field label={text.default}><select aria-label={text.default} disabled={disabled} value={value?.mode ?? ''}
      onChange={event => {
        const mode = event.target.value as PostgresColumnDefault['mode'];
        onChange(mode === 'literal' ? { mode, value: '' } : { mode });
      }}>
      {value === undefined && <option value="" disabled>{text.chooseDefault}</option>}
      <option value="none">{removeLabel ?? text.noDefault}</option>
      <option value="literal">{text.literal}</option>
      {postgresDefaultPresets.filter(preset => acceptsPostgresDefaultPreset(type, preset)).map(preset =>
        <option key={preset} value={preset}>{text.presets[preset]}</option>)}
    </select></Field>
    {value?.mode === 'literal' && <Field label={text.value}>
      <input value={value.value} maxLength={4096} disabled={disabled}
        onChange={event => onChange({ mode: 'literal', value: event.target.value })}/>
    </Field>}
  </>;
}
