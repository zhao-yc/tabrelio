import { useEffect, useRef, useState } from 'react';
import type { SqliteTablePage, SqliteTablePageInput } from '../../shared/sqliteTableBrowse';
import type { SqliteIncomingOutput } from '../../shared/sqliteIncoming';
import { errorMessage, invoke } from '../lib';
import { sqliteRelationZh as text } from '../locales/sqliteRelation.zh-CN';
import { captureSqliteReferenceSource } from '../sqliteReferenceSource';
import { SqliteRelationDialog } from './SqliteRelationDialog';
import { ErrorBox, Modal, Spinner } from './ui';

/** 原行定位使用独立只读任务，关闭加载窗口时等待该任务及取消确认。 */
export function SqliteQueryRelationDialog({ request, current, onClose, onOpen }: {
  request: SqliteTablePageInput; current(): boolean; onClose(): void; onOpen(output: SqliteIncomingOutput): boolean;
}) {
  const [root, setRoot] = useState<{ page: SqliteTablePage; capture: ReturnType<typeof captureSqliteReferenceSource> }>();
  const [error, setError] = useState(''), [closing, setClosing] = useState(false);
  const latest = useRef(current);
  latest.current = current;
  const work = useRef<Promise<void> | undefined>(undefined), stopping = useRef(false), alive = useRef(false);
  const cancel = () => invoke('query.cancel', { taskId: request.taskId });

  useEffect(() => {
    alive.current = true;
    const pending = (async () => {
      try {
        if (!latest.current()) throw Error(text.stale);
        const page = await invoke('sqlite.tablePage', request);
        if (!alive.current || stopping.current) return;
        if (!latest.current() || page.target.kind !== 'table' || page.target.table !== request.table ||
            page.result.rows.length !== 1 || page.edit) throw Error(text.stale);
        setRoot({ page, capture: captureSqliteReferenceSource(page, 0) });
      } catch (failure) {
        if (alive.current && !stopping.current) setError(errorMessage(failure));
      }
    })();
    work.current = pending;
    void pending.then(() => { if (work.current === pending) work.current = undefined; });
    return () => {
      alive.current = false;
      if (work.current && !stopping.current) void cancel().catch(() => {});
    };
  }, [request]);

  async function close(): Promise<void> {
    if (stopping.current) return;
    stopping.current = true;
    setClosing(true);
    try {
      const pending = work.current;
      if (pending) {
        const [ack] = await Promise.allSettled([cancel(), pending]);
        if (ack.status === 'rejected') throw ack.reason;
      }
      if (alive.current) onClose();
    } catch (failure) {
      if (alive.current) { stopping.current = false; setClosing(false); setError(errorMessage(failure)); }
    }
  }

  if (root) return <SqliteRelationDialog source={root.page} values={root.capture.values}
    current={() => root.capture.current() && latest.current()}
    onActivity={() => { /* 查询标签在原行加载和逐层读取期间一直持有同一个租约。 */ }}
    onOpen={onOpen} onClose={onClose} />;
  return <Modal title={text.title} wide onClose={() => void close()}>
    <div className="modal-content"><ErrorBox message={error}/>{!error && <Spinner text={text.queryLoading}/>}</div>
    <footer className="modal-footer"><button disabled={closing} onClick={() => void close()}>{text.close}</button></footer>
  </Modal>;
}
