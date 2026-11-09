import type { ReactNode } from 'react';
import type { QueryResult } from '../../shared/contracts';
import '../queryResultFrequency.css';

export function QueryResultOriginsTable({ result, origins, labels, action }: {
  result: QueryResult;
  origins: readonly ({ database: string; table: string; column: string } | null)[];
  labels: { title: string; position: string; resultColumn: string; database: string; table: string;
    column: string; action: string; unavailable: string };
  action(index: number): ReactNode;
}) {
  return <div className="query-result-overview"><table aria-label={labels.title}>
    <thead><tr>{[labels.position, labels.resultColumn, labels.database, labels.table, labels.column, labels.action]
      .map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{result.columns.map((column, index) => {
      const origin = origins[index];
      return <tr key={column.key}>
        <td>{index + 1}</td><th scope="row">{column.name || labels.unavailable}</th>
        <td>{origin?.database ?? labels.unavailable}</td><td>{origin?.table ?? labels.unavailable}</td>
        <td>{origin?.column ?? labels.unavailable}</td><td>{action(index)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
