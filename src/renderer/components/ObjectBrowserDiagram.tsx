import { useEffect, useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { errorMessage, invoke } from '../lib';
import { relationshipDiagramZh as text } from '../locales/relationshipDiagram.zh-CN';
import { readObjectBrowserDiagram } from '../objectBrowserDiagram';
import { relationshipDiagramLimits as limits, type RelationshipDiagram } from '../relationshipDiagram';
import { RelationshipDiagramCanvas } from './RelationshipDiagramDialog';
import { ErrorBox, Spinner } from './ui';

interface ReadOperation { stopped: boolean; taskId?: string; cancel?: Promise<string>; }

/** 图固定在一次目录读取上。筛选只改变下一次读取范围，旧图保留至完整结果到达。 */
export function ObjectBrowserDiagram({ profile, database, tables, current, onDesign }: {
  profile: ConnectionProfile; database: string; tables: readonly string[]; current(): boolean; onDesign(table: string): void;
}) {
  const [diagram, setDiagram] = useState<RelationshipDiagram>();
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(false), reading = useRef<ReadOperation | undefined>(undefined);
  const latest = useRef(current); latest.current = current;

  function stop() {
    const operation = reading.current;
    if (!operation || operation.stopped) return;
    operation.stopped = true;
    if (operation.taskId) operation.cancel = invoke('query.cancel', { taskId: operation.taskId }).then(() => '', errorMessage);
  }

  async function read() {
    if (reading.current || !latest.current() || !tables.length || tables.length > limits.tables) return;
    const operation: ReadOperation = { stopped: false };
    reading.current = operation;
    setBusy(true); setProgress(text.browserReading); setError(''); setNotice('');
    const owned = () => alive.current && reading.current === operation && latest.current();
    const check = () => {
      if (!owned()) throw Error(text.stale);
      if (operation.stopped) throw Error(text.cancelled);
    };
    try {
      await Promise.resolve();
      const value = await readObjectBrowserDiagram(profile, database, tables, {
        check, task: id => { operation.taskId = id; }, progress: (done, total) => {
          if (owned()) setProgress(text.progress(done, total));
        },
      });
      check();
      setDiagram(value);
    } catch (reason) {
      if (owned() && !operation.stopped) setError(errorMessage(reason));
    } finally {
      const cancellationError = await operation.cancel;
      if (owned()) {
        setBusy(false);
        if (cancellationError) setError(cancellationError);
        else if (operation.stopped) setNotice(text.cancelled);
      }
      if (reading.current === operation) reading.current = undefined;
    }
  }

  useEffect(() => {
    alive.current = true;
    void read();
    return () => { alive.current = false; stop(); reading.current = undefined; };
  }, []);

  const changed = diagram && (diagram.tables.length !== tables.length || diagram.tables.some((table, index) => table.name !== tables[index]));
  return <section className="object-browser-diagram" aria-label={text.browserView} aria-busy={busy}>
    <div className="object-browser-diagram-tools">
      <span>{text.browserMatches(tables.length)}</span>
      <button disabled={busy || !tables.length || tables.length > limits.tables} onClick={() => { void read(); }}>{text.browserRead}</button>
      {busy && <button onClick={stop}>{text.stop}</button>}
    </div>
    {tables.length > limits.tables && <p role="status">{text.browserLimit(limits.tables)}</p>}
    {changed && <p role="status">{text.selectionChanged}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <Spinner text={progress}/>}
    <ErrorBox message={error}/>
    {diagram ? <RelationshipDiagramCanvas diagram={diagram} localDatabase={database} exportDisabled={busy} exportCurrent={current} onDesign={table => {
      if (!reading.current && latest.current()) onDesign(table);
    }} designDisabled={busy}/> : !tables.length && <p>{text.noTables}</p>}
  </section>;
}
