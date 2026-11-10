import { useRef, useState } from 'react';
import { savedQueryRenameNameSchema } from '../../shared/savedQueryRename';
import { queryTabRenameZh as text } from '../locales/queryTabRename.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

/** 表单仅保留标题。提交时由工作台核对原标签令牌，避免把名称写到同名标签。 */
export function QueryTabRenameDialog({ owner, title, onRename, onClose }: {
  owner: string; title: string; onRename(name: string): boolean; onClose(): void;
}) {
  const [name, setName] = useState(title), [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const parsed = savedQueryRenameNameSchema.safeParse(name.trim());
  return <Modal title={text.action} onClose={onClose} initialFocus={input}>
    <form data-query-tab-rename={owner} onSubmit={event => {
      event.preventDefault();
      if (!composing.current && !stale && parsed.success && parsed.data !== title && !onRename(parsed.data)) setStale(true);
    }}>
      <div className="modal-content">
        <p>{text.hint}</p>
        <Field label={text.name}><input ref={input} aria-label={text.name} value={name} maxLength={256}
          onFocus={event => event.currentTarget.select()}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={event => setName(event.target.value)}/></Field>
        <ErrorBox message={stale ? text.stale : parsed.success ? '' : parsed.error.issues[0]?.message ?? ''}/>
      </div>
      <footer className="modal-footer"><button type="button" onClick={onClose}>{zh.common.cancel}</button><span className="grow"/>
        <button type="submit" className="primary" disabled={stale || !parsed.success || parsed.data === title}>{text.confirm}</button></footer>
    </form>
  </Modal>;
}
