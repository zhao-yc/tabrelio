import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QueryOutcome } from '../../shared/contracts';
import { parsePlanSnapshot } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text, planComparisonTitles } from '../../shared/explainSnapshot.zh-CN';
import { compareCurrentPlan } from '../../shared/planSnapshotComparison';
import type { PlanComparison } from '../../shared/planComparison';
import { errorMessage, invoke } from '../lib';
import { ExplainSnapshotSaveButton } from './ExplainSnapshotSaveButton';
import { PlanComparisonView } from './PlanComparisonView';
import { ErrorBox, Modal } from './ui';

/** 当前结果的对比和保存共用文件选择入口；切走查询或替换结果后丢弃迟到回执。 */
export function LivePlanFileActions({ outcome, complete, busy, isCurrent, onFileBusyChange }: {
  outcome: QueryOutcome; complete: boolean; busy: boolean; isCurrent(): boolean; onFileBusyChange?(value: boolean): void;
}) {
  const [fileAction, setFileAction] = useState<'save' | 'compare'>();
  const [comparison, setComparison] = useState<{ left: string; right: string; value: PlanComparison }>();
  const [error, setError] = useState('');
  const operation = useRef<'save' | object | null>(null), alive = useRef(false);
  const latest = useRef({ busy, isCurrent }); latest.current = { busy, isCurrent };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const plan = outcome.sqliteExplain ?? outcome.analysis ?? outcome.explain;
  const dialect = plan?.dialect ?? 'postgresql';
  const title = planComparisonTitles[dialect];

  /** 外层查询在文件交互期间也锁定；只能由原请求通知释放。 */
  function claim(token: 'save' | object, action: 'save' | 'compare') {
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

  async function compare() {
    if (!plan || !complete || comparison) return;
    const token = {};
    const current = () => alive.current && operation.current === token &&
      (!latest.current.busy || !!onFileBusyChange) && latest.current.isCurrent();
    try {
      if (!claim(token, 'compare')) return;
      const selected = await invoke('explainFiles.open', {});
      if (!selected || !current()) return;
      const baseline = parsePlanSnapshot(selected.snapshot);
      const value = compareCurrentPlan(baseline, outcome);
      setComparison({ left: `${selected.name} · ${baseline.serverVersion}`, right: plan.version, value });
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { release(token); }
  }

  return <>
    <ExplainSnapshotSaveButton outcome={outcome} busy={busy || fileAction === 'compare' || !!comparison} isCurrent={isCurrent} onFileBusyChange={saving}/>
    <button disabled={!complete || busy || !!fileAction || !!comparison} title={!complete ? text.compareIncomplete : undefined}
      onClick={() => void compare()}>{fileAction === 'compare' ? text.opening : text.compareBaseline}</button>
    <ErrorBox message={error}/>
    {comparison && createPortal(<Modal title={title} onClose={() => setComparison(undefined)} wide>
      <div className="explain-snapshot-dialog"><PlanComparisonView comparison={comparison.value} dialect={dialect} tree={outcome.analysis?.format === 'tree'}
        left={comparison.left} right={comparison.right} rightLabel={text.compareCurrent}/></div>
    </Modal>, document.body)}
  </>;
}
