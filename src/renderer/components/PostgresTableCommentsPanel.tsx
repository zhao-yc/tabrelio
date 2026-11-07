import { useState } from 'react';
import { postgresTableManagePreviewSchema } from '../../shared/postgresTableManage';
import { invoke } from '../lib';
import { postgresTableCommentsZh as text } from '../locales/postgresTableComments.zh-CN';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ErrorBox, Field } from './ui';

/** 选择其他字段时保留已编辑的注释，只有确认后的整批 SQL 才写入服务器。 */
export function PostgresTableCommentsPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [position, setPosition] = useState(0);
  const [changes, setChanges] = useState(new Map<number, string | null>());
  const column = original.columns.find(item => item.position === position);
  const before = column ? column.comment : original.comment;
  const value = changes.has(position) ? changes.get(position) : before;
  const { preview, setPreview, busy, unknown, error, setError, submit } = usePostgresStructureEdit(props, !!changes.size, false,
    () => {
      const draft = postgresTableManagePreviewSchema.parse({
        ...target, action: 'comment', stamp: original.commentStamp, value: changes.get(0),
        columns: original.columns.filter(item => changes.has(item.position)).map(item => ({
          position: item.position, name: item.name, value: changes.get(item.position),
        })),
      });
      return invoke('postgres.tableManage.preview', draft);
    }, token => invoke('postgres.tableManage.apply', { connectionId: target.connectionId, database: target.database, token, confirmed: true }));

  function change(value: string | null) {
    setChanges(previous => {
      const next = new Map(previous);
      if (value === before) next.delete(position);
      else next.set(position, value);
      return next;
    });
    setError('');
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <p>{text.hint}</p>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <Field label={text.target}><select aria-label={text.target} value={position} onChange={event => setPosition(Number(event.target.value))}>
        <option value={0}>{text.table}</option>
        {original.columns.map(item => <option key={item.position} value={item.position}>{text.column(item.name)}</option>)}
      </select></Field>
      <Field label={text.value}><textarea rows={4} maxLength={4096} value={value ?? ''} onChange={event => change(event.target.value || null)}/></Field>
      <button disabled={!changes.has(position)} onClick={() => change(before)}>{text.restore}</button>
      <span role="status">{text.changed(changes.size)}</span>
    </fieldset>
    {preview && <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || unknown} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !changes.size} onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
