import { useLayoutEffect, useRef, useState } from 'react';
import { queryDatabasePatch } from '../../shared/queryContext';
import { errorMessage, invoke, uid } from '../lib';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { TableForeignKeyJoinIntent, type MysqlQueryBuilderPreview } from '../tableForeignKeyJoinIntent';
import { ManualJoinTablePicker, manualJoinTableNames } from './ManualJoinFields';
import { TableForeignKeyJoinDialog, tableForeignKeyJoinServices } from './TableForeignKeyJoinDialog';
import { ErrorBox, Modal, Spinner } from './ui';

interface SourceOperation { finished: Promise<void>; taskId?: string; cancellation?: Promise<unknown>; }

/** 新建查询的起始表选择只读目录和结构，原标签不会被登记为本次 JOIN 的作业来源。 */
export function QueryJoinStartDialog({ connectionId, database, onBack, onClose, onViewApplied }: {
  connectionId: string; database: string; onBack(): void; onClose(): void; onViewApplied?(): void;
}) {
  const [owner] = useState(() => {
    const workspace = useWorkspace.getState();
    const profile = workspace.connections.find(item => item.id === connectionId);
    return { profile, version: workspace.connectionVersions[connectionId] ?? 0, tab: workspace.settings.activeTabId,
      limit: workspace.settings.resultLimit, invalid: false, intent: undefined as TableForeignKeyJoinIntent | undefined };
  });
  const [tables, setTables] = useState<string[]>(), [table, setTable] = useState('');
  const [builder, setBuilder] = useState<{ intent: TableForeignKeyJoinIntent; single: boolean }>();
  const [invalid, setInvalid] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(false), closing = useRef(false), pending = useRef<SourceOperation | null>(null);

  /** 原连接、版本或活动标签离开后永久失效，迟到回包不能在切回后恢复权限。 */
  function current(): boolean {
    if (!alive.current || closing.current || owner.invalid) return false;
    const workspace = useWorkspace.getState();
    const profile = workspace.connections.find(item => item.id === connectionId);
    owner.invalid = profile !== owner.profile || (profile?.dialect !== 'mysql' && profile?.dialect !== 'mariadb') ||
      (workspace.connectionVersions[connectionId] ?? 0) !== owner.version || workspace.settings.activeTabId !== owner.tab ||
      workspace.settings.resultLimit !== owner.limit;
    return !owner.invalid;
  }

  function cancelRead() {
    const operation = pending.current;
    if (operation?.taskId && !operation.cancellation) {
      const taskId = operation.taskId;
      operation.cancellation = Promise.resolve().then(() => tableForeignKeyJoinServices.cancel(taskId))
        .catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
    }
  }

  useLayoutEffect(() => {
    alive.current = true;
    const check = () => {
      if (current()) return;
      if (!owner.invalid) return;
      setInvalid(true); owner.intent?.invalidate(); cancelRead();
    };
    const unsubscribe = useWorkspace.subscribe(check);
    check();
    return () => { unsubscribe(); alive.current = false; cancelRead(); };
  }, []);

  function run(action: 'directory' | 'single' | 'join') {
    if (!current() || pending.current || (action !== 'directory' && !tables?.includes(table))) return;
    const operation: SourceOperation = { finished: Promise.resolve() };
    pending.current = operation; setError(''); setMessage(action === 'directory' ? text.builderCatalog : text.checking);
    operation.finished = Promise.resolve().then(async () => {
      if (!current()) return;
      if (action === 'directory') {
        const objects = await invoke('metadata.objects', { connectionId, database });
        if (!current()) return;
        const names = manualJoinTableNames(objects);
        setTables(names); if (!names.includes(table)) setTable('');
      } else {
        operation.taskId = uid();
        const source = await tableForeignKeyJoinServices.read({ connectionId, database, table, taskId: operation.taskId });
        if (!current()) return;
        if (source.database !== database || source.name !== table) throw Error(text.builderTarget);
        const next = new TableForeignKeyJoinIntent(source, connectionId, owner.limit, [], current);
        owner.intent = next; setBuilder({ intent: next, single: action === 'single' });
      }
    }).catch(reason => { if (current()) setError(errorMessage(reason)); }).finally(async () => {
      await operation.cancellation;
      pending.current = null;
      if (alive.current && !closing.current) setMessage('');
    });
  }

  /** 返回或关闭时等待原读取及其取消回执，后续窗口不能复用本次起始表。 */
  function close(next: () => void) {
    if (closing.current || !alive.current) return;
    closing.current = true;
    const operation = pending.current;
    if (!operation) { next(); return; }
    setMessage(text.closing); cancelRead();
    void operation.finished.then(() => { if (alive.current) next(); });
  }

  function open(preview: MysqlQueryBuilderPreview): boolean {
    const intent = builder?.intent;
    if (!intent?.current() || !current()) return false;
    const workspace = useWorkspace.getState();
    if (workspace.settings.tabs.length >= 100) throw Error(text.tabs);
    const sql = intent.consume(preview);
    const title = ('parent' in preview ? text.manualQueryTitle : text.singleQueryTitle)(intent.source.name);
    workspace.openTab({ kind: 'query', title, connectionId,
      ...queryDatabasePatch({ state: 'known', database }), sql });
    onClose();
    return true;
  }

  if (builder) return <TableForeignKeyJoinDialog intent={builder.intent} manual={!builder.single} single={builder.single} onOpen={open} onClose={onClose} onViewApplied={onViewApplied}
    onCleanupError={reason => useWorkspace.getState().notify(reason, true)}/>;
  return <Modal title={text.builderTitle} onClose={() => close(onClose)}>
    <div className="modal-content" aria-busy={!!message}>
      <p>{text.builderHint}</p><p><strong>{text.builderDatabase}</strong> {database}</p>
      <fieldset disabled={invalid || !!message}>
        <div className="child-reference-tools"><button type="button" onClick={() => run('directory')}>{text.builderCatalog}</button></div>
        <ManualJoinTablePicker source tables={tables} table={table} onTable={setTable}/>
      </fieldset>
      <ErrorBox message={invalid ? text.stale : error}/>{message && <Spinner text={message}/>}
    </div>
    <footer className="modal-footer">
      <button type="button" disabled={closing.current} onClick={() => close(onBack)}>{text.builderBack}</button>
      <span className="grow"/>
      <button type="button" disabled={closing.current} onClick={() => close(onClose)}>{zh.common.cancel}</button>
      <button type="button" disabled={invalid || !!message || !tables?.includes(table)} onClick={() => run('join')}>{text.builderRead}</button>
      <button type="button" className="primary" disabled={invalid || !!message || !tables?.includes(table)} onClick={() => run('single')}>{text.singleEntry}</button>
    </footer>
  </Modal>;
}
