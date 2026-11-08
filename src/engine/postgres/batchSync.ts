import { randomUUID } from 'node:crypto';
import type { PostgresBatchSyncPreview, PostgresBatchSyncPreviewInput } from '../../shared/postgresBatchSync';
import type { PostgresDataCompareInput, PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import type { PostgresSyncEvidence } from './dataCompare';
import type { PostgresSyncGroup } from './tableWorkspace';
import { batchSyncConfirmation, batchSyncPreviewRow, createBatchSyncPreviewBudget } from '../../shared/dataCompareBatchSync';

type Compare = (input: Pick<PostgresDataCompareInput, 'source' | 'target' | 'mapping'>, capture: boolean) =>
  Promise<{ report: PostgresDataCompareOutput; evidence?: PostgresSyncEvidence }>;

/** 保留已选操作的可信快照证据。各表依次读取，累计行数及字节共用批次预算。 */
export async function preparePostgresBatchSync(input: PostgresBatchSyncPreviewInput, compare: Compare) {
  const groups: PostgresSyncGroup[] = [], tables: PostgresBatchSyncPreview['tables'] = [];
  const counts = { insert: 0, update: 0, delete: 0 };
  const actions = { 'source-only': 'insert', 'target-only': 'delete', different: 'update' } as const;
  const reserve = createBatchSyncPreviewBudget();
  for (const pair of input.pairs) {
    const { report, evidence } = await compare({
      source: { ...input.source, table: pair.source }, target: { ...input.target, table: pair.target }, mapping: pair.mapping,
    }, true);
    const selected = report.differences.flatMap((row, index) => {
      const action = actions[row.kind];
      return input.actions.includes(action) ? [{ action, row, index }] : [];
    });
    if (!selected.length) continue;
    if (!evidence) throw Error('右侧表不能生成同步证据：' + pair.target);
    const tableCounts = { insert: 0, update: 0, delete: 0 };
    const columns = report.columns.map(column => column.name);
    const selectedRows: PostgresSyncGroup['rows'] = [];
    const details = selected.map(({ action, row: difference, index }) => {
      const row = evidence.rows[index];
      if (!row || !evidence.relation.syncCapabilities[action]) throw Error('右侧表缺少准确行版本或所选写权限：' + pair.target);
      const detail = batchSyncPreviewRow(action, difference, columns, row, pair.mapping);
      reserve(detail);
      tableCounts[action]++; counts[action]++;
      selectedRows.push(row);
      return detail;
    });
    groups.push({ table: pair.target, rows: selectedRows, evidence: { ...evidence, rows: [] } });
    tables.push({ table: evidence.relation.sql, confirmation: input.target.database + '.' + evidence.relation.sql, counts: tableCounts,
      rows: details });
  }
  if (!groups.length) return null;
  const confirmation = batchSyncConfirmation(tables.map(table => table.confirmation));
  const preview: PostgresBatchSyncPreview = { previewId: randomUUID(), confirmation, counts, tables };
  return { preview, groups };
}
