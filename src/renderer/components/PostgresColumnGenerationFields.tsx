import type { PostgresColumnGeneration } from '../../shared/postgresCreateTable';
import { postgresCreateTableZh as text } from '../locales/postgresCreateTable.zh-CN';
import { Field } from './ui';

/** 建表和新增字段复用生成方式及表达式输入，由 PostgreSQL 校验表达式语义。 */
export function PostgresColumnGenerationFields({ value, onChange, allowVirtual = true }: {
  value?: PostgresColumnGeneration; onChange(value?: PostgresColumnGeneration): void; allowVirtual?: boolean;
}) {
  return <>
    <Field label={text.generation}><select aria-label={text.generation} value={value?.mode ?? ''} onChange={event => {
      const mode = event.target.value as PostgresColumnGeneration['mode'] | '';
      onChange(mode ? { mode, expression: value?.expression ?? '' } : undefined);
    }}>
      <option value="">{text.generationNone}</option>
      <option value="stored">{text.generationStored}</option>
      {allowVirtual && <option value="virtual">{text.generationVirtual}</option>}
    </select></Field>
    {value && <PostgresGenerationExpression value={value.expression}
      onChange={expression => onChange({ ...value, expression })}/>}
  </>;
}

export function PostgresGenerationExpression({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <Field label={text.generationExpression}>
    <textarea aria-label={text.generationExpression} value={value} rows={2} maxLength={16384} placeholder={text.generationExample}
      onChange={event => onChange(event.target.value)}/>
  </Field>;
}
