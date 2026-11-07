import { useEffect, useRef, useState } from 'react';
import { importBatchLimit, type ImportBatchChoice, type ImportBatchChoose } from '../../shared/fileImportBatch';
import type { ImportFileInspectOutput, ImportFileReadOptions } from '../../shared/importNewTable';
import type { FileImportResult } from '../../shared/sqlFileImport';
import { cellPreview, errorMessage, invoke, uid } from '../lib';
import { matchImportColumns, type ImportMappingAction } from '../importMapping';
import { ImportMappingActions } from './ImportMappingActions';
import { ErrorBox, Modal } from './ui';

type Options = ImportFileReadOptions & { format: ImportBatchChoose['format'] };
type ScannedFile = Pick<ImportFileInspectOutput, 'records' | 'source' | 'rows'> & { token: string; name: string };
type Scan = { files: ScannedFile[]; columns: string[]; targets: string[] };
type Operation = { taskId?: string; cancelled: boolean; cancelling?: Promise<unknown> };

export const importBatchZh = {
  open: '多文件导入',
  title: '向同一张表导入多个文件',
  choose: '选择并扫描多个文件',
  preflight: '预检全部文件',
  commit: '确认整批导入',
  mapping: (name: string) => '批次映射 ' + name,
  select: '不导入此列',
  back: '返回导入设置',
  cancel: '取消当前操作',
  close: '完成',
  scanned: (count: number, rows: number) => `已扫描 ${count} 个文件，共 ${rows} 条记录。`,
  checked: (count: number) => `${count} 个文件均通过预检，等待确认提交。`,
  committed: (count: number, rows: number) => `已提交 ${count} 个文件，共 ${rows} 条记录。`,
  failed: '未确认整批提交，请核对回执后再决定是否重新导入。',
  changed: '连接已变化，请关闭后重新打开导入。',
} as const;

/** 批次共用一份映射。扫描与预检逐文件串行，提交仅发送一次原子导入。 */
export function ImportBatchDialog({ target, options, current, onBack, onDone }: {
  target: Omit<ImportBatchChoose, 'format'>; options: Options;
  current(): boolean; onBack(): void; onDone(): void;
}) {
  const [choiceList, setChoiceList] = useState<ImportBatchChoice['files']>([]);
  const [scan, setScan] = useState<Scan>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<FileImportResult>();
  const [submitted, setSubmitted] = useState(false);
  const selection = useRef<ImportBatchChoice | undefined>(undefined);
  const operation = useRef<Operation | undefined>(undefined);
  const mounted = useRef(false);
  const submittedRef = useRef(false);
  const confirmation = useRef<{ scan: Scan; schema: string } | undefined>(undefined);
  const original = useRef({ target, current });
  const stillCurrent = () => original.current.current() && current() &&
    original.current.target.connectionId === target.connectionId && original.current.target.database === target.database &&
    original.current.target.table === target.table;
  const valid = stillCurrent();
  const release = (choice?: ImportBatchChoice) => {
    if (choice) void invoke('files.releaseImportBatch', { token: choice.token }).catch(() => undefined);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = operation.current;
      if (active?.taskId && !active.cancelling) void invoke('query.cancel', { taskId: active.taskId }).catch(() => undefined);
      release(selection.current);
    };
  }, []);

  function begin(): Operation | undefined {
    if (!mounted.current || !stillCurrent() || operation.current || submittedRef.current) return;
    const active = { cancelled: false };
    operation.current = active; setBusy(true); setProgress(''); setError('');
    return active;
  }
  function assertCurrent(active: Operation) {
    if (active.cancelled) throw Error('操作已取消。');
    if (!mounted.current || !stillCurrent() || operation.current !== active) throw Error(importBatchZh.changed);
  }
  async function finish(active: Operation) {
    await active.cancelling;
    if (operation.current !== active) return;
    operation.current = undefined;
    if (mounted.current) { setBusy(false); setProgress(''); }
  }
  function fail(active: Operation, reason: unknown) {
    if (mounted.current && operation.current === active) setError(errorMessage(reason));
  }
  function cancel() {
    const active = operation.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    setProgress('正在等待当前任务结束…');
    if (active.taskId) active.cancelling = invoke('query.cancel', { taskId: active.taskId }).catch(reason => fail(active, reason));
  }
  function invalidatePreview() { confirmation.current = undefined; setVerified(false); }

  async function chooseAndScan() {
    const active = begin();
    if (!active) return;
    try {
      const choice = await invoke('files.chooseImportBatch', { ...target, format: options.format });
      if (!choice) return;
      if (!mounted.current || !stillCurrent() || active.cancelled) { release(choice); assertCurrent(active); }
      selection.current = choice; setChoiceList(choice.files);
      invalidatePreview(); setScan(undefined); setMapping({});
      const info = await invoke('metadata.table', target);
      assertCurrent(active);
      if (info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB') throw Error('多文件导入只支持 InnoDB 基本表。');
      const targets = info.columns.filter(column => !column.generated).map(column => column.name);
      const files: ScannedFile[] = [];
      let columns: string[] = [];
      let columnSet: Set<string> | undefined;
      for (const [index, file] of choice.files.entries()) {
        assertCurrent(active);
        setProgress(`扫描第 ${index + 1} 个文件，共 ${choice.files.length} 个。`);
        const taskId = uid(); active.taskId = taskId;
        const { records, columns: names, rows, source } = await invoke('files.inspectImport', {
          ...options, fileToken: file.token, taskId, strictEncoding: true, batchToken: choice.token,
        });
        active.taskId = undefined;
        assertCurrent(active);
        if (!records || !names.length) throw Error(`第 ${index + 1} 个文件没有可导入的记录。`);
        if (!columnSet) { columns = names; columnSet = new Set(names); }
        if (names.length !== columns.length || names.some(name => !columnSet!.has(name))) throw Error(`第 ${index + 1} 个文件的源字段与首个文件不一致。`);
        files.push({ ...file, records, source, rows: rows.slice(0, 3) });
      }
      if (!Number.isSafeInteger(files.reduce((total, file) => total + file.records, 0))) throw Error('批次记录总数超过可确认范围。');
      setScan({ files, columns, targets });
      const positional = options.format === 'csv' && options.csvHasHeader === false || options.format === 'txt' && options.txtOptions?.hasHeader === false;
      const writable = new Set(targets);
      setMapping(Object.fromEntries(columns.map(column => [column, !positional && writable.has(column) ? column : ''])));
    } catch (reason) { fail(active, reason); }
    finally { await finish(active); }
  }

  function map(action: ImportMappingAction) {
    if (!scan || operation.current || submittedRef.current || !stillCurrent()) return;
    invalidatePreview();
    const selected = matchImportColumns(action, scan.columns, scan.targets.map(name => ({ name })));
    setMapping(Object.fromEntries(scan.columns.map((name, index) => [name, selected[index]?.name ?? ''])));
  }
  const selectedMapping = Object.fromEntries(Object.entries(mapping).filter(([, value]) => value));
  const mapped = Object.values(selectedMapping);
  const mappingReady = mapped.length > 0 && new Set(mapped).size === mapped.length;
  const total = scan?.files.reduce((sum, file) => sum + file.records, 0) ?? 0;

  async function preflight() {
    const choice = selection.current;
    if (!scan || !mappingReady || !choice) return;
    const active = begin();
    if (!active) return;
    invalidatePreview();
    let schema: string | undefined;
    try {
      for (const [index, file] of scan.files.entries()) {
        assertCurrent(active);
        setProgress(`预检第 ${index + 1} 个文件，共 ${scan.files.length} 个。`);
        const taskId = uid(); active.taskId = taskId;
        const report = await invoke('files.preflight', {
          ...target, ...options, taskId, fileToken: file.token, expectedSource: file.source, batchToken: choice.token, mapping: selectedMapping,
        });
        active.taskId = undefined;
        assertCurrent(active);
        if (!report.complete || report.issueCount || report.validRecords !== file.records ||
            report.sourceFingerprint !== file.source.sha256 || report.sourceBytes !== file.source.bytes ||
            schema !== undefined && schema !== report.schemaFingerprint) {
          const issue = report.issues[0]?.message;
          throw Error(`第 ${index + 1} 个文件未通过预检。${issue ?? '文件、目标结构或记录数有变化，请重新扫描。'}`);
        }
        schema = report.schemaFingerprint;
      }
      if (!schema) throw Error('未取得目标表结构指纹。');
      confirmation.current = { scan, schema }; setVerified(true);
    } catch (reason) { fail(active, reason); }
    finally { await finish(active); }
  }

  async function commit() {
    const choice = selection.current;
    const checked = confirmation.current;
    if (!scan || !choice || checked?.scan !== scan || !mappingReady) return;
    const active = begin();
    if (!active) return;
    invalidatePreview(); submittedRef.current = true; setSubmitted(true);
    const taskId = uid(); active.taskId = taskId;
    setProgress('正在写入同一事务，等待数据库确认…');
    try {
      const receipt = await invoke('files.import', {
        ...target, ...options, taskId, fileToken: scan.files[0].token,
        mapping: selectedMapping, transactionMode: 'atomic',
        batch: { token: choice.token, schemaFingerprint: checked.schema, sources: scan.files.map(file => ({
          fileToken: file.token, expectedSource: file.source, records: file.records,
        })) },
      });
      if (mounted.current) setResult(receipt);
    } catch (reason) { fail(active, Error(importBatchZh.failed + ' ' + errorMessage(reason))); }
    finally { await finish(active); }
  }

  function close() {
    if (operation.current) return;
    if (submittedRef.current) onDone(); else onBack();
  }
  return <Modal title={importBatchZh.title} wide onClose={close}>
    <div className="modal-content" aria-busy={busy}>
      <p>{target.database}.{target.table} · {options.format.toUpperCase()} · {options.encoding.toUpperCase()}</p>
      <p className="muted">一次选择 2 至 {importBatchLimit} 个文件，共用前一步的编码、格式选项和本页字段映射。全部文件使用一次事务新增。</p>
      {!submitted && <button type="button" disabled={!valid || busy} onClick={() => void chooseAndScan()}>{importBatchZh.choose}</button>}
      {!scan && choiceList.length > 0 && <ol>{choiceList.map(file => <li key={file.token}>{file.name}</li>)}</ol>}
      {scan && <>
        <p>{importBatchZh.scanned(scan.files.length, total)}</p>
        <ol>{scan.files.map(file => <li key={file.token}>
          <details><summary>{file.name} · {file.records} 条</summary>
            <table><thead><tr>{scan.columns.slice(0, 12).map(name => <th key={name}>{name}</th>)}</tr></thead>
              <tbody>{file.rows.map((row, index) => <tr key={index}>{scan.columns.slice(0, 12).map(name =>
                <td key={name}>{cellPreview(Object.hasOwn(row, name) ? row[name] : undefined, 100)}</td>)}</tr>)}</tbody></table>
          </details>
        </li>)}</ol>
        <h3>共用字段映射</h3>
        <ImportMappingActions disabled={!valid || busy || submitted} onAction={map}/>
        <div className="mapping-grid">{scan.columns.map(name => <label className="mapping-row" key={name}>
          <span className="truncate">{name || '空字段名'}</span>
          <select aria-label={importBatchZh.mapping(name)} value={mapping[name] ?? ''} disabled={!valid || busy || submitted}
            onChange={event => { if (!operation.current && !submittedRef.current && stillCurrent()) {
              invalidatePreview(); setMapping({ ...mapping, [name]: event.target.value });
            } }}>
            <option value="">{importBatchZh.select}</option>
            {scan.targets.map(value => <option value={value} key={value} disabled={value !== mapping[name] && mapped.includes(value)}>{value}</option>)}
          </select>
        </label>)}</div>
        {!submitted && <button type="button" disabled={!valid || busy || !mappingReady} onClick={() => void preflight()}>{importBatchZh.preflight}</button>}
        {verified && <p role="status">{importBatchZh.checked(scan.files.length)}</p>}
        {result && (result.rows === total ? <p className="success-box" role="status">{importBatchZh.committed(scan.files.length, total)}</p>
          : <p className="error-box">{importBatchZh.failed}</p>)}
      </>}
      {progress && <p role="status">{progress}</p>}
      <ErrorBox message={error || (!valid ? importBatchZh.changed : '')}/>
      {result?.errors.map((detail, index) => <p key={index}>{detail}</p>)}
    </div>
    <footer className="modal-footer">
      <button type="button" disabled={busy} onClick={close}>{submitted ? importBatchZh.close : importBatchZh.back}</button>
      <span className="grow"/>
      {busy && <button type="button" disabled={operation.current?.cancelled} onClick={cancel}>{importBatchZh.cancel}</button>}
      {!submitted && <button type="button" className="primary" disabled={!valid || busy || !verified} onClick={() => void commit()}>{importBatchZh.commit}</button>}
    </footer>
  </Modal>;
}
