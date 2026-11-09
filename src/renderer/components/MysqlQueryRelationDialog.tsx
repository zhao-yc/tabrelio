import { useEffect, useRef, useState } from 'react';
import type { CommandMap } from '../../shared/contracts';
import { ChildReferenceIntent } from '../childReferenceIntent';
import { errorMessage, invoke } from '../lib';
import { mysqlQueryRelationZh as text } from '../locales/mysqlQueryRelation.zh-CN';
import { zh } from '../locales/zh-CN';
import { ChildReferenceDialog } from './ChildReferenceDialog';
import { ForeignKeyDialog } from './ForeignKeyDialog';
import { ErrorBox, Modal, Spinner } from './ui';

type Input = CommandMap['mysql.queryRelation']['input'];
type Output = CommandMap['mysql.queryRelation']['output'];

/** 关联窗口使用已核验的整行快照，原标签租约保持到所有实际读取结束。 */
export function MysqlQueryRelationDialog({ request, direction, current, onClose }: {
  request: Input; direction: 'parent' | 'children'; current(): boolean; onClose(): void;
}) {
  const latest = useRef(current);
  latest.current = current;
  const alive = useRef(false), closing = useRef(false), reads = useRef(0);
  const work = useRef<Promise<void> | undefined>(undefined);
  const [root, setRoot] = useState<{ data: Output; base: { connectionId: string; database: string; table: string }; child: ChildReferenceIntent }>();
  const [error, setError] = useState(''), [waiting, setWaiting] = useState(false);
  const cancel = () => invoke('query.cancel', { taskId: request.taskId });

  useEffect(() => {
    alive.current = true;
    const pending = (async () => {
      try {
        if (!latest.current()) throw Error(text.stale);
        const data = await invoke('mysql.queryRelation', request);
        if (!alive.current || closing.current) return;
        if (!latest.current()) throw Error(text.stale);
        const { info, row } = data;
        const base = { connectionId: request.connectionId, database: info.database, table: info.name };
        setRoot({ data, base, child: new ChildReferenceIntent(info, request.taskId, row, [], () => alive.current && !closing.current && latest.current()) });
      } catch (failure) { if (alive.current && !closing.current) setError(errorMessage(failure)); }
    })();
    work.current = pending;
    void pending.then(() => { if (work.current === pending) work.current = undefined; });
    return () => { alive.current = false; if (work.current && !closing.current) void cancel().catch(() => {}); };
  }, [request]);

  const activity = (delta: 1 | -1) => {
    reads.current += delta;
    if (alive.current && closing.current && reads.current === 0) onClose();
  };
  async function close(): Promise<void> {
    if (closing.current) return;
    closing.current = true;
    setWaiting(true);
    const pending = work.current;
    if (pending) {
      const [ack] = await Promise.allSettled([cancel(), pending]);
      if (ack.status === 'rejected') {
        if (alive.current) { closing.current = false; setWaiting(false); setError(errorMessage(ack.reason)); }
        return;
      }
    }
    if (alive.current && reads.current === 0) onClose();
  }

  if (root && !waiting && current()) {
    if (direction === 'children') return <ChildReferenceDialog base={root.base} intent={root.child} onActivity={activity} onClose={() => void close()} />;
    const { info, row } = root.data, key = info.foreignKeys[0];
    if (key) return <ForeignKeyDialog base={root.base} keys={info.foreignKeys} mode="browse"
      snapshot={{ rowId: request.taskId, data: row, source: info, foreignKey: key, generation: 0 }}
      onApply={() => { /* 查询入口仅使用浏览模式。 */ }} onClose={() => void close()} onActivity={activity} />;
  }
  const message = error || (!current() ? text.stale : root && !waiting ? text.empty : '');
  return <Modal title={text[direction]} wide onClose={() => void close()}>
    <div className="modal-content"><ErrorBox message={message}/>{!message && <Spinner text={text.loading}/>}</div>
    <footer className="modal-footer"><button disabled={waiting} onClick={() => void close()}>{zh.common.close}</button></footer>
  </Modal>;
}
