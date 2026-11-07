import { useState } from 'react';
import { postgresPolicyCommands, postgresPolicyRequiresReplacement, type PostgresPolicyCatalog,
  type PostgresPolicyChange, type PostgresPolicyDefinition } from '../../shared/postgresPolicy';
import { postgresTableManagePreviewSchema } from '../../shared/postgresTableManage';
import { invoke } from '../lib';
import { postgresTablePolicyZh as text } from '../locales/postgresTablePolicy.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

function newDefinition(old?: PostgresPolicyCatalog): PostgresPolicyDefinition {
  return old ? { command: old.command, permissive: old.permissive,
    roles: old.roles.some(role => role.oid === '0') ? null : old.roles.map(role => role.name), using: old.using, check: old.check }
    : { command: 'ALL', permissive: true, roles: [''], using: null, check: null };
}

/** 表单锁定准确的表和目录摘要，策略重建与 RLS 状态改动在预览后单独确认。 */
export function PostgresTablePolicyPanel(props: PostgresStructureEditProps) {
  const { original, target, onClose } = props;
  const policies = original.policies ?? [];
  const [kind, setKind] = useState<PostgresPolicyChange['kind']>(policies.length ? 'edit' : 'create');
  const [from, setFrom] = useState(policies[0]?.name ?? '');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(original.rowSecurity), [forced, setForced] = useState(original.forceRowSecurity);
  const [definition, setDefinition] = useState(() => newDefinition(policies[0]));
  const patch = (change: Partial<PostgresPolicyDefinition>) => setDefinition(value => ({ ...value, ...change }));
  const { command, permissive, roles, using, check } = definition;
  const current = policies.find(policy => policy.name === from);
  const defining = kind === 'create' || kind === 'edit';
  const existing = kind === 'edit' || kind === 'rename' || kind === 'drop';
  const usingAllowed = command !== 'INSERT', checkAllowed = command !== 'SELECT' && command !== 'DELETE';
  const draft = { ...definition, using: usingAllowed && using?.trim() ? using : null, check: checkAllowed && check?.trim() ? check : null };
  const replacing = kind === 'edit' && !!current && postgresPolicyRequiresReplacement(current, draft);
  const blocked = replacing && current?.rebuildBlocked;
  const confirmation = kind === 'state' ? text.confirmState : kind === 'drop' ? text.confirmDrop : replacing ? text.confirmRebuild : '';
  const canPreview = kind === 'state' ? enabled !== original.rowSecurity || forced !== original.forceRowSecurity :
    (!existing || !!current) && ((kind !== 'create' && kind !== 'rename') || !!name.trim()) &&
    (!defining || (roles === null || roles.every(role => role.trim())) && !blocked);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, canPreview, !!confirmation, () => {
      const change: PostgresPolicyChange = kind === 'create' ? { ...draft, kind, name } : kind === 'edit' ? { ...draft, kind, from } :
        kind === 'rename' ? { kind, from, name } : kind === 'drop' ? { kind, from } : { kind, enabled, forced };
      return invoke('postgres.tableManage.preview', postgresTableManagePreviewSchema.parse({
        ...target, action: 'policy', stamp: original.policyStamp, change,
      }));
    }, token => invoke('postgres.tableManage.apply', { connectionId: target.connectionId, database: target.database, token, confirmed: true }));

  return <section className="pg-column-edit" aria-label={text.title}>
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {confirmation && <label className="pg-column-edit-drop"><input type="checkbox" checked={acceptDrop}
        disabled={busy || unknown} onChange={event => setAcceptDrop(event.target.checked)}/>{confirmation}</label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.operation}><select aria-label={text.operation} value={kind} onChange={event => {
          const next = event.target.value as PostgresPolicyChange['kind'];
          setKind(next); setName(''); setError('');
          if (next === 'create' || next === 'edit') setDefinition(newDefinition(next === 'edit' ? current : undefined));
        }}>{Object.entries(text.actions).map(([key, label]) => <option key={key} value={key}
          disabled={key !== 'state' && key !== 'create' && !policies.length}>{label}</option>)}</select></Field>
        {existing && <Field label={text.existing}><select aria-label={text.existing} value={from} onChange={event => {
          setFrom(event.target.value); setName(''); setError('');
          if (kind === 'edit') setDefinition(newDefinition(policies.find(policy => policy.name === event.target.value)));
        }}>{policies.map(policy => <option key={policy.oid}>{policy.name}</option>)}</select></Field>}
        {(kind === 'create' || kind === 'rename') && <Field label={text.name}>
          <input value={name} maxLength={63} onChange={event => setName(event.target.value)}/>
        </Field>}
        {defining && <>
          <Field label={text.command}><select aria-label={text.command} value={command}
            onChange={event => patch({ command: event.target.value as PostgresPolicyDefinition['command'] })}>
            {postgresPolicyCommands.map(value => <option key={value}>{value}</option>)}
          </select></Field>
          <Field label={text.type}><select aria-label={text.type} value={permissive ? 'permissive' : 'restrictive'}
            onChange={event => patch({ permissive: event.target.value === 'permissive' })}>
            <option value="permissive">{text.permissive}</option><option value="restrictive">{text.restrictive}</option>
          </select></Field>
          <Field label={text.roles}><select aria-label={text.roles} value={roles === null ? 'public' : 'named'}
            onChange={event => patch({ roles: event.target.value === 'public' ? null : [''] })}>
            <option value="named">{text.named}</option><option value="public">{text.public}</option>
          </select></Field>
        </>}
      </div>
      {kind === 'state' && <>
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> {text.enabled}</label>
        <label><input type="checkbox" checked={forced} onChange={event => setForced(event.target.checked)}/> {text.forced}</label>
        <p>{text.stateHint}</p><p>{text.forcedHint}</p>
      </>}
      {defining && <>
        {roles?.map((role, index) => <div className="pg-column-edit-fields" key={index}>
          <Field label={text.role(index)}><input value={role} onChange={event =>
            patch({ roles: roles.map((value, i) => i === index ? event.target.value : value) })}/></Field>
          <button disabled={roles.length === 1} onClick={() => patch({ roles: roles.filter((_, i) => i !== index) })}>
            {text.removeRole(index)}
          </button>
        </div>)}
        {roles && <button disabled={roles.length >= 64} onClick={() => patch({ roles: [...roles, ''] })}>{text.addRole}</button>}
        <p>{text.usingHint}</p>
        {usingAllowed && <Field label={text.using}><textarea aria-label={text.using} rows={2} maxLength={16384} value={using ?? ''}
          onChange={event => patch({ using: event.target.value || null })}/></Field>}
        {checkAllowed && <Field label={text.check}><textarea aria-label={text.check} rows={2} maxLength={16384} value={check ?? ''}
          onChange={event => patch({ check: event.target.value || null })}/></Field>}
        {(command === 'ALL' || command === 'UPDATE') && <p>{text.checkFallback}</p>}
        {blocked && <p>{text.rebuildBlocked}</p>}
      </>}
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={confirmation ? 'danger' : 'primary'} disabled={busy || unknown || !!confirmation && !acceptDrop}
          onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !canPreview} onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
