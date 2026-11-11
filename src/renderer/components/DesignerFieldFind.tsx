import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appModalSelector } from '../modalSelectors';
import { designerFieldFindZh as text } from '../locales/designerFieldFind.zh-CN';
import './DesignerFieldFind.css';

/** 查找绑定当前设计器和字段对象，定位只滚动并聚焦现有控件。 */
export function useDesignerFieldFind<Field extends { name: string }>(fields: readonly Field[], enabled = true) {
  const [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Field>();
  const panel = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | undefined>(undefined);
  const handler = useRef<(event: KeyboardEvent) => void>(() => {});
  const composing = useRef(false);
  const needle = query.toLowerCase();
  const matches = opened && enabled && needle ? fields.flatMap((field, index) =>
    field.name.toLowerCase().includes(needle) ? [index] : []) : [];
  const active = selected ? matches.findIndex(index => fields[index] === selected) : -1;
  const activeRow = matches[active];

  function scope() {
    const dialog = panel.current?.closest<HTMLElement>(appModalSelector);
    const dialogs = document.querySelectorAll(appModalSelector);
    return enabled && dialog === dialogs[dialogs.length - 1] ? dialog : undefined;
  }

  function open() {
    const dialog = scope();
    if (!dialog) return;
    if (!opened) {
      const focused = document.activeElement;
      returnFocus.current = focused instanceof HTMLElement && dialog.contains(focused) ? focused : trigger.current ?? undefined;
      setOpened(true);
    } else {
      input.current?.focus();
      input.current?.select();
    }
  }

  function close() {
    const focus = returnFocus.current;
    setOpened(false); setSelected(undefined); composing.current = false;
    if (focus?.isConnected && scope()?.contains(focus) && !focus.matches(':disabled')) focus.focus({ preventScroll: true });
    else trigger.current?.focus();
  }

  function step(direction: -1 | 1) {
    const dialog = scope();
    if (!dialog || composing.current || !matches.length) return;
    const next = active < 0 ? (direction > 0 ? 0 : matches.length - 1) : (active + direction + matches.length) % matches.length;
    const index = matches[next];
    const row = dialog.querySelector<HTMLElement>(`[data-designer-field-index="${index}"]`);
    if (!row || row.closest(appModalSelector) !== dialog) return;
    setSelected(fields[index]);
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    (row.querySelector<HTMLElement>('[data-designer-field-name]:not(:disabled)') ?? row).focus({ preventScroll: true });
  }

  useLayoutEffect(() => { if (opened && enabled) input.current?.focus(); }, [opened, enabled]);
  useLayoutEffect(() => {
    handler.current = event => {
      if (event.defaultPrevented || event.isComposing || composing.current || event.keyCode === 229 || event.altKey || event.repeat) return;
      const target = event.target, dialog = scope();
      if (!(target instanceof Element) || !dialog || target.closest(appModalSelector) !== dialog || target.closest('.monaco-editor')) return;
      const key = event.key.toLowerCase();
      const find = key === 'f' && !event.shiftKey && event.ctrlKey !== event.metaKey;
      const next = opened && (key === 'f3' && !event.ctrlKey && !event.metaKey || key === 'g' && event.metaKey && !event.ctrlKey);
      const escape = opened && key === 'escape' && !event.ctrlKey && !event.metaKey &&
        (panel.current?.contains(target) || target.closest('[data-designer-field-current]') !== null);
      if (!find && !next && !escape) return;
      event.preventDefault(); event.stopPropagation();
      if (find) open();
      else if (escape) close();
      else step(event.shiftKey ? -1 : 1);
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handler.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  return {
    controls: <section ref={panel} className="designer-field-find" aria-label={text.title} data-open={opened ? 'true' : undefined}>
      <button type="button" ref={trigger} disabled={!enabled} aria-expanded={opened}
        aria-keyshortcuts="Control+F Meta+F" onClick={open}>{text.title}</button>
      {opened && <>
        <input ref={input} type="search" aria-label={text.query} placeholder={text.query} maxLength={512} disabled={!enabled} value={query}
          onChange={event => { setQuery(event.target.value); setSelected(undefined); }}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey ||
                event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat) step(event.shiftKey ? -1 : 1);
          }}/>
        <button type="button" disabled={!matches.length} onClick={() => step(-1)}>{text.previous}</button>
        <button type="button" disabled={!matches.length} onClick={() => step(1)}>{text.next}</button>
        <span role="status">{!needle ? text.empty : matches.length ? text.count(matches.length, active + 1) : text.none}</span>
        <button type="button" onClick={close}>{text.close}</button>
      </>}
    </section>,
    rowProps: (index: number) => ({
      'data-designer-field-index': index, 'data-designer-field-current': activeRow === index ? 'true' : undefined, tabIndex: -1,
    }),
  };
}
