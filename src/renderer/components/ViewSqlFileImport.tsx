import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../../shared/contracts';
import { errorMessage, invoke } from '../lib';
import { queryFilesZh as fileText } from '../locales/queryFiles.zh-CN';
import { viewSqlFileZh as text } from '../locales/viewSqlFile.zh-CN';
import { ErrorBox, Field } from './ui';

/** SQL 文件只读写当前草稿。切换目标、修改正文或开始预览后丢弃迟到结果。 */
export function ViewSqlFileImport({ owner, name, value, disabled, hint, current, prepare, prepareSave = prepare, apply }: {
  owner: object;
  name: string;
  value: string;
  disabled: boolean;
  hint: string;
  current(): boolean;
  prepare(sql: string): string;
  prepareSave?(sql: string): string;
  apply(sql: string): void;
}) {
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [replacement, setReplacement] = useState<{ sql: string; token: object }>();
  const lease = useRef<object | undefined>(undefined), pending = useRef(false);
  useLayoutEffect(() => {
    const token = {};
    lease.current = token;
    setMessage('');
    setReplacement(undefined);
    return () => { if (lease.current === token) lease.current = undefined; };
  }, [owner, disabled]);

  async function transfer(action: 'load' | 'save') {
    const token = lease.current;
    if (!token || pending.current || disabled || !current()) return;
    const live = () => lease.current === token && current();
    pending.current = true; setBusy(true); setError(''); setMessage(''); setReplacement(undefined);
    try {
      if (action === 'save') {
        // 先冻结当前可载入的草稿和编码。原生对话框返回时原草稿已变更则撤销本次保存。
        const sql = prepareSave(value);
        const safeName = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
        const selected = await invoke('files.choose', { purpose: 'export', format: 'sql', suggestedName: text.filename(safeName) });
        if (!selected || !live()) return;
        await invoke('files.writeQuery', { fileToken: selected.token, encoding, sql });
        if (live()) setMessage(text.saved(selected.name));
        return;
      }
      const selected = await invoke('files.choose', { purpose: 'query', format: 'sql' });
      if (!selected || !live()) return;
      const { sql } = await invoke('files.readQuery', { fileToken: selected.token, encoding });
      if (!live()) return;
      const draft = prepare(sql);
      if (draft === value) return;
      if (value.trim()) setReplacement({ sql: draft, token });
      else apply(draft);
    } catch (reason) {
      if (live()) setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (lease.current) setBusy(false);
    }
  }

  /** 确认只消费当前草稿的文件正文，不能覆盖等待确认期间的新输入。 */
  function replace() {
    if (!replacement || lease.current !== replacement.token || disabled || !current()) return;
    setReplacement(undefined);
    apply(replacement.sql);
  }

  return <div aria-busy={busy}>
    <Field label={fileText.encoding}><select aria-label={fileText.encoding} disabled={disabled || busy} value={encoding}
      onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
      <option value="utf8">{fileText.utf8}</option>
      <option value="utf16le">{fileText.utf16le}</option>
      <option value="gb18030">{fileText.gb18030}</option>
    </select></Field>
    <button type="button" title={hint} disabled={disabled || busy} onClick={() => void transfer('load')}>{text.open}</button>
    <button type="button" disabled={disabled || busy || !value.trim()} onClick={() => void transfer('save')}>{text.save}</button>
    {message && <p role="status">{message}</p>}
    {replacement && <div>
      <p>{text.replace}</p>
      <button type="button" onClick={() => setReplacement(undefined)}>{text.keep}</button>
      <button type="button" onClick={replace}>{text.confirmReplace}</button>
    </div>}
    <ErrorBox message={error}/>
  </div>;
}
