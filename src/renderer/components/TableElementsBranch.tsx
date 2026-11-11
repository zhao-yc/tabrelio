import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Columns3, KeyRound, List, Link2 } from 'lucide-react';
import type { TableElements, TableElementsTarget } from '../../shared/tableElements';
import { tableElementsZh as text } from '../locales/tableElements.zh-CN';
import { errorMessage, invoke } from '../lib';
import { SidebarNodeRequests, sidebarConnectionEnd } from '../sidebarNodeRequests';
import { useWorkspace } from '../store';
import { ErrorBox, Spinner } from './ui';

type Group = keyof TableElements;
const groups: Group[] = ['columns', 'indexes', 'foreignKeys'];
const icons = { columns: Columns3, indexes: List, foreignKeys: Link2 };

/** 结构读取与本机方案分开触发。折叠、父节点刷新及换连接时撤销原目录回包。 */
export function TableElementsBranch({ connectionId, database, table, available, children }: TableElementsTarget & {
  available(): boolean; children(leading: ReactNode): ReactNode;
}) {
  const [expanded, setExpanded] = useState(false), expandedRef = useRef(false);
  const [elements, setElements] = useState<TableElements>(), [error, setError] = useState('');
  const [openGroups, setOpenGroups] = useState<ReadonlySet<Group>>(new Set(['columns']));
  const [requests] = useState(() => new SidebarNodeRequests(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0));
  useLayoutEffect(() => { requests.activate(); return () => requests.dispose(); }, [requests]);

  async function load() {
    if (!available() || sidebarConnectionEnd(connectionId)) return;
    const request = requests.begin('load');
    if (!request) return;
    setElements(undefined);
    setError('');
    try {
      const result = await invoke('metadata.tableElements', { connectionId, database, table });
      if (!requests.current(request) || !available()) return;
      if (sidebarConnectionEnd(connectionId)) setError(text.ending); else setElements(result);
    } catch (reason) {
      if (requests.current(request) && available()) setError(errorMessage(reason));
    } finally {
      requests.finish(request);
    }
  }

  function toggle() {
    if (!available() || !expandedRef.current && sidebarConnectionEnd(connectionId) || !requests.collapse()) return;
    expandedRef.current = !expandedRef.current;
    setExpanded(expandedRef.current);
    if (expandedRef.current) void load();
    else { setElements(undefined); setError(''); }
  }

  function toggleGroup(group: Group) {
    setOpenGroups(previous => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  const label = expanded ? text.collapse(table) : text.expand(table);
  return <>{children(<button type="button" className="icon-button table-elements-toggle" aria-expanded={expanded}
    aria-label={label} title={label} onClick={toggle}>{expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>)}
    {expanded && <div className="table-elements-branch" role="group" aria-label={text.branch(table)}>
      {error ? <><ErrorBox message={error}/><button onClick={() => void load()}>{text.retry}</button></> :
        !elements ? <Spinner text={text.loading}/> : groups.map(group => {
          const Icon = icons[group], open = openGroups.has(group);
          return <div key={group}>
            <button type="button" className="tree-label table-elements-group" aria-expanded={open} onClick={() => toggleGroup(group)}>
              {open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<Icon size={12}/><span>{text[group]}</span>
              <span className="table-elements-count">{elements[group].length}</span>
            </button>
            {open && <div className="table-elements-list" role="group" aria-label={text[group]}>
              {elements[group].length ? <ElementList elements={elements} group={group}/> : <span className="tree-hint">{text.noElements}</span>}
            </div>}
          </div>;
        })}
    </div>}
  </>;
}

function ElementList({ elements, group }: { elements: TableElements; group: Group }) {
  if (group === 'columns') return <ul>{elements.columns.map(column => {
    const type = column.type || text.noDeclaredType;
    const description = [column.name, type, column.primary && text.primary, column.generated && text.generated].filter(Boolean).join(' · ');
    return <li key={column.name} className="table-element" title={description}>
      {column.primary ? <KeyRound size={11} aria-label={text.primary}/> : <Columns3 size={11} aria-hidden="true"/>}
      <span className="truncate">{column.name}</span><small className="truncate">{type}{column.generated && ' · ' + text.generated}</small>
    </li>;
  })}</ul>;
  if (group === 'indexes') return <ul>{elements.indexes.map(index => {
    const flags = [index.primary ? text.primary : index.unique && text.unique, index.partial && text.partial].filter(Boolean).join(' · ');
    return <li key={index.name} className="table-element" title={[index.name, flags].filter(Boolean).join(' · ')}>
      <List size={11} aria-hidden="true"/><span className="truncate">{index.name}</span>{flags && <small className="truncate">{flags}</small>}
    </li>;
  })}</ul>;
  return <ul>{elements.foreignKeys.map(key => {
    const name = key.name ?? text.ordinal(key.ordinal);
    const destination = key.reference && [key.reference.namespace, key.reference.table].filter(Boolean).join(' / ');
    return <li key={name}>{key.reference ? <details className="table-element-reference">
      <summary title={name}><span className="truncate">{name}</span></summary>
      <div className="table-element-mapping">
        <strong>{destination}</strong>
        {key.reference.pairs.map(pair => <div key={pair.local}>{pair.local} → {pair.remote ?? text.implicitPrimary}</div>)}
      </div>
    </details> : <span className="table-element" title={name}>{name}</span>}</li>;
  })}</ul>;
}
