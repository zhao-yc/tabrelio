import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import { sqliteResultOriginsZh as text } from '../locales/sqliteResultOrigins.zh-CN';
import { sqliteTableEditZh as editText } from '../locales/sqliteTableEdit.zh-CN';
import { sqliteBinaryInputHex } from '../sqliteBinaryInput';
import { errorMessage } from '../lib';
import { ErrorBox, Spinner } from './ui';
import './SqliteQueryInlineCellEditor.css';

export interface SqliteQueryInlineCell {
  findAnchor(): HTMLElement | null;
  bounds: DOMRect;
  column: string;
  label: string;
  typed?: string;
}

/** 在原网格位置缓冲带存储类的单格输入；进入预览前仍无数据库写入。 */
export function SqliteQueryInlineCellEditor({ cell, initial, nullable, loading, error, visible, onStage, onCancel }: {
  cell: SqliteQueryInlineCell; initial?: SqliteOriginalValue; nullable: boolean;
  loading: boolean; error: string; visible: boolean;
  onStage(value: SqliteOriginalValue): void; onCancel(): void;
}) {
  const [draft, setDraft] = useState<{ kind: SqliteOriginalValue['kind']; value: string }>();
  const [validation, setValidation] = useState('');
  const panel = useRef<HTMLFormElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const types = useRef<HTMLSelectElement>(null), cancel = useRef<HTMLButtonElement>(null), composing = useRef(false);
  const kind = draft?.kind ?? (cell.typed !== undefined && initial?.kind === 'null' ? 'text' : initial?.kind ?? 'text');
  const value = draft?.value ?? cell.typed ?? (initial && initial.kind !== 'null' ? initial.value : '');
  const ready = !!initial && !loading && !error;
  const { findAnchor, bounds, typed } = cell;

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !visible) return;
    const position = () => {
      const current = findAnchor()?.getBoundingClientRect();
      const rect = current?.width && current.height ? current : bounds;
      element.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - element.offsetHeight - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [findAnchor, bounds, visible]);

  useLayoutEffect(() => {
    composing.current = false;
    if (!visible) return;
    if (!ready) { cancel.current?.focus({ preventScroll: true }); return; }
    if (!input.current) { types.current?.focus({ preventScroll: true }); return; }
    input.current.focus({ preventScroll: true });
    if (typed === undefined) input.current.select();
    else input.current.setSelectionRange(input.current.value.length, input.current.value.length);
  }, [ready, visible, typed]);

  function stage() {
    if (!initial || !ready || composing.current || !visible) return;
    try {
      const next = !draft && typed === undefined ? initial : sqliteEditValueSchema.parse(kind === 'null' ? { kind }
        : { kind, value: kind === 'blob' ? sqliteBinaryInputHex(value) : value });
      onStage(next);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }

  return createPortal(<form className="sqlite-query-inline-cell" ref={panel} hidden={!visible} role="region"
    aria-label={text.inlineLabel(cell.label)} onSubmit={event => { event.preventDefault(); stage(); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current || event.repeat) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key === 'Enter' && event.target === input.current && !event.shiftKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); stage();
      }
    }}>
    <strong title={cell.column}>{cell.label}</strong>
    {loading && <Spinner text={text.inlineReading}/>}
    {ready && <><select ref={types} aria-label={editText.type(cell.column)} value={kind}
      onChange={event => { setDraft({ kind: event.target.value as SqliteOriginalValue['kind'], value }); setValidation(''); }}>
      {Object.entries(editText.kinds).filter(([key]) => key !== 'null' || nullable || initial.kind === 'null')
        .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>{kind !== 'null' && <textarea ref={input} aria-label={editText.value(cell.column)} rows={2}
      spellCheck={false} value={value} maxLength={sqliteTableEditLimits.valueUnits}
      onChange={event => { setDraft({ kind, value: event.target.value }); setValidation(''); }}/>}</>}
    <ErrorBox message={error || validation}/>
    <div className="sqlite-query-inline-actions">
      <button ref={cancel} type="button" onClick={onCancel}>{editText.cancelInput}</button>
      <button type="submit" disabled={!ready} className="primary">{text.inlinePreview}</button>
    </div>
  </form>, document.body);
}
