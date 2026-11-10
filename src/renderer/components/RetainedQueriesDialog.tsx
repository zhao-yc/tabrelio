import { useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import type { RetainedQuery } from '../recentClosedQueries';
import { queryCloseZh as text } from '../locales/queryClose.zh-CN';
import { queryContextZh } from '../locales/queryContext.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal } from './ui';
import '../openTabSearch.css';

/** 预览固定长度的内存副本，打开仍由工作台核对原条目和连接身份。 */
export function RetainedQueriesDialog({ ownerId, entries, connections, atCapacity, onOpen, onClose }: {
  ownerId: string; entries: readonly RetainedQuery[]; connections: readonly ConnectionProfile[]; atCapacity: boolean;
  onOpen(entry: RetainedQuery): boolean; onClose(): void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  return <Modal title={text.retainedTitle} onClose={onClose} initialFocus={atCapacity ? undefined : first}>
    <div className="modal-content open-tab-search" data-retained-query-list={ownerId}>
      <p>{text.retainedHint}</p>
      {atCapacity && <p role="status">{text.retainedCapacity}</p>}
      {!entries.length && <p role="status">{text.retainedEmpty}</p>}
      <ErrorBox message={error}/>
      <ol className="open-tab-search-list retained-query-list">{entries.map(({ tabId, draft }, index) => {
        const entry = entries[index];
        const context = draft.databaseContext;
        const database = context ? context.state === 'known' ? context.database ?? queryContextZh.none : queryContextZh.unknown
          : draft.database ?? queryContextZh.legacy;
        const preview = draft.sql.slice(0, 160).replace(/[\uD800-\uDBFF]$/, '');
        return <li key={tabId}>
          <button ref={index === 0 ? first : undefined} type="button" className="open-tab-search-option" disabled={atCapacity}
            aria-label={text.retainedOpen(draft.title, index + 1)}
            onClick={() => { if (!onOpen(entry)) setError(text.retainedStale); }}>
            <span className="open-tab-search-heading"><strong>{draft.title}</strong></span>
            <span className="open-tab-search-meta">
              <span>{connections.find(connection => connection.id === draft.connectionId)?.name}</span><span>{database}</span>
            </span>
            <span className="retained-query-preview">{preview}{preview.length < draft.sql.length ? '…' : ''}</span>
          </button>
        </li>;
      })}</ol>
    </div>
    <footer className="modal-footer"><span className="grow"/><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
