import type { SqliteWriteFact } from '../../shared/sqliteTableEdit';
import { sqliteImportWriteFactSchema } from '../../shared/sqliteTableImport';
import { sqliteWriteFactSchema } from '../../shared/sqliteWriteFact';
import { sqliteWriteFactZh as text } from '../locales/sqliteWriteFact.zh-CN';

/** TaskEvent只是展示通道，只有Main验证过的最小事实可展开，处理数量不冒充提交数量。 */
export function SqliteWriteFactSummary({ fact, importing = false }: { fact?: SqliteWriteFact; importing?: boolean }) {
  const parsed = (importing ? sqliteImportWriteFactSchema : sqliteWriteFactSchema).safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  const tables = 'batchTables' in value && Array.isArray(value.batchTables) ? value.batchTables : [value.target.table];
  return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {tables.join('、')}</dd><dt>{text.requested}</dt><dd>{value.requestedRows}</dd><dt>{text.processed}</dt><dd>{value.appliedRows}</dd></dl></details>;
}
