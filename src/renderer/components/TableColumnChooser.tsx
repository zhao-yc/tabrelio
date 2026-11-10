import { useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, setTableHeaderColumnVisibility } from '../tableColumnPreferences';
import { tableColumnChooserZh as text } from '../locales/tableColumnChooser.zh-CN';
import '../tableColumnChooser.css';

export function useTableColumnChooser(scope: string) {
  const id = useId();
  const [openedScope, setOpenedScope] = useState<string>();
  const focusFromMenu = useRef(false);
  const open = openedScope === scope;
  const close = () => setOpenedScope(undefined);
  return {
    id, open, close, focusFromMenu,
    toggleProps: { 'aria-controls': id, 'aria-expanded': open, className: open ? 'selected' : undefined,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        if (open) close();
        else {
          focusFromMenu.current = event.currentTarget.getAttribute('role') === 'menuitem';
          setOpenedScope(scope);
        }
      } },
  };
}

interface Props {
  chooser: ReturnType<typeof useTableColumnChooser>;
  preferences: TablePreferences;
  disabled: boolean;
  apply(update: (preferences: TablePreferences) => TablePreferences): void;
}

/** 侧栏与列布局共用草稿。列表筛选只影响侧栏，最后一个可见列由布局合同保护。 */
export function TableColumnChooser({ chooser, preferences, disabled, apply }: Props) {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (chooser.open && chooser.focusFromMenu.current) {
      chooser.focusFromMenu.current = false;
      panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    }
  }, [chooser.open, chooser.focusFromMenu]);
  function close() {
    const tab = panel.current?.closest('.workspace-tab');
    const trigger = tab?.querySelector<HTMLButtonElement>(`button[aria-controls="${chooser.id}"]:not(:disabled)`) ??
      tab?.querySelector<HTMLButtonElement>('.toolbar .action-menu-trigger:not(:disabled)');
    chooser.close();
    trigger?.focus({ preventScroll: true });
  }
  return <section ref={panel} id={chooser.id} className="table-column-chooser" aria-label={text.title} hidden={!chooser.open}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
    {chooser.open && <ChooserContents preferences={preferences} disabled={disabled} apply={apply} close={close}/>}
  </section>;
}

function ChooserContents({ preferences, disabled, apply, close }: Omit<Props, 'chooser'> & { close(): void }) {
  const [search, setSearch] = useState('');
  const columns = preferences.columns;
  const count = columns.filter(column => !column.hidden).length;
  const needle = search.toLowerCase();
  const matching = columns.filter(column => column.name.toLowerCase().includes(needle));
  return <>
    <header><h2>{text.title}</h2><button type="button" onClick={close}>{text.close}</button></header>
    <div className="table-column-chooser-controls">
      <input type="search" aria-label={text.search} placeholder={text.search} value={search} onChange={event => setSearch(event.target.value)}/>
      <div><span>{text.count(count, columns.length)}</span>
        <button type="button" disabled={disabled || count === columns.length} onClick={() => apply(setTableHeaderColumnVisibility)}>{text.showAll}</button>
      </div>
    </div>
    <div className="table-column-chooser-list">
      {matching.length === 0 && <p>{text.empty}</p>}
      {matching.map(column => <label key={column.name} title={column.name}>
        <input type="checkbox" checked={!column.hidden} disabled={disabled || count === 1 && !column.hidden}
          onChange={event => {
            const hidden = !event.target.checked;
            apply(current => current.columns.some(item => item.name === column.name && !!item.hidden !== hidden) ?
              changeTablePreference(current, column.name, { hidden }) : current);
          }}/><span>{column.name}</span>
      </label>)}
    </div>
  </>;
}
