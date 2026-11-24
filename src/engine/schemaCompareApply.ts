import type { ResultSetHeader } from 'mysql2';
import type { SchemaCompareApplyResult, SchemaComparePreview, SchemaCompareResult } from '../shared/schemaCompare';
import { readSchemaComparisonTarget, type SchemaComparisonSnapshot } from './schemaCompare';
import { compareSchemaSnapshots } from './schemaCompareProjection';
import { qualified } from './sql';
import { assertStructureDefinitionUnchanged, structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';

/** 仅用引擎已生成的变更，合并成一条 InnoDB 原子 ALTER；外键改动仍须人工审查。 */
export function schemaSynchronizationSql(target: SchemaComparisonSnapshot, report: SchemaCompareResult, preview: SchemaComparePreview): string | undefined {
  if (!preview.statements.length || preview.blocked.length || !target.namespace || !/^(?:8\.[04]\.|10\.11\.|11\.4\.)/.test(target.serverVersion)) return;
  const document = structureDocumentOf(target);
  const tail = tableDefinitionTokens(document.tail.raw, target.context);
  if (!tail.some((token, index) => token.kind === 'word' && token.value.toUpperCase() === 'ENGINE' &&
    tail[index + 1]?.value === '=' && tail[index + 2]?.value.toUpperCase() === 'INNODB')) return;
  if (!target.normalizedMode.split(',').some(mode => mode === 'STRICT_TRANS_TABLES' || mode === 'STRICT_ALL_TABLES')) return;
  const prefix = 'ALTER TABLE ' + qualified(target.target.database, target.target.table) + ' ';
  const clauses = preview.statements.map(statement => {
    if (statement.destructive || !statement.sql.startsWith(prefix) || !statement.sql.endsWith(';')) return;
    const row = report.rows.find(item => item.category === statement.category && item.name === statement.name);
    // 现有行的列类型和约束保持；索引仅新增，保留服务器对唯一键的原子检查。
    if (statement.category === 'columns' && row?.status === 'added' && row.source) {
      const tokens = tableDefinitionTokens(row.source.rawSql, target.context);
      const notNull = tokens.some((token, index) => token.kind === 'word' && token.value.toUpperCase() === 'NOT' &&
        tokens[index + 1]?.kind === 'word' && tokens[index + 1].value.toUpperCase() === 'NULL');
      if (notNull && !tokens.some(token => token.kind === 'word' && token.value.toUpperCase() === 'DEFAULT')) return;
    } else if (!(statement.category === 'columns' && row?.status === 'changed' &&
        row.changedProperties.every(property => property === 'default' || property === 'comment')) &&
        !(statement.category === 'indexes' && row?.status === 'added')) return;
    return statement.sql.slice(prefix.length, -1);
  });
  if (clauses.some(clause => !clause)) return;
  return prefix + clauses.join(',\n  ') + ';';
}

/** 用执行连接复核完整目标定义，提交后从同一服务器回读所选结构。 */
export async function applySchemaSynchronization(context: StructureTaskContext, source: SchemaComparisonSnapshot,
  target: SchemaComparisonSnapshot, preview: SchemaComparePreview, sql: string, submitting: () => void, check: () => void): Promise<SchemaCompareApplyResult> {
  await structureTaskQuery(context, 'SET SESSION lock_wait_timeout = 10');
  const current = await readSchemaComparisonTarget(context, target.target);
  assertStructureDefinitionUnchanged(target, current);
  if (JSON.stringify(current.namespace) !== JSON.stringify(target.namespace)) throw Error('目标实例或名称规则已变化，未发送结构同步');
  check();
  const { rows } = await structureTaskQuery<ResultSetHeader>(context, sql, submitting);
  const warningCount = Number.isSafeInteger(rows?.warningStatus) ? rows.warningStatus : null;
  const result: SchemaCompareApplyResult = { status: 'unverified', target: { ...target.target }, changed: 0, warningCount };
  try {
    const after = await readSchemaComparisonTarget(context, target.target), report = compareSchemaSnapshots(source, after);
    result.changed = preview.statements.filter(statement => report.rows.some(row => row.category === statement.category &&
      row.name === statement.name && (row.status === 'same' || statement.category === 'columns' &&
        row.status === 'changed' && row.changedProperties.length === 1 && row.changedProperties[0] === 'position'))).length;
    if (warningCount === 0 && result.changed === preview.statements.length && after.identity === target.identity) result.status = 'verified';
  } catch { /* DDL 已返回，回读失败须保留需核对状态。 */ }
  return result;
}
