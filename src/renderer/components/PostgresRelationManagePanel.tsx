import { useState } from 'react';
import { postgresTableManagePreviewSchema, type PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresViewManagePreviewSchema } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresTableManageZh as tableText } from '../locales/postgresTableManage.zh-CN';
import { postgresViewManageZh } from '../locales/postgresViewManage.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 表维护和视图管理复用原结构窗口的提交与未知结果保护。 */
export function PostgresRelationManagePanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const table = original.tableManage;
  const text = table ? tableText : postgresViewManageZh;
  const [action, setAction] = useState<PostgresTableManageInput['action']>(!table || table.rename ? 'rename' : table.drop ? 'drop' : 'truncate');
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<'continue' | 'restart'>('continue');
  const renaming = action === 'rename', truncating = action === 'truncate';
  const confirmationRequired = !renaming;
  // 单行输入会去掉换行，旧表名含换行时使用可复制的转义写法。
  const confirmation = /[\r\n]/.test(original.name) ? JSON.stringify(original.name) : original.name;
  const destination = table && renaming && name ? postgresIdentifier(original.schema) + '.' + postgresIdentifier(name) : undefined;
  const applyTarget = { connectionId: target.connectionId, database: target.database };
  const report: PostgresStructureEditProps = {
    ...props, onResult: (message, unknown, receipt, _attempted, truncateTables) => props.onResult(message, unknown, receipt, destination, truncateTables),
  };
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(report, confirmationRequired || !!name, confirmationRequired, async () => {
      if (table) {
        const base = { ...target, stamp: table.stamp };
        const draft = postgresTableManagePreviewSchema.parse({ ...base, action, ...(renaming ? { name } : truncating ? { identity } : {}) });
        const result = await invoke('postgres.tableManage.preview', draft);
        if (truncating && !result.truncateScope?.tables.length) throw Error(tableText.unknown);
        return result;
      }
      const base = original.kind === 'm'
        ? { ...target, stamp: original.materializedManageStamp, relationKind: 'materialized' }
        : { ...target, stamp: original.viewEditStamp };
      const input = postgresViewManagePreviewSchema.parse(renaming ? { ...base, action, name } : { ...base, action });
      return invoke('postgres.viewManage.preview', input);
    }, token => table ? invoke('postgres.tableManage.apply', { ...applyTarget, token, confirmed: true }) :
      invoke('postgres.viewManage.apply', { ...applyTarget, token }), table ? preview => props.beforeManage?.(destination, preview.truncateScope?.tables) : undefined);

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    <p>{renaming ? text.renameHint : truncating ? tableText.truncateHint : original.kind === 'm' ? text.materializedDropHint : text.dropHint}</p>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {preview.truncateScope && <>
        <p>{tableText.affectedTables}</p><pre aria-label={tableText.affectedTables} tabIndex={0}>{preview.truncateScope.tables.join('\n')}</pre>
        {!!preview.truncateScope.sequences.length && <>
          <p>{tableText.affectedSequences}</p><pre aria-label={tableText.affectedSequences} tabIndex={0}>{preview.truncateScope.sequences.join('\n')}</pre>
        </>}
      </>}
      {confirmationRequired && table ? <Field label={truncating ? tableText.acknowledgeTruncate : text.acknowledge}><input key={preview.token} placeholder={confirmation}
        disabled={busy || unknown} autoComplete="off" onChange={event => setAcceptDrop(event.target.value === confirmation)}/></Field> : confirmationRequired && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/>{text.acknowledge}
      </label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.operation}><select aria-label={text.operation} value={action} onChange={event => {
          setAction(event.target.value as typeof action);
          setError('');
        }}>{(!table || table.rename) && <option value="rename">{text.rename}</option>}
          {(!table || table.drop) && <option value="drop">{text.drop}</option>}
          {table?.truncate && <option value="truncate">{tableText.truncate}</option>}</select></Field>
        {truncating && <Field label={tableText.identity}><select aria-label={tableText.identity} value={identity}
          onChange={event => setIdentity(event.target.value as typeof identity)}>
          <option value="continue">{tableText.continue}</option><option value="restart">{tableText.restart}</option>
        </select></Field>}
        {renaming && <Field label={text.name}><input value={name} maxLength={63} onChange={event => {
          setName(event.target.value);
          setError('');
        }}/></Field>}
      </div>
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={renaming ? 'primary' : 'danger'} disabled={busy || unknown || confirmationRequired && !acceptDrop}
          onClick={() => void submit(true)}>{renaming ? text.confirmRename : truncating ? tableText.confirmTruncate : text.confirmDrop}</button>
      </> : <button className="primary" disabled={busy || unknown || renaming && (!name.trim() || name === original.name)}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
