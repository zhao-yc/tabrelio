import { useState } from 'react';
import type { CommandMap } from '../../shared/contracts';
import type { DraftRow } from '../dataChanges';
import { errorMessage, ownCell } from '../lib';
import { mysqlQueryBatchEditZh as text } from '../locales/mysqlQueryBatchEdit.zh-CN';
import { assertCopiedRecordKeys, duplicateRecordDraft } from '../recordDuplicate';
import {
  beginRecordDraft, editRecordInput, initialRecordInput, recordFieldTooLarge, recordValueSummary, stageRecordDraft, type RecordContext,
} from '../recordViews';
import { RecordValueEditor } from './RecordValueEditor';
import { ErrorBox, Field } from './ui';

type BatchRecord = CommandMap['mysql.queryBatchEdit']['output'];

/** 使用普通表页的新增草稿与键校验，来源值保持只读，并保留未投影字段的原值。 */
export function prepareMysqlQueryCopy(record: BatchRecord, connectionId: string) {
  const { info } = record;
  const context: RecordContext = { target: { connectionId, database: info.database, table: info.name }, generation: 0,
    connectionVersion: 0, info, loaded: true, stale: false, busy: false };
  const originals = record.rows.map((data, index): DraftRow => ({ id: 'source-' + index, data, original: data, inserted: false, deleted: false }));
  const writable = new Set(record.columns);
  const rows = originals.map((source, index) => {
    const draft = duplicateRecordDraft([source], source.id, context, 'copy-' + index)[1];
    return { ...draft, data: Object.fromEntries(Object.entries(draft.data).filter(([key]) => writable.has(key))) };
  });
  return { originals, rows, context, columns: info.columns.filter(column => writable.has(column.name)) };
}

export function MysqlQueryCopyDraftEditor({ draft, displayRows, busy, isCurrent, onPreview }: {
  draft: ReturnType<typeof prepareMysqlQueryCopy>; displayRows: number[]; busy: boolean; isCurrent(): boolean; onPreview(rows: DraftRow[]): void;
}) {
  const { originals, context, columns, rows } = draft;
  const [index, setIndex] = useState(0), [field, setField] = useState(columns[0]?.name), [error, setError] = useState('');
  const [inputs, setInputs] = useState(() => rows.map(row => beginRecordDraft(row, context)));
  const row = rows[index], input = inputs[index];
  const column = columns.find(item => item.name === field);
  const value = column && !recordFieldTooLarge(ownCell(row.data, column.name)) ? input.fields.get(column.name) ?? initialRecordInput(input, column) : undefined;

  function stage() {
    if (!isCurrent() || busy) return;
    try {
      const next = rows.map((item, position) => stageRecordDraft([item], inputs[position], context)[0]);
      assertCopiedRecordKeys([...originals, ...next], context.info!, new Set(next.map(item => item.id)));
      setError('');
      onPreview(next);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <>
    <p>{text.copyHint}</p>
    <Field label={text.copyRow}><select value={index} disabled={busy} onChange={event => { setIndex(Number(event.target.value)); setError(''); }}>
      {displayRows.map((position, index) => <option key={position} value={index}>{position}</option>)}
    </select></Field>
    {!!columns.length && <Field label={text.copyField}><select value={field} disabled={busy} onChange={event => { setField(event.target.value); setError(''); }}>
      {columns.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></Field>}
    {column && value && <RecordValueEditor key={JSON.stringify([row.id, column.name])} column={column} input={value} inserted focus={false}
      reason={busy ? text.reading : ''} source={[row, column]} isCurrent={() => !busy && isCurrent()} onChange={next => {
        try {
          const edited = editRecordInput(input, column, next);
          setInputs(current => current.map((item, position) => position === index ? edited : item)); setError('');
        } catch (reason) { setError(errorMessage(reason)); }
      }}/>}
    {column && !value && <p>{recordValueSummary(ownCell(row.data, column.name))}</p>}
    <ErrorBox message={error}/>
    <button className="primary" disabled={busy} onClick={stage}>{text.copyPreview}</button>
  </>;
}
