import { useState } from 'react';
import { postgresTableManagePreviewSchema } from '../../shared/postgresTableManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresViewManagePreviewSchema } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresTableManageZh } from '../locales/postgresTableManage.zh-CN';
import { postgresViewManageZh } from '../locales/postgresViewManage.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 重命名和受限删除复用原结构窗口的提交与未知结果保护。 */
export function PostgresRelationManagePanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const table = original.tableManage;
  const text = table ? postgresTableManageZh : postgresViewManageZh;
  const [action, setAction] = useState<'rename' | 'drop'>(table && !table.rename ? 'drop' : 'rename');
  const [name, setName] = useState('');
  const dropping = action === 'drop';
  // 单行输入会去掉换行，旧表名含换行时使用可复制的转义写法。
  const confirmation = /[\r\n]/.test(original.name) ? JSON.stringify(original.name) : original.name;
  const destination = table && !dropping && name ? postgresIdentifier(original.schema) + '.' + postgresIdentifier(name) : undefined;
  const applyTarget = { connectionId: target.connectionId, database: target.database };
  const report: PostgresStructureEditProps = { ...props, onResult: (message, unknown, receipt) => props.onResult(message, unknown, receipt, destination) };
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(report, dropping || !!name, dropping, async () => {
      if (table) {
        const base = { ...target, stamp: table.stamp };
        const draft = postgresTableManagePreviewSchema.parse(dropping ? { ...base, action } : { ...base, action, name });
        return invoke('postgres.tableManage.preview', draft);
      }
      const base = original.kind === 'm'
        ? { ...target, stamp: original.materializedManageStamp, relationKind: 'materialized' }
        : { ...target, stamp: original.viewEditStamp };
      const input = postgresViewManagePreviewSchema.parse(dropping ? { ...base, action } : { ...base, action, name });
      return invoke('postgres.viewManage.preview', input);
    }, token => table ? invoke('postgres.tableManage.apply', { ...applyTarget, token, confirmed: true }) :
      invoke('postgres.viewManage.apply', { ...applyTarget, token }), table ? () => props.beforeManage?.(destination) : undefined);

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    <p>{dropping ? original.kind === 'm' ? text.materializedDropHint : text.dropHint : text.renameHint}</p>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && table ? <Field label={text.acknowledge}><input key={preview.token} placeholder={confirmation}
        disabled={busy || unknown} autoComplete="off" onChange={event => setAcceptDrop(event.target.value === confirmation)}/></Field> : dropping && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/>{text.acknowledge}
      </label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.operation}><select aria-label={text.operation} value={action} onChange={event => {
          setAction(event.target.value as typeof action);
          setError('');
        }}>{(!table || table.rename) && <option value="rename">{text.rename}</option>}
          {(!table || table.drop) && <option value="drop">{text.drop}</option>}</select></Field>
        {!dropping && <Field label={text.name}><input value={name} maxLength={63} onChange={event => {
          setName(event.target.value);
          setError('');
        }}/></Field>}
      </div>
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={dropping ? 'danger' : 'primary'} disabled={busy || unknown || dropping && !acceptDrop}
          onClick={() => void submit(true)}>{dropping ? text.confirmDrop : text.confirmRename}</button>
      </> : <button className="primary" disabled={busy || unknown || !dropping && (!name.trim() || name === original.name)}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
