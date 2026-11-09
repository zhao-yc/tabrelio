import type { QueryResult, SqliteResultColumnOrigin } from '../../shared/contracts';
import { sqliteResultOriginsZh as text } from '../locales/sqliteResultOrigins.zh-CN';
import { zh } from '../locales/zh-CN';
import { Modal } from './ui';
import '../queryResultFrequency.css';

export function SqliteResultOriginsDialog({ result, origins, onOpenTable, onClose }: {
  result: QueryResult;
  origins: readonly SqliteResultColumnOrigin[];
  onOpenTable(index: number): void;
  onClose(): void;
}) {
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.hint}</p>
      <div className="query-result-overview"><table aria-label={text.title}>
        <thead><tr>{[text.position, text.resultColumn, text.database, text.table, text.column, text.action].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{result.columns.map((column, index) => {
          const origin = origins[index];
          return <tr key={column.key}>
            <td>{index + 1}</td><th scope="row">{column.name || text.unavailable}</th>
            <td>{origin?.database ?? text.unavailable}</td><td>{origin?.table ?? text.unavailable}</td><td>{origin?.column ?? text.unavailable}</td>
            <td>{origin?.database === 'main' && <button type="button" aria-label={text.tableLabel(origin.table, index + 1)}
              onClick={() => onOpenTable(index)}>{text.openTable}</button>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
    <footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
