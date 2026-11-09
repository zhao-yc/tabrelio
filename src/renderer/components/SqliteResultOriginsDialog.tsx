import type { QueryResult, SqliteResultColumnOrigin } from '../../shared/contracts';
import { sqliteResultOriginsZh as text } from '../locales/sqliteResultOrigins.zh-CN';
import { zh } from '../locales/zh-CN';
import { Modal } from './ui';
import { QueryResultOriginsTable } from './QueryResultOriginsTable';

export function SqliteResultOriginsDialog({ result, origins, onOpenTable, onClose }: {
  result: QueryResult;
  origins: readonly SqliteResultColumnOrigin[];
  onOpenTable(index: number): void;
  onClose(): void;
}) {
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.hint}</p>
      <QueryResultOriginsTable result={result} origins={origins} labels={text} action={index => {
        const origin = origins[index];
        return origin?.database === 'main' && <button type="button" aria-label={text.tableLabel(origin.table, index + 1)}
          onClick={() => onOpenTable(index)}>{text.openTable}</button>;
      }}/>
    </div>
    <footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
