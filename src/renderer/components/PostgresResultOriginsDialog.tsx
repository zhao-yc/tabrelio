import type { QueryResult } from '../../shared/contracts';
import type { PostgresResultOrigin } from '../../shared/postgresResultOrigins';
import { postgresResultOriginsZh as text } from '../locales/postgresResultOrigins.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import '../queryResultFrequency.css';

export function PostgresResultOriginsDialog({ result, origins, error, onOpen, onClose }: {
  result: QueryResult; origins?: PostgresResultOrigin[]; error?: string;
  onOpen(index: number): void; onClose(): void;
}) {
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.hint}</p>
      {error ? <ErrorBox message={error}/> : !origins ? <Spinner/> : <div className="query-result-overview">
        <table aria-label={text.title}>
          <thead><tr>{[text.position, text.resultColumn, text.schema, text.relation, text.column, text.action]
            .map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{result.columns.map((column, index) => {
            const origin = origins[index];
            return <tr key={column.key}>
              <td>{index + 1}</td><th scope="row">{column.name || text.missing}</th>
              <td>{origin?.schema ?? text.missing}</td><td>{origin?.table ?? text.missing}</td><td>{origin?.column ?? text.missing}</td>
              <td>{origin?.canOpen && <button type="button" aria-label={text.openLabel(origin.table, index + 1)}
                onClick={() => onOpen(index)}>{text.openRelation}</button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </div>
    <footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
