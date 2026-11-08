import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { QueryResult, ResultColumn } from '../../shared/contracts';
import { queryResultKeywordZh as text } from '../locales/queryResultKeyword.zh-CN';
import { matchQueryResultKeyword, projectQueryResultKeyword, queryResultKeywordLimits } from '../queryResultKeyword';
import '../queryResultKeyword.css';

interface Scope {
  source: QueryResult | undefined;
  columns: readonly ResultColumn[] | undefined;
  context: readonly unknown[];
  generation: number;
  filter?: { keyword: string; matches: ReturnType<typeof matchQueryResultKeyword> };
}

/** 关键字只属于当前结果和可见列，不进入可保存的条件、整理历史或固定快照。 */
export function useQueryResultKeyword(source: QueryResult | undefined, columns: readonly ResultColumn[] | undefined,
  context: readonly unknown[], organized: QueryResult | undefined) {
  const [scope, setScope] = useState<Scope>(() => ({ source, columns, context, generation: 0 }));
  const current = scope.source === source && scope.columns === columns &&
    scope.context.length === context.length && scope.context.every((value, index) => Object.is(value, context[index]));
  if (!current) setScope({ source, columns, context, generation: scope.generation + 1 });
  const filter = current ? scope.filter : undefined;
  const result = useMemo(() => organized && filter ? projectQueryResultKeyword(organized, filter.matches) : organized, [organized, filter]);
  /** 试算成功才撤销当前勾选和行定位，超出预算时仍保留上一视图。 */
  function apply(keyword: string, invalidate: () => void) {
    if (!source || !columns || !current) return false;
    if (keyword === (filter?.keyword ?? '')) return true;
    const next = keyword ? { keyword, matches: matchQueryResultKeyword(source, columns, keyword) } : undefined;
    invalidate();
    setScope({ ...scope, filter: next });
    return true;
  }
  return { result, apply, generation: scope.generation, keyword: filter?.keyword ?? '' };
}

export function QueryResultKeyword({ keyword, total, matched, disabled, onApply }: {
  keyword: string; total: number; matched: number; disabled: boolean; onApply: (keyword: string) => boolean;
}) {
  const [draft, setDraft] = useState(keyword);
  const [error, setError] = useState('');
  const composing = useRef(false);
  function apply(value: string) {
    if (disabled || composing.current) return;
    try {
      if (!onApply(value)) return;
      setDraft(value);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.invalid);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(draft);
  }
  return <form className="query-result-keyword" role="search" aria-label={text.input} title={text.hint} onSubmit={submit}>
    <input aria-label={text.input} aria-description={text.hint} placeholder={text.input} type="search" value={draft} maxLength={queryResultKeywordLimits.needle}
      disabled={disabled} onChange={event => { setDraft(event.target.value); setError(''); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Enter') return;
        event.stopPropagation();
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.preventDefault();
      }} />
    <button type="submit" disabled={disabled || draft === keyword}>{text.apply}</button>
    {keyword && <button type="button" disabled={disabled} onClick={() => apply('')}>{text.clear}</button>}
    {keyword && <span role="status">{text.counts(matched, total)}</span>}
    {error && <span role="alert" className="warning-text">{error}</span>}
  </form>;
}
