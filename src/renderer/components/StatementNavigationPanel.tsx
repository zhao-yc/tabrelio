import { useMemo, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../../shared/contracts';
import type { SavedQueryGroupTarget } from '../../shared/savedQueryOrganization';
import type { StatementNavigationView } from '../statementNavigationController';
import { currentNavigableStatement, statementNavigationPreview, statementNavigationStart, type NavigableStatement, type StatementNavigationDialect } from '../../shared/statementNavigation';
import type { StatementSelectionDestination } from '../statementNavigationExtract';
import { statementDraftBatchLimit } from '../queryDuplicateIntent';
import { errorMessage } from '../lib';
import { statementNavigationZh as text } from '../locales/statementNavigation.zh-CN';
import { queryFilesZh as fileText } from '../locales/queryFiles.zh-CN';
import { SavedQuerySaveGroup } from './SavedQuerySaveGroup';
import '../statementNavigation.css';

const pageSize = 10;
export interface StatementNavigationPanelProps {
  source: string; dialect: StatementNavigationDialect; view: StatementNavigationView; cursor: number;
  position(offset: number): { lineNumber: number; column: number }; onNavigate(index: number, select: boolean): void; onRefresh(): void; onCancel(): void; onClose(): void;
  onExtract(ranges: readonly NavigableStatement[], destination: StatementSelectionDestination): void | Promise<void>;
}
/** 目录只从捕获的原文生成预览和本地筛选；跳转始终由原模型owner确认。 */
export function StatementNavigationPanel({ source, dialect, view, cursor, position, onNavigate, onRefresh, onCancel, onClose, onExtract }: StatementNavigationPanelProps) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), result = view.result;
  const ranges = result?.status === 'ready' ? result.statements : undefined;
  const [selection, setSelection] = useState<{ ranges: readonly NavigableStatement[]; indices: ReadonlySet<number> }>();
  const checked = selection?.ranges === ranges ? selection?.indices : undefined;
  const selected = ranges?.filter((_, index) => checked?.has(index)) ?? [];
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [saving, setSaving] = useState(false), savingRef = useRef(false);
  const [nameDraft, setNameDraft] = useState<{ checked: ReadonlySet<number>; name: string; error?: string; group?: SavedQueryGroupTarget }>();
  // 命名只对应打开表单时的勾选，目录刷新或改选后须重新命名。
  const naming = nameDraft?.checked === checked ? nameDraft : undefined;
  /** 单条与批量更新都沿用目录原编号，避免搜索或翻页后按可见位置修改错行。 */
  function updateChecked(targets: readonly number[], enabled: boolean) {
    if (!ranges || savingRef.current) return;
    setSelection(previous => {
      const indices = new Set(previous?.ranges === ranges ? previous.indices : []);
      for (const index of targets) {
        if (enabled) indices.add(index);
        else indices.delete(index);
      }
      return { ranges, indices };
    });
  }
  async function runOutput(destination: Extract<StatementSelectionDestination, object | 'separate'>) {
    if (savingRef.current || !selected.length) return;
    const named = typeof destination === 'object' && 'libraryName' in destination;
    savingRef.current = true;
    setSaving(true);
    try {
      await onExtract(selected, destination);
      if (named) setNameDraft(undefined);
    } catch (reason) {
      if (!named || !naming) throw reason;
      setNameDraft({ ...naming, error: errorMessage(reason) });
    }
    finally { savingRef.current = false; setSaving(false); }
  }
  const activeIndex = ranges ? currentNavigableStatement(source, ranges, cursor, dialect) : -1;
  const rows = useMemo(() => ranges?.map((range, index) => ({ range, index, start: statementNavigationStart(source, range, dialect), preview: statementNavigationPreview(source, range, dialect) })).filter(row => !search || source.slice(row.range.start, row.range.end).toLowerCase().includes(search.toLowerCase())) ?? [], [ranges, source, search, dialect]);
  const matchingChecked = rows.filter(row => checked?.has(row.index)).length;
  const allMatchingChecked = rows.length > 0 && matchingChecked === rows.length;
  const matchingMixed = matchingChecked > 0 && !allMatchingChecked;
  const outsideSearch = selected.length - matchingChecked;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), actual = Math.min(page, pages - 1);
  return <section className="statement-navigation" aria-label={text.title}><header><strong>{text.title}</strong><span role="status">{view.busy ? text.loading : result?.status === 'ready' ? text.total(rows.length) : result ? text.reasons[result.reason] ?? text.unavailable : ''}</span><span className="grow"/>
    {view.busy ? <button onClick={onCancel}>{text.cancel}</button> : <button onClick={onRefresh}>{text.refresh}</button>}<button onClick={onClose}>{text.close}</button></header>
    <p className="muted small">{text.hint}</p>
    {ranges && <><input aria-label={text.search} placeholder={text.search} value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(0); }}/>
      <label className="inline-field statement-navigation-check-matches">
        <input type="checkbox" checked={allMatchingChecked} aria-checked={matchingMixed ? 'mixed' : allMatchingChecked}
          ref={input => { if (input) input.indeterminate = matchingMixed; }} disabled={!rows.length || saving}
          onChange={event => updateChecked(rows.map(row => row.index), event.currentTarget.checked)}/>
        {text.checkMatches}
      </label>
      <div className="statement-navigation-selection" aria-busy={saving}>
        <span>{text.checked(selected.length)}</span>
        {outsideSearch > 0 && <span className="muted">{text.checkedOutsideSearch(outsideSearch)}</span>}
        <button disabled={!selected.length || saving} onClick={() => onExtract(selected, 'clipboard')}>{text.copyChecked}</button>
        <button disabled={!selected.length || saving} onClick={() => onExtract(selected, 'query')}>{text.openChecked}</button>
        <button disabled={!selected.length || saving} title={text.separateHint(statementDraftBatchLimit)}
          onClick={() => void runOutput('separate')}>{text.openSeparately}</button>
        <button disabled={!selected.length || saving} onClick={() => setSelection(undefined)}>{text.clearChecked}</button>
        <select aria-label={text.scriptEncoding} value={encoding} disabled={!selected.length || saving}
          onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
          <option value="utf8">{fileText.utf8}</option>
          <option value="utf16le">{fileText.utf16le}</option>
          <option value="gb18030">{fileText.gb18030}</option>
        </select>
        <button disabled={!selected.length || saving} onClick={() => void runOutput({ encoding })}>{text.saveChecked}</button>
        <button disabled={!checked || !selected.length || saving || !!naming}
          onClick={() => { if (checked) setNameDraft({ checked, name: '' }); }}>{text.library}</button>
      </div>
      {naming && <form className="statement-navigation-selection" onSubmit={event => {
        event.preventDefault();
        const name = naming.name.trim();
        if (name) void runOutput({ libraryName: name, group: naming.group });
      }}>
        <input autoFocus aria-label={text.libraryName} placeholder={text.libraryName} maxLength={256} value={naming.name}
          disabled={saving} onChange={event => setNameDraft({ ...naming, name: event.target.value, error: undefined })}/>
        <SavedQuerySaveGroup disabled={saving} target={naming.group} onChange={group => setNameDraft({ ...naming, group, error: undefined })}/>
        <button type="submit" disabled={!naming.name.trim() || saving}>{text.librarySave}</button>
        <button type="button" disabled={saving} onClick={() => setNameDraft(undefined)}>{text.libraryCancel}</button>
        {naming.error && <p role="alert">{naming.error}</p>}
      </form>}
      <ol start={actual * pageSize + 1}>{rows.slice(actual * pageSize, (actual + 1) * pageSize).map(row => <li key={row.index} className={row.index === activeIndex ? 'active' : ''}>
        <input type="checkbox" aria-label={text.check(row.index)} disabled={saving} checked={checked?.has(row.index) ?? false}
          onChange={event => updateChecked([row.index], event.currentTarget.checked)}/>
        <button className="statement-navigation-target" aria-label={text.position(row.index, position(row.start).lineNumber)} title={row.preview} onClick={() => onNavigate(row.index, false)}><span>{text.position(row.index, position(row.start).lineNumber)}</span><code>{row.preview}</code></button>
        <button aria-label={`${text.select} ${row.index + 1}`} onClick={() => onNavigate(row.index, true)}>{text.select}</button>
      </li>)}</ol>{!rows.length && <p>{text.empty}</p>}
      {pages > 1 && <footer><button disabled={actual === 0} onClick={() => setPage(actual - 1)}>{text.previous}</button><span>{text.page(actual + 1, pages)}</span><button disabled={actual + 1 >= pages} onClick={() => setPage(actual + 1)}>{text.next}</button></footer>}
    </>}
  </section>;
}
