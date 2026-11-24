import type { ResultExportData } from '../shared/contracts';
import type { PlanSnapshotDocument } from '../shared/explainSnapshot';
import type { PlanComparison } from '../shared/planComparison';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';
import { explainSnapshotZh as text } from '../shared/explainSnapshot.zh-CN';

const columns = ['dialect', 'path', 'depth', 'status', 'left_source', 'right_source', 'left_node', 'right_node',
  'field', 'left_value', 'right_value'].map(key => ({key, name: key}));

/** 按当前节点范围生成 JSON 数组。字段值始终是原文本，null 表示该侧缺少字段。 */
export function snapshotPlanComparisonReport(nodes: readonly PlanComparison['nodes'][number][],
  dialect: PlanSnapshotDocument['dialect'], leftSource: string, rightSource: string): ResultExportData {
  const rows: ResultExportData['rows'] = [];
  for (const node of nodes) {
    if (rows.length + Math.max(1, node.fields.length) > resultExportLimits.rows) throw Error(text.compareReportTooMany);
    const common = {dialect, path: node.path, depth: node.depth, status: node.status, left_source: leftSource,
      right_source: rightSource, left_node: node.left ?? null, right_node: node.right ?? null};
    for (const field of node.fields.length ? node.fields : [undefined]) {
      rows.push({...common, field: field?.name ?? null, left_value: field?.left ?? null, right_value: field?.right ?? null});
    }
  }
  const report = {columns, rows, truncated: false};
  validateResultExportData(report);
  return report;
}
