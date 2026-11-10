import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { QueryResult } from '../../shared/contracts';
import { queryResultNavigatorZh as text } from '../locales/queryResultNavigator.zh-CN';
import { appModalSelector } from '../modalSelectors';
import { useWorkspace } from '../store';
import { Modal } from './ui';
import '../openTabSearch.css';

interface Props {
  tabId: string;
  results: readonly QueryResult[];
  names: readonly (string | undefined)[];
  selected?: number;
  disabled: boolean;
  isCurrent(): boolean;
  onSelect(index: number): void;
}

const pageSize = 40;

/** 导航只持有本次返回的结果标识，选中后走查询页原有的结果切换。 */
export function QueryResultNavigator(props: Props) {
  const { tabId, results, disabled, isCurrent } = props;
  const latest = useRef(props);
  latest.current = props;
  const [owner, setOwner] = useState<{ results: readonly QueryResult[]; current(): boolean }>();
  const opened = owner?.results === results && !disabled;
  useLayoutEffect(() => {
    if (owner && !opened) setOwner(undefined);
  }, [owner, opened]);
  useLayoutEffect(() => {
    if (opened) return useWorkspace.subscribe(() => {
      if (!owner.current()) setOwner(undefined);
    });
  }, [owner, opened]);

  function open() {
    if (disabled || !isCurrent() || document.querySelector(appModalSelector)) return;
    const workspace = useWorkspace.getState();
    const tab = workspace.settings.tabs.find(item => item.id === tabId);
    if (!tab || workspace.settings.activeTabId !== tabId) return;
    const version = workspace.connectionVersions[tab.connectionId];
    setOwner({ results, current() {
      const state = useWorkspace.getState();
      return state.settings.activeTabId === tabId && state.settings.tabs.find(item => item.id === tabId) === tab &&
        state.connectionVersions[tab.connectionId] === version && !state.activeJobs[tabId];
    } });
  }

  function select(index: number) {
    if (!owner || !opened || !owner.current() || !results[index]) return;
    // 现有结果入口要求没有模态窗口。关闭后再核对查询归属和结果引用。
    flushSync(() => setOwner(undefined));
    const current = latest.current;
    if (owner.current() && current.results === owner.results && !current.disabled && current.isCurrent())
      current.onSelect(index);
  }

  return <>
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={opened} onClick={open}>{text.open}</button>
    {opened && createPortal(<ResultList results={results} names={props.names} selected={props.selected}
      onSelect={select} onClose={() => setOwner(undefined)}/>, document.body)}
  </>;
}

function ResultList({ results, names, selected, onSelect, onClose }: Pick<Props, 'results' | 'names' | 'selected' | 'onSelect'> & { onClose(): void }) {
  const [query, setQuery] = useState(''), [position, setPosition] = useState(selected ?? 0);
  const input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null), listId = useId();
  const composing = useRef(false);
  const matches = useMemo(() => {
    const value = query.trim().toLowerCase();
    const ordinal = Number(/^#?(\d+)$/.exec(value)?.[1]);
    const ordinalOnly = value.startsWith('#') && Number.isFinite(ordinal);
    return results.flatMap((result, index) => {
      const matchesText = () => names[index]?.toLowerCase().includes(value) ||
        result.postgresCommand?.toLowerCase().includes(value) ||
        result.columns.some(column => column.name.toLowerCase().includes(value));
      return (!value || index + 1 === ordinal || (!ordinalOnly && matchesText())) ? [index] : [];
    });
  }, [query, results, names]);
  const current = Math.min(position, Math.max(matches.length - 1, 0));
  const page = Math.floor(current / pageSize);
  const pageCount = Math.ceil(matches.length / pageSize);
  const index = matches[current];
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest' }); }, [index]);

  function activate(resultIndex: number) {
    const dialog = input.current?.closest(appModalSelector);
    const surfaces = document.querySelectorAll(appModalSelector);
    if (!composing.current && dialog && surfaces[surfaces.length - 1] === dialog) onSelect(resultIndex);
  }

  return <Modal title={text.open} onClose={onClose} initialFocus={input}>
    <div className="open-tab-search">
      <input ref={input} className="open-tab-search-input" role="combobox" aria-label={text.input} placeholder={text.placeholder}
        aria-controls={listId} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={index === undefined ? undefined : `${listId}-${index}`}
        maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPosition(0); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 ||
              event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || index === undefined) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPosition(Math.max(0, Math.min(current + (event.key === 'ArrowDown' ? 1 : -1), matches.length - 1)));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (!event.repeat) activate(index);
          }
        }}/>
      <p role="status">{text.count(matches.length, results.length)}</p>
      <div id={listId} className="open-tab-search-list" role="listbox" aria-label={text.list}>
        {matches.slice(page * pageSize, (page + 1) * pageSize).map(resultIndex => {
          const result = results[resultIndex], name = names[resultIndex];
          return <button key={resultIndex} ref={resultIndex === index ? active : undefined} id={`${listId}-${resultIndex}`}
            type="button" role="option" aria-selected={resultIndex === index} tabIndex={-1} className="open-tab-search-option"
            onMouseDown={event => event.preventDefault()} onClick={() => activate(resultIndex)}>
            <span className="open-tab-search-heading"><strong>{text.result(resultIndex + 1)}{name && ` · ${name}`}</strong></span>
            <span className="open-tab-search-meta">{[
              result.columns.length ? text.rows(result.rows.length) : result.postgresCommand ?? text.status,
              result.affectedRows !== undefined && text.affected(result.affectedRows),
              result.truncated && text.truncated,
              resultIndex === selected && text.current,
            ].filter(Boolean).join(' · ')}</span>
          </button>;
        })}
      </div>
      {!matches.length && <p>{text.empty}</p>}
      {pageCount > 1 && <div className="open-tab-search-options">
        <button type="button" disabled={page === 0} onClick={() => setPosition((page - 1) * pageSize)}>{text.previous}</button>
        <span>{text.page(page + 1, pageCount)}</span>
        <button type="button" disabled={page + 1 === pageCount} onClick={() => setPosition((page + 1) * pageSize)}>{text.next}</button>
      </div>}
    </div>
    <footer className="modal-footer"><button type="button" onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
