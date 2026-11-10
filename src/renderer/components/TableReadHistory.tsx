import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableReadStatement } from '../../shared/tableReadStatements';
import type { TableWriteOutcome, TableWriteTrace } from '../../shared/tableWriteTrace';
import { tableReadHistoryZh as text } from '../locales/tableReadHistory.zh-CN';
import { Modal } from './ui';
import '../tableReadHistory.css';

type EntryContent =
  | { kind: 'read'; position: number; rows: number; statements: readonly TableReadStatement[] }
  | { kind: 'write'; outcome: TableWriteOutcome; statements: readonly TableReadStatement[]; omitted: number };
type Entry = EntryContent & {
  sequence: number;
  time: string;
};

/** 只在原标签内保留读取和提交历史，连接修订或目标变化后撤销旧回调并丢弃列表。 */
export function useTableReadHistory(scope: string) {
  const source = useMemo(() => ({ sequence: 0 }), [scope]);
  const owner = useRef<typeof source | undefined>(source);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    owner.current = source;
    setEntries([]);
    setOpen(false);
    return () => { if (owner.current === source) owner.current = undefined; };
  }, [source]);
  function append(content: EntryContent) {
    if (owner.current !== source) return;
    const entry = { ...content, sequence: ++source.sequence, time: new Date().toISOString() };
    setEntries(previous => owner.current === source ? [entry, ...previous].slice(0, 30) : previous);
  }
  function record(statements: readonly TableReadStatement[] | undefined, position: number, rows: number) {
    if (statements?.length) append({ kind: 'read', statements, position, rows });
  }
  function recordWrite(trace: TableWriteTrace | undefined, outcome: TableWriteOutcome) {
    if (trace?.statements.length) append({ kind: 'write', outcome, ...trace });
  }
  return { entries, open, setOpen, record, recordWrite };
}

export function TableReadHistory({ history }: { history: ReturnType<typeof useTableReadHistory> }) {
  if (!history.open) return null;
  return <Modal title={text.title} onClose={() => history.setOpen(false)} wide>
      <div className="modal-content dialog-body table-read-history">
        <p>{text.scope}</p>
        {history.entries.length === 0 && <p>{text.empty}</p>}
        {history.entries.map((entry, index) => <details key={entry.sequence} open={index === 0}>
          <summary><time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString('zh-CN')}</time> · {
            entry.kind === 'read' ? text.read(entry.position, entry.rows) : text.outcomes[entry.outcome]
          }</summary>
          {entry.kind === 'write' && entry.omitted > 0 && <p>{text.omitted(entry.omitted)}</p>}
          {entry.statements.map((statement, statementIndex) => <div key={statementIndex}>
            <pre>{statement.sql}</pre>
            {statement.clipped && <p>{text.clipped}</p>}
          </div>)}
        </details>)}
      </div>
      <footer className="modal-footer"><button type="button" onClick={() => history.setOpen(false)}>{text.close}</button></footer>
  </Modal>;
}
