import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QueryOutcome } from '../../shared/contracts';
import { parsePlanSnapshot } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text } from '../../shared/explainSnapshot.zh-CN';
import { compareCurrentSqlitePlan } from '../../shared/sqlitePlanComparison';
import type { PlanComparison } from '../../shared/planComparison';
import { errorMessage, invoke } from '../lib';
import { ExplainSnapshotSaveButton } from './ExplainSnapshotSaveButton';
import { PlanComparisonView } from './PlanComparisonView';
import { ErrorBox, Modal } from './ui';

/** 当前结果的对比和保存共用文件选择入口；切走查询或替换结果后丢弃迟到回执。 */
export function SqliteLivePlanActions({ outcome, complete, busy, isCurrent }: {
  outcome: QueryOutcome; complete: boolean; busy: boolean; isCurrent(): boolean;
}) {
  const [fileAction, setFileAction] = useState<'save' | 'compare'>();
  const [comparison, setComparison] = useState<{ left: string; right: string; value: PlanComparison }>();
  const [error, setError] = useState('');
  const operation = useRef<'save' | object | null>(null), alive = useRef(false);
  const latest = useRef({ busy, isCurrent }); latest.current = { busy, isCurrent };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function saving(value: boolean) {
    if (value) {
      if (!alive.current || operation.current || latest.current.busy || !latest.current.isCurrent()) throw Error(text.busy);
      operation.current = 'save'; setFileAction('save'); setError('');
    } else if (operation.current === 'save') {
      operation.current = null;
      if (alive.current) setFileAction(undefined);
    }
  }

  async function compare() {
    const plan = outcome.sqliteExplain;
    if (!plan || !complete || comparison || !alive.current || operation.current || latest.current.busy || !isCurrent()) return;
    const token = {};
    operation.current = token; setFileAction('compare'); setError('');
    const current = () => alive.current && operation.current === token && !latest.current.busy && latest.current.isCurrent();
    try {
      const selected = await invoke('explainFiles.open', {});
      if (!selected || !current()) return;
      const baseline = parsePlanSnapshot(selected.snapshot);
      setComparison({ left: `${selected.name} · ${baseline.serverVersion}`, right: plan.version, value: compareCurrentSqlitePlan(baseline, plan) });
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally {
      if (operation.current === token) operation.current = null;
      if (alive.current) setFileAction(undefined);
    }
  }

  return <>
    <ExplainSnapshotSaveButton outcome={outcome} busy={busy || fileAction === 'compare' || !!comparison} isCurrent={isCurrent} onFileBusyChange={saving}/>
    <button disabled={!complete || busy || !!fileAction || !!comparison} title={!complete ? text.compareIncomplete : undefined}
      onClick={() => void compare()}>{fileAction === 'compare' ? text.opening : text.sqliteCompareBaseline}</button>
    <ErrorBox message={error}/>
    {comparison && createPortal(<Modal title={text.sqliteCompareTitle} onClose={() => setComparison(undefined)} wide>
      <div className="explain-snapshot-dialog"><PlanComparisonView comparison={comparison.value} dialect="sqlite"
        left={comparison.left} right={comparison.right} rightLabel={text.sqliteCompareCurrent}/></div>
    </Modal>, document.body)}
  </>;
}
