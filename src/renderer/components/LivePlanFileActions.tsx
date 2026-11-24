import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { QueryOutcome } from '../../shared/contracts';
import { capturePlanSnapshot, parsePlanSnapshot, type PlanSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text, planComparisonTitles } from '../../shared/explainSnapshot.zh-CN';
import { compareCurrentPlan } from '../../shared/planSnapshotComparison';
import type { PlanComparison } from '../../shared/planComparison';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { ActionMenu } from './ActionMenu';
import { ExplainSnapshotSaveButton } from './ExplainSnapshotSaveButton';
import { PlanComparisonView } from './PlanComparisonView';
import { ErrorBox, Modal } from './ui';

type PlanKind = PlanSnapshotDocument['kind'];
type PlanBaseline = { name: string; snapshot: PlanSnapshotDocument };
type Baselines = Partial<Record<PlanKind, PlanBaseline>>;
type FileAction = 'save' | 'compare' | 'load-baseline' | 'export-baseline';
const PlanBaselines = createContext<{ owner: object; snapshots: Baselines; update(kind: PlanKind, value?: PlanBaseline): void } | null>(null);

/** 执行前的待确认状态暂时收起基准，原库重新确认时恢复。确认换库或连接换代清空内存。 */
export function QueryPlanBaselines({ scope, database, children }: { scope: string; database?: string | null; children: ReactNode }) {
  const [state, setState] = useState<{ scope: string; database?: string | null; owner: object; snapshots: Baselines }>({ scope, database, owner: {}, snapshots: {} });
  const sameScope = state.scope === scope, sameDatabase = state.database === database;
  if (!sameScope || database !== undefined && !sameDatabase) setState({ scope, database, owner: {}, snapshots: {} });
  const baseline = sameScope && sameDatabase && database !== undefined ? { owner: state.owner, snapshots: state.snapshots,
    update: (kind: PlanKind, value?: PlanBaseline) => setState(current => current.owner === state.owner
      ? { ...current, snapshots: { ...current.snapshots, [kind]: value } } : current),
  } : null;
  return <PlanBaselines.Provider value={baseline}>{children}</PlanBaselines.Provider>;
}

/** 当前结果的对比和保存共用文件选择入口；切走查询或替换结果后丢弃迟到回执。 */
export function LivePlanFileActions({ outcome, complete, busy, isCurrent, onFileBusyChange }: {
  outcome: QueryOutcome; complete: boolean; busy: boolean; isCurrent(): boolean; onFileBusyChange?(value: boolean): void;
}) {
  const [fileAction, setFileAction] = useState<FileAction>();
  const [comparison, setComparison] = useState<{ left: string; right: string; value: PlanComparison }>();
  const [error, setError] = useState('');
  const baselines = useContext(PlanBaselines);
  const operation = useRef<'save' | object | null>(null), alive = useRef(false);
  const reportBusy = useRef(false);
  const latest = useRef({ busy, isCurrent, baselines }); latest.current = { busy, isCurrent, baselines };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const plan = outcome.sqliteExplain ?? outcome.analysis ?? outcome.explain;
  const kind: PlanKind = outcome.sqliteExplain ? 'dbark.sqlite-explain-snapshot' : outcome.analysis ? 'dbark.analyze-snapshot' : 'dbark.explain-snapshot';
  const pinned = baselines?.snapshots[kind];
  const dialect = plan?.dialect ?? 'postgresql';
  const title = planComparisonTitles[dialect];

  /** 外层查询在文件交互期间也锁定；只能由原请求通知释放。 */
  function claim(token: 'save' | object, action: FileAction) {
    if (!alive.current || operation.current || latest.current.busy || !latest.current.isCurrent()) return false;
    onFileBusyChange?.(true);
    operation.current = token; setFileAction(action); setError('');
    return true;
  }

  function release(token: 'save' | object) {
    if (operation.current !== token) return;
    operation.current = null;
    if (alive.current) setFileAction(undefined);
    onFileBusyChange?.(false);
  }

  function saving(value: boolean) {
    if (value) { if (!claim('save', 'save')) throw Error(text.busy); }
    else release('save');
  }

  function showComparison(name: string, baseline: PlanSnapshotDocument) {
    if (!plan) return;
    const value = compareCurrentPlan(baseline, outcome);
    setComparison({ left: `${name} · ${baseline.serverVersion}`, right: plan.version, value });
  }

  /** 本地比较只读取两份原计划。基准完整性校验通过后才替换旧基准。 */
  function pinnedAction(action: 'pin' | 'compare' | 'remove') {
    if (!baselines || !plan || !alive.current || operation.current || latest.current.busy ||
        !latest.current.isCurrent() || comparison) return;
    setError('');
    try {
      if (action === 'remove') {
        if (pinned) { baselines.update(kind); useWorkspace.getState().notify(text.pinnedRemoved); }
      } else if (complete) {
        if (action === 'compare' && pinned) showComparison(pinned.name, pinned.snapshot);
        if (action === 'pin') {
          const snapshot = capturePlanSnapshot(outcome);
          compareCurrentPlan(snapshot, outcome);
          baselines.update(kind, {name: text.pinnedBaselineName, snapshot});
          useWorkspace.getState().notify(text.pinnedSaved);
        }
      }
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 读取后复核原标签与基准身份。选择文件期间即使切回同一标签，旧读取也不能覆盖基准。 */
  async function usePlanFile(action: Exclude<FileAction, 'save'>) {
    if (!plan || comparison || (action === 'export-baseline' ? !pinned : !complete) || action !== 'compare' && !baselines) return;
    const token = {};
    const tabId = useWorkspace.getState().settings.activeTabId;
    let revoked = false, unsubscribe: (() => void) | undefined;
    const current = () => alive.current && operation.current === token && !revoked &&
      (!latest.current.busy || !!onFileBusyChange) && latest.current.isCurrent() && (action === 'compare' ||
        latest.current.baselines?.owner === baselines?.owner && latest.current.baselines?.snapshots[kind] === pinned);
    try {
      if (!claim(token, action)) return;
      unsubscribe = useWorkspace.subscribe(state => { if (state.settings.activeTabId !== tabId) revoked = true; });
      if (action === 'export-baseline' && pinned) {
        const saved = await invoke('explainFiles.save', {snapshot: pinned.snapshot});
        if (saved && current()) useWorkspace.getState().notify(text.pinnedExported(saved.name));
        return;
      }
      const selected = await invoke('explainFiles.open', {});
      if (!selected || !current()) return;
      const snapshot = parsePlanSnapshot(selected.snapshot);
      if (action === 'compare') showComparison(selected.name, snapshot);
      else if (baselines) {
        compareCurrentPlan(snapshot, outcome);
        baselines.update(kind, {name: selected.name, snapshot});
        useWorkspace.getState().notify(text.pinnedLoaded(selected.name));
      }
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { unsubscribe?.(); release(token); }
  }

  return <>
    <ExplainSnapshotSaveButton outcome={outcome} busy={busy || !!fileAction || !!comparison} isCurrent={isCurrent} onFileBusyChange={saving}/>
    <button disabled={!complete || busy || !!fileAction || !!comparison} title={!complete ? text.compareIncomplete : undefined}
      onClick={() => void usePlanFile('compare')}>{fileAction === 'compare' ? text.opening : text.compareBaseline}</button>
    {baselines && <ActionMenu label={text.pinnedMenu} isCurrent={isCurrent} disabled={busy || !!fileAction || !!comparison}>
      <button disabled={!complete} onClick={() => pinnedAction('pin')}>{pinned ? text.pinnedReplace : text.pinnedSet}</button>
      <button disabled={!complete || !pinned} onClick={() => pinnedAction('compare')}>{text.pinnedCompare}</button>
      <button disabled={!complete} onClick={() => void usePlanFile('load-baseline')}>{text.pinnedLoad}</button>
      <button disabled={!pinned} onClick={() => void usePlanFile('export-baseline')}>{text.pinnedExport}</button>
      <button disabled={!pinned} onClick={() => pinnedAction('remove')}>{text.pinnedClear}</button>
    </ActionMenu>}
    <ErrorBox message={error}/>
    {comparison && createPortal(<Modal title={title} onClose={() => { if (!reportBusy.current) setComparison(undefined); }} wide>
      <div className="explain-snapshot-dialog"><PlanComparisonView comparison={comparison.value} dialect={dialect} tree={outcome.analysis?.format === 'tree'}
        left={comparison.left} right={comparison.right} rightIsCurrent onFileBusyChange={value => { reportBusy.current = value; }}/></div>
    </Modal>, document.body)}
  </>;
}
