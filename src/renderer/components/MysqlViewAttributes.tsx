import { useMemo, useState } from 'react';
import { changeMysqlViewDraftAttribute, mysqlViewAttributeOptions, mysqlViewDraftAttributes, type MysqlViewAttributeChange } from '../../shared/mysqlViewFile';
import { errorMessage } from '../lib';
import { mysqlViewAttributesZh as text } from '../locales/mysqlViewAttributes.zh-CN';
import { ErrorBox, Field } from './ui';

const fields = ['algorithm', 'security', 'check'] as const;

/** 表单与编辑器共用同一份 SQL 草稿，读取失败时保留手写 SQL，不能猜测后覆盖。 */
export function MysqlViewAttributes({ database, view, sql, disabled, current, change }: {
  database: string; view: string; sql: string; disabled: boolean;
  current(): boolean;
  change(sql: string): void;
}) {
  const [error, setError] = useState('');
  const attributes = useMemo(() => {
    if (disabled) return;
    try { return mysqlViewDraftAttributes(sql, database, view); } catch { return undefined; }
  }, [database, view, sql, disabled]);

  function update(option: MysqlViewAttributeChange) {
    if (!attributes || !current()) return;
    setError('');
    try { change(changeMysqlViewDraftAttribute(sql, database, view, option)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <fieldset disabled={disabled || !attributes}>
    <legend>{text.title}</legend>
    <div className="form-grid three">{fields.map(key => <Field key={key} label={text[key]}>
      <select aria-label={text[key]} value={attributes?.[key] ?? ''} onChange={event => update({ key, value: event.target.value } as MysqlViewAttributeChange)}>
        {!attributes && <option value="">—</option>}
        {mysqlViewAttributeOptions[key].map(value => <option key={value} value={value}>{text.values[value]}</option>)}
      </select>
    </Field>)}</div>
    <p className="muted">{attributes ? text.hint : text.unavailable}</p>
    <ErrorBox message={error}/>
  </fieldset>;
}
