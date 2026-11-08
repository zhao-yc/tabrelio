import { useMemo, useState } from 'react';
import { postgresEditViewPreviewSchema, postgresViewColumnsSchema, preparePostgresViewDefinition, postgresViewQuerySampleRows } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresViewEditZh as text } from '../locales/postgresViewEdit.zh-CN';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ViewSqlFileImport } from './ViewSqlFileImport';
import { ViewOutputColumns } from './ViewOutputColumns';
import { ViewQueryInspect } from './ViewQueryInspect';
import { viewQueryInspectZh } from '../locales/viewQueryInspect.zh-CN';
import { viewSqlFileZh } from '../locales/viewSqlFile.zh-CN';
import { useWorkspace } from '../store';

/** 预填服务器定义，沿用结构编辑器的原窗口保护、预览和明确提交。 */
export function PostgresViewEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [definition, setDefinition] = useState(original.viewDefinition ?? '');
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [previewColumns, setPreviewColumns] = useState<{ owner: object; names: string[] }>();
  const profile = useWorkspace(state => state.connections.find(item => item.id === target.connectionId));
  const importOwner = useMemo(() => ({}), [definition, columnNames, original, profile, props.version, target.connectionId, target.database, target.table]);
  const dirty = definition !== original.viewDefinition || columnNames.length > 0;
  const { preview, setPreview, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, dirty, false,
      async () => invoke('postgres.editView.preview', postgresEditViewPreviewSchema.parse({
        ...target, definition, columnNames, stamp: original.viewEditStamp,
      })),
      token => invoke('postgres.editView.apply', { connectionId: target.connectionId, database: target.database, token }));

  function changeDefinition(sql: string) {
    setDefinition(sql);
    setError('');
  }

  function importCurrent(): boolean {
    const state = useWorkspace.getState();
    return !operation.current && !unknown && (state.connectionVersions[target.connectionId] ?? 0) === props.version &&
      state.connections.find(item => item.id === target.connectionId) === profile;
  }

  /** 明确放弃本地草稿，未知终态下关闭编辑将重新读取目录。 */
  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    {preview ? <>
      <p>{text.review}</p>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
    </> : <>
      <p>{text.hint}</p>
      <label>{text.definition}<textarea rows={10} spellCheck={false} maxLength={128 * 1024}
        value={definition} disabled={busy || unknown} onChange={event => changeDefinition(event.target.value)}/></label>
      <ViewSqlFileImport owner={importOwner} name={target.table} value={definition} disabled={busy || unknown}
        hint={viewSqlFileZh.postgresHint} current={importCurrent} prepare={preparePostgresViewDefinition} apply={changeDefinition}/>
      <ViewQueryInspect owner={importOwner} hint={viewQueryInspectZh.postgresHint(postgresViewQuerySampleRows)}
        disabled={busy || unknown || !definition.trim()} current={importCurrent}
        read={mode => {
          if (mode === 'rows') setPreviewColumns(undefined);
          return invoke('postgres.createView.inspectQuery', { connectionId: target.connectionId, database: target.database, definition, columnNames, mode });
        }} onRows={columns => setPreviewColumns({ owner: importOwner, names: columns.map(column => column.name) })}/>
      <ViewOutputColumns owner={importOwner} original={columnNames} partial disabled={busy || unknown} current={importCurrent}
        previewColumns={previewColumns?.owner === importOwner ? previewColumns.names : undefined}
        applyNames={names => { setColumnNames(postgresViewColumnsSchema.parse(names)); setError(''); }}/>
    </>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || unknown} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !dirty || !definition.trim()}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={close}>{text.close}</button>
    </div>
  </section>;
}
