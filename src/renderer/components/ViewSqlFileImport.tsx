import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../../shared/contracts';
import { errorMessage, invoke } from '../lib';
import { queryFilesZh as fileText } from '../locales/queryFiles.zh-CN';
import { viewSqlFileZh as text } from '../locales/viewSqlFile.zh-CN';
import { ErrorBox, Field } from './ui';

/** 读取本机 SQL 只替换当前定义草稿。切换目标、修改正文或开始预览后丢弃迟到结果。 */
export function ViewSqlFileImport({ owner, value, disabled, hint, current, prepare, apply }: {
  owner: object;
  value: string;
  disabled: boolean;
  hint: string;
  current(): boolean;
  prepare(sql: string): string;
  apply(sql: string): void;
}) {
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [replacement, setReplacement] = useState<{ sql: string; token: object }>();
  const lease = useRef<object | undefined>(undefined), pending = useRef(false);
  useLayoutEffect(() => {
    const token = {};
    lease.current = token;
    setReplacement(undefined);
    return () => { if (lease.current === token) lease.current = undefined; };
  }, [owner, disabled]);

  async function load() {
    const token = lease.current;
    if (!token || pending.current || disabled || !current()) return;
    const live = () => lease.current === token && current();
    pending.current = true; setBusy(true); setError(''); setReplacement(undefined);
    try {
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
    <Field label={fileText.encoding}><select disabled={disabled || busy} value={encoding}
      onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
      <option value="utf8">{fileText.utf8}</option>
      <option value="utf16le">{fileText.utf16le}</option>
      <option value="gb18030">{fileText.gb18030}</option>
    </select></Field>
    <button type="button" title={hint} disabled={disabled || busy} onClick={() => void load()}>{text.open}</button>
    {replacement && <div>
      <p>{text.replace}</p>
      <button type="button" onClick={() => setReplacement(undefined)}>{text.keep}</button>
      <button type="button" onClick={replace}>{text.confirmReplace}</button>
    </div>}
    <ErrorBox message={error}/>
  </div>;
}
