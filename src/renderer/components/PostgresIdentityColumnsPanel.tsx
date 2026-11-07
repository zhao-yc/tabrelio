import { useState } from 'react';
import { postgresTableManagePreviewSchema, type PostgresIdentityChange } from '../../shared/postgresTableManage';
import type { PostgresStructureResult } from '../../shared/postgresStructure';
import { invoke } from '../lib';
import { postgresIdentityColumnsZh as text } from '../locales/postgresIdentityColumns.zh-CN';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ErrorBox, Field } from './ui';

export function postgresIdentityColumns(structure: PostgresStructureResult) {
  return structure.columns.filter(column => column.identity || !column.nullable && !column.generation &&
    column.defaultExpression === null && ['smallint', 'integer', 'bigint'].includes(column.type));
}

/** 标识属性和底层序列属于原字段，确认后由服务器在同一事务中校验。 */
export function PostgresIdentityColumnsPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const columns = postgresIdentityColumns(original);
  const [position, setPosition] = useState(columns[0]?.position);
  const column = columns.find(item => item.position === position) ?? columns[0];
  const [kind, setKind] = useState<PostgresIdentityChange['kind']>(column?.identity ? 'mode' : 'add');
  const [mode, setMode] = useState<'always' | 'byDefault'>(column?.identity === 'a' ? 'byDefault' : 'always');
  const [start, setStart] = useState('1'), [restart, setRestart] = useState('');
  const destructive = kind === 'drop' || kind === 'restart';
  const canPreview = !!column && (kind === 'add' ? !!start : kind !== 'mode' || (mode === 'always' ? 'a' : 'd') !== column.identity);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, canPreview, destructive, () => {
      const change: PostgresIdentityChange = kind === 'add' ? { kind, mode, start } : kind === 'mode' ? { kind, mode } :
        kind === 'restart' ? { kind, value: restart || undefined } : { kind };
      return invoke('postgres.tableManage.preview', postgresTableManagePreviewSchema.parse({
        ...target, action: 'identity', stamp: original.identityStamp, position: column!.position, name: column!.name, change,
      }));
    }, token => invoke('postgres.tableManage.apply', { connectionId: target.connectionId, database: target.database, token, confirmed: true }));

  const hint = { add: text.addHint, mode: text.modeHint, restart: text.restartHint, drop: text.dropHint }[kind];
  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3><p>{hint}</p>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {destructive && <label className="pg-column-edit-drop"><input type="checkbox" checked={acceptDrop} disabled={busy || unknown}
        onChange={event => setAcceptDrop(event.target.checked)}/>{kind === 'drop' ? text.acknowledgeDrop : text.acknowledgeRestart}</label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.column}><select aria-label={text.column} value={column?.position ?? ''} onChange={event => {
          const next = columns.find(item => item.position === Number(event.target.value));
          if (!next) return;
          setPosition(next.position); setKind(next.identity ? 'mode' : 'add');
          setMode(next.identity === 'a' ? 'byDefault' : 'always'); setStart('1'); setRestart(''); setError('');
        }}>{columns.map(item => <option key={item.position} value={item.position}>{item.name}</option>)}</select></Field>
        <Field label={text.operation}><select aria-label={text.operation} value={kind}
          onChange={event => { setKind(event.target.value as PostgresIdentityChange['kind']); setError(''); }}>
          {column?.identity ? <><option value="mode">{text.actions.mode}</option><option value="restart">{text.actions.restart}</option>
            <option value="drop">{text.actions.drop}</option></> : <option value="add">{text.actions.add}</option>}
        </select></Field>
        {(kind === 'add' || kind === 'mode') && <Field label={text.mode}><select aria-label={text.mode} value={mode}
          onChange={event => { setMode(event.target.value as typeof mode); setError(''); }}>
          <option value="always">{text.always}</option><option value="byDefault">{text.byDefault}</option>
        </select></Field>}
        {kind === 'add' && <Field label={text.start}><input value={start} maxLength={20} onChange={event => { setStart(event.target.value); setError(''); }}/></Field>}
        {kind === 'restart' && <Field label={text.restart}><input value={restart} maxLength={20} placeholder={text.restartPlaceholder}
          onChange={event => { setRestart(event.target.value); setError(''); }}/></Field>}
      </div>
      {column?.identity && <p>{text.currentMode} · {column.identity === 'a' ? text.always : text.byDefault}</p>}
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={destructive ? 'danger' : 'primary'} disabled={busy || unknown || destructive && !acceptDrop}
          onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !canPreview} onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
