import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { queryFileTextDifference } from '../../shared/queryFileReload';
import { historyPagesZh as text } from '../locales/historyPages.zh-CN';
import { SqlTextPreview } from './SqlTextPreview';
import '../query-file-reload.css';

export interface HistorySqlComparisonSource { id: string; label: string; sql: string; }

/** 差异区间沿用线性比较。完整正文按需分段展示，两侧的查找和翻段互不影响。 */
export function HistorySqlComparison({ sources, onClose }: {
  sources: readonly [HistorySqlComparisonSource, HistorySqlComparisonSource]; onClose(): void;
}) {
  const [reversed, setReversed] = useState(false);
  const [full, setFull] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const [left, right] = reversed ? [sources[1], sources[0]] : sources;
  const difference = useMemo(() => queryFileTextDifference(left.sql, right.sql), [left, right]);
  const changed = !!(difference.beforeUnits || difference.afterUnits);
  const sides = [
    { source: left, label: text.compareLeft, fullLabel: text.compareLeftFull, excerpt: difference.before },
    { source: right, label: text.compareRight, fullLabel: text.compareRightFull, excerpt: difference.after },
  ];

  return <section aria-label={text.compareTitle}>
    <div className="inline-field">
      <h3 ref={heading} tabIndex={-1}>{text.compareTitle}</h3>
      <button type="button" onClick={() => setReversed(value => !value)}>{text.compareSwap}</button>
      <button type="button" aria-expanded={full} onClick={() => setFull(value => !value)}>{full ? text.compareHideFull : text.compareShowFull}</button>
      <button type="button" onClick={onClose}>{text.compareClose}</button>
    </div>
    <p role="status">{changed
      ? text.compareCounts(difference.prefixUnits, difference.suffixUnits, difference.beforeUnits, difference.afterUnits)
      : text.compareSame}</p>
    {!full && (difference.beforeTruncated || difference.afterTruncated) && <p className="muted small">{text.compareOmitted}</p>}
    <div className="query-file-reload-diff">{sides.map(side => <section key={side.source.id} aria-label={side.label}>
      <h4>{side.label}</h4><p>{side.source.label}</p>
      {full ? <SqlTextPreview title={side.fullLabel} sql={side.source.sql}/>
        : changed && <pre tabIndex={0}>{side.excerpt || text.compareEmpty}</pre>}
    </section>)}</div>
  </section>;
}
