import { useMemo, useState } from 'react';
import { postgresColumnPlan, type PostgresColumnChange } from '../../shared/postgresColumnEdit';
import { acceptsPostgresDefaultPreset, postgresCreateTypes,
  type PostgresColumnDefault, type PostgresColumnGeneration, type PostgresColumnType, type PostgresCreateColumn } from '../../shared/postgresCreateTable';
import { postgresColumnEditZh as text } from '../locales/postgresColumnEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ErrorBox } from './ui';
import { PostgresColumnDefaultFields } from './PostgresColumnDefaultFields';
import { PostgresColumnGenerationFields, PostgresGenerationExpression } from './PostgresColumnGenerationFields';

/** 在原结构视图中编辑结构化草稿，输入、预览和实际提交分别锁定。 */
export function PostgresColumnEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [kind, setKind] = useState<keyof typeof text.actions>('add');
  const [changes, setChanges] = useState<PostgresColumnChange[]>([]);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [type, setType] = useState<PostgresColumnType['type'] | ''>('text');
  const [length, setLength] = useState(''), [precision, setPrecision] = useState(''), [scale, setScale] = useState('');
  const [nullable, setNullable] = useState(true), [comment, setComment] = useState('');
  const [defaultValue, setDefaultValue] = useState<PostgresColumnDefault>({ mode: 'none' });
  const [generation, setGeneration] = useState<PostgresColumnGeneration>();
  const [generationDraft, setGenerationDraft] = useState<string>();
  const [removeGeneration, setRemoveGeneration] = useState(false);
  const [replacement, setReplacement] = useState<{ field: string; value: PostgresColumnDefault }>();
  const fields = useMemo(() => changes.length
    ? postgresColumnPlan(original, { ...target, editStamp: original.editStamp!, changes }).fields
    : original.columns.map(field => ({ name: field.name, type: field.type, identity: !!field.identity,
      generation: field.generation, generationExpression: field.generationExpression,
      defaultExpression: field.defaultExpression })), [original, target, changes]);
  const version = original.serverVersion ?? 0;
  const generatedFields = fields.filter(field => field.generation && (version >= 170000 || (version >= 130000 && field.generation === 's')));
  const candidates = kind === 'generation' ? generatedFields : fields;
  const selected = candidates.find(field => field.name === from) ?? candidates[0];
  const old = selected?.name ?? '';
  const replacementValue = replacement?.field === old ? replacement?.value : undefined;
  const canSetDefault = !!selected && !selected.identity && !selected.generation;
  const canRemoveGeneration = selected?.generation === 's' && version >= 130000;
  const removingGeneration = canRemoveGeneration && (removeGeneration || version < 170000);
  const generationText = generationDraft ?? selected?.generationExpression ?? '';
  const unstagedGeneration = kind === 'generation' && (generationDraft !== undefined || removeGeneration);
  const needsName = kind === 'add' || kind === 'rename';
  const needsType = kind === 'add' || kind === 'type';
  const dropping = changes.some(change => change.kind === 'drop');
  const canStage = (!needsName || !!name) && (!needsType || !!type) && (kind === 'add' || !!old) &&
    (kind !== 'default' || canSetDefault && !!replacementValue) &&
    (kind !== 'generation' || removingGeneration || (version >= 170000 && !!generationText.trim() && generationText !== selected?.generationExpression));

  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name || !!replacementValue || unstagedGeneration, dropping,
      () => invoke('postgres.columnEdit.preview', { ...target, editStamp: original.editStamp!, changes }),
      token => invoke('postgres.columnEdit.apply', { ...target, token }));

  /** 将当前表单编译成一项受限改动，及早发现批次中的名称冲突。 */
  function stage() {
    if (operation.current || unknown || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const dataType: PostgresColumnType = { type: type || 'text',
        ...(type === 'varchar' && length ? { length: Number(length) } : {}),
        ...(type === 'numeric' && precision ? { precision: Number(precision) } : {}),
        ...(type === 'numeric' && scale ? { scale: Number(scale) } : {}) };
      const field: PostgresCreateColumn = { ...dataType, name, nullable, primary: false, unique: false, identity: 'none',
        generation, default: defaultValue, comment };
      let change: PostgresColumnChange;
      switch (kind) {
        case 'add': change = { kind, field }; break;
        case 'rename': change = { kind, from: old, name }; break;
        case 'type': change = { kind, from: old, dataType }; break;
        case 'nullable': change = { kind, from: old, nullable }; break;
        case 'default': {
          if (!replacementValue) return;
          const mode = replacementValue.mode;
          change = mode === 'literal' || mode === 'none'
            ? { kind, from: old, value: replacementValue.mode === 'literal' ? replacementValue.value : null }
            : { kind: 'defaultPreset', from: old, preset: mode };
          break;
        }
        case 'comment': change = { kind, from: old, value: comment || null }; break;
        case 'generation': change = { kind, from: old, expression: removingGeneration ? null : generationText }; break;
        case 'drop': change = { kind, from: old }; break;
      }
      const next = [...changes, change];
      postgresColumnPlan(original, { ...target, editStamp: original.editStamp!, changes: next });
      setChanges(next);
      setPreview(undefined);
      setName('');
      setReplacement(undefined);
      setGenerationDraft(undefined);
      setRemoveGeneration(false);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{text.actions[kind]}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => {
          const action = event.target.value as keyof typeof text.actions;
          setKind(action);
          setName('');
          setType(action === 'add' ? 'text' : '');
          setLength('');
          setPrecision('');
          setScale('');
          setNullable(true);
          setDefaultValue({ mode: 'none' });
          setGeneration(undefined);
          setGenerationDraft(undefined);
          setRemoveGeneration(false);
          setReplacement(undefined);
          setComment('');
        }}>
          {Object.entries(text.actions).map(([action, label]) =>
            <option key={action} value={action} disabled={action === 'generation' ? !generatedFields.length : action !== 'add' && !fields.length}>{label}</option>)}
        </select></label>
        {kind !== 'add' && <label>{text.from}<select aria-label={text.from} value={old} onChange={event => {
          setFrom(event.target.value);
          setReplacement(undefined);
          setGenerationDraft(undefined);
          setRemoveGeneration(false);
        }}>
          {candidates.map(field => <option key={field.name}>{field.name}</option>)}
        </select></label>}
        {needsName && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
        {needsType && <>
          <label>{text.type}<select aria-label={text.type} value={type} onChange={event => {
            const next = event.target.value as PostgresColumnType['type'] | '';
            setType(next);
            const mode = defaultValue.mode;
            if (mode !== 'none' && mode !== 'literal' && !acceptsPostgresDefaultPreset(next, mode)) setDefaultValue({ mode: 'none' });
          }}>
            {kind === 'type' && <option value="" disabled>{text.chooseType}</option>}
            {postgresCreateTypes.map(value => <option key={value}>{value}</option>)}
          </select></label>
          {type === 'varchar' && <label>{text.length}<input type="number" min={1} value={length} onChange={event => setLength(event.target.value)}/></label>}
          {type === 'numeric' && <>
            <label>{text.precision}<input type="number" min={1} value={precision} onChange={event => setPrecision(event.target.value)}/></label>
            <label>{text.scale}<input type="number" min={0} value={scale} onChange={event => setScale(event.target.value)}/></label>
          </>}
        </>}
        {(kind === 'add' || kind === 'comment') &&
          <label>{text.comment}<input value={comment} onChange={event => setComment(event.target.value)}/></label>}
        {(kind === 'add' || kind === 'nullable') &&
          <label><input type="checkbox" checked={nullable} onChange={event => setNullable(event.target.checked)}/> {text.nullable}</label>}
        {kind === 'add' && !generation && <PostgresColumnDefaultFields type={type} value={defaultValue} onChange={setDefaultValue}/>}
        {kind === 'add' && version >= 120000 && <PostgresColumnGenerationFields value={generation} allowVirtual={version >= 180000}
          onChange={next => {
            setGeneration(next);
            if (next) setDefaultValue({ mode: 'none' });
          }}/>}
        {kind === 'default' && canSetDefault && <PostgresColumnDefaultFields type={selected.type} value={replacementValue}
          onChange={value => setReplacement({ field: old, value })} removeLabel={text.removeDefault}/>}
        {kind === 'generation' && selected && <>
          <label>{text.generationAction}<select aria-label={text.generationAction}
            value={removingGeneration ? 'remove' : 'replace'} onChange={event => {
              setGenerationDraft(undefined);
              setRemoveGeneration(event.target.value === 'remove');
            }}>
            {version >= 170000 && <option value="replace">{text.replaceGeneration}</option>}
            {canRemoveGeneration && <option value="remove">{text.removeGeneration}</option>}
          </select></label>
          {!removingGeneration && <PostgresGenerationExpression value={generationText} onChange={setGenerationDraft}/>}
        </>}
      </div>
      {kind === 'type' && <p>{text.typeNote}</p>}
      {kind === 'default' && (canSetDefault
        ? <p className="pg-column-default-expression">{text.existingDefault} <code>{selected.defaultExpression ?? text.noDefault}</code></p>
        : <p>{text.defaultUnavailable}</p>)}
      {kind === 'comment' && !comment && <p>{text.clearComment}</p>}
      {kind === 'generation' && removingGeneration && <p>{text.preserveGeneratedValues}</p>}
      {(kind === 'add' && generation?.mode === 'stored' ||
        kind === 'generation' && selected?.generation === 's' && !removingGeneration) && <p>{text.rewriteGeneration}</p>}
      <button disabled={!canStage || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, index) =>
      <li key={index}>{change.kind === 'add' ? text.adding(change.field.name) : change.kind === 'rename'
        ? text.renaming(change.from, change.name) : text.modifying(change)}</li>)}</ol>}
    {preview && <pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>}
    {preview && dropping && <label className="pg-column-edit-drop">
      <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/> {text.confirmDrop}
    </label>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || !changes.length || needsName && !!name || !!replacementValue || unstagedGeneration || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview || dropping && !acceptDrop} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
