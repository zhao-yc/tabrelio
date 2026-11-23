import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanComparison } from '../../shared/planComparison';
import type { PlanSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text, planComparisonTitles } from '../../shared/explainSnapshot.zh-CN';

interface Props {
  comparison: PlanComparison;
  dialect: PlanSnapshotDocument['dialect'];
  tree?: boolean;
  left: string;
  right: string;
  rightLabel?: string;
}

const maxSearchLength = 200;
const contains = (needle: string, ...values: (string | undefined)[]) => values.some(value => value?.toLowerCase().includes(needle));

/** 更换对比结果重置查找，取消或读取失败时仍由原结果持有状态。 */
export function PlanComparisonView(props: Props) {
  const owner = useRef({ result: props.comparison, generation: 0 });
  if (owner.current.result !== props.comparison) owner.current = { result: props.comparison, generation: owner.current.generation + 1 };
  return <OwnedPlanComparison key={owner.current.generation} {...props}/>;
}

/** 两列读取已返回的计划。查找和字段定位只访问当前对比结果。 */
function OwnedPlanComparison({ comparison, dialect, tree, left, right, rightLabel = text.compareRight }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState(''), [searchSelected, setSearchSelected] = useState<string>();
  const selectedButton = useRef<HTMLButtonElement>(null), firstMatchedRow = useRef<HTMLTableRowElement>(null);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => comparison.nodes.filter(node => (showAll || node.status !== 'same') && (!needle ||
    contains(needle, node.path, node.left, node.right) || node.fields.some(field => contains(needle, field.name, field.left, field.right)))), [comparison, showAll, needle]);
  const preferred = needle ? searchSelected ?? selected : selected;
  const current = visible.find(node => node.path === preferred) ?? visible[0];
  const matchedField = needle && current?.fields.find(field => contains(needle, field.name, field.left, field.right));
  useLayoutEffect(() => {
    if (!needle) return;
    selectedButton.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    firstMatchedRow.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [needle, current]);

  /** 查找期间的选择单独保存，清空后返回查找前选中的路径。 */
  function updateSearch(value: string) {
    setSearch(value.length <= maxSearchLength ? value : value.slice(0, maxSearchLength).replace(/[\uD800-\uDBFF]$/, ''));
    setSearchSelected(undefined);
  }

  function travel(direction: 1 | -1) {
    if (!current || !needle) return;
    const index = (visible.indexOf(current) + direction + visible.length) % visible.length;
    setSearchSelected(visible[index].path);
  }
  return <section className="explain-comparison" aria-label={planComparisonTitles[dialect]}>
    <div className="explain-comparison-sources">
      <span>{text.compareLeft}　{left}</span><span>{rightLabel}　{right}</span>
    </div>
    <p className="muted small">{dialect === 'sqlite' ? text.sqliteCompareHint : tree ? text.treeCompareHint : text.compareHint}</p>
    <div className="explain-comparison-summary">
      <strong role="status">{text.compareCount(comparison.different, comparison.nodes.length)}</strong>
      <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.currentTarget.checked)} /> {text.compareShowAll}</label>
    </div>
    <div className="explain-comparison-search" role="search" aria-label={text.compareFind}>
      <input type="search" aria-label={text.compareFind} placeholder={text.compareFindPlaceholder} title={text.compareFindHint}
        value={search} maxLength={maxSearchLength} onInput={event => updateSearch(event.currentTarget.value)} onKeyDown={event => {
          if (!needle || event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault(); travel(event.shiftKey ? -1 : 1);
        }}/>
      {!!needle && <>
        <span role="status" aria-label={text.compareFind}>{text.compareFindCount(current ? visible.indexOf(current) + 1 : 0, visible.length)}</span>
        <button disabled={visible.length < 2} onClick={() => travel(-1)}>{text.compareFindPrevious}</button>
        <button disabled={visible.length < 2} onClick={() => travel(1)}>{text.compareFindNext}</button>
      </>}
      {!!search && <button onClick={() => updateSearch('')}>{text.compareFindClear}</button>}
    </div>
    {current ? <div className="explain-comparison-body">
      <div className="explain-comparison-paths">
        {visible.map(node => <button key={node.path} aria-pressed={node === current} ref={node === current ? selectedButton : undefined}
          style={{ paddingInlineStart: 8 + Math.min(node.depth, 8) * 9 }} onClick={() => needle ? setSearchSelected(node.path) : setSelected(node.path)}>
          <strong>{text.compareStatuses[node.status]} · {node.right ?? node.left}</strong><small>{node.path}</small>
        </button>)}
      </div>
      <div className="explain-comparison-detail">
        <div className="explain-comparison-sources"><span>{current.left ?? '—'}</span><span>{current.right ?? '—'}</span></div>
        {current.fields.length ? <table>
          <thead><tr><th scope="col">{text.compareField}</th><th scope="col">{text.compareLeft}</th><th scope="col">{rightLabel}</th></tr></thead>
          <tbody>{current.fields.map(field => <tr key={field.name} ref={field === matchedField ? firstMatchedRow : undefined}
            data-plan-match={!!needle && contains(needle, field.name, field.left, field.right) || undefined}>
            <th scope="row">{field.name}</th><td>{field.left ?? '—'}</td><td>{field.right ?? '—'}</td>
          </tr>)}</tbody>
        </table> : <p>{text.compareSame}</p>}
        {current.changedFields > current.fields.length && <p>{text.compareMore(current.changedFields - current.fields.length)}</p>}
      </div>
    </div> : <p>{needle ? text.compareFindEmpty : text.compareSame}</p>}
  </section>;
}
