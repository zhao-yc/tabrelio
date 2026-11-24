import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { QueryResult } from '../../shared/contracts';
import type { QueryFailure } from '../../shared/queryFailure';
import { truncateQueryScriptMessage } from '../../shared/queryContinueOnError';
import { queryPinsZh } from '../locales/queryPins.zh-CN';
import { queryResultNavigatorZh as text } from '../locales/queryResultNavigator.zh-CN';
import { queryDuplicateZh as draftText } from '../locales/queryDuplicate.zh-CN';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import type { PinnedQueryResult } from '../queryPins';
import { useWorkspace } from '../store';
import { ErrorBox, Modal } from './ui';
import { errorMessage } from '../lib';
import { copyQuerySourceSql } from '../querySourceClipboard';
import '../openTabSearch.css';

interface ExecutionErrors {
  failures: readonly QueryFailure[];
  canLocateFailure(failure: QueryFailure): boolean;
  locate(failure: QueryFailure, target: 'best'): void;
}

export interface QueryResultNavigatorControl { openReceipts(): void; }

interface Props {
  control?: Ref<QueryResultNavigatorControl>;
  tabId: string;
  results: readonly QueryResult[];
  names: readonly (string | undefined)[];
  statementOrdinals?: readonly (number | undefined)[];
  executionErrors: ExecutionErrors;
  statementSource?: {
    canRead(entry: CurrentEntry): boolean;
    read(entry: CurrentEntry): string | undefined;
    open?(entry: CurrentEntry): void;
  };
  selected?: number;
  pins: readonly PinnedQueryResult[];
  selectedPin?: PinnedQueryResult;
  disabled: boolean;
  isCurrent(): boolean;
  onSelect(index: number): void;
  onSelectPin(pin: PinnedQueryResult): void;
}

type CurrentEntry = { kind: 'current'; index: number; name?: string; statementOrdinal?: number; result: QueryResult } |
  { kind: 'failure'; index: number; statementOrdinal: number; failure: QueryFailure; message: string };
type Entry = CurrentEntry | { kind: 'pinned'; pin: PinnedQueryResult; name: string; result: QueryResult };
type Source = 'all' | 'current' | 'pinned';

const pageSize = 40;

/** 导航绑定打开时的结果与固定列表，选中后走查询页原有的来源切换。 */
export function QueryResultNavigator(props: Props) {
  const { tabId, results, pins, executionErrors, disabled, isCurrent, control } = props;
  const { failures } = executionErrors;
  const latest = useRef(props);
  latest.current = props;
  const [owner, setOwner] = useState<{ results: readonly QueryResult[]; pins: readonly PinnedQueryResult[];
    failures: readonly QueryFailure[]; includeFailures: boolean;
    current(): boolean; invalidate(): void }>();
  const opened = owner?.results === results && owner.pins === pins && owner.failures === failures && !disabled;
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

  function open(includeFailures: boolean) {
    if (disabled || !isCurrent() || document.querySelector(appModalSelector)) return;
    const workspace = useWorkspace.getState();
    const tab = workspace.settings.tabs.find(item => item.id === tabId);
    if (!tab || workspace.settings.activeTabId !== tabId) return;
    const version = workspace.connectionVersions[tab.connectionId];
    let live = true;
    setOwner({ results, pins, failures, includeFailures, invalidate() { live = false; }, current() {
      const state = useWorkspace.getState();
      return live && state.settings.activeTabId === tabId && state.settings.tabs.find(item => item.id === tabId) === tab &&
        state.connectionVersions[tab.connectionId] === version && !state.activeJobs[tabId];
    } });
  }
  // 菜单和快捷键从同一入口进入，复用当前标签、模态和回执的检查。
  useImperativeHandle(control, () => ({ openReceipts: () => open(true) }));

  function activateEntry(entry: Entry, action: 'navigate' | 'draft') {
    if (!owner || !opened || !owner.current()) return;
    if (action === 'draft' ? entry.kind === 'pinned' || !props.statementSource?.open || !props.statementSource.canRead(entry)
      : entry.kind === 'failure' && !executionErrors.canLocateFailure(entry.failure)) return;
    // 关闭窗口后再核对查询归属和原列表，防止旧条目切到重跑后的同序号结果。
    flushSync(() => setOwner(undefined));
    const current = latest.current;
    if (!owner.current() || current.results !== owner.results || current.pins !== owner.pins || current.executionErrors.failures !== owner.failures ||
        current.disabled || !current.isCurrent()) return;
    if (entry.kind === 'current' && current.results[entry.index] !== entry.result ||
        entry.kind === 'failure' && owner.failures[entry.index] !== entry.failure) return;
    if (action === 'draft') {
      if (entry.kind !== 'pinned' && current.statementSource?.canRead(entry)) current.statementSource.open?.(entry);
      return;
    }
    if (entry.kind === 'current') current.onSelect(entry.index);
    if (entry.kind === 'pinned' && current.pins.includes(entry.pin)) current.onSelectPin(entry.pin);
    if (entry.kind === 'failure' && current.executionErrors.canLocateFailure(entry.failure)) {
      current.executionErrors.locate(entry.failure, 'best');
    }
  }

  /** 导航窗口保持打开，读范围和写剪贴板时分别复核条目仍属于本次执行。 */
  function copyEntry(entry: CurrentEntry, dialogCurrent: () => boolean) {
    const current = () => {
      const props = latest.current;
      return dialogCurrent() && !!owner && opened && owner.current() && !props.disabled &&
        props.results === owner.results && props.pins === owner.pins && props.executionErrors.failures === owner.failures &&
        (entry.kind === 'current' ? props.results[entry.index] === entry.result : props.executionErrors.failures[entry.index] === entry.failure) &&
        props.statementSource?.canRead(entry) === true;
    };
    if (!current()) throw Error(text.originalUnavailable);
    const source = latest.current.statementSource?.read(entry);
    if (source === undefined) throw Error(text.originalUnavailable);
    copyQuerySourceSql(source, current);
  }

  return <>
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={opened} onClick={() => open(false)}>{text.open}</button>
    {opened && createPortal(<ResultList results={results} names={props.names} statementOrdinals={props.statementOrdinals}
      executionErrors={executionErrors} statementSource={props.statementSource} selected={props.selected} pins={pins} selectedPin={props.selectedPin}
      startWithFailures={owner.includeFailures} onActivate={activateEntry} onCopy={copyEntry} onClose={() => setOwner(undefined)}/>, document.body)}
  </>;
}

function ResultList({ results, names, statementOrdinals, executionErrors, statementSource, selected, pins, selectedPin, startWithFailures, onActivate, onCopy, onClose }:
  Pick<Props, 'results' | 'names' | 'statementOrdinals' | 'executionErrors' | 'statementSource' | 'selected' | 'pins' | 'selectedPin'> & {
    startWithFailures: boolean; onActivate(entry: Entry, action: 'navigate' | 'draft'): void;
    onCopy(entry: CurrentEntry, current: () => boolean): void; onClose(): void;
  }) {
  const { failures } = executionErrors;
  const [query, setQuery] = useState(''), [source, setSource] = useState<Source>('all');
  const [includeFailures, setIncludeFailures] = useState(failures.length > 0 && (startWithFailures || !results.length && !pins.length));
  const input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null), listId = useId();
  const composing = useRef(false);
  const entries = useMemo<Entry[]>(() => {
    const current = results.map((result, index): CurrentEntry => {
      // 来源必须与完整结果列表逐项对齐。缺失的语句序号不能由结果序号补造。
      const ordinal = statementOrdinals?.length === results.length ? statementOrdinals[index] : undefined;
      return { kind: 'current', index, name: names[index], statementOrdinal: ordinal && ordinal > 0 && Number.isSafeInteger(ordinal) ? ordinal : undefined, result };
    });
    if (includeFailures && failures.length) {
      current.push(...failures.map((failure, index): CurrentEntry => {
        const message = truncateQueryScriptMessage(failure.message);
        return { kind: 'failure', index, statementOrdinal: failure.statementOrdinal, failure,
          message: message.length < failure.message.length ? `${message}\n${text.errorTruncated}` : message };
      }));
      // 只在所有回执都有语句序号时混排，同一语句的多组结果保留返回顺序。
      if (current.every(entry => entry.statementOrdinal !== undefined)) current.sort((left, right) => left.statementOrdinal! - right.statementOrdinal!);
    }
    return [...pins.map((pin): Entry => ({ kind: 'pinned', pin, name: pin.label, result: pin.result })), ...current];
  }, [results, names, statementOrdinals, pins, includeFailures, failures]);
  // 插入失败条目后，列表位置会变化。用原结果身份定位初始高亮。
  const [position, setPosition] = useState(() => Math.max(0, entries.findIndex(entry =>
    entry.kind === 'pinned' ? entry.pin === selectedPin : entry.kind === 'current' && !selectedPin && entry.index === selected)));
  const matches = useMemo(() => {
    const value = query.trim().toLowerCase();
    const ordinal = Number(/^#?(\d+)$/.exec(value)?.[1]);
    const ordinalOnly = value.startsWith('#') && Number.isFinite(ordinal);
    const statement = /^@(\d+)$/.exec(value);
    const statementOrdinal = statement ? Number(statement[1]) : undefined;
    return entries.filter(entry => {
      if (source !== 'all' && (entry.kind === 'pinned' ? source !== 'pinned' : source !== 'current')) return false;
      if (statementOrdinal !== undefined) return entry.kind !== 'pinned' && entry.statementOrdinal === statementOrdinal;
      if (entry.kind === 'failure') return !ordinalOnly && entry.message.toLowerCase().includes(value);
      if (!value || entry.kind === 'current' && entry.index + 1 === ordinal) return true;
      const { result, name } = entry;
      return !ordinalOnly && (name?.toLowerCase().includes(value) ||
        entry.kind === 'pinned' && entry.pin.originalLabel?.toLowerCase().includes(value) || result.postgresCommand?.toLowerCase().includes(value) ||
        result.statement.toLowerCase().includes(value) || result.columns.some(column => column.name.toLowerCase().includes(value)));
    });
  }, [entries, query, source]);
  const current = Math.min(position, Math.max(matches.length - 1, 0));
  const page = Math.floor(current / pageSize);
  const pageCount = Math.ceil(matches.length / pageSize);
  const entry = matches[current];
  const currentEntry = useRef(entry);
  useLayoutEffect(() => { currentEntry.current = entry; }, [entry]);
  const [feedback, setFeedback] = useState<{ entry: CurrentEntry; error?: string }>();
  const canLocateError = entry?.kind === 'failure' && executionErrors.canLocateFailure(entry.failure);
  const canReadSource = entry && entry.kind !== 'pinned' && !!statementSource?.canRead(entry);
  const optionId = (item: Entry) => item.kind === 'pinned' ? `${listId}-pin-${item.pin.id}` : `${listId}-${item.kind}-${item.index}`;
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest' }); }, [entry]);

  function activate(item: Entry, action: 'navigate' | 'draft' = 'navigate') {
    const dialog = input.current?.closest(appModalSelector);
    const surfaces = document.querySelectorAll(appModalSelector);
    if (!composing.current && dialog && surfaces[surfaces.length - 1] === dialog) onActivate(item, action);
  }

  function statementButtons(item: CurrentEntry) {
    if (!statementSource) return null;
    const available = item.kind === 'failure' ? draftText.failureStatementHint : draftText.resultStatementHint;
    const unavailable = item.kind === 'failure' ? draftText.failureStatementUnavailable : draftText.resultStatementUnavailable;
    return <>
      {statementSource.open && <button type="button" disabled={!canReadSource} title={canReadSource ? available : unavailable} onClick={() => activate(item, 'draft')}>
        {item.kind === 'failure' ? draftText.failureStatement : draftText.resultStatement}</button>}
      <button type="button" disabled={!canReadSource} title={canReadSource ? undefined : text.originalUnavailable} onClick={event => {
        const button = event.currentTarget, dialog = input.current?.closest(appModalSelector) ?? undefined;
        try {
          onCopy(item, () => !composing.current && currentEntry.current === item && button.isConnected && gridDialogCurrent(button, () => dialog));
          setFeedback({entry: item});
        } catch (reason) { setFeedback({entry: item, error: errorMessage(reason)}); }
      }}>{text.copyOriginal}</button>
    </>;
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
      {pins.length > 0 && (results.length > 0 || includeFailures && failures.length > 0) && <div className="open-tab-search-sort" role="group" aria-label={text.source}>
        {(['all', 'current', 'pinned'] as const).map(kind => <button key={kind} type="button" aria-pressed={source === kind}
          onClick={() => { setSource(kind); setPosition(0); input.current?.focus(); }}>{text.sources[kind]}</button>)}
      </div>}
      {!!failures.length && <label className="check"><input type="checkbox" checked={includeFailures}
        onChange={event => { setIncludeFailures(event.target.checked); setSource('all'); setPosition(0); input.current?.focus(); }}/>{text.includeFailures}</label>}
      <p role="status">{includeFailures ? text.receiptCount(matches.length, entries.length) : text.count(matches.length, entries.length)}</p>
      <p className="muted small">{includeFailures ? text.errorHint : text.receiptHint}</p>
      <div id={listId} className="open-tab-search-list" role="listbox" aria-label={includeFailures ? text.receipts : text.list}>
        {matches.slice(page * pageSize, (page + 1) * pageSize).map((item, row) => {
          if (item.kind === 'failure') {
            const id = optionId(item);
            return <button key={id} ref={item === entry ? active : undefined} id={id}
              type="button" role="option" aria-selected={item === entry} tabIndex={-1} className="open-tab-search-option"
              onMouseDown={event => event.preventDefault()} onClick={() => { setPosition(page * pageSize + row); input.current?.focus(); }}>
              <span className="open-tab-search-heading warning-text"><strong>{text.failedStatement(item.statementOrdinal)}</strong></span>
              <span className="query-result-navigator-sql">{item.message.slice(0, 200).replace(/[\uD800-\uDBFF]$/, '')}{item.message.length > 200 ? '…' : ''}</span>
            </button>;
          }
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
              item.kind === 'pinned' && queryPinsZh.elapsed(result.elapsedMs),
              item.kind === 'current' && item.statementOrdinal !== undefined && text.statement(item.statementOrdinal),
              result.columns.length ? text.rows(result.rows.length) : result.postgresCommand ?? text.status,
              result.affectedRows !== undefined && text.affected(result.affectedRows),
              result.truncated && text.truncated,
              selectedItem && text.current,
            ].filter(Boolean).join(' · ')}</span>
            {preview && <code className="query-result-navigator-sql">{preview}{result.statement.length > 200 ? '…' : ''}</code>}
          </button>;
        })}
      </div>
      {!matches.length && <p>{includeFailures ? text.noReceipts : text.empty}</p>}
      {pageCount > 1 && <div className="open-tab-search-options">
        <button type="button" disabled={page === 0} onClick={() => setPosition((page - 1) * pageSize)}>{text.previous}</button>
        <span>{text.page(page + 1, pageCount)}</span>
        <button type="button" disabled={page + 1 === pageCount} onClick={() => setPosition((page + 1) * pageSize)}>{text.next}</button>
      </div>}
      {entry?.kind === 'current' && statementSource && <div className="open-tab-search-options">{statementButtons(entry)}</div>}
      {entry?.kind === 'failure' && <section className="query-result-navigator-error" aria-label={text.errorDetail}>
        <pre>{entry.message}</pre>
        <div className="open-tab-search-options">
          <button type="button" disabled={!canLocateError} onClick={() => activate(entry)}>{text.locateError}</button>
          {statementButtons(entry)}
          {!canLocateError && <span className="muted small">{text.errorLocationUnavailable}</span>}
        </div>
      </section>}
      {feedback && feedback.entry === entry && (feedback.error ? <ErrorBox message={feedback.error}/> : <p role="status">{text.originalCopied}</p>)}
    </div>
    <footer className="modal-footer"><button type="button" onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
