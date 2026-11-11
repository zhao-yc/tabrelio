import { useState } from 'react';
import { mysqlQueryStatusLimit, type MysqlQueryStatusReport } from '../../shared/mysqlQueryStatus';
import { mysqlQueryStatusZh as text } from '../locales/mysqlQueryStatus.zh-CN';
import '../mysqlQueryStatus.css';

const integer = new Intl.NumberFormat('zh-CN');
const duration = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

/** 回执只含数值和状态。展开及汇总都在本地完成，不访问原会话。 */
export function MysqlQueryStatus({ report }: { report: MysqlQueryStatusReport }) {
  const [open, setOpen] = useState(false);
  const entries = report.entries.slice(0, mysqlQueryStatusLimit);
  const omitted = report.omitted + report.entries.length - entries.length;
  const total = !omitted && entries.length && entries.every(entry => entry.traffic)
    ? entries.reduce((sum, entry) => ({ sent: sum.sent + BigInt(entry.traffic!.sent), received: sum.received + BigInt(entry.traffic!.received) }),
      { sent: 0n, received: 0n }) : undefined;
  return <details className="mysql-query-status" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{text.title}{total ? <span> · {text.total(integer.format(total.sent), integer.format(total.received))}</span> : null}</summary>
    {open && <div className="mysql-query-status-body">
      <p className="muted">{text.hint}</p>
      {entries.length ? <table aria-label={text.title}>
        <thead><tr>{text.columns.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.ordinal}>
          <th scope="row">{entry.ordinal}</th>
          <td>{text[entry.status]}</td>
          <td>{duration.format(entry.elapsedMs)}</td>
          <td>{entry.traffic ? integer.format(entry.traffic.sent) : text.unavailable}</td>
          <td>{entry.traffic ? integer.format(entry.traffic.received) : text.unavailable}</td>
        </tr>)}</tbody>
      </table> : <p>{text.empty}</p>}
      {omitted > 0 && <p>{text.omitted(omitted)}</p>}
    </div>}
  </details>;
}
