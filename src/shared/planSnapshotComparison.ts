import type { QueryOutcome } from './contracts';
import type { PlanSnapshotDocument } from './explainSnapshot';
import { compareCurrentMysqlPlan, compareMysqlPlanSnapshots } from './mysqlPlanComparison';
import { compareCurrentPostgresPlan, comparePostgresPlanSnapshots } from './postgresPlanComparison';
import { compareCurrentSqlitePlan, compareSqlitePlanSnapshots } from './sqlitePlanComparison';

/** 导入的快照类型已经过 codec 校验；文本估算计划只有原表格。 */
export function comparePlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument) {
  if (left.dialect === 'sqlite') return compareSqlitePlanSnapshots(left, right);
  if (left.dialect === 'postgresql') return comparePostgresPlanSnapshots(left, right);
  return compareMysqlPlanSnapshots(left, right);
}

/** 由当前计划决定比较规则，异类基准不能改变计划类型。 */
export function compareCurrentPlan(baseline: PlanSnapshotDocument, outcome: QueryOutcome) {
  if (outcome.sqliteExplain) return compareCurrentSqlitePlan(baseline, outcome.sqliteExplain);
  if ((outcome.analysis ?? outcome.explain)?.dialect === 'postgresql') return compareCurrentPostgresPlan(baseline, outcome);
  return compareCurrentMysqlPlan(baseline, outcome);
}
