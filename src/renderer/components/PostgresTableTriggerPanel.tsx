import { useState } from 'react';
import { postgresTableManagePreviewSchema } from '../../shared/postgresTableManage';
import { postgresTriggerEvents, type PostgresTriggerChange, type PostgresTriggerMode } from '../../shared/postgresTrigger';
import { invoke } from '../lib';
import { postgresTableTriggerZh as text } from '../locales/postgresTableTrigger.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

type Create = Extract<PostgresTriggerChange, { kind: 'create' }>;

/** 表单只允许原表上的一项改动，预览绑定当前结构，删除需要单独确认。 */
export function PostgresTableTriggerPanel(props: PostgresStructureEditProps) {
  const { original, target, onClose } = props;
  const triggers = original.triggers?.filter(item => !item.internal && !item.inherited && !item.constraint) ?? [];
  const [kind, setKind] = useState<PostgresTriggerChange['kind']>('create');
  const [from, setFrom] = useState(triggers[0]?.name ?? '');
  const [name, setName] = useState('');
  const [timing, setTiming] = useState<Create['timing']>('BEFORE'), [level, setLevel] = useState<Create['level']>('ROW');
  const [events, setEvents] = useState<Create['events']>(['INSERT']);
  const [updateOf, setUpdateOf] = useState<string[]>([]);
  const [condition, setCondition] = useState('');
  const [functionSchema, setFunctionSchema] = useState(original.schema), [functionName, setFunctionName] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const trigger = triggers.find(item => item.name === from);
  const [mode, setMode] = useState<PostgresTriggerMode>(trigger?.mode ?? 'O');
  const creating = kind === 'create', dropping = kind === 'drop';
  const canPreview = creating ? !!name.trim() && !!functionSchema && !!functionName && !!events.length : !!trigger &&
    (kind === 'rename' ? !!name.trim() && name !== from : kind !== 'mode' || mode !== trigger.mode);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, !!name || !!functionName || !!condition || !!args.length || !creating, dropping, () => {
      const change: PostgresTriggerChange = kind === 'create' ? { kind, name, timing, level, events,
        updateOf: events.includes('UPDATE') ? updateOf : [], condition: condition.trim() ? condition : undefined,
        functionSchema, functionName, args } : kind === 'rename' ? { kind, from, name } :
        kind === 'mode' ? { kind, from, mode } : { kind, from };
      return invoke('postgres.tableManage.preview', postgresTableManagePreviewSchema.parse({
        ...target, action: 'trigger', stamp: original.editStamp, change,
      }));
    }, token => invoke('postgres.tableManage.apply', { connectionId: target.connectionId, database: target.database, token, confirmed: true }));

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && <label className="pg-column-edit-drop"><input type="checkbox" checked={acceptDrop} disabled={busy || unknown}
        onChange={event => setAcceptDrop(event.target.checked)}/>{text.confirmDrop}</label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.operation}><select aria-label={text.operation} value={kind} onChange={event => {
          setKind(event.target.value as PostgresTriggerChange['kind']); setName(''); setMode(trigger?.mode ?? 'O'); setError('');
        }}>{Object.entries(text.actions).map(([key, label]) =>
          <option key={key} value={key} disabled={key !== 'create' && !triggers.length}>{label}</option>)}</select></Field>
        {!creating && <Field label={text.existing}><select aria-label={text.existing} value={from} onChange={event => {
          const next = triggers.find(item => item.name === event.target.value)!;
          setFrom(next.name); setMode(next.mode); setError('');
        }}>{triggers.map(item => <option key={item.oid}>{item.name}</option>)}</select></Field>}
        {(creating || kind === 'rename') && <Field label={text.name}>
          <input value={name} maxLength={63} onChange={event => setName(event.target.value)}/>
        </Field>}
        {kind === 'mode' && <Field label={text.mode}><select aria-label={text.mode} value={mode}
          onChange={event => setMode(event.target.value as PostgresTriggerMode)}>
          {Object.entries(text.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>}
        {creating && <>
          <Field label={text.timing}><select aria-label={text.timing} value={timing} onChange={event => setTiming(event.target.value as Create['timing'])}>
            <option value="BEFORE">{text.before}</option><option value="AFTER">{text.after}</option>
          </select></Field>
          <Field label={text.level}><select aria-label={text.level} value={level} onChange={event => {
            const next = event.target.value as Create['level'];
            setLevel(next);
            if (next === 'ROW') setEvents(values => values.filter(value => value !== 'TRUNCATE'));
          }}><option value="ROW">{text.row}</option><option value="STATEMENT">{text.statement}</option></select></Field>
          <Field label={text.functionSchema}><input value={functionSchema} onChange={event => setFunctionSchema(event.target.value)}/></Field>
          <Field label={text.functionName}><input value={functionName} onChange={event => setFunctionName(event.target.value)}/></Field>
        </>}
      </div>
      {creating ? <>
        <p>{text.functionHint}</p>
        <fieldset className="pg-trigger-events"><legend>{text.events}</legend>
          {postgresTriggerEvents.map(event => <label key={event}><input type="checkbox" checked={events.includes(event)}
            disabled={event === 'TRUNCATE' && level === 'ROW'} onChange={change => setEvents(values => change.target.checked
              ? [...values, event] : values.filter(value => value !== event))}/>{event}</label>)}
        </fieldset>
        {events.includes('UPDATE') && <Field label={text.updateOf}><select aria-label={text.updateOf} multiple size={4} value={updateOf}
          onChange={event => setUpdateOf(Array.from(event.target.selectedOptions, item => item.value))}>
          {original.columns.map(column => <option key={column.position}>{column.name}</option>)}
        </select></Field>}
        <Field label={text.condition}><textarea aria-label={text.condition} rows={2} maxLength={16384} value={condition}
          onChange={event => setCondition(event.target.value)}/></Field>
        {args.map((arg, index) => <div className="pg-column-edit-fields" key={index}>
          <Field label={text.arg(index)}><input value={arg} maxLength={4096}
            onChange={event => setArgs(values => values.map((value, position) => index === position ? event.target.value : value))}/></Field>
          <button onClick={() => setArgs(values => values.filter((_, position) => position !== index))}>{text.removeArg(index)}</button>
        </div>)}
        <button disabled={args.length >= 16} onClick={() => setArgs(values => [...values, ''])}>{text.addArg}</button>
      </> : trigger && <pre aria-label={text.definition} tabIndex={0}>{trigger.definition}</pre>}
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={dropping ? 'danger' : 'primary'} disabled={busy || unknown || dropping && !acceptDrop}
          onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !canPreview} onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
