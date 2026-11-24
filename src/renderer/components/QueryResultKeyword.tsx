import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { QueryResult, ResultColumn } from '../../shared/contracts';
import { queryResultKeywordZh as text } from '../locales/queryResultKeyword.zh-CN';
import { matchQueryResultKeyword, projectQueryResultKeyword, queryResultKeywordLimits } from '../queryResultKeyword';
import '../queryResultKeyword.css';

interface ResultIdentity {
  connectionScope: string;
  execution: string | undefined;
}

interface SavedKeyword extends ResultIdentity {
  columns: readonly ResultColumn[];
  keyword: string;
}

interface Scope extends ResultIdentity {
  source: QueryResult | undefined;
  columns: readonly ResultColumn[] | undefined;
  context: readonly unknown[];
  generation: number;
  filter?: { keyword: string; matches: ReturnType<typeof matchQueryResultKeyword> };
}

/** 同一结果和可见列恢复已应用的关键字，命中集合按原返回行重新计算。 */
export function useQueryResultKeyword(source: QueryResult | undefined, columns: readonly ResultColumn[] | undefined,
  context: readonly unknown[], organized: QueryResult | undefined, connectionScope: string, execution: string | undefined) {
  const [savedKeywords] = useState(() => new WeakMap<QueryResult, SavedKeyword>());
  const [scope, setScope] = useState<Scope>(() => ({ source, columns, context, connectionScope, execution, generation: 0 }));
  const current = scope.source === source && scope.columns === columns &&
    scope.connectionScope === connectionScope && scope.execution === execution &&
    scope.context.length === context.length && scope.context.every((value, index) => Object.is(value, context[index]));
  /** 读取当前执行中对应列布局的关键字，也可用于其它已返回结果的导出。 */
  function readKeyword(result: QueryResult, visible: readonly ResultColumn[]): string | undefined {
    const saved = savedKeywords.get(result);
    if (saved?.connectionScope === connectionScope && saved.execution === execution &&
        saved.columns.length === visible.length && saved.columns.every((column, index) => column === visible[index]))
      return saved.keyword;
  }
  if (!current) {
    const next: Scope = { source, columns, context, connectionScope, execution, generation: scope.generation + 1 };
    if (source && columns && scope.source !== source) {
      const keyword = readKeyword(source, columns);
      try {
        if (keyword) next.filter = { keyword, matches: matchQueryResultKeyword(source, columns, keyword) };
      } catch {
        // 原数据发生变化或超出预算时保留当前结果的原视图。
      }
    }
    setScope(next);
  }
  const filter = current ? scope.filter : undefined;
  useLayoutEffect(() => {
    if (!current || !source || !columns) return;
    // 只保留已提交的文本。草稿与带行引用的命中集合都随当前视图释放。
    if (filter) savedKeywords.set(source, { columns, connectionScope, execution, keyword: filter.keyword });
    else savedKeywords.delete(source);
  }, [savedKeywords, current, source, columns, connectionScope, execution, filter]);
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
  return { result, apply, readKeyword, generation: scope.generation, keyword: filter?.keyword ?? '' };
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
