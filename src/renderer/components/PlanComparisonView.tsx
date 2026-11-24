import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanComparison } from '../../shared/planComparison';
import type { PlanSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text, planComparisonTitles } from '../../shared/explainSnapshot.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import { snapshotPlanComparisonReport } from '../planComparisonReport';
import { ErrorBox } from './ui';

interface Props {
  comparison: PlanComparison;
  dialect: PlanSnapshotDocument['dialect'];
  tree?: boolean;
  left: string;
  right: string;
  rightIsCurrent?: boolean;
  fileBusy?: boolean;
  onFileBusyChange?(value: boolean): void;
}

const maxSearchLength = 200;
const contains = (needle: string, ...values: (string | undefined)[]) => values.some(value => value?.toLowerCase().includes(needle));
const reverseStatus = { added: 'removed', removed: 'added', changed: 'changed', same: 'same' } as const;
type NodeStatus = keyof typeof reverseStatus;
type PlanFilter = 'different' | 'all' | NodeStatus;
const planFilters: readonly PlanFilter[] = ['different', 'added', 'removed', 'changed', 'same', 'all'];
const fieldPreviewLimit = 80;

function previewValue(value: string | undefined, short: boolean): string | undefined {
  return short && value !== undefined && value.length > 1800 ? value.slice(0, 1800).replace(/[\uD800-\uDBFF]$/, '') + '…' : value;
}

/** 更换对比结果重置查找，取消或读取失败时仍由原结果持有状态。 */
export function PlanComparisonView(props: Props) {
  const owner = useRef({ result: props.comparison, generation: 0 });
  if (owner.current.result !== props.comparison) owner.current = { result: props.comparison, generation: owner.current.generation + 1 };
  return <OwnedPlanComparison key={owner.current.generation} {...props}/>;
}

/** 两列读取已返回的计划。查找和字段定位只访问当前对比结果。 */
function OwnedPlanComparison({ comparison, dialect, tree, left, right, rightIsCurrent, fileBusy, onFileBusyChange }: Props) {
  const [filter, setFilter] = useState<PlanFilter>('different');
  const [reversed, setReversed] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState(''), [searchSelected, setSearchSelected] = useState<string>();
  const [phase, setPhase] = useState<'choose' | 'write'>();
  const [reportStatus, setReportStatus] = useState(''), [reportError, setReportError] = useState('');
  const report = useRef<{taskId: string; writing: boolean} | undefined>(undefined), alive = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selectedButton = useRef<HTMLButtonElement>(null), firstMatchedRow = useRef<HTMLTableRowElement>(null);
  const needle = search.trim().toLowerCase();
  const clipFields = dialect !== 'sqlite' && !tree;
  // 对齐路径和字段都来自同一份既有比较结果，只改变从左到右阅读的方向。
  const nodes = useMemo(() => reversed ? comparison.nodes.map(node => ({
    ...node, left: node.right, right: node.left, status: reverseStatus[node.status],
    fields: node.fields.map(field => ({ ...field, left: field.right, right: field.left })),
  })) : comparison.nodes, [comparison, reversed]);
  const visible = useMemo(() => nodes.filter(node => (filter === 'all' || filter === node.status ||
    filter === 'different' && node.status !== 'same') && (!needle || contains(needle, node.path, node.left, node.right) ||
    node.fields.slice(0, fieldPreviewLimit).some(field => contains(needle, field.name,
      previewValue(field.left, clipFields), previewValue(field.right, clipFields))))), [nodes, filter, needle, clipFields]);
  const leftHeading = reversed && rightIsCurrent ? text.compareCurrent : text.compareLeft;
  const rightHeading = !reversed && rightIsCurrent ? text.compareCurrent : text.compareRight;
  const preferred = needle ? searchSelected ?? selected : selected;
  const current = visible.find(node => node.path === preferred) ?? visible[0];
  const fields = current?.fields.slice(0, fieldPreviewLimit).map(field => ({...field,
    left: previewValue(field.left, clipFields), right: previewValue(field.right, clipFields),
  })) ?? [];
  const matchedField = needle && fields.find(field => contains(needle, field.name, field.left, field.right));
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

  /** 新增和移除的含义随方向反转，筛选跟随原来的节点集合。 */
  function swapSides() {
    setReversed(value => !value);
    setFilter(value => value === 'added' || value === 'removed' ? reverseStatus[value] : value);
  }

  /** 先冻结筛选范围及左右方向，文件选择返回后仍须由原比较窗口提交。 */
  async function exportReport(button: HTMLButtonElement) {
    const dialog = button.closest(appModalSelector) ?? undefined;
    const modalCurrent = () => alive.current && button.isConnected && gridDialogCurrent(button, () => dialog);
    if (!visible.length || report.current || fileBusy || !modalCurrent()) return;
    const operation = {taskId: uid(), writing: false};
    const currentReport = () => report.current === operation && modalCurrent();
    let claimed = false;
    setReportStatus(''); setReportError('');
    try {
      const result = snapshotPlanComparisonReport(visible, dialect,
        `${leftHeading} · ${reversed ? right : left}`, `${rightHeading} · ${reversed ? left : right}`);
      onFileBusyChange?.(true); claimed = true;
      report.current = operation; setPhase('choose');
      const file = await invoke('files.choose', {purpose: 'export', format: 'json', suggestedName: text.compareReportName});
      if (!file || !currentReport()) return;
      operation.writing = true; setPhase('write');
      const saved = await invoke('files.exportResult', {fileToken: file.token, taskId: operation.taskId, format: 'json', encoding: 'utf8', result});
      if (currentReport()) setReportStatus(text.compareReportSaved(saved.rows));
    } catch (reason) { if (modalCurrent()) setReportError(errorMessage(reason)); }
    finally {
      if (report.current === operation) { report.current = undefined; if (alive.current) setPhase(undefined); }
      if (claimed) onFileBusyChange?.(false);
    }
  }

  function cancelReport() {
    const operation = report.current;
    if (operation?.writing) void invoke('query.cancel', {taskId: operation.taskId}).catch(reason => {
      if (alive.current && report.current === operation) setReportError(errorMessage(reason));
    });
  }

  return <section className="explain-comparison" aria-label={planComparisonTitles[dialect]}>
    <div className="explain-comparison-sources">
      <span>{leftHeading}　{reversed ? right : left}</span><span>{rightHeading}　{reversed ? left : right}</span>
    </div>
    <p className="muted small">{dialect === 'sqlite' ? text.sqliteCompareHint : tree ? text.treeCompareHint : text.compareHint}</p>
    <div className="explain-comparison-summary">
      <strong role="status">{text.compareCount(comparison.different, comparison.nodes.length)}</strong>
      <label>{text.compareFilter}
        <select value={filter} onChange={event => setFilter(event.currentTarget.value as PlanFilter)}>
          {planFilters.map(value => <option key={value} value={value}>{text.compareFilters[value]}</option>)}
        </select>
      </label>
      <button type="button" onClick={swapSides} title={text.compareSwapHint}>{text.compareSwap}</button>
      <button type="button" disabled={!visible.length || !!phase || fileBusy} title={text.compareReportHint}
        onClick={event => void exportReport(event.currentTarget)}>{phase === 'choose' ? text.compareReportChoose
          : phase === 'write' ? text.compareReportWrite : text.compareReportExport}</button>
      {phase === 'write' && <button type="button" onClick={cancelReport}>{text.compareReportCancel}</button>}
      {reportStatus && <span role="status">{reportStatus}</span>}
    </div>
    <ErrorBox message={reportError}/>
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
        {fields.length ? <table>
          <thead><tr><th scope="col">{text.compareField}</th><th scope="col">{leftHeading}</th><th scope="col">{rightHeading}</th></tr></thead>
          <tbody>{fields.map(field => <tr key={field.name} ref={field === matchedField ? firstMatchedRow : undefined}
            data-plan-match={!!needle && contains(needle, field.name, field.left, field.right) || undefined}>
            <th scope="row">{field.name}</th><td>{field.left ?? '—'}</td><td>{field.right ?? '—'}</td>
          </tr>)}</tbody>
        </table> : <p>{text.compareSame}</p>}
        {current.changedFields > fields.length && <p>{text.compareMore(current.changedFields - fields.length)}</p>}
      </div>
    </div> : <p>{needle ? text.compareFindEmpty : filter === 'different' || filter === 'all' ? text.compareSame : text.compareFilterEmpty}</p>}
  </section>;
}
