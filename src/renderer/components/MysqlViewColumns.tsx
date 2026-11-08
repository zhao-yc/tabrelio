import { useMemo, useState } from 'react';
import { changeMysqlViewDraftColumns, mysqlViewDraftColumns } from '../../shared/mysqlViewFile';
import { errorMessage } from '../lib';
import { mysqlViewColumnsZh as text } from '../locales/mysqlViewColumns.zh-CN';
import { ErrorBox, Field } from './ui';

/** 列名在点击应用前只存于表单。定义或连接发生变化时弃用旧列表和预览列。 */
export function MysqlViewColumns({ owner, database, view, sql, disabled, current, previewColumns, change }: {
  owner: object; database: string; view: string; sql: string; disabled: boolean;
  current(): boolean;
  previewColumns?: readonly string[];
  change(sql: string): void;
}) {
  const [draft, setDraft] = useState<{ owner: object; names: readonly string[]; error?: string }>();
  const original = useMemo(() => {
    if (disabled) return;
    try { return mysqlViewDraftColumns(sql, database, view); } catch { return undefined; }
  }, [database, view, sql, disabled]);
  const active = draft?.owner === owner ? draft : undefined;
  const names = active?.names ?? original ?? [];
  const editable = !disabled && !!original;
  const dirty = original && (names.length !== original.length || names.some((name, index) => name !== original[index]));

  function edit(next: readonly string[]) {
    if (editable && current()) setDraft({ owner, names: next });
  }

  function apply() {
    if (!editable || !dirty || !current()) return;
    try {
      if (names.length && previewColumns?.length && previewColumns.length !== names.length)
        throw Error(text.countMismatch(previewColumns.length));
      change(changeMysqlViewDraftColumns(sql, database, view, names));
    } catch (reason) {
      setDraft({ owner, names, error: errorMessage(reason) });
    }
  }

  return <fieldset disabled={!editable}>
    <legend>{text.title}</legend>
    <p className="muted">{editable ? text.hint : text.unavailable}</p>
    <div className="form-grid">
      {names.map((name, index) => <Field key={index} label={text.column(index + 1)}>
        <span className="input-action">
          <textarea rows={1} aria-label={text.column(index + 1)} value={name} maxLength={64}
            onChange={event => edit(names.map((value, at) => at === index ? event.target.value : value))}/>
          <button type="button" aria-label={text.remove(index + 1)} title={text.remove(index + 1)}
            onClick={() => edit(names.filter((_name, at) => at !== index))}>×</button>
        </span>
      </Field>)}
    </div>
    <div className="pg-column-edit-actions">
      <button type="button" onClick={() => edit([...names, ''])}>{text.add}</button>
      <button type="button" disabled={!previewColumns?.length} onClick={() => edit(previewColumns ?? [])}>{text.fromPreview}</button>
      <button type="button" disabled={!names.length} onClick={() => edit([])}>{text.clear}</button>
      <button type="button" disabled={!dirty} onClick={apply}>{text.apply}</button>
    </div>
    <ErrorBox message={active?.error}/>
  </fieldset>;
}
