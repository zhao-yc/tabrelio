import { useEffect, useRef, useState } from 'react';
import type { DatabaseObject, FileChoice } from '../../shared/contracts';
import { postgresRelationName } from '../../shared/postgresSql';
import { EXCEL_LIMITS, excelWorksheetNames } from '../../shared/excelTransfer';
import { acquireWorkspaceBusy, useWorkspace } from '../store';
import { errorMessage, invoke, kindLabels, uid } from '../lib';
import { checkTableFilteredExportOutput } from '../tableFilteredExportUi';
import { postgresWorkbookExportZh, sqliteWorkbookExportZh } from '../locales/workbookExport.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';

type Operation = { taskId?: string; stop?: Promise<unknown> };
type ObjectChoice = { name: string; kind: 'table' | 'view' };
interface Props {
  connectionId: string; database: string; dialect: 'sqlite' | 'postgresql'; tabId: string; objects: readonly DatabaseObject[];
  current(): boolean; onClose(): void;
}

/** 选文件与实际导出均占用原标签，重载或换绑后不会发送旧选择。 */
export function WorkbookExportDialog({ connectionId, database, dialect, tabId, objects, current, onClose }: Props) {
  const text = dialect === 'postgresql' ? postgresWorkbookExportZh : sqliteWorkbookExportZh;
  const [selected, setSelected] = useState<ObjectChoice[]>([]), [search, setSearch] = useState('');
  const [file, setFile] = useState<FileChoice | null>(null), [done, setDone] = useState<number>();
  const [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const active = useRef<Operation | undefined>(undefined), mounted = useRef(true);
  const choices = objects.filter((object): object is ObjectChoice => (object.kind === 'table' || object.kind === 'view') &&
    object.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const names = excelWorksheetNames(selected.map(object => dialect === 'postgresql' ? postgresRelationName(object.name).name : object.name));
  const valid = current(), ready = selected.length >= 2, locked = busy || done !== undefined || !valid;

  function stop() {
    const operation = active.current;
    if (!operation?.taskId || operation.stop) return;
    if (mounted.current) setCancelling(true);
    operation.stop = invoke('query.cancel', { taskId: operation.taskId }).catch(reason => {
      if (mounted.current) setError(errorMessage(reason));
    });
  }
  useEffect(() => {
    mounted.current = true;
    const off = useWorkspace.subscribe(() => { if (!current()) stop(); });
    return () => { mounted.current = false; off(); stop(); };
  }, [current]);

  function toggle(object: ObjectChoice) {
    if (active.current || !current() || done !== undefined) return;
    const exists = selected.some(item => item.name === object.name);
    if (!exists && selected.length === EXCEL_LIMITS.maxSheets) return;
    setSelected(exists ? selected.filter(item => item.name !== object.name) : [...selected, object]);
    setFile(null); setError('');
  }

  async function run(exporting: boolean) {
    if (active.current || !current() || !ready || done !== undefined || exporting && !file) return;
    const operation: Operation = exporting ? { taskId: uid() } : {};
    active.current = operation;
    setBusy(true); setError('');
    let lease: ReturnType<typeof acquireWorkspaceBusy> | undefined;
    try {
      lease = acquireWorkspaceBusy(tabId);
      if (!current()) throw Error(text.stale);
      if (!exporting) {
        const result = await invoke('files.choose', { purpose: 'export', format: 'xlsx', suggestedName: text.suggestedName });
        if (result && mounted.current && current()) setFile(result);
      } else {
        setFile(null);
        const input = { connectionId, database, fileToken: file!.token, taskId: operation.taskId!,
          objects: selected.map(({ name, kind }) => ({ name, kind })) };
        const output = checkTableFilteredExportOutput(dialect === 'postgresql'
          ? await invoke('postgres.workbookExport', input)
          : await invoke('sqlite.workbookExport', { ...input, database: 'main', format: 'xlsx', encoding: 'utf8' }));
        if (mounted.current) { setFile(file); setDone(output.rows); }
        else useWorkspace.getState().notify(text.complete(selected.length, output.rows));
      }
    } catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally {
      await operation.stop;
      lease?.release(); active.current = undefined;
      if (mounted.current) { setBusy(false); setCancelling(false); }
    }
  }

  const close = () => { if (!active.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content">
      <p>{text.hint}</p>
      <Field label={text.search}><input aria-label={text.search} disabled={locked} value={search} onChange={event => setSearch(event.target.value)}/></Field>
      <div style={{ maxHeight: '25vh', overflow: 'auto' }}>
        {choices.map(object => {
          const checked = selected.some(item => item.name === object.name);
          return <div key={object.name}><label className="check"><input type="checkbox" checked={checked}
            disabled={locked || !checked && selected.length >= EXCEL_LIMITS.maxSheets}
            onChange={() => toggle(object)}/>{object.name} · {kindLabels[object.kind]}</label></div>;
        })}
      </div>
      <p>{text.selected(selected.length, EXCEL_LIMITS.maxSheets)}</p>
      {!!selected.length && <ol aria-label={text.order}>{selected.map((object, index) => <li key={object.name}>
        {object.name} → {names[index]}
      </li>)}</ol>}
      <button type="button" disabled={locked || !ready} onClick={() => void run(false)}>{file?.name ?? text.choose}</button>
      {busy && <Spinner text={active.current?.taskId ? text.exporting : undefined}/>}
      {done !== undefined && <p role="status">{text.complete(selected.length, done)}</p>}
      <ErrorBox message={error || (!valid && done === undefined ? text.stale : '')}/>
    </div>
    <footer className="modal-footer"><button type="button" disabled={busy} onClick={close}>{text.close}</button><span className="grow"/>
      {busy && active.current?.taskId && <button type="button" disabled={cancelling} onClick={stop}>{text.cancel}</button>}
      {done === undefined && <button type="button" className="primary" disabled={locked || !file || !ready} onClick={() => void run(true)}>{text.export}</button>}
    </footer>
  </Modal>;
}
