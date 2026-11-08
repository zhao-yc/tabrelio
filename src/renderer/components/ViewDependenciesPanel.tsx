import { useLayoutEffect, useRef, useState } from 'react';
import type { ViewDependencies, ViewDependency } from '../../shared/viewDependencies';
import { assertObjectDefinitionOutput, objectDefinitionInputSchema, objectDefinitionTaskPrefix, type ObjectDefinitionOutput } from '../../shared/objectDefinition';
import { errorMessage, invoke, uid } from '../lib';
import { viewDependenciesZh as text } from '../locales/viewDependencies.zh-CN';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Spinner } from './ui';

interface DefinitionRequest {
  taskId: string;
  lease: object;
  cancelled: boolean;
  cancellation?: Promise<unknown>;
}

function DependenciesTable({ title, rows, unknown = false, disabled, open }: {
  title: string; rows: ViewDependency[]; unknown?: boolean; disabled: boolean; open(row: ViewDependency): void;
}) {
  return <section aria-label={title}>
    <h3>{title}</h3>
    {rows.length ? <table className="design-table">
      <thead><tr><th>{text.database}</th><th>{text.name}</th><th>{text.definition}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={JSON.stringify([row.database, row.name])}><td>{row.database}</td><td>{row.name}</td>
        <td><button type="button" disabled={disabled} aria-label={text.openDefinition(row.database, row.name)}
          onClick={() => open(row)}>{text.definition}</button></td></tr>)}</tbody>
    </table> : <p>{unknown ? text.referencedUnknown : text.empty}</p>}
  </section>;
}

/** 结果仅绑定已保存对象的原窗口和连接，草稿编辑不改变依赖来源。 */
export function ViewDependenciesPanel({ owner, current, disabled, load, connectionId, dialect }: {
  owner: object; current(): boolean; disabled: boolean; load(): Promise<ViewDependencies>;
  connectionId: string; dialect: 'mysql' | 'mariadb' | 'sqlite';
}) {
  const active = useRef<object | undefined>(undefined), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [data, setData] = useState<ViewDependencies>();
  const [definition, setDefinition] = useState<{ row: ViewDependency; output?: ObjectDefinitionOutput; error?: string }>();
  const [definitionBusy, setDefinitionBusy] = useState(false);
  const readingDefinition = useRef<DefinitionRequest | undefined>(undefined);
  const definitionSection = useRef<HTMLElement>(null);
  const selectedRow = definition?.row;

  useLayoutEffect(() => {
    if (selectedRow) definitionSection.current?.focus();
  }, [selectedRow]);

  /** 只取消本面板持有的定义读取，等待原请求与取消都收尾后再允许重读。 */
  function stopDefinition() {
    const request = readingDefinition.current;
    if (!request || request.cancelled) return;
    request.cancelled = true;
    request.cancellation = invoke('query.cancel', { taskId: request.taskId }).catch(reason => {
      if (active.current === request.lease && current()) setError(errorMessage(reason));
    });
  }

  useLayoutEffect(() => {
    const lease = {};
    active.current = lease;
    setData(undefined);
    setError('');
    setDefinition(undefined);
    return () => {
      if (active.current === lease) {
        active.current = undefined;
        stopDefinition();
      }
    };
  }, [owner, disabled]);

  async function read() {
    const lease = active.current;
    if (!lease || disabled || pending.current || readingDefinition.current || !current()) return;
    const live = () => active.current === lease && current();
    pending.current = true;
    setBusy(true);
    setError('');
    setData(undefined);
    setDefinition(undefined);
    try {
      const result = await load();
      if (live()) setData(result);
    } catch (reason) {
      if (live()) setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  /** 直接使用目录行的库和对象名，不从显示文本或未保存 SQL 重新解析目标。 */
  async function openDefinition(row: ViewDependency, expectedKind?: 'view') {
    const lease = active.current;
    if (!lease || disabled || pending.current || readingDefinition.current || !current()) return;
    const taskId = objectDefinitionTaskPrefix + uid();
    const request: DefinitionRequest = { taskId, lease, cancelled: false };
    readingDefinition.current = request;
    const live = () => active.current === lease && !request.cancelled && current();
    setDefinition({ row });
    setDefinitionBusy(true);
    try {
      const input = objectDefinitionInputSchema.parse({ connectionId, database: row.database, table: row.name, taskId });
      const result = await invoke('query.objectDefinition', input);
      if (!live()) return;
      assertObjectDefinitionOutput(result, input, dialect);
      if (expectedKind && result.kind !== expectedKind) throw Error(text.kindChanged);
      setDefinition({ row, output: result });
    } catch (reason) {
      if (live()) setDefinition({ row, error: errorMessage(reason) });
    } finally {
      await request.cancellation;
      readingDefinition.current = undefined;
      if (active.current) setDefinitionBusy(false);
    }
  }

  function closeDefinition() {
    stopDefinition();
    setDefinition(undefined);
  }

  const unavailable = busy || disabled || definitionBusy;
  return <section aria-label={text.title} aria-busy={busy || definitionBusy}>
    <p className="muted">{text.hint}</p>
    <button type="button" disabled={unavailable} onClick={() => void read()}>{text.read}</button>
    {busy && <Spinner text={text.working}/>}
    <ErrorBox message={error}/>
    {definition && <section ref={definitionSection} tabIndex={-1} aria-label={text.definitionTitle}>
      <h3>{text.definitionTitle}</h3>
      <p><code>{definition.row.database} / {definition.row.name}</code></p>
      {definitionBusy && <Spinner text={text.loadingDefinition}/>}
      <ErrorBox message={definition.error}/>
      {definition.output && <SqlEditor key={definition.output.request.taskId} value={definition.output.ddl}
        dialect={dialect} readOnly height={240}/>}
      <button type="button" onClick={closeDefinition}>{text.closeDefinition}</button>
    </section>}
    {data && <>
      <p>{data.source === 'catalogue' ? text.catalogue : text.definitions}</p>
      {data.skipped > 0 && <p className="warning-text">{text.skipped(data.skipped)}</p>}
      {data.truncated && <p className="warning-text">{text.truncated}</p>}
      <DependenciesTable title={text.referenced} rows={data.referenced} unknown={data.referencedUnknown}
        disabled={unavailable} open={row => void openDefinition(row)}/>
      <DependenciesTable title={text.referencing} rows={data.referencing}
        disabled={unavailable} open={row => void openDefinition(row, 'view')}/>
    </>}
  </section>;
}
