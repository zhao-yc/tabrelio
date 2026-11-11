import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Columns3, KeyRound, List, Link2, Pencil } from 'lucide-react';
import type { TableElements, TableElementsTarget } from '../../shared/tableElements';
import { tableElementsZh as text } from '../locales/tableElements.zh-CN';
import { errorMessage, invoke } from '../lib';
import { SidebarNodeRequests, sidebarConnectionEnd } from '../sidebarNodeRequests';
import type { StructureElement } from '../structureElementFocus';
import { appModalSelector } from '../modalSelectors';
import { useWorkspace } from '../store';
import { ErrorBox, Spinner } from './ui';
import { SidebarTreeRow } from './SidebarContextMenu';

type Group = keyof TableElements;
const groups: Group[] = ['columns', 'indexes', 'foreignKeys'];
const icons = { columns: Columns3, indexes: List, foreignKeys: Link2 };

/** 结构读取与本机方案分开触发。折叠、父节点刷新及换连接时撤销原目录回包。 */
export function TableElementsBranch({ connectionId, database, table, available, onDesign, children }: TableElementsTarget & {
  available(): boolean; children(leading: ReactNode): ReactNode;
  onDesign?(element: StructureElement): void;
}) {
  const [expanded, setExpanded] = useState(false), expandedRef = useRef(false);
  const [elements, setElements] = useState<TableElements>(), [error, setError] = useState('');
  const catalogue = useRef<TableElements | undefined>(undefined);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<Group>>(new Set(['columns']));
  const [requests] = useState(() => new SidebarNodeRequests(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0));
  useLayoutEffect(() => {
    requests.activate();
    return () => { catalogue.current = undefined; requests.dispose(); };
  }, [requests]);

  async function load() {
    if (!available() || sidebarConnectionEnd(connectionId)) return;
    const request = requests.begin('load');
    if (!request) return;
    catalogue.current = undefined;
    setElements(undefined);
    setError('');
    try {
      const result = await invoke('metadata.tableElements', { connectionId, database, table });
      if (!requests.current(request) || !available()) return;
      if (sidebarConnectionEnd(connectionId)) setError(text.ending);
      else { catalogue.current = result; setElements(result); }
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
    else { catalogue.current = undefined; setElements(undefined); setError(''); }
  }

  function toggleGroup(group: Group) {
    setOpenGroups(previous => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  const label = expanded ? text.collapse(table) : text.expand(table);
  /** 用户只能从仍展开的原目录进入设计器，刷新、折叠及断开立即收回该入口。 */
  const current = () => !!elements && catalogue.current === elements && expandedRef.current && available() &&
    !sidebarConnectionEnd(connectionId) && !document.querySelector(appModalSelector);
  function design(element: StructureElement) { if (current()) onDesign?.(element); }
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
              {elements[group].length ? <ElementList elements={elements} group={group} onDesign={onDesign ? design : undefined}
                parent={{ connectionId, database, table }} current={current}/> : <span className="tree-hint">{text.noElements}</span>}
            </div>}
          </div>;
        })}
    </div>}
  </>;
}

function ElementList({ elements, group, onDesign, parent, current }: {
  elements: TableElements; group: Group; parent: TableElementsTarget; current(): boolean;
  onDesign?(element: StructureElement): void;
}) {
  /** 单击留在树上，双击或原生键盘激活进入设计器。 */
  const item = (name: string, description: string, content: ReactNode) => {
    if (!onDesign) return <li key={name}><span className="table-element" title={description}>{content}</span></li>;
    const rename = group === 'columns' ? () => onDesign({ group, name, rename: true }) : undefined;
    const button = <button type="button" className={'table-element table-element-design' + (rename ? ' tree-label' : '')}
      title={description + ' · ' + text.design} aria-label={text.designNamed(name)} aria-description={description}
      aria-keyshortcuts={rename ? 'F2' : undefined}
      onClick={event => { if (event.detail === 0) onDesign({ group, name }); }}
      onKeyDown={event => {
        if (rename && event.key === 'F2' && !event.repeat && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); rename();
        }
      }}
      onDoubleClick={() => onDesign({ group, name })}>{content}</button>;
    return <li key={name}>{rename ? <SidebarTreeRow elementMenu target={{ kind: 'table', name: parent.table, database: parent.database, connectionId: parent.connectionId }}
      className="table-element-row" label={name} version={[elements, name]} isCurrent={current}
      actions={<button aria-label={text.rename} onClick={rename}><Pencil size={12}/></button>}>{button}</SidebarTreeRow> : button}</li>;
  };
  if (group === 'columns') return <ul>{elements.columns.map(column => {
    const type = column.type || text.noDeclaredType;
    const description = [column.name, type, column.primary && text.primary, column.generated && text.generated].filter(Boolean).join(' · ');
    return item(column.name, description, <>
      {column.primary ? <KeyRound size={11} aria-label={text.primary}/> : <Columns3 size={11} aria-hidden="true"/>}
      <span className="truncate">{column.name}</span><small className="truncate">{type}{column.generated && ' · ' + text.generated}</small>
    </>);
  })}</ul>;
  if (group === 'indexes') return <ul>{elements.indexes.map(index => {
    const flags = [index.primary ? text.primary : index.unique && text.unique, index.partial && text.partial].filter(Boolean).join(' · ');
    return item(index.name, [index.name, flags].filter(Boolean).join(' · '), <>
      <List size={11} aria-hidden="true"/><span className="truncate">{index.name}</span>{flags && <small className="truncate">{flags}</small>}
    </>);
  })}</ul>;
  return <ul>{elements.foreignKeys.map(key => {
    const name = key.name ?? text.ordinal(key.ordinal);
    const destination = key.reference && [key.reference.namespace, key.reference.table].filter(Boolean).join(' / ');
    const open = key.name !== undefined && onDesign ? () => onDesign({ group, name }) : undefined;
    return <li key={name}>{key.reference ? <details className="table-element-reference">
      <summary title={open ? name + ' · ' + text.design : name} onDoubleClick={open}><span className="truncate">{name}</span></summary>
      <div className="table-element-mapping">
        <strong>{destination}</strong>
        {key.reference.pairs.map(pair => <div key={pair.local}>{pair.local} → {pair.remote ?? text.implicitPrimary}</div>)}
        {open && <button type="button" className="table-element-mapping-action" onClick={open}>{text.design}</button>}
      </div>
    </details> : open ? <button type="button" className="table-element table-element-design" aria-label={text.designNamed(name)}
      title={name + ' · ' + text.design} onClick={open}>{name}</button> : <span className="table-element" title={name}>{name}</span>}</li>;
  })}</ul>;
}
