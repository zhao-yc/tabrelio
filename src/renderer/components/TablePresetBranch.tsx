import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ListFilter } from 'lucide-react';
import type { TablePresetSnapshot, TablePresetTarget } from '../../shared/tablePresets';
import { tablePresetTabId, type TablePresetTabKind } from '../../shared/tablePresetTab';
import { errorMessage, invoke, uid } from '../lib';
import { tablePresetsZh as text } from '../locales/tablePresets.zh-CN';
import { onTablePresetsChanged } from '../tablePresetTree';
import { useWorkspace } from '../store';
import { ErrorBox, Spinner } from './ui';

/** 展开后才读本机清单，点击子节点才领独立标签。折叠、刷新及换连接撤销旧清单。 */
export function TablePresetBranch({ kind, connectionId, database, table, connectionVersion, children }: TablePresetTarget & {
  kind: TablePresetTabKind; connectionVersion: number; children(leading: ReactNode): ReactNode;
}) {
  type Entry = Pick<TablePresetSnapshot['entries'][number], 'id' | 'name' | 'connectionDigest'>;
  type Snapshot = { source: { connectionDigest: string }; entries: Entry[] };
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Snapshot>(), [error, setError] = useState('');
  const request = useRef(0), loaded = useRef<Snapshot | undefined>(undefined);
  const target = { connectionId, database, table };
  const label = text.treeExpand(table);

  function connectionCurrent(): boolean {
    const state = useWorkspace.getState();
    return (state.connectionVersions[connectionId] ?? 0) === connectionVersion &&
      state.connections.find(profile => profile.id === connectionId)?.dialect === (kind === 'postgres' ? 'postgresql' : 'sqlite');
  }

  async function load() {
    const generation = ++request.current;
    loaded.current = undefined; setSnapshot(undefined); setError('');
    try {
      if (!connectionCurrent() || kind === 'sqlite' && database !== 'main') return;
      const result = kind === 'sqlite' ? await invoke('sqlite.tablePresets.list', { ...target, database: 'main' }) :
        await invoke('postgres.table.presets.list', target);
      if (generation !== request.current || !connectionCurrent()) return;
      loaded.current = result; setSnapshot(result);
    } catch (reason) {
      if (generation === request.current && connectionCurrent()) setError(errorMessage(reason));
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
    const stop = onTablePresetsChanged(kind, target, () => { void load(); });
    return () => { ++request.current; loaded.current = undefined; stop(); };
  }, [open, kind, connectionId, database, table, connectionVersion]);

  function toggle() {
    ++request.current; loaded.current = undefined; setSnapshot(undefined); setError('');
    setOpen(value => !value);
  }

  function openPreset(entry: Entry) {
    if (!snapshot || loaded.current !== snapshot || !connectionCurrent() || entry.connectionDigest !== snapshot.source.connectionDigest ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const state = useWorkspace.getState();
    state.select({ connectionId, database });
    state.openTab({ ...target, id: tablePresetTabId(kind, entry.id, uid()), kind: 'table', title: text.tabTitle(table, entry.name) });
  }

  return <>{children(<button type="button" className="icon-button table-preset-toggle" aria-label={label} title={label} aria-expanded={open} onClick={toggle}>
    {open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
  </button>)}
    {open && <div className="table-preset-branch" role="group" aria-label={label}>
      {error ? <><ErrorBox message={error}/><button onClick={() => void load()}>{text.treeRetry}</button></> :
        !snapshot ? <Spinner/> : snapshot.entries.length === 0 ? <span className="tree-hint">{text.treeEmpty}</span> :
          snapshot.entries.map(entry => <button key={entry.id} className="tree-label table-preset-entry" aria-label={text.treeOpen(entry.name)}
            title={entry.name} disabled={entry.connectionDigest !== snapshot.source.connectionDigest} onClick={() => openPreset(entry)}>
            <ListFilter size={12}/><span className="truncate">{entry.name}</span>
          </button>)}
    </div>}
  </>;
}
