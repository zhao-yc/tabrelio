import { randomUUID } from 'node:crypto';
import type { SqliteConnectionProfile } from '../shared/contracts';
import type { SqliteBatchSyncPreview, SqliteBatchSyncPreviewInput } from '../shared/sqliteBatchSync';
import { batchSyncConfirmation, batchSyncPreviewRow, createBatchSyncPreviewBudget, type requireBatchSyncSelection } from '../shared/dataCompareBatchSync';
import type { SqliteDataCompareEndpoint, SqliteDataCompareInput, SqliteDataCompareOutput } from '../shared/sqliteDataCompare';
import { sqliteDataSyncLimits as limits } from '../shared/sqliteDataCompare';
import type { SqliteFileIdentity, SqliteValue } from '../engine/sqlite/protocol';
import { sqliteEditLocator, type SqliteEditClaim } from './sqliteTableEdit';
import { quoteSqliteIdentifier as quote, type SqliteTableCatalogue } from './sqliteTableBrowse';

export interface SqliteSyncEvidence {
  target: SqliteDataCompareEndpoint;
  identity: SqliteFileIdentity;
  catalogue: SqliteTableCatalogue;
  schemaVersion: string;
  columns: string[];
  originalColumns: string[];
  keyColumns: string[];
  rows: { key: SqliteValue[]; before?: SqliteValue[]; after?: SqliteValue[] }[];
}

/** 预览仅使用可信比较快照里的键和完整原值。确认前没有数据库写操作。 */
export function buildSqliteSyncClaim(evidence: SqliteSyncEvidence, selected: readonly number[], profile: SqliteConnectionProfile): SqliteEditClaim {
  if (profile.id !== evidence.target.connectionId || profile.sqlite.readOnly) throw Error('SQLite 同步目标连接为只读或已变化');
  const selectedRows = selected.map(index => evidence.rows[index]);
  if (selectedRows.some(row => !row) || Buffer.byteLength(JSON.stringify(selectedRows)) > limits.bytes)
    throw Error('SQLite 同步选择无效或超过 1 MiB，请减少所选行');
  const columns = evidence.originalColumns.map(name => {
    const column = evidence.catalogue.columns.find(item => item.name === name)!;
    return { name, declaredType: column.declaredType, generated: false, nullable: true, hasDefault: false };
  });
  const expires = Date.now() + limits.lifetimeMs;
  const snapshot: SqliteEditClaim['snapshot'] = {
    id: randomUUID(), pageOffset: 0, pageLimit: limits.selected, target: evidence.target, profile,
    identity: evidence.identity, catalogue: evidence.catalogue, columns, schemaVersion: evidence.schemaVersion,
    locator: { kind: 'primary-key', columns: evidence.keyColumns, collations: evidence.keyColumns.map(() => 'BINARY') },
    rows: selectedRows.map(row => row.before ?? []), locators: selectedRows.map(row => row.key),
    expires, bytes: 0, active: 0, revoked: false,
  };
  const counts = { insert: 0, update: 0, delete: 0 };
  const table = '"main".' + quote(evidence.target.table);
  const nonKey = evidence.columns.map((name, index) => ({ name, index })).filter(field => !evidence.keyColumns.includes(field.name));
  const statements = selectedRows.map(({ before, after }, row) => {
    const where = sqliteEditLocator(snapshot, row);
    if (!before && after) {
      counts.insert++;
      return { kind: 'insert' as const, sql: `INSERT OR ABORT INTO ${table} (${evidence.columns.map(quote).join(', ')}) VALUES (${after.map(() => '?').join(', ')})`, parameters: after };
    }
    if (!after) {
      counts.delete++;
      return { kind: 'delete' as const, row, sql: `DELETE FROM ${table} WHERE ${where.sql}`, parameters: where.parameters };
    }
    if (!nonKey.length) throw Error('SQLite 同步没有可更新字段');
    counts.update++;
    return { kind: 'update' as const, row, sql: `UPDATE OR ABORT ${table} SET ${nonKey.map(field => quote(field.name) + '=?').join(', ')} WHERE ${where.sql}`,
      parameters: [...nonKey.map(field => after[field.index]), ...where.parameters] };
  });
  if (statements.some(statement => statement.parameters.length > 1024)) throw Error('SQLite 同步参数数目超过上限');
  return { snapshot, statements, counts, confirmation: 'main.' + evidence.target.table,
    synchronization: { columns: evidence.columns, rows: selectedRows.map(row => row.after) } };
}

/** 冻结同一目标文件的候选差异。只有最终选中的行才编译绑定参数。 */
export async function buildSqliteBatchSync(
  input: SqliteBatchSyncPreviewInput, profile: SqliteConnectionProfile,
  compare: (request: SqliteDataCompareInput, capture: (evidence: SqliteSyncEvidence) => void) => Promise<SqliteDataCompareOutput>,
) {
  if (profile.id !== input.targetConnectionId || profile.sqlite.readOnly) throw Error('SQLite 多表同步需要可写的右侧连接');
  const groups: SqliteSyncEvidence[] = [], tables: SqliteBatchSyncPreview['tables'] = [];
  const counts = { insert: 0, update: 0, delete: 0 };
  const reserve = createBatchSyncPreviewBudget();
  const byDifference = { insert: 'source-only', update: 'different', delete: 'target-only' } as const;
  for (const pair of input.pairs) {
    let evidence: SqliteSyncEvidence | undefined;
    const output = await compare({
      source: { connectionId: input.sourceConnectionId, database: 'main', table: pair.source },
      target: { connectionId: input.targetConnectionId, database: 'main', table: pair.target },
      taskId: input.taskId, mode: 'and', filters: [], mapping: pair.mapping,
    }, value => { evidence = value; });
    const requested = input.actions.reduce((count, action) => count + output.counts[byDifference[action]], 0);
    if (!requested) continue;
    if (!evidence) throw Error('右侧表不能生成完整同步证据：' + pair.target);
    const selected: SqliteSyncEvidence['rows'] = [];
    const rows: SqliteBatchSyncPreview['tables'][number]['rows'] = [];
    const tableCounts = { insert: 0, update: 0, delete: 0 };
    for (const [index, row] of evidence.rows.entries()) {
      const action = row.before ? row.after ? 'update' : 'delete' : 'insert';
      if (!input.actions.includes(action)) continue;
      const detail = batchSyncPreviewRow(action, output.differences[index], output.columns, row, pair.mapping);
      reserve(detail);
      selected.push(row); rows.push(detail);
      tableCounts[action]++; counts[action]++;
    }
    if (selected.length !== requested) throw Error('SQLite 多表同步证据与比较计数不一致');
    const first = groups[0];
    if (first && (JSON.stringify(first.identity) !== JSON.stringify(evidence.identity) || first.schemaVersion !== evidence.schemaVersion))
      throw Error('预览期间右侧文件身份或表结构已变化，请重新比较');
    groups.push({ ...evidence, rows: selected });
    tables.push({ table: pair.target, confirmation: 'main.' + pair.target, counts: tableCounts, rows });
  }
  if (!groups.length) return;
  return { groups, counts, confirmation: batchSyncConfirmation(tables.map(table => table.confirmation)), tables };
}

function combineSqliteSyncClaims(groups: SqliteEditClaim[], counts: SqliteEditClaim['counts'], confirmation: string): SqliteEditClaim {
  return groups.length === 1 ? groups[0] : {
    snapshot: groups[0].snapshot, statements: groups.flatMap(group => group.statements), counts, confirmation, batch: groups,
  };
}

/** 领取可信候选的最终子集，沿用单表的原行定位、参数及写后复核。 */
export function selectSqliteBatchSyncClaim(evidence: SqliteSyncEvidence[], selection: ReturnType<typeof requireBatchSyncSelection>,
  profile: SqliteConnectionProfile): SqliteEditClaim {
  const groups = selection.groups.map(({ tableIndex, rows }) => buildSqliteSyncClaim(evidence[tableIndex], rows, profile));
  return combineSqliteSyncClaims(groups, selection.counts, selection.confirmation);
}
