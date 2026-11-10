import { useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { TableReadStatement } from '../../shared/tableReadStatements';
import type { TableWriteOutcome, TableWriteTrace } from '../../shared/tableWriteTrace';
import { tableReadHistoryZh as text } from '../locales/tableReadHistory.zh-CN';
import { navigationZh } from '../locales/navigation.zh-CN';
import '../tableReadHistory.css';

type EntryContent =
  | { kind: 'read'; position: number; rows: number; statements: readonly TableReadStatement[] }
  | { kind: 'read-failed'; statements: readonly TableReadStatement[] }
  | { kind: 'write'; outcome: TableWriteOutcome; statements: readonly TableReadStatement[]; omitted: number };
type Entry = EntryContent & {
  sequence: number;
  time: string;
};

/** 只在原标签内保留读取和提交历史，连接修订或目标变化后撤销旧回调并丢弃列表。 */
export function useTableReadHistory(scope: string) {
  const id = useId();
  const source = useMemo(() => ({ sequence: 0 }), [scope]);
  const owner = useRef<typeof source | undefined>(source);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const focusFromMenu = useRef(false);
  useLayoutEffect(() => {
    owner.current = source;
    setEntries([]);
    setOpen(false);
    focusFromMenu.current = false;
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
  function recordReadFailure(statements: readonly TableReadStatement[]) {
    if (statements.length) append({ kind: 'read-failed', statements });
  }
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    focusFromMenu.current = !open && event.currentTarget.getAttribute('role') === 'menuitem';
    setOpen(!open);
  }
  const toggleProps = { 'aria-controls': id, 'aria-expanded': open, className: open ? 'selected' : undefined, onClick: toggle };
  return { id, entries, open, toggleProps, close: () => setOpen(false), focusFromMenu, record, recordReadFailure, recordWrite };
}

export function TableReadHistory({ history }: { history: ReturnType<typeof useTableReadHistory> }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (history.open && history.focusFromMenu.current) {
      history.focusFromMenu.current = false;
      closeButton.current?.focus();
    }
  }, [history.open, history.focusFromMenu]);
  /** 关闭只归还当前表页的入口焦点。窄窗中优先返回承载入口的「更多」。 */
  function close() {
    const tab = closeButton.current?.closest('.workspace-tab');
    const button = tab?.querySelector<HTMLButtonElement>(`button[aria-controls="${history.id}"]:not(:disabled)`);
    const more = [...(tab?.querySelectorAll<HTMLButtonElement>('.action-menu-trigger:not(:disabled)') ?? [])]
      .find(trigger => trigger.getAttribute('aria-label') === navigationZh.more);
    history.close();
    (button ?? more)?.focus({ preventScroll: true });
  }
  return <section id={history.id} className="table-read-history" aria-label={text.title} hidden={!history.open}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
    {history.open && <>
      <header className="table-read-history-header">
        <h2>{text.title}</h2>
        <span className="table-read-history-count">{text.count(history.entries.length)}</span>
        <button type="button" ref={closeButton} onClick={close}>{text.close}</button>
      </header>
      <HistoryEntries entries={history.entries}/>
    </>}
  </section>;
}

function HistoryEntries({ entries }: { entries: Entry[] }) {
  // 默认跟随最新一条。用户展开或折叠后，在本次查看中尊重选择，翻页不打断查阅。
  const [selection, setSelection] = useState<number | null>();
  const expanded = selection === null || entries.some(entry => entry.sequence === selection) ? selection : entries[0]?.sequence;
  return <div className="table-read-history-entries">
    <p>{text.scope}</p>
    {entries.length === 0 && <p>{text.empty}</p>}
    {entries.map(entry => {
      const open = entry.sequence === expanded;
      return <details key={entry.sequence} open={open}>
          <summary onClick={event => { event.preventDefault(); setSelection(open ? null : entry.sequence); }}>
            <time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString('zh-CN')}</time> · {
            entry.kind === 'read' ? text.read(entry.position, entry.rows) :
              entry.kind === 'read-failed' ? text.readFailed : text.outcomes[entry.outcome]
          }</summary>
          {open && <>
            {entry.kind === 'write' && entry.omitted > 0 && <p>{text.omitted(entry.omitted)}</p>}
            {entry.statements.map((statement, statementIndex) => <div key={statementIndex}>
              <pre>{statement.sql}</pre>
              {statement.clipped && <p>{text.clipped}</p>}
            </div>)}
          </>}
      </details>;
    })}
  </div>;
}
