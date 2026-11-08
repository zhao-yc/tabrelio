import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib';
import type { fullQueryExportProfilesZh } from '../locales/fullQueryExportProfiles.zh-CN';
import { ErrorBox, Field } from './ui';

type Selection = { name: string; revision: string };
export type NamedProfileChange<Options> =
  | { kind: 'add'; profile: { name: string; options: Options } }
  | { kind: 'update'; selected: Selection; profile: { name: string; options: Options } }
  | { kind: 'delete'; selected: Selection };

export function NamedProfiles<Options, Entry extends Selection>({ options, disabled, limits, text, list, mutate, onApply }: {
  options?: Options;
  disabled: boolean;
  limits: { count: number; name: number };
  text: Omit<typeof fullQueryExportProfilesZh, 'tableHint' | 'unavailableFields' | 'unavailableFormat' | 'fieldOrder'>;
  list(): Promise<Entry[]>;
  mutate(input: NamedProfileChange<Options>): Promise<Entry[]>;
  onApply(entry: Entry): boolean | Promise<boolean>;
}) {
  const [profiles, setProfiles] = useState<Entry[]>();
  const [selection, setSelection] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [opened, setOpened] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    void list().then(result => {
      if (active) setProfiles(result);
    }).catch(reason => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [list, opened, reload]);

  const selected = profiles?.find(item => item.name === selection);
  const blocked = disabled || saving || !profiles;
  const canSave = !blocked && !!options && !!name.trim();

  /** 只在主进程完成写盘后更新列表和回执，失败时保留方案及当前配置。 */
  async function change(kind: NamedProfileChange<Options>['kind']) {
    if (blocked || writing.current) return;
    const target = selected && { name: selected.name, revision: selected.revision };
    const profile = options && { name: name.trim(), options };
    let input: NamedProfileChange<Options>;
    if (kind === 'delete' && target) input = { kind, selected: target };
    else if (kind === 'update' && target && profile?.name) input = { kind, selected: target, profile };
    else if (kind === 'add' && profile?.name) input = { kind, profile };
    else return;

    writing.current = true;
    setSaving(true); setError(''); setNotice('');
    try {
      setProfiles(await mutate(input));
      const savedName = input.kind === 'delete' ? '' : input.profile.name;
      setSelection(savedName); setName(savedName);
      setNotice(input.kind === 'delete' ? text.deleted : text.saved);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { writing.current = false; setSaving(false); }
  }

  async function apply() {
    if (blocked || writing.current || !selected) return;
    writing.current = true;
    setSaving(true); setError(''); setNotice('');
    try {
      if (await onApply(selected)) setNotice(text.applied);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { writing.current = false; setSaving(false); }
  }

  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{text.title}</summary>
    <p className="muted small">{text.hint}</p>
    {!profiles && !error && <p>{text.loading}</p>}
    <Field label={text.select}><select aria-label={text.select} value={selected?.name ?? ''} disabled={blocked} onChange={event => {
      setSelection(event.target.value); setName(event.target.value); setError(''); setNotice('');
    }}>
      <option value="">{text.placeholder}</option>
      {profiles?.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></Field>
    <div className="inline-field">
      <button disabled={blocked || !selected} onClick={() => void apply()}>{text.apply}</button>
      <button disabled={blocked || !selected} onClick={() => void change('delete')}>{text.delete}</button>
    </div>
    <Field label={text.name}><input value={name} maxLength={limits.name} disabled={blocked}
      onChange={event => setName(event.target.value)}/></Field>
    <div className="inline-field">
      <button disabled={!canSave || (profiles?.length ?? 0) >= limits.count} onClick={() => void change('add')}>{text.add}</button>
      <button disabled={!canSave || !selected} onClick={() => void change('update')}>{text.update}</button>
    </div>
    <p className="muted small" aria-live="polite">{notice}</p>
    <ErrorBox message={error}/>
    {error && <button disabled={disabled || saving} onClick={() => {
      setError(''); setProfiles(undefined); setSelection(''); setReload(value => value + 1);
    }}>{text.reload}</button>}
  </details>;
}
