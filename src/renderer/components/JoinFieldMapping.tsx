import { useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { queryBuilderJoinZh as text } from '../locales/queryBuilderJoin.zh-CN';
import './QueryBuilderJoinPanel.css';

interface Relation { label: string; columns: readonly { name: string }[]; }
interface Pick { source: number; name: string; revision: object; }
export type JoinFieldLinkResult = 'added' | 'duplicate' | 'limit';
const dragType = 'application/x-tabrelio-join-field';

/** 拖放只传本面板的短期标记，列身份和当前设计修订留在本地。 */
export function JoinFieldMapping({ left, right, revision, disabled, pairs, current, link, initialSource = 0 }: {
  left: readonly Relation[]; right: Relation; revision: object; disabled: boolean;
  initialSource?: number;
  pairs: readonly { left: string; right: string; operator: string }[];
  current(): boolean;
  link(source: number, left: string, right: string): JoinFieldLinkResult;
}) {
  const [expanded, setExpanded] = useState(false), [source, setSource] = useState(initialSource);
  const [leftSearch, setLeftSearch] = useState(''), [rightSearch, setRightSearch] = useState('');
  const [picked, setPicked] = useState<Pick>(), [notice, setNotice] = useState('');
  const drag = useRef<{ pick: Pick; token: string } | undefined>(undefined);
  const targetSearch = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; drag.current = undefined; };
  }, []);
  const sourceIndex = left[source] ? source : 0;
  const selected = picked?.revision === revision ? picked : undefined;
  const eligible = () => mounted.current && !disabled && current();

  function commit(pick: Pick, target: string) {
    if (!eligible() || pick.revision !== revision || !left[pick.source]?.columns.some(column => column.name === pick.name) ||
        !right.columns.some(column => column.name === target)) return;
    const outcome = link(pick.source, pick.name, target);
    setNotice(outcome === 'added' ? text.mappingAdded(pick.name, target) :
      outcome === 'duplicate' ? text.mappingDuplicate : text.mappingLimit);
    if (outcome === 'added') setPicked(undefined);
  }

  function start(event: DragEvent, name: string) {
    if (!eligible()) { event.preventDefault(); return; }
    const pick = { source: sourceIndex, name, revision }, token = crypto.randomUUID();
    drag.current = { pick, token };
    event.dataTransfer.setData(dragType, token);
    event.dataTransfer.effectAllowed = 'link';
    setPicked(pick); setNotice('');
  }

  const matches = (relation: Relation, query: string) => relation.columns.filter(column =>
    column.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const from = expanded ? matches(left[sourceIndex], leftSearch) : [];
  const to = expanded ? matches(right, rightSearch) : [];
  return <section className="join-field-mapping">
    <button type="button" aria-expanded={expanded} disabled={disabled} onClick={() => {
      if (!eligible()) return;
      setExpanded(!expanded); setPicked(undefined); setNotice(''); drag.current = undefined;
    }}>{text.fieldMapping}</button>
    {expanded && <div className="join-field-mapping-body" role="region" aria-label={text.fieldMapping}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !selected) return;
        event.preventDefault(); event.stopPropagation(); setPicked(undefined); drag.current = undefined;
      }}>
      <p>{text.mappingHint}</p>
      <div className="join-field-mapping-sides">
        <div>
          <select aria-label={text.mappingSource} value={sourceIndex} disabled={disabled} onChange={event => {
            setSource(Number(event.target.value)); setPicked(undefined); setNotice(''); drag.current = undefined;
          }}>{left.map((item, index) => <option key={index} value={index}>{item.label}</option>)}</select>
          <input type="search" aria-label={text.mappingLeftSearch} placeholder={text.mappingLeftSearch} value={leftSearch}
            onChange={event => setLeftSearch(event.target.value)}/>
          <div className="join-field-mapping-list" role="group" aria-label={left[sourceIndex].label}>
            {from.map(({ name }) => <button key={name} type="button" title={name} draggable={!disabled} disabled={disabled}
              aria-pressed={selected?.source === sourceIndex && selected.name === name}
              onClick={event => {
                if (!eligible()) return;
                setPicked({ source: sourceIndex, name, revision }); setNotice('');
                if (event.detail === 0) targetSearch.current?.focus();
              }}
              onDragStart={event => start(event, name)} onDragEnd={() => { drag.current = undefined; }}>{name}</button>)}
            {!from.length && <span>{text.mappingEmpty}</span>}
          </div>
        </div>
        <div>
          <strong title={right.label}>{right.label}</strong>
          <input ref={targetSearch} type="search" aria-label={text.mappingRightSearch} placeholder={text.mappingRightSearch} value={rightSearch}
            onChange={event => setRightSearch(event.target.value)}/>
          <div className="join-field-mapping-list" role="group" aria-label={right.label}>
            {to.map(({ name }) => <button key={name} type="button" title={name} disabled={disabled}
              aria-disabled={!selected} onClick={() => { if (selected) commit(selected, name); }}
              onDragOver={event => {
                if (drag.current?.pick.revision !== revision || !eligible() || !event.dataTransfer.types.includes(dragType)) return;
                event.preventDefault(); event.dataTransfer.dropEffect = 'link';
              }} onDrop={event => {
                const active = drag.current;
                if (!active || event.dataTransfer.getData(dragType) !== active.token) return;
                event.preventDefault(); event.stopPropagation(); drag.current = undefined; commit(active.pick, name);
              }}>{name}</button>)}
            {!to.length && <span>{text.mappingEmpty}</span>}
          </div>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!!pairs.length && <ul className="join-field-mapping-pairs" aria-label={text.mappingPairs}>
        {pairs.map((pair, index) => <li key={index}>
          <code title={pair.left}>{pair.left}</code><span>{pair.operator}</span><code title={pair.right}>{pair.right}</code>
        </li>)}
      </ul>}
    </div>}
  </section>;
}
