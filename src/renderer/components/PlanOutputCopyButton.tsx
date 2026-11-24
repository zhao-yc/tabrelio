import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryResult } from '../../shared/contracts';
import { encodeClipboard, maxClipboardCells, maxClipboardCharacters, writeTableClipboardEvent } from '../gridClipboard';
import { errorMessage, ownCell } from '../lib';
import { explainZh as text } from '../locales/explain.zh-CN';

interface Props {
  raw?: string;
  table?: QueryResult;
  busy: boolean;
  truncated: boolean;
  isCurrent(): boolean;
}

/** 复制完整回包的文字或原表格，不从渲染后的树读取字段，也不重新执行查询。 */
export function PlanOutputCopyButton({ raw, table, busy, truncated, isCurrent }: Props) {
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>();
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => {
    committed.current = ticket;
    return () => { if (committed.current === ticket) committed.current = undefined; };
  });
  const available = !truncated && (!!raw || !!table?.columns.length && !!table.rows.length);
  const current = () => committed.current === ticket && !busy && available && isCurrent();

  function copy() {
    if (!current()) return;
    try {
      let content = raw;
      if (!content && table) {
        const { columns, rows } = table;
        if ((rows.length + 1) * columns.length > maxClipboardCells) throw Error(text.copyTooLarge);
        const values = rows.map(row => columns.map(column => {
          const value = ownCell(row, column.key);
          if (value === undefined) throw Error(text.copyUnavailable);
          return value;
        }));
        content = encodeClipboard(values, columns.map(column => column.name)).text;
      }
      if (!content || content.length > maxClipboardCharacters) throw Error(text.copyTooLarge);
      const output = content;
      writeTableClipboardEvent(current, data => data.setData('text/plain', output));
      setFeedback({ message: text.copiedOutput, error: false });
    } catch (reason) {
      if (current()) setFeedback({ message: errorMessage(reason), error: true });
    }
  }

  return <><button type="button" onClick={copy} disabled={busy || !available}
    title={truncated ? text.copyTruncated : available ? undefined : text.copyUnavailable}>{text.copyOutput}</button>
    {feedback && <span className="muted" role={feedback.error ? 'alert' : 'status'}>{feedback.message}</span>}</>;
}
