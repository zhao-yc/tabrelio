import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { QueryResult } from '../../shared/contracts';
import { queryResultNavigatorZh as text } from '../locales/queryResultNavigator.zh-CN';
import { appModalSelector } from '../modalSelectors';
import type { PinnedQueryResult } from '../queryPins';
import { useWorkspace } from '../store';
import { Modal } from './ui';
import '../openTabSearch.css';

interface Props {
  tabId: string;
  results: readonly QueryResult[];
  names: readonly (string | undefined)[];
  selected?: number;
  pins: readonly PinnedQueryResult[];
  selectedPin?: PinnedQueryResult;
  disabled: boolean;
  isCurrent(): boolean;
  onSelect(index: number): void;
  onSelectPin(pin: PinnedQueryResult): void;
}

type Entry = { kind: 'current'; index: number; name?: string; result: QueryResult } |
  { kind: 'pinned'; pin: PinnedQueryResult; name: string; result: QueryResult };
type Source = 'all' | Entry['kind'];

const pageSize = 40;

/** 导航绑定打开时的结果与固定列表，选中后走查询页原有的来源切换。 */
export function QueryResultNavigator(props: Props) {
  const { tabId, results, pins, disabled, isCurrent } = props;
  const latest = useRef(props);
  latest.current = props;
  const [owner, setOwner] = useState<{ results: readonly QueryResult[]; pins: readonly PinnedQueryResult[];
    current(): boolean; invalidate(): void }>();
  const opened = owner?.results === results && owner.pins === pins && !disabled;
  useLayoutEffect(() => {
    if (owner && !opened) setOwner(undefined);
  }, [owner, opened]);
  useLayoutEffect(() => {
    if (opened) return useWorkspace.subscribe(() => {
      if (!owner.current()) {
        owner.invalidate();
        setOwner(undefined);
      }
    });
  }, [owner, opened]);

  function open() {
    if (disabled || !isCurrent() || document.querySelector(appModalSelector)) return;
    const workspace = useWorkspace.getState();
    const tab = workspace.settings.tabs.find(item => item.id === tabId);
    if (!tab || workspace.settings.activeTabId !== tabId) return;
    const version = workspace.connectionVersions[tab.connectionId];
    let live = true;
    setOwner({ results, pins, invalidate() { live = false; }, current() {
      const state = useWorkspace.getState();
      return live && state.settings.activeTabId === tabId && state.settings.tabs.find(item => item.id === tabId) === tab &&
        state.connectionVersions[tab.connectionId] === version && !state.activeJobs[tabId];
    } });
  }

  function select(entry: Entry) {
    if (!owner || !opened || !owner.current()) return;
    // 关闭窗口后再核对查询归属和原列表，防止旧条目切到重跑后的同序号结果。
    flushSync(() => setOwner(undefined));
    const current = latest.current;
    if (!owner.current() || current.results !== owner.results || current.pins !== owner.pins ||
        current.disabled || !current.isCurrent()) return;
    if (entry.kind === 'current' && current.results[entry.index] === entry.result) current.onSelect(entry.index);
    if (entry.kind === 'pinned' && current.pins.includes(entry.pin)) current.onSelectPin(entry.pin);
  }

  return <>
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={opened} onClick={open}>{text.open}</button>
    {opened && createPortal(<ResultList results={results} names={props.names} selected={props.selected} pins={pins} selectedPin={props.selectedPin}
      onSelect={select} onClose={() => setOwner(undefined)}/>, document.body)}
  </>;
}

function ResultList({ results, names, selected, pins, selectedPin, onSelect, onClose }:
  Pick<Props, 'results' | 'names' | 'selected' | 'pins' | 'selectedPin'> & { onSelect(entry: Entry): void; onClose(): void }) {
  const [query, setQuery] = useState(''), [source, setSource] = useState<Source>('all');
  const [position, setPosition] = useState(() => {
    if (selectedPin) return Math.max(0, pins.indexOf(selectedPin));
    return selected === undefined ? 0 : pins.length + selected;
  });
  const input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null), listId = useId();
  const composing = useRef(false);
  const entries = useMemo<Entry[]>(() => [
    ...pins.map((pin): Entry => ({ kind: 'pinned', pin, name: pin.label, result: pin.result })),
    ...results.map((result, index): Entry => ({ kind: 'current', index, name: names[index], result })),
  ], [results, names, pins]);
  const matches = useMemo(() => {
    const value = query.trim().toLowerCase();
    const ordinal = Number(/^#?(\d+)$/.exec(value)?.[1]);
    const ordinalOnly = value.startsWith('#') && Number.isFinite(ordinal);
    return entries.filter(entry => {
      if (source !== 'all' && source !== entry.kind) return false;
      if (!value || entry.kind === 'current' && entry.index + 1 === ordinal) return true;
      const { result, name } = entry;
      return !ordinalOnly && (name?.toLowerCase().includes(value) || result.postgresCommand?.toLowerCase().includes(value) ||
        result.statement.toLowerCase().includes(value) || result.columns.some(column => column.name.toLowerCase().includes(value)));
    });
  }, [entries, query, source]);
  const current = Math.min(position, Math.max(matches.length - 1, 0));
  const page = Math.floor(current / pageSize);
  const pageCount = Math.ceil(matches.length / pageSize);
  const entry = matches[current];
  const optionId = (item: Entry) => `${listId}-${item.kind === 'pinned' ? 'pin-' + item.pin.id : item.index}`;
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest' }); }, [entry]);

  function activate(item: Entry) {
    const dialog = input.current?.closest(appModalSelector);
    const surfaces = document.querySelectorAll(appModalSelector);
    if (!composing.current && dialog && surfaces[surfaces.length - 1] === dialog) onSelect(item);
  }

  return <Modal title={text.open} onClose={onClose} initialFocus={input}>
    <div className="open-tab-search">
      <input ref={input} className="open-tab-search-input" role="combobox" aria-label={text.input} placeholder={text.placeholder}
        aria-controls={listId} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={entry ? optionId(entry) : undefined}
        maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPosition(0); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 ||
              event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !entry) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPosition(Math.max(0, Math.min(current + (event.key === 'ArrowDown' ? 1 : -1), matches.length - 1)));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (!event.repeat) activate(entry);
          }
        }}/>
      {pins.length > 0 && results.length > 0 && <div className="open-tab-search-sort" role="group" aria-label={text.source}>
        {(['all', 'current', 'pinned'] as const).map(kind => <button key={kind} type="button" aria-pressed={source === kind}
          onClick={() => { setSource(kind); setPosition(0); input.current?.focus(); }}>{text.sources[kind]}</button>)}
      </div>}
      <p role="status">{text.count(matches.length, entries.length)}</p>
      <p className="muted small">{text.receiptHint}</p>
      <div id={listId} className="open-tab-search-list" role="listbox" aria-label={text.list}>
        {matches.slice(page * pageSize, (page + 1) * pageSize).map(item => {
          const { result, name } = item, id = optionId(item);
          const label = item.kind === 'pinned' ? item.pin.label : [text.result(item.index + 1), name].filter(Boolean).join(' · ');
          const selectedItem = item.kind === 'pinned' ? item.pin === selectedPin : !selectedPin && item.index === selected;
          // 摘要仅取有界回执前缀，不访问编辑器原文，且不截断UTF-16代理对。
          const preview = result.statement.slice(0, 200).replace(/[\uD800-\uDBFF]$/, '').replace(/\s+/g, ' ').trim();
          return <button key={id} ref={item === entry ? active : undefined} id={id}
            type="button" role="option" aria-selected={item === entry} tabIndex={-1} className="open-tab-search-option"
            onMouseDown={event => event.preventDefault()} onClick={() => activate(item)}>
            <span className="open-tab-search-heading"><strong>{label}</strong></span>
            <span className="open-tab-search-meta">{[
              item.kind === 'pinned' && text.sources.pinned,
              result.columns.length ? text.rows(result.rows.length) : result.postgresCommand ?? text.status,
              result.affectedRows !== undefined && text.affected(result.affectedRows),
              result.truncated && text.truncated,
              selectedItem && text.current,
            ].filter(Boolean).join(' · ')}</span>
            {preview && <code className="query-result-navigator-sql">{preview}{result.statement.length > 200 ? '…' : ''}</code>}
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
