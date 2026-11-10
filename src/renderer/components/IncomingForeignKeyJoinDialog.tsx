import { useEffect, useRef, useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import type { IncomingReferenceRelation, IncomingReferencesOutput } from '../../shared/incomingReferences';
import { checkIncomingReferencePage } from '../childReferenceIntent';
import { foreignKeyJoinMetadataKey } from '../tableForeignKeyJoin';
import type { TableForeignKeyJoinIntent } from '../tableForeignKeyJoinIntent';
import { errorMessage, invoke, uid } from '../lib';
import { childReferencesZh as directoryText } from '../locales/childReferences.zh-CN';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { tableForeignKeyJoinServices } from './TableForeignKeyJoinDialog';
import { ErrorBox, Modal, Spinner } from './ui';
import '../childReferences.css';

interface Page { output: IncomingReferencesOutput; cursors: Array<string | undefined> }
interface Read { taskId: string; promise?: Promise<void>; cancelled: boolean; cancellation?: Promise<unknown> }

/** 父表目录和所选子表结构共用一个读取占位；不请求任何父行或子行。 */
export function IncomingForeignKeyJoinDialog({ intent, onProceed, onClose, onActivity }: {
  intent: TableForeignKeyJoinIntent; onProceed(child: TableInfo, relation: IncomingReferenceRelation): void;
  onClose(): void; onActivity(delta: 1 | -1): void;
}) {
  const [page, setPage] = useState<Page>(), pageRef = useRef<Page | undefined>(undefined);
  const [selected, setSelected] = useState(''), selectedRef = useRef('');
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [invalid, setInvalid] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false), closingRef = useRef(false), read = useRef<Read | undefined>(undefined);
  const { database, name: table } = intent.source;

  function current(): boolean {
    if (!alive.current || closingRef.current || !intent.current()) return false;
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialogs.length !== 1 || dialogs[0].getAttribute('aria-label') !== text.incomingTitle || document.querySelector('[role="alertdialog"]')) {
      intent.invalidate(); return false;
    }
    return true;
  }

  function cancel() {
    const active = read.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    active.cancellation = Promise.resolve().then(() => tableForeignKeyJoinServices.cancel(active.taskId)).catch(() => undefined);
  }

  /** 原读取和取消均结束后才归还占用；目录或工作区换代后不发布迟到结果。 */
  function run<T>(request: (taskId: string) => Promise<T>, accept: (result: T) => void) {
    if (!current() || read.current) return;
    const active: Read = { taskId: uid(), cancelled: false };
    read.current = active;
    try { onActivity(1); }
    catch (reason) { read.current = undefined; setError(errorMessage(reason)); return; }
    setBusy(true); setError('');
    active.promise = (async () => {
      try {
        if (!current()) return;
        const result = await request(active.taskId);
        if (!active.cancelled && current()) accept(result);
      } catch (reason) { if (!active.cancelled && current()) setError(errorMessage(reason)); }
      finally {
        if (active.cancellation) await active.cancellation;
        read.current = undefined;
        onActivity(-1);
        if (alive.current) setBusy(false);
      }
    })();
  }

  function load(cursors: Page['cursors']) {
    const previous = pageRef.current, cursor = cursors.at(-1);
    run(taskId => invoke('table.incomingReferences', { connectionId: intent.connectionId, database, table, taskId, ...(cursor ? { cursor } : {}) }), output => {
      try { checkIncomingReferencePage(intent, output, previous?.output.sourceDigest, foreignKeyJoinMetadataKey); }
      catch (reason) { intent.invalidate(); throw reason; }
      const next = { output: structuredClone(output), cursors };
      pageRef.current = next; setPage(next); selectedRef.current = ''; setSelected('');
    });
  }

  function proceed() {
    if (!page || pageRef.current !== page || !selected || selectedRef.current !== selected) return;
    const relation = page.output.relations[Number(selected)];
    if (!relation) return;
    run(taskId => tableForeignKeyJoinServices.read({ connectionId: intent.connectionId, database: relation.database, table: relation.table, taskId }),
      child => onProceed(child, relation));
  }

  function close() {
    if (closingRef.current) return;
    closingRef.current = true; setClosing(true);
    const active = read.current; cancel();
    void Promise.resolve(active?.promise).finally(() => { if (alive.current) onClose(); });
  }

  useEffect(() => {
    alive.current = true;
    const unsubscribe = intent.subscribe(() => { if (alive.current) { setInvalid(true); cancel(); } });
    const timer = setTimeout(() => load([undefined]), 0);
    const block = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.addEventListener('keydown', block, true);
    return () => { alive.current = false; clearTimeout(timer); unsubscribe(); cancel(); document.removeEventListener('keydown', block, true); };
  }, []);

  const disabled = busy || closing || invalid || !intent.current();
  return <Modal title={text.incomingTitle} onClose={close}>
    <div className="modal-content" aria-busy={busy || closing}>
      <p>{database}.{table}</p><p>{text.incomingScope}</p>
      <ErrorBox message={invalid || !intent.current() ? text.stale : error}/>
      {busy && <Spinner text={text.incomingLoading}/>}
      {page && <>
        <label>{directoryText.relations}<select aria-label={directoryText.relations} disabled={disabled} value={selected} onChange={event => {
          if (!current() || read.current || pageRef.current !== page) return;
          selectedRef.current = event.target.value; setSelected(event.target.value);
        }}>
          <option value="">{directoryText.relations}</option>
          {page.output.relations.map((relation, index) => <option key={relation.digest} value={index}>{relation.database}.{relation.table} · {relation.foreignKey.name}</option>)}
        </select></label>
        {!page.output.relations.length && <p>{directoryText.emptyRelations}</p>}
        <div className="child-reference-tools">
          <button disabled={disabled || page.cursors.length < 2} onClick={() => { if (pageRef.current === page) load(page.cursors.slice(0, -1)); }}>{directoryText.previousRelations}</button>
          <span role="status">{directoryText.relationPage(page.cursors.length)}</span>
          <button disabled={disabled || !page.output.nextCursor} onClick={() => { if (pageRef.current === page && page.output.nextCursor) load([...page.cursors, page.output.nextCursor]); }}>{directoryText.nextRelations}</button>
        </div>
      </>}
      {closing && <p>{text.closing}</p>}
    </div>
    <footer className="modal-footer">
      {busy && <button disabled={closing} onClick={cancel}>{text.cancel}</button>}
      {!page && !busy && <button disabled={disabled} onClick={() => load([undefined])}>{text.incomingRead}</button>}
      <span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button>
      <button className="primary" disabled={disabled || !selected} onClick={proceed}>{text.incomingOpen}</button>
    </footer>
  </Modal>;
}
