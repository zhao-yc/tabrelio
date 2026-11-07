import { useEffect, useState } from 'react';
import { postgresTableManagePreviewSchema, type PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresViewManagePreviewSchema } from '../../shared/postgresCreateView';
import { errorMessage, invoke } from '../lib';
import { postgresTableManageZh as tableText } from '../locales/postgresTableManage.zh-CN';
import { postgresViewManageZh } from '../locales/postgresViewManage.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 表维护和视图管理复用原结构窗口的提交与未知结果保护。 */
export function PostgresRelationManagePanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const table = original.tableManage;
  const text = table ? tableText : postgresViewManageZh;
  const [action, setAction] = useState<PostgresTableManageInput['action']>(
    !table || table.rename ? 'rename' : table.move ? 'move' : table.drop ? 'drop' : 'truncate');
  const [name, setName] = useState('');
  const [schema, setSchema] = useState('');
  const [schemas, setSchemas] = useState<{ names: string[]; error?: string }>();
  const [identity, setIdentity] = useState<'continue' | 'restart'>('continue');
  const renaming = action === 'rename', moving = action === 'move', truncating = action === 'truncate';
  const confirmationRequired = action === 'drop' || truncating;
  const canPreview = renaming ? !!name.trim() && name !== original.name : !moving || !!schemas?.names.includes(schema);
  // 单行输入会去掉换行，旧表名含换行时使用可复制的转义写法。
  const confirmation = /[\r\n]/.test(original.name) ? JSON.stringify(original.name) : original.name;
  const destination = table && renaming && name ? postgresIdentifier(original.schema) + '.' + postgresIdentifier(name) :
    moving && schema ? postgresIdentifier(schema) + '.' + postgresIdentifier(original.name) : undefined;
  const applyTarget = { connectionId: target.connectionId, database: target.database };
  useEffect(() => {
    if (!moving) return;
    let current = true;
    setSchemas(undefined);
    void invoke('postgres.createTable.schemas', { connectionId: target.connectionId, database: target.database }).then(list => {
      if (!current) return;
      const names = list.filter(item => item !== original.schema);
      setSchema(value => names.includes(value) ? value : '');
      setSchemas({ names });
    }).catch(reason => { if (current) setSchemas({ names: [], error: errorMessage(reason) }); });
    return () => { current = false; };
  }, [moving, target.connectionId, target.database, original.schema, props.version]);
  const report: PostgresStructureEditProps = {
    ...props, onResult: (message, unknown, receipt, _attempted, truncateTables) => props.onResult(message, unknown, receipt, destination, truncateTables),
  };
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(report, confirmationRequired || !!name || !!schema, confirmationRequired, async () => {
      if (table) {
        const base = { ...target, stamp: table.stamp };
        const draft = postgresTableManagePreviewSchema.parse({
          ...base, action, ...(renaming ? { name } : moving ? { schema } : truncating ? { identity } : {}),
        });
        const result = await invoke('postgres.tableManage.preview', draft);
        if (truncating && !result.truncateScope?.tables.length) throw Error(tableText.unknown);
        if (moving && !result.moveScope) throw Error(tableText.unknown);
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
    <ErrorBox message={[unknown && text.unknown, error, moving && schemas?.error].filter(Boolean).join(' ')}/>
    <p>{renaming ? text.renameHint : moving ? tableText.moveHint :
      truncating ? tableText.truncateHint : original.kind === 'm' ? text.materializedDropHint : text.dropHint}</p>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {preview.truncateScope && <>
        <p>{tableText.affectedTables}</p><pre aria-label={tableText.affectedTables} tabIndex={0}>{preview.truncateScope.tables.join('\n')}</pre>
        {!!preview.truncateScope.sequences.length && <>
          <p>{tableText.affectedSequences}</p><pre aria-label={tableText.affectedSequences} tabIndex={0}>{preview.truncateScope.sequences.join('\n')}</pre>
        </>}
      </>}
      {preview.moveScope && ([
        [tableText.moveIndexes, preview.moveScope.indexes],
        [tableText.moveConstraints, preview.moveScope.constraints],
        [tableText.moveSequences, preview.moveScope.sequences],
      ] as const).map(([label, names]) => !!names.length && <div key={label}>
        <p>{label}</p><pre aria-label={label} tabIndex={0}>{names.join('\n')}</pre>
      </div>)}
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
          {table?.move && <option value="move">{tableText.move}</option>}
          {(!table || table.drop) && <option value="drop">{text.drop}</option>}
          {table?.truncate && <option value="truncate">{tableText.truncate}</option>}</select></Field>
        {truncating && <Field label={tableText.identity}><select aria-label={tableText.identity} value={identity}
          onChange={event => setIdentity(event.target.value as typeof identity)}>
          <option value="continue">{tableText.continue}</option><option value="restart">{tableText.restart}</option>
        </select></Field>}
        {moving && <Field label={tableText.schema}><select aria-label={tableText.schema} value={schema}
          disabled={!schemas?.names.length} onChange={event => { setSchema(event.target.value); setError(''); }}>
          <option value="">{!schemas ? tableText.loadingSchemas : schemas.names.length ? tableText.chooseSchema : tableText.noSchemas}</option>
          {schemas?.names.map(item => <option key={item} value={item}>{item}</option>)}
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
        <button className={confirmationRequired ? 'danger' : 'primary'} disabled={busy || unknown || confirmationRequired && !acceptDrop}
          onClick={() => void submit(true)}>{renaming ? text.confirmRename : moving ? tableText.confirmMove : truncating ? tableText.confirmTruncate : text.confirmDrop}</button>
      </> : <button className="primary" disabled={busy || unknown || !canPreview}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
