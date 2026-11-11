import { useState } from 'react';
import { mysqlQueryStatusLimit, type MysqlQueryStatusReport } from '../../shared/mysqlQueryStatus';
import { mysqlQueryStatusZh as text } from '../locales/mysqlQueryStatus.zh-CN';
import { Modal } from './ui';
import '../mysqlQueryStatus.css';

const integer = new Intl.NumberFormat('zh-CN');
const duration = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const stageDuration = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });

/** 回执只含数值和状态。展开及汇总都在本地完成，不访问原会话。 */
export function MysqlQueryStatus({ report }: { report: MysqlQueryStatusReport }) {
  const [open, setOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState<number>();
  const entries = report.entries.slice(0, mysqlQueryStatusLimit);
  const omitted = report.omitted + report.entries.length - entries.length;
  const stages = entries.find(entry => entry.ordinal === selectedStage)?.stages;
  const total = !omitted && entries.length && entries.every(entry => entry.traffic)
    ? entries.reduce((sum, entry) => ({ sent: sum.sent + BigInt(entry.traffic!.sent), received: sum.received + BigInt(entry.traffic!.received) }),
      { sent: 0n, received: 0n }) : undefined;
  return <><details className="mysql-query-status" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{text.title}{total ? <span> · {text.total(integer.format(total.sent), integer.format(total.received))}</span> : null}</summary>
    {open && <div className="mysql-query-status-body">
      {report.termination && <p role="status">{report.termination === 'cancelled' ? text.cancelled : text.interrupted}</p>}
      <p className="muted">{text.hint}</p>
      {report.stageCollection && <p className="muted">{report.stageCollection === 'ready' ? text.stageRetention :
        report.stageCollection === 'disabled' ? text.stageDisabled : text.stageUnavailable}</p>}
      {entries.length ? <table aria-label={text.title}>
        <thead><tr>{text.columns.map(label => <th scope="col" key={label}>{label}</th>)}
          {report.stageCollection && <th scope="col">{text.stageTitle}</th>}
        </tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.ordinal}>
          <th scope="row">{entry.ordinal}</th>
          <td>{text[entry.status]}</td>
          <td>{duration.format(entry.elapsedMs)}</td>
          <td>{entry.traffic ? integer.format(entry.traffic.sent) : text.unavailable}</td>
          <td>{entry.traffic ? integer.format(entry.traffic.received) : text.unavailable}</td>
          {report.stageCollection && <td>{entry.stages ? <button type="button" aria-label={text.stageDetails(entry.ordinal)}
            aria-haspopup="dialog" onClick={() => setSelectedStage(entry.ordinal)}>
            {integer.format(entry.stages.rows.length)}
          </button> : text.stageEmpty}</td>}
        </tr>)}</tbody>
      </table> : <p>{text.empty}</p>}
      {omitted > 0 && <p>{text.omitted(omitted)}</p>}
    </div>}
  </details>
    {stages && selectedStage !== undefined && <Modal title={text.stageTable(selectedStage)} onClose={() => setSelectedStage(undefined)}>
      <div className="modal-content mysql-query-stage-content">
        <p className="muted">{text.stageRetention}</p>
        <table aria-label={text.stageTitle}>
          <thead><tr><th scope="col">{text.stageColumn}</th><th scope="col">{text.stageDuration}</th></tr></thead>
          <tbody>{stages.rows.map((stage, index) => <tr key={index}><td>{stage.name}</td>
            <td>{stage.elapsedMs === null ? text.stageUntimed : stageDuration.format(stage.elapsedMs)}</td>
          </tr>)}</tbody>
        </table>
        {stages.limited && <p>{text.stageLimited}</p>}
      </div>
    </Modal>}
  </>;
}
