import { useMemo, useState } from 'react';
import { postgresTableManagePreviewSchema } from '../../shared/postgresTableManage';
import { postgresTriggerEditorDraft, postgresTriggerEvents, postgresTriggerReplaceMinimum, type PostgresTriggerChange,
  type PostgresTriggerDefinition, type PostgresTriggerMode } from '../../shared/postgresTrigger';
import { invoke } from '../lib';
import { postgresTableTriggerZh as text } from '../locales/postgresTableTrigger.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

function newDefinition(schema: string): PostgresTriggerDefinition {
  return { timing: 'BEFORE', level: 'ROW', events: ['INSERT'], updateOf: [], functionSchema: schema, functionName: '', args: [] };
}

/** 表单只允许原表上的一项改动，预览绑定当前结构，删除需要单独确认。 */
export function PostgresTableTriggerPanel(props: PostgresStructureEditProps) {
  const { original, target, onClose } = props;
  const triggers = original.triggers?.filter(item => !item.internal && !item.inherited && !item.constraint) ?? [];
  const [kind, setKind] = useState<PostgresTriggerChange['kind']>('create');
  const [from, setFrom] = useState(triggers[0]?.name ?? '');
  const [name, setName] = useState('');
  const replacements = useMemo(() => {
    const drafts = new Map<string, PostgresTriggerDefinition>();
    if ((original.serverVersion ?? 0) >= postgresTriggerReplaceMinimum) {
      for (const trigger of original.triggers ?? []) {
        const draft = postgresTriggerEditorDraft(trigger, original.columns);
        if (draft) drafts.set(trigger.name, draft);
      }
    }
    return drafts;
  }, [original]);
  const [definition, setDefinition] = useState(() => newDefinition(original.schema));
  const { timing, level, events, updateOf, condition, functionSchema, functionName, args, oldTable, newTable } = definition;
  const patch = (change: Partial<PostgresTriggerDefinition>) => setDefinition(value => ({ ...value, ...change }));
  const trigger = triggers.find(item => item.name === from);
  const [mode, setMode] = useState<PostgresTriggerMode>(trigger?.mode ?? 'O');
  const creating = kind === 'create', replacing = kind === 'replace', dropping = kind === 'drop';
  const defining = creating || replacing;
  const candidates = replacing ? triggers.filter(item => replacements.has(item.name)) : triggers;
  const canDefine = !!functionSchema && !!functionName && !!events.length;
  const canPreview = creating ? !!name.trim() && canDefine : !!trigger &&
    (kind === 'rename' ? !!name.trim() && name !== from : kind === 'mode' ? mode !== trigger.mode :
      !replacing || replacements.has(from) && canDefine);
  const showTransitions = timing === 'AFTER' && events.length === 1 && !events.includes('TRUNCATE') || !!oldTable || !!newTable;
  const pick = (nextFrom: string, nextKind: PostgresTriggerChange['kind']) => {
    setFrom(nextFrom);
    setMode(triggers.find(item => item.name === nextFrom)?.mode ?? 'O');
    if (nextKind === 'replace') setDefinition(replacements.get(nextFrom) ?? newDefinition(original.schema));
    if (nextKind === 'create') setDefinition(newDefinition(original.schema));
    setError('');
  };
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, !!name || !!functionName || !!condition || !!args.length || !creating, dropping, () => {
      const draft = { ...definition, updateOf: events.includes('UPDATE') ? updateOf : [],
        condition: condition?.trim() ? condition : undefined };
      const change: PostgresTriggerChange = kind === 'create' ? { ...draft, kind, name } :
        kind === 'replace' ? { ...draft, kind, from } : kind === 'rename' ? { kind, from, name } :
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
          const next = event.target.value as PostgresTriggerChange['kind'];
          setKind(next); setName('');
          pick(next === 'replace' && !replacements.has(from) ? replacements.keys().next().value ?? '' : from, next);
        }}>{Object.entries(text.actions).map(([key, label]) =>
          <option key={key} value={key} disabled={key === 'replace' ? !replacements.size : key !== 'create' && !triggers.length}>
            {label}
          </option>)}</select></Field>
        {!creating && <Field label={text.existing}><select aria-label={text.existing} value={from} onChange={event => {
          pick(event.target.value, kind);
        }}>{candidates.map(item => <option key={item.oid}>{item.name}</option>)}</select></Field>}
        {(creating || kind === 'rename') && <Field label={text.name}>
          <input value={name} maxLength={63} onChange={event => setName(event.target.value)}/>
        </Field>}
        {kind === 'mode' && <Field label={text.mode}><select aria-label={text.mode} value={mode}
          onChange={event => setMode(event.target.value as PostgresTriggerMode)}>
          {Object.entries(text.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>}
        {defining && <>
          <Field label={text.timing}><select aria-label={text.timing} value={timing} onChange={event => patch({ timing: event.target.value as PostgresTriggerDefinition['timing'] })}>
            <option value="BEFORE">{text.before}</option><option value="AFTER">{text.after}</option>
          </select></Field>
          <Field label={text.level}><select aria-label={text.level} value={level} onChange={event => {
            const next = event.target.value as PostgresTriggerDefinition['level'];
            patch({ level: next, events: next === 'ROW' ? events.filter(value => value !== 'TRUNCATE') : events });
          }}><option value="ROW">{text.row}</option><option value="STATEMENT">{text.statement}</option></select></Field>
          <Field label={text.functionSchema}><input value={functionSchema} onChange={event => patch({ functionSchema: event.target.value })}/></Field>
          <Field label={text.functionName}><input value={functionName} onChange={event => patch({ functionName: event.target.value })}/></Field>
        </>}
      </div>
      {defining ? <>
        {replacing && <p>{text.replaceHint}</p>}
        <p>{text.functionHint}</p>
        <fieldset className="pg-trigger-events"><legend>{text.events}</legend>
          {postgresTriggerEvents.map(event => <label key={event}><input type="checkbox" checked={events.includes(event)}
            disabled={event === 'TRUNCATE' && level === 'ROW'} onChange={change => patch({ events: change.target.checked
              ? [...events, event] : events.filter(value => value !== event) })}/>{event}</label>)}
        </fieldset>
        {events.includes('UPDATE') && <Field label={text.updateOf}><select aria-label={text.updateOf} multiple size={4} value={updateOf}
          onChange={event => patch({ updateOf: Array.from(event.target.selectedOptions, item => item.value) })}>
          {original.columns.map(column => <option key={column.position}>{column.name}</option>)}
        </select></Field>}
        {showTransitions && <>
          <div className="pg-column-edit-fields">
            <Field label={text.oldTable}><input maxLength={63} value={oldTable ?? ''}
              onChange={event => patch({ oldTable: event.target.value || undefined })}/></Field>
            <Field label={text.newTable}><input maxLength={63} value={newTable ?? ''}
              onChange={event => patch({ newTable: event.target.value || undefined })}/></Field>
          </div>
          <p>{text.transitionHint}</p>
        </>}
        <Field label={text.condition}><textarea aria-label={text.condition} rows={2} maxLength={16384} value={condition ?? ''}
          onChange={event => patch({ condition: event.target.value })}/></Field>
        {args.map((arg, index) => <div className="pg-column-edit-fields" key={index}>
          <Field label={text.arg(index)}><textarea aria-label={text.arg(index)} value={arg} maxLength={4096} rows={arg.includes('\n') ? 2 : 1}
            onChange={event => patch({ args: args.map((value, position) => index === position ? event.target.value : value) })}/></Field>
          <button onClick={() => patch({ args: args.filter((_, position) => position !== index) })}>{text.removeArg(index)}</button>
        </div>)}
        <button disabled={args.length >= 16} onClick={() => patch({ args: [...args, ''] })}>{text.addArg}</button>
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
