import { useEffect, useRef, useState } from 'react';
import { ChevronsDownUp, ListFilter } from 'lucide-react';
import type { ConnectionProfile } from '../../shared/contracts';
import { sidebarViewZh as text } from '../locales/sidebarView.zh-CN';

export type SidebarVendor = ConnectionProfile['dialect'] | '';

/** 非模态筛选面板保留原树，离开或按 Esc 即可继续在树中操作。 */
export function SidebarViewControls({ vendor, starredOnly, flat, onVendor, onStarredOnly, onFlat, onCollapse }: {
  vendor: SidebarVendor; starredOnly: boolean; flat: boolean;
  onVendor(value: SidebarVendor): void; onStarredOnly(value: boolean): void; onFlat(value: boolean): void; onCollapse(): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const active = !!vendor || starredOnly;
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
    };
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className="sidebar-view-controls" ref={root} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); }
  }}>
    <button ref={trigger} type="button" className="icon-button sidebar-view-trigger" aria-label={text.controls}
      title={text.controls} aria-expanded={open} aria-controls={open ? 'sidebar-view-panel' : undefined}
      data-filtered={active} onClick={() => setOpen(!open)}><ListFilter size={15}/></button>
    {open && <div className="sidebar-view-panel" id="sidebar-view-panel" role="group" aria-label={text.controls}>
      <label>{text.vendor}<select value={vendor} onChange={event => onVendor(event.target.value as SidebarVendor)}>
        <option value="">{text.all}</option>
        {Object.entries(text.vendors).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><input type="checkbox" checked={starredOnly} onChange={event => onStarredOnly(event.target.checked)}/>{text.starredOnly}</label>
      <label><input type="checkbox" checked={flat} onChange={event => onFlat(event.target.checked)}/>{text.flat}</label>
      <button type="button" className="sidebar-collapse" onClick={() => { onCollapse(); close(); }}>
        <ChevronsDownUp size={14}/>{text.collapse}
      </button>
    </div>}
  </div>;
}
