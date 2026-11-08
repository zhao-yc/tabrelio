import { useState } from 'react';
import { postgresViewManagePreviewSchema } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresMaterializedColumnNamesZh as text } from '../locales/postgresMaterializedColumnNames.zh-CN';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ErrorBox, Field } from './ui';

/** 使用当前目录的列顺序。预览和确认沿用原结构窗口的连接及终态保护。 */
export function PostgresMaterializedColumnNamesPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [names, setNames] = useState(() => original.columns.map(column => column.name));
  const dirty = names.some((name, index) => name !== original.columns[index]?.name);
  const { preview, setPreview, busy, unknown, error, setError, operation, submit } = usePostgresStructureEdit(props, dirty, false,
    () => invoke('postgres.viewManage.preview', postgresViewManagePreviewSchema.parse({
      ...target, action: 'renameColumns', relationKind: 'materialized', stamp: original.materializedManageStamp, columnNames: names,
    })),
    token => invoke('postgres.viewManage.apply', { connectionId: target.connectionId, database: target.database, token }),
    () => props.beforeManage?.());

  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <p>{text.hint}</p>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    {preview ? <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre> :
      <fieldset className="form-grid" disabled={busy || unknown}>
        {original.columns.map((column, index) => <Field key={column.position} label={column.name}>
          <textarea rows={1} spellCheck={false} aria-label={text.name(column.name)} maxLength={63} value={names[index]}
            onChange={event => {
              const name = event.target.value;
              setNames(current => current.map((value, at) => at === index ? name : value));
              setError('');
            }}/>
        </Field>)}
      </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || unknown} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !dirty}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={close}>{text.close}</button>
    </div>
  </section>;
}
