import { randomUUID } from 'node:crypto';
import type { PostgresBatchSyncPreview, PostgresBatchSyncPreviewInput } from '../../shared/postgresBatchSync';
import { postgresDataSyncLimits as limits, type PostgresDataCompareInput, type PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import type { PostgresSyncEvidence } from './dataCompare';
import type { PostgresSyncGroup } from './tableWorkspace';

type Compare = (input: Pick<PostgresDataCompareInput, 'source' | 'target' | 'mapping'>, capture: boolean) =>
  Promise<{ report: PostgresDataCompareOutput; evidence?: PostgresSyncEvidence }>;

/** 保留已选操作的可信快照证据。各表依次读取，累计行数及字节共用批次预算。 */
export async function preparePostgresBatchSync(input: PostgresBatchSyncPreviewInput, compare: Compare) {
  const groups: PostgresSyncGroup[] = [], tables: PostgresBatchSyncPreview['tables'] = [];
  const counts = { insert: 0, update: 0, delete: 0 };
  const actions = { 'source-only': 'insert', 'target-only': 'delete', different: 'update' } as const;
  let size = 0, rows = 0;
  for (const pair of input.pairs) {
    const { report, evidence } = await compare({
      source: { ...input.source, table: pair.source }, target: { ...input.target, table: pair.target }, mapping: pair.mapping,
    }, true);
    const selected = report.differences.flatMap((row, index) => {
      const action = actions[row.kind];
      return input.actions.includes(action) ? [{ action, key: row.key, index }] : [];
    });
    if (!selected.length) continue;
    if (!evidence) throw Error('右侧表不能生成同步证据：' + pair.target);
    if (rows + selected.length > limits.selected) throw Error('PostgreSQL 多表同步最多 100 行，请减少表对或操作范围');
    const tableCounts = { insert: 0, update: 0, delete: 0 };
    const selectedRows = selected.map(({ action, index }) => {
      const row = evidence.rows[index];
      if (!row || !evidence.relation.syncCapabilities[action]) throw Error('右侧表缺少准确行版本或所选写权限：' + pair.target);
      size += Buffer.byteLength(JSON.stringify(row));
      if (size > limits.bytes) throw Error('PostgreSQL 多表同步超过 1 MiB，请减少表对或操作范围');
      tableCounts[action]++; counts[action]++;
      return row;
    });
    rows += selected.length;
    groups.push({ table: pair.target, rows: selectedRows, evidence: { ...evidence, rows: [] } });
    tables.push({ table: evidence.relation.sql, counts: tableCounts, rows: selected.map(({ action, key }) => ({ action, key })) });
  }
  if (!groups.length) return null;
  const confirmation = input.target.database + '.' + tables[0].table + (tables.length > 1 ? ` 等 ${tables.length} 张表` : '');
  const preview: PostgresBatchSyncPreview = { previewId: randomUUID(), confirmation, counts, tables };
  return { preview, groups };
}
