import { useEffect, useRef, useState } from 'react';
import type { PostgresQueryRecordPageInput } from '../../shared/postgresQueryRecord';
import { errorMessage, invoke } from '../lib';
import { postgresReferencePickerZh as text } from '../locales/postgresReferencePicker.zh-CN';
import { useWorkspace } from '../store';
import { PostgresReferencePicker, type PostgresReferenceSource } from './PostgresReferencePicker';
import { ErrorBox, Modal } from './ui';

/** 原行定位回包只交给当前弹窗，迟到的令牌也必须释放。 */
export function PostgresQueryReferenceDialog({ request, direction, isCurrent, onClose }: {
  request: Extract<PostgresQueryRecordPageInput, { operation: 'reference' }>;
  direction: 'parent' | 'children';
  isCurrent(): boolean;
  onClose(): void;
}) {
  const latest = useRef(isCurrent);
  latest.current = isCurrent;
  const [source, setSource] = useState<PostgresReferenceSource>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let token: { table: string; pageToken: string } | undefined;
    const { connectionId, database, tabId } = request;
    const current = () => active && latest.current();
    const release = () => {
      if (token) void invoke('postgres.table.release', { connectionId, database, tabId, ...token }).catch(() => {});
      token = undefined;
    };
    void (async () => {
      try {
        if (!current()) return;
        const { table, page } = await invoke('postgres.queryRecordPage', request);
        if (!page.pageToken) throw Error(text.expired);
        token = { table, pageToken: page.pageToken };
        if (!current()) { release(); return; }
        setSource({ current, input: { connectionId, database, tabId, ...token,
          ...(direction === 'parent' ? { parentRow: 0 } : { childrenRow: 0 }) } });
      } catch (reason) { if (current()) setError(errorMessage(reason)); }
    })();
    return () => { active = false; release(); };
  }, [request, direction]);

  return <Modal title={direction === 'parent' ? text.browseTitle : text.childrenTitle} onClose={onClose} wide>
    <div className="modal-content">
      <ErrorBox message={error}/>
      {!source && !error && <p role="status">{text.queryLoading}</p>}
      {source && <PostgresReferencePicker source={source} onClose={onClose} queryResult onOpen={opened => {
        if (!source.current()) throw Error(text.relatedExpired);
        const workspace = useWorkspace.getState();
        if (workspace.settings.tabs.length >= 100) throw Error(text.relatedTabsFull);
        workspace.openTab({ id: opened.tabId, kind: 'table', title: text.relatedTitle(opened.table),
          connectionId: request.connectionId, database: request.database, table: opened.table });
      }}/>}
    </div>
  </Modal>;
}
