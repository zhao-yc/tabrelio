import { useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { postgresArchiveEntryLimit, type PostgresArchiveExportInput, type PostgresArchiveListing,
  type PostgresArchiveRestoreChoice, type PostgresArchiveSqlExport } from '../../shared/postgresArchive';
import { errorMessage, invoke, uid } from '../lib';
import { postgresArchiveZh as text } from '../locales/postgresArchive.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

const entriesPerPage = 40;

export function PostgresArchiveDialog({ onClose, onRestore, paused }: {
  onClose(): void;
  onRestore?: (archive: PostgresArchiveRestoreChoice) => void;
  paused?: boolean;
}) {
  const [source, setSource] = useState<FileChoice | null>(null), [tool, setTool] = useState<FileChoice | null>(null);
  const [listing, setListing] = useState<PostgresArchiveListing>();
  const [exported, setExported] = useState<PostgresArchiveSqlExport | null>(null);
  const [content, setContent] = useState<PostgresArchiveExportInput['content']>('all');
  const [portable, setPortable] = useState(false);
  const [entryMode, setEntryMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState(''), [page, setPage] = useState(0);
  const [choosing, setChoosing] = useState(false), [operation, setOperation] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  const locked = choosing || !!operation;
  const available = !!source && !!tool && !locked;
  const ready = available && (!entryMode || selected.length > 0);
  const filterText = filter.trim().toLowerCase();
  const matches = entryMode ? listing?.entries.filter(entry => `${entry.id} ${entry.label}`.toLowerCase().includes(filterText)) ?? [] : [];
  const pageCount = Math.max(1, Math.ceil(matches.length / entriesPerPage));
  const matchingSelection = new Set(selected);
  const selectionOptions = { content: entryMode ? 'all' as const : content, portable, ...(entryMode ? { entryIds: selected } : {}) };

  function clearListing() {
    setListing(undefined); setEntryMode(false); setSelected([]); setFilter(''); setPage(0); setExported(null);
  }

  async function choose(kind: 'tool' | 'source') {
    if (active.current) return;
    active.current = true;
    setChoosing(true); clearListing(); setError('');
    const update = kind === 'tool' ? setTool : setSource;
    update(null);
    try { update(await invoke('postgres.archive.choose', { kind })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setChoosing(false); active.current = false; }
  }

  async function run(action: 'list' | 'export') {
    if (active.current || !source || !tool || action === 'export' && !ready) return;
    active.current = true;
    const operationId = uid();
    const input = { operationId, sourceToken: source.token, toolToken: tool.token };
    setOperation(operationId); setError('');
    try {
      if (action === 'list') {
        clearListing();
        setListing(await invoke('postgres.archive.list', input));
      } else {
        setExported(null);
        setExported(await invoke('postgres.archive.exportSql', { ...input, ...selectionOptions }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setOperation(undefined); setCancelling(false); active.current = false; }
  }

  async function cancel() {
    if (!operation || cancelling) return;
    setCancelling(true);
    try { await invoke('postgres.archive.cancel', { operationId: operation }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  const close = () => { if (!active.current) onClose(); };
  if (paused) return null;
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <div>
        <button disabled={locked} onClick={() => void choose('source')}>{text.chooseSource}</button>
        {source && <span> · {source.name}</span>}
      </div>
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.chooseTool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      <fieldset disabled={locked}>
        <Field label={text.content}><select aria-label={text.content} value={selectionOptions.content} disabled={entryMode} onChange={event => {
          setContent(event.target.value as PostgresArchiveExportInput['content']); setExported(null);
        }}><option value="all">{text.all}</option><option value="schema">{text.schema}</option><option value="data">{text.data}</option></select></Field>
      </fieldset>
      <label className="check"><input type="checkbox" disabled={locked} checked={portable} onChange={event => {
        setPortable(event.target.checked); setExported(null);
      }}/>{text.portable}</label>
      {operation && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {listing && <section className="database-backup-plan">
        <p>{text.directory} · pg_restore {listing.toolVersion}</p>
        {!!listing.entries.length && <label className="check"><input type="checkbox" disabled={locked} checked={entryMode} onChange={event => {
          setEntryMode(event.target.checked); setExported(null);
        }}/>{text.selectEntries}</label>}
        {entryMode ? <fieldset className="database-backup-table-picker" disabled={locked}>
          <p>{text.entryScope}</p>
          <Field label={text.entryFilter}><input value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}/></Field>
          <p>{text.entryCount(selected.length, matches.length)}</p>
          <div>
            <button disabled={!matches.length || selected.length + matches.reduce((count, entry) => count + Number(!matchingSelection.has(entry.id)), 0) > postgresArchiveEntryLimit}
              onClick={() => { setSelected([...new Set([...selected, ...matches.map(entry => entry.id)])]); setExported(null); }}>{text.selectMatches}</button>
            <button disabled={!selected.length} onClick={() => { setSelected([]); setExported(null); }}>{text.clearEntries}</button>
          </div>
          <div className="database-backup-table-list">
            {matches.slice(page * entriesPerPage, (page + 1) * entriesPerPage).map(entry => <label className="check" key={entry.id}>
              <input type="checkbox" checked={matchingSelection.has(entry.id)} disabled={!matchingSelection.has(entry.id) && selected.length >= postgresArchiveEntryLimit}
                onChange={event => { setSelected(event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id)); setExported(null); }}/>
              {entry.id} · {entry.label}
            </label>)}
          </div>
          {pageCount > 1 && <div>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>{text.previousPage}</button>
            <button disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>{text.nextPage}</button>
            {text.entryPage(page + 1, pageCount)}
          </div>}
        </fieldset> : <pre className="database-backup-native-list" aria-label={text.directory} tabIndex={0}>{listing.text}</pre>}
        {listing.warning && <p>{text.warnings} · {listing.warning}</p>}
      </section>}
      {exported && <section className="database-backup-plan" role="status">
        <p>{text.done(exported.name, exported.bytes)}</p>
        {exported.warning && <p>{text.warnings} · {exported.warning}</p>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={!available} onClick={() => void run('list')}>{text.list}</button>
      {operation ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <>
          <button disabled={!ready} onClick={() => void run('export')}>{text.export}</button>
          {onRestore && <button className="primary" disabled={!ready} onClick={() => {
            if (!active.current && ready && source && tool)
              onRestore({ name: source.name, selection: { sourceToken: source.token, toolToken: tool.token, ...selectionOptions } });
          }}>{text.restore}</button>}
        </>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
