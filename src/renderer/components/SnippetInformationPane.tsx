import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FileCode2, Search } from 'lucide-react';
import type { ConnectionProfile, SqlSnippet } from '../../shared/contracts';
import type { HistoryInsertionRegistry } from '../historyInsertion';
import { errorMessage } from '../lib';
import { objectInformationZh as text } from '../locales/objectInformation.zh-CN';
import { formatText, zh } from '../locales/zh-CN';
import { appModalSelector } from '../modalSelectors';
import { snippetCatalog, snippetTemplatesForDialect } from '../snippetCompletion';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { SnippetsDialog } from './SnippetsDialog';
import { useSqlEditorDrop } from './SidebarContextMenu';
import { ErrorBox } from './ui';

/** 片段是本地资料。方言跟随活动查询，目录变更会撤销旧自定义片段的插入资格。 */
export function SnippetInformationPane({ insertion, selectedProfile, expanded }: {
  insertion: HistoryInsertionRegistry; selectedProfile?: ConnectionProfile; expanded: boolean;
}) {
  const tab = useWorkspace(({ settings }) => settings.tabs.find(item => item.id === settings.activeTabId && item.kind === 'query'));
  const profile = useWorkspace(state => state.connections.find(item => item.id === tab?.connectionId));
  const busy = useWorkspace(state => !!tab && !!state.activeJobs[tab.id]);
  const dialect = profile?.dialect ?? selectedProfile?.dialect;
  const templates = snippetTemplatesForDialect(dialect);
  const revision = useSyncExternalStore(snippetCatalog.subscribe, snippetCatalog.revision);
  const [catalog, setCatalog] = useState<{ revision: number; rows?: SqlSnippet[] }>();
  const [search, setSearch] = useState(''), [group, setGroup] = useState('');
  const [selection, setSelection] = useState<string>();
  const [creating, setCreating] = useState(false);
  const sqlDrop = useSqlEditorDrop();

  useEffect(() => {
    let alive = true;
    void snippetCatalog.list().then(rows => {
      if (alive && snippetCatalog.revision() === revision) setCatalog({ revision, rows });
    });
    return () => { alive = false; };
  }, [revision]);

  const loaded = catalog?.revision === revision;
  const items = useMemo(() => [...(loaded ? catalog.rows ?? [] : []), ...templates], [catalog, loaded, templates]);
  const groups = [...new Set(items.map(item => item.group))].sort();
  const selectedGroup = groups.includes(group.slice(1)) ? group : '';
  const needle = search.trim().toLowerCase();
  const matches = useMemo(() => items.filter(item => (!selectedGroup || item.group === selectedGroup.slice(1)) &&
    (!needle || [item.name, item.group, item.description, item.sql].some(value => value.toLowerCase().includes(needle)))), [items, selectedGroup, needle]);
  const key = (item: SqlSnippet) => (templates.includes(item) ? 'template:' : 'user:') + item.id;
  const selected = matches.find(item => key(item) === selection);
  const editable = !!tab && !!profile && !busy && !expanded;
  const latestEditable = useRef(editable); latestEditable.current = editable;

  function insertionCurrent(snippet: SqlSnippet) {
    const workspace = useWorkspace.getState();
    return latestEditable.current && !!tab && !!profile && workspace.settings.activeTabId === tab.id &&
      workspace.connections.includes(profile) && !document.querySelector(appModalSelector) &&
      (templates.includes(snippet) || snippetCatalog.revision() === revision);
  }

  function insert(snippet: SqlSnippet) {
    if (!tab || !insertionCurrent(snippet)) return;
    const target = insertion.capture(tab.id, 'snippet');
    try {
      if (!target?.insertSnippet) throw Error(zh.snippets.insertUnavailable);
      target.insertSnippet(snippet);
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
    finally { target?.dispose(); }
  }

  return <section className="object-info-snippets" aria-label={text.snippets}>
    <div className="object-info-snippet-filters">
      <label className="object-info-identifier-search"><Search size={14} aria-hidden="true"/>
        <input type="search" aria-label={zh.snippets.search} placeholder={zh.snippets.search} value={search} onChange={event => setSearch(event.target.value)}/>
      </label>
      <select aria-label={zh.snippets.groupFilter} value={selectedGroup} onChange={event => setGroup(event.target.value)}>
        <option value="">{zh.snippets.allGroups}</option>
        {groups.map(value => <option key={value} value={':' + value}>{value || zh.snippets.ungrouped}</option>)}
      </select>
      <button type="button" onClick={() => { if (!document.querySelector(appModalSelector)) setCreating(true); }}>{zh.snippets.new}</button>
    </div>
    {!loaded && <p role="status">{zh.snippets.loading}</p>}
    {loaded && !catalog.rows && <ErrorBox message={text.snippetsReadFailed}/>}
    {matches.length ? <ul aria-label={zh.snippets.title}>
      {matches.map(item => <li key={key(item)}>
        <button type="button" className="object-info-snippet-name" aria-label={formatText(zh.snippets.selectName, item.name)}
          aria-pressed={selected === item} draggable={editable && !!sqlDrop} title={editable ? text.dragSnippet : undefined}
          onClick={() => setSelection(key(item))} onDoubleClick={() => insert(item)} onDragStart={event => {
            if (!tab || !sqlDrop?.beginSnippetDrag(tab.id, item, event.currentTarget,
              { current: () => insertionCurrent(item) }, event.dataTransfer)) event.preventDefault();
          }}>
          <strong>{item.name}</strong><small>{templates.includes(item) ? zh.snippets.builtin : item.group || zh.snippets.ungrouped}</small>
        </button>
        <button type="button" className="icon-button" disabled={!editable} aria-label={text.insertSnippet(item.name)} title={text.insertSnippet(item.name)}
          onClick={() => insert(item)}><FileCode2 size={14}/></button>
      </li>)}
    </ul> : <p role="status">{zh.snippets.empty}</p>}
    {selected && <section className="object-info-snippet-preview" aria-label={zh.snippets.sql}>
      {selected.description && <p>{selected.description}</p>}
      <div><SqlEditor key={key(selected)} value={selected.sql} dialect={dialect} readOnly/></div>
    </section>}
    {creating && createPortal(<SnippetsDialog initialSql="" dialect={dialect} startWithDraft onClose={() => setCreating(false)}/>, document.body)}
  </section>;
}
