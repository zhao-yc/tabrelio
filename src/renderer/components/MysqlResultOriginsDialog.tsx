import { useEffect, useRef, useState } from 'react';
import type { QueryResult } from '../../shared/contracts';
import type { MysqlResultColumnOrigin } from '../../shared/mysqlResultOrigins';
import { errorMessage, invoke, uid } from '../lib';
import { mysqlResultOriginsZh as text } from '../locales/mysqlResultOrigins.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import { QueryResultOriginsTable } from './QueryResultOriginsTable';

/** 同时只核对一个目标，关闭时等待准确任务和取消回执，迟到结果不能打开标签。 */
export function MysqlResultOriginsDialog({ result, origins, resolve, onClose, onOpen }: {
  result: QueryResult;
  origins: MysqlResultColumnOrigin[];
  resolve(index: number, taskId: string): Promise<{ database: string; table: string }>;
  onClose(): void;
  onOpen(target: { database: string; table: string }): void;
}) {
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ id: string; done: Promise<void> } | undefined>(undefined), alive = useRef(false), closingRef = useRef(false);
  const cancel = (taskId: string) => invoke('query.cancel', { taskId });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (pending.current && !closingRef.current) void cancel(pending.current.id).catch(() => {});
    };
  }, []);

  function open(index: number): void {
    if (pending.current || closingRef.current || origins[index]?.scope !== 'catalog') return;
    const id = uid();
    setBusy(true);
    setError('');
    const done = Promise.resolve().then(() => {
      if (alive.current && !closingRef.current) return resolve(index, id);
    }).then(target => {
      if (target && alive.current && !closingRef.current) onOpen(target);
    }).catch(reason => {
      if (alive.current && !closingRef.current) setError(errorMessage(reason));
    }).finally(() => {
      pending.current = undefined;
      if (alive.current) setBusy(false);
    });
    pending.current = { id, done };
  }

  async function close(): Promise<void> {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const task = pending.current;
    if (task) {
      const [ack] = await Promise.allSettled([cancel(task.id), task.done]);
      if (ack.status === 'rejected' && alive.current) {
        closingRef.current = false; setClosing(false); setError(errorMessage(ack.reason)); return;
      }
    }
    if (alive.current) onClose();
  }

  return <Modal title={text.title} onClose={() => void close()} wide>
    <div className="modal-content">
      <p>{text.hint}</p><ErrorBox message={error}/>{busy && <Spinner text={text.loading}/>}
      <QueryResultOriginsTable result={result} origins={origins} labels={text} action={index => {
        const origin = origins[index];
        return origin?.scope === 'catalog' ? <button type="button" disabled={busy || closing}
          aria-label={text.openLabel(origin.table, index + 1)} onClick={() => open(index)}>{text.openObject}</button>
          : origin && <span>{origin.scope === 'temporary' ? text.temporary : text.unverified}</span>;
      }}/>
    </div>
    <footer className="modal-footer"><span className="grow"/><button type="button" disabled={closing} onClick={() => void close()}>{zh.common.close}</button></footer>
  </Modal>;
}
