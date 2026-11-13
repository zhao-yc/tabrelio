import { useLayoutEffect, useRef, useState } from 'react';
import { sqlSyntaxBoundary } from '../../shared/sqlSyntaxCheck';
import { formatText } from '../locales/zh-CN';
import { historyPagesZh as text } from '../locales/historyPages.zh-CN';
import { findSqlPreviewMatch } from '../sqlTextPreviewFind';

const sqlPartUnits = 65536;

/** 只把当前段放进界面，分段边界保留原 CRLF 和 Unicode 代理对。 */
export function SqlTextPreview({ title, sql, onClose, partLabels }: {
  title: string; sql: string; onClose?(): void; partLabels?: { previous: string; next: string; position: string };
}) {
  const [part, setPart] = useState(0);
  const [needle, setNeedle] = useState('');
  const [match, setMatch] = useState<number | null>();
  const pre = useRef<HTMLPreElement>(null);
  const highlight = useRef<HTMLElement>(null);
  const count = Math.max(1, Math.ceil(sql.length / sqlPartUnits));
  const boundary = (index: number) => {
    const offset = Math.min(sql.length, index * sqlPartUnits);
    return sqlSyntaxBoundary(sql, offset) ? offset : offset - 1;
  };
  const start = boundary(part), end = boundary(part + 1);
  const markStart = Math.max(start, match ?? end);
  const markEnd = Math.min(end, (match ?? end) + needle.length);

  /** 只滚动正文框，键盘查找时保留输入框焦点和外层历史列表位置。 */
  function scrollHighlight() {
    const box = pre.current, mark = highlight.current;
    if (box && mark) box.scrollTop += mark.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
  }
  useLayoutEffect(scrollHighlight, [part, match]);

  function find(backward: boolean) {
    if (!needle) return;
    const next = findSqlPreviewMatch(sql, needle, match, backward);
    setMatch(next);
    if (next !== null) {
      const section = Math.floor(next / sqlPartUnits);
      const target = next < boundary(section + 1) ? section : section + 1;
      if (next === match && target === part) scrollHighlight();
      setPart(target);
    }
  }

  return <section className="history-sql-preview" aria-label={title}>
    <div className="inline-field" role="search" aria-label={text.sqlFindTitle}>
      <input aria-label={text.sqlFindTitle} placeholder={text.sqlFindTitle} autoComplete="off" maxLength={512} value={needle}
        onChange={event => { setNeedle(event.target.value); setMatch(undefined); }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          find(event.shiftKey);
        }}/>
      <button disabled={!needle} onClick={() => find(true)}>{text.sqlFindPrevious}</button>
      <button disabled={!needle} onClick={() => find(false)}>{text.sqlFindNext}</button>
      {match !== undefined && <span role="status" aria-label={text.sqlFindStatus}>{match === null ? text.sqlFindMissing : text.sqlFindLocated}</span>}
    </div>
    <pre ref={pre} tabIndex={0}>{markStart < markEnd ? <>{sql.slice(start, markStart)}<mark ref={highlight}>{sql.slice(markStart, markEnd)}</mark>{sql.slice(markEnd, end)}</> : sql.slice(start, end)}</pre>
    <div className="inline-field"><button disabled={part === 0} onClick={() => setPart(part - 1)}>{partLabels?.previous ?? text.sqlPrevious}</button>
      <span role="status" aria-label={partLabels?.position ?? text.sqlPartStatus}>{formatText(text.sqlPart, part + 1, count)}</span>
      <button disabled={part + 1 >= count} onClick={() => setPart(part + 1)}>{partLabels?.next ?? text.sqlNext}</button>
      {onClose && <button onClick={onClose}>{text.sqlClose}</button>}
    </div></section>;
}
