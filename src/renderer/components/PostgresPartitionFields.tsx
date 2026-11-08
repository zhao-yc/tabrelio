import { movePostgresCreateKey, PostgresCreateKeyOrder } from './PostgresCreateKeyOrder';
import { postgresPartitionStrategies, type PostgresCreateColumn, type PostgresPartitionBound, type PostgresPartitionDesign, type PostgresPartitionValue } from '../../shared/postgresCreateTable';
import { uid } from '../lib';
import { postgresCreateTableZh } from '../locales/postgresCreateTable.zh-CN';
import { Field } from './ui';

type KeyField = Pick<PostgresCreateColumn, 'name' | 'generation'> & { id: string };
type Strategy = PostgresPartitionDesign['strategy'];
const text = postgresCreateTableZh.partition;
type ListValue = { id: string; value: string | null };
export type PostgresPartitionBoundDraft = {
  useDefault: boolean;
  from: Record<string, PostgresPartitionValue>; to: Record<string, PostgresPartitionValue>;
  values: ListValue[]; modulus: string; remainder: string;
};
type ChildDraft = PostgresPartitionBoundDraft & { id: string; name: string };
export interface PostgresPartitionDraft {
  strategy: Strategy | ''; keyIds: string[]; children: ChildDraft[];
}

const emptyValue: PostgresPartitionValue = { kind: 'value', value: '' };
const listValue = (): ListValue => ({ id: uid(), value: '' });

export function newPostgresPartitionBound(): PostgresPartitionBoundDraft {
  return { useDefault: false, from: {}, to: {}, values: [listValue()], modulus: '', remainder: '' };
}

export function compilePostgresPartitionBound(strategy: Strategy, child: PostgresPartitionBoundDraft,
  keys: readonly { id: string }[]): PostgresPartitionBound {
  if (strategy !== 'hash' && child.useDefault) return { kind: 'default' };
  if (strategy === 'list') return { kind: strategy, values: child.values.map(item => item.value) };
  if (strategy === 'hash') return { kind: strategy,
    modulus: child.modulus.trim() ? Number(child.modulus) : Number.NaN,
    remainder: child.remainder.trim() ? Number(child.remainder) : Number.NaN };
  return { kind: strategy, from: keys.map(field => child.from[field.id] ?? emptyValue),
    to: keys.map(field => child.to[field.id] ?? emptyValue) };
}

function keyFields(draft: PostgresPartitionDraft, fields: KeyField[]) {
  return draft.keyIds.flatMap(id => {
    const field = fields.find(item => item.id === id);
    return field && field.name.trim() && !field.generation ? [field] : [];
  });
}

/** 字段 ID 只用于表单关联。编译时按实际列名和选中顺序生成受校验的结构。 */
export function compilePostgresPartition(draft: PostgresPartitionDraft, fields: KeyField[]): PostgresPartitionDesign | undefined {
  const strategy = draft.strategy;
  if (!strategy) return undefined;
  const keys = keyFields(draft, fields);
  return {
    strategy, keys: keys.map(field => field.name),
    children: draft.children.map(child => ({ ...compilePostgresPartitionBound(strategy, child, keys), name: child.name })),
  };
}

/** RANGE 的每一项只有文字、MINVALUE 或 MAXVALUE 三种来源。 */
function RangeValueField({ label, value, onChange }: {
  label: string; value: PostgresPartitionValue; onChange(value: PostgresPartitionValue): void;
}) {
  return <>
    <Field label={label + text.boundMode}><select aria-label={label + text.boundMode} value={value.kind} onChange={event => {
      const kind = event.target.value;
      onChange(kind === 'min' || kind === 'max' ? { kind } : emptyValue);
    }}>
      <option value="value">{text.value}</option><option value="min">MINVALUE</option><option value="max">MAXVALUE</option>
    </select></Field>
    {value.kind === 'value' && <Field label={label}><input maxLength={4096} value={value.value}
      onChange={event => onChange({ kind: 'value', value: event.target.value })}/></Field>}
  </>;
}

/** 已有父表和初始建表共用边界控件，不允许用户输入原文 SQL。 */
export function PostgresPartitionBoundFields({ strategy, child, keys, defaultUnavailable, patch }: {
  strategy: Strategy; child: PostgresPartitionBoundDraft; keys: readonly { id: string; name: string }[];
  defaultUnavailable?: boolean; patch(value: Partial<PostgresPartitionBoundDraft>): void;
}) {
  return <>
    {strategy !== 'hash' && !defaultUnavailable && <label><input type="checkbox" checked={child.useDefault}
      onChange={event => patch({ useDefault: event.target.checked })}/>{text.default}</label>}
    {strategy === 'range' && !child.useDefault && keys.map(field => <div className="pg-partition-bound" key={field.id}>
      <RangeValueField label={field.name + text.from} value={child.from[field.id] ?? emptyValue}
        onChange={value => patch({ from: { ...child.from, [field.id]: value } })}/>
      <RangeValueField label={field.name + text.to} value={child.to[field.id] ?? emptyValue}
        onChange={value => patch({ to: { ...child.to, [field.id]: value } })}/>
    </div>)}
    {strategy === 'list' && !child.useDefault && <div className="pg-partition-bound">
      {child.values.map((entry, valueIndex) => <div className="pg-partition-list-value" key={entry.id}>
        <Field label={text.listValue(valueIndex + 1)}><input maxLength={4096} value={entry.value ?? ''} disabled={entry.value === null}
          onChange={event => patch({ values: child.values.map(item => item.id === entry.id
            ? { ...item, value: event.target.value } : item) })}/></Field>
        <label><input type="checkbox" checked={entry.value === null} onChange={event => patch({
          values: child.values.map(item => item.id === entry.id ? { ...item, value: event.target.checked ? null : '' } : item),
        })}/>NULL</label>
        <button disabled={child.values.length === 1} onClick={() => patch({
          values: child.values.filter(item => item.id !== entry.id),
        })}>{text.removeValue}</button>
      </div>)}
      <button disabled={child.values.length >= 128}
        onClick={() => patch({ values: [...child.values, listValue()] })}>{text.addValue}</button>
    </div>}
    {strategy === 'hash' && <>
      <Field label={text.modulus}><input type="number" min={1} max={2147483647} value={child.modulus}
        onChange={event => patch({ modulus: event.target.value })}/></Field>
      <Field label={text.remainder}><input type="number" min={0} max={2147483646} value={child.remainder}
        onChange={event => patch({ remainder: event.target.value })}/></Field>
    </>}
  </>;
}

export function PostgresPartitionFields({ draft, fields, onChange }: {
  draft: PostgresPartitionDraft; fields: KeyField[]; onChange(value: PostgresPartitionDraft): void;
}) {
  const { strategy, children } = draft;
  const keys = keyFields(draft, fields), ids = keys.map(field => field.id);
  const eligible = fields.filter(field => field.name.trim() && !field.generation);
  function patch(child: ChildDraft, value: Partial<ChildDraft>) {
    onChange({ ...draft, children: children.map(item => item.id === child.id ? { ...item, ...value } : item) });
  }
  return <section className="pg-create-partition">
    <Field label={text.strategy}><select aria-label={text.strategy} value={strategy} onChange={event => {
      const next = event.target.value as PostgresPartitionDraft['strategy'];
      onChange({ ...draft, strategy: next, keyIds: next === 'list' ? ids.slice(0, 1) : ids });
    }}>
      <option value="">{text.none}</option>
      {postgresPartitionStrategies.map(item => <option key={item} value={item}>{text.strategies[item]}</option>)}
    </select></Field>
    {strategy && <>
      <fieldset className="pg-create-field">
        <legend>{text.keys}</legend>
        {eligible.map(field => {
          const index = ids.indexOf(field.id);
          return <label key={field.id}><input type="checkbox" checked={index >= 0} disabled={index < 0 && ids.length >= 32}
            onChange={event => onChange({ ...draft, keyIds: event.target.checked
              ? strategy === 'list' ? [field.id] : [...ids, field.id] : ids.filter(id => id !== field.id) })}/>
            {field.name}{index >= 0 ? ' (' + (index + 1) + ')' : ''}
          </label>;
        })}
        {!eligible.length && <p>{text.noFields}</p>}
      </fieldset>
      <PostgresCreateKeyOrder label={text.keyOrder} fields={keys} onMove={(id, direction) => {
        const keyIds = movePostgresCreateKey(ids, id, direction);
        if (keyIds) onChange({ ...draft, keyIds });
      }}/>
      <p>{text.hints[strategy]}</p>
      {children.map((child, index) => <fieldset key={child.id} className="pg-create-field">
        <legend>{text.child(index + 1)}</legend>
        <Field label={text.name}><input value={child.name} onChange={event => patch(child, { name: event.target.value })}/></Field>
        <PostgresPartitionBoundFields strategy={strategy} keys={keys} child={child} patch={value => patch(child, value)}/>
        <button onClick={() => onChange({ ...draft, children: children.filter(item => item.id !== child.id) })}>{text.remove}</button>
      </fieldset>)}
      <button disabled={children.length >= 32} onClick={() => onChange({ ...draft, children: [...children, {
        id: uid(), name: '', ...newPostgresPartitionBound(),
      }] })}>{text.add}</button>
    </>}
  </section>;
}
