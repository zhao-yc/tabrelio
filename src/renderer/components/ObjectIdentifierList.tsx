import { useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Search } from 'lucide-react';
import { writeTableClipboardEvent } from '../gridClipboard';
import { errorMessage, kindLabels } from '../lib';
import { objectInformationZh as text } from '../locales/objectInformation.zh-CN';
import { sidebarContextMenuZh } from '../locales/sidebarContextMenu.zh-CN';
import { appModalSelector } from '../modalSelectors';
import type { IdentifierEntry } from '../objectIdentifiers';
import { useWorkspace } from '../store';
import type { OpenWorkbenchTarget } from '../workbenchNavigation';
import { tableElementsZh } from '../locales/tableElements.zh-CN';

const pageSize = 50;

/** 搜索和翻页只整理原目录。操作继续绑定原目录和实际按钮，隐藏的旧命中不能延迟打开标签。 */
export function ObjectIdentifierList({ entries, fields, current, onOpen }: {
  entries: readonly IdentifierEntry[]; fields: boolean; current(): boolean; onOpen: OpenWorkbenchTarget;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const needle = search.trim().toLowerCase();
  const matches = useMemo(() => needle ? entries.filter(entry => entry.name.toLowerCase().includes(needle) ||
    entry.sql?.toLowerCase().includes(needle)) : entries, [entries, needle]);
  const from = page * pageSize, to = Math.min(from + pageSize, matches.length);
  const searchLabel = fields ? text.searchFieldIdentifiers : text.searchRelationIdentifiers;
  const operationCurrent = (button: HTMLButtonElement) => () => button.isConnected && current() && !document.querySelector(appModalSelector);
  const notify = (message: string, failure = false) => useWorkspace.getState().notify(message, failure);

  function changePage(next: number) {
    setPage(next);
    if (list.current) list.current.scrollTop = 0;
  }
  function copy(sql: string, button: HTMLButtonElement) {
    const isCurrent = operationCurrent(button);
    if (!isCurrent()) return;
    try {
      writeTableClipboardEvent(isCurrent, data => data.setData('text/plain', sql));
      notify(sidebarContextMenuZh.copied);
    } catch (reason) { if (isCurrent()) notify(errorMessage(reason), true); }
  }

  return <section className="object-info-identifiers" aria-label={text.identifiers}>
    <label className="object-info-identifier-search"><Search size={14} aria-hidden="true"/>
      <input type="search" value={search} placeholder={searchLabel} aria-label={searchLabel} onChange={event => {
        setSearch(event.target.value);
        changePage(0);
      }}/>
    </label>
    {matches.length ? <>
      <ul ref={list} aria-label={fields ? text.fieldIdentifiers : text.relationIdentifiers}>
        {matches.slice(from, to).map(entry => {
          const relation = 'relation' in entry ? entry.relation : undefined;
          const sql = entry.sql;
          const detail = 'type' in entry ? entry.type || tableElementsZh.noDeclaredType : kindLabels[entry.relation.kind];
          return <li key={JSON.stringify([relation?.kind, entry.name])}>
            <div className="object-info-identifier-name"><strong>{entry.name}</strong><span>{detail}</span></div>
            {relation && <button type="button" className="icon-button" aria-label={text.openIdentifier(entry.name)} title={text.openIdentifier(entry.name)}
              onClick={event => {
                const isCurrent = operationCurrent(event.currentTarget);
                if (isCurrent()) void onOpen(relation, { isCurrent }).catch(reason => { if (isCurrent()) notify(errorMessage(reason), true); });
              }}><ExternalLink size={14}/></button>}
            {sql && <button type="button" className="icon-button" aria-label={text.copyIdentifier(entry.name)} title={text.copyIdentifier(entry.name)}
              onClick={event => copy(sql, event.currentTarget)}><Copy size={14}/></button>}
          </li>;
        })}
      </ul>
      <footer>
        <span role="status">{text.identifierRange(from + 1, to, matches.length)}</span>
        {matches.length > pageSize && <div className="object-info-dependency-pages">
          <button type="button" disabled={page === 0} onClick={() => changePage(page - 1)}>{text.previousIdentifiers}</button>
          <button type="button" disabled={to >= matches.length} onClick={() => changePage(page + 1)}>{text.nextIdentifiers}</button>
        </div>}
      </footer>
    </> : <p role="status">{needle ? text.noMatchingIdentifiers : text.noIdentifiers}</p>}
  </section>;
}
