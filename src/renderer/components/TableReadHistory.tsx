import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableReadStatement } from '../../shared/tableReadStatements';
import { tableReadHistoryZh as text } from '../locales/tableReadHistory.zh-CN';
import { Modal } from './ui';
import '../tableReadHistory.css';

interface Entry {
  sequence: number;
  time: string;
  position: number;
  rows: number;
  statements: readonly TableReadStatement[];
}

/** 只在原标签内保留成功交付的读取，连接修订或目标变化后撤销旧回调并丢弃列表。 */
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
  function record(statements: readonly TableReadStatement[] | undefined, position: number, rows: number) {
    if (!statements?.length || owner.current !== source) return;
    const entry = { sequence: ++source.sequence, time: new Date().toISOString(), position, rows, statements };
    setEntries(previous => owner.current === source ? [entry, ...previous].slice(0, 30) : previous);
  }
  return { entries, open, setOpen, record };
}

export function TableReadHistory({ history }: { history: ReturnType<typeof useTableReadHistory> }) {
  if (!history.open) return null;
  return <Modal title={text.title} onClose={() => history.setOpen(false)} wide>
      <div className="modal-content dialog-body table-read-history">
        <p>{text.scope}</p>
        {history.entries.length === 0 && <p>{text.empty}</p>}
        {history.entries.map((entry, index) => <details key={entry.sequence} open={index === 0}>
          <summary><time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString('zh-CN')}</time> · {text.read(entry.position, entry.rows)}</summary>
          {entry.statements.map((statement, statementIndex) => <div key={statementIndex}>
            <pre>{statement.sql}</pre>
            {statement.clipped && <p>{text.clipped}</p>}
          </div>)}
        </details>)}
      </div>
      <footer className="modal-footer"><button type="button" onClick={() => history.setOpen(false)}>{text.close}</button></footer>
  </Modal>;
}
