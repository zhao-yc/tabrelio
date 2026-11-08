import type { PostgresSqlFileInspection } from '../../shared/postgresSqlFile';
import { postgresSqlFileZh as text } from '../locales/postgresSqlFile.zh-CN';

export function PostgresSqlInspectionReport({ inspection }: { inspection: PostgresSqlFileInspection }) {
  const issue = inspection.issue;
  const locate = issue && issue.reason !== 'cancelled' && issue.reason !== 'file';
  return <section className="database-backup-plan" aria-label={text.inspectionTitle}>
    <strong>{text.inspectionTitle}</strong>
    <p>{issue ? text.reason[issue.reason] : text.inspectionComplete}</p>
    {locate && <p>{text.inspectionStopped} {text.failedAt(issue.nextStatement)}</p>}
    <p>{text.inspectionSummary(inspection.statements, inspection.structure, inspection.changes,
      inspection.copyBlocks, inspection.copyBytes, inspection.other)}</p>
    <p>{text.inspectionScope}</p>
  </section>;
}
