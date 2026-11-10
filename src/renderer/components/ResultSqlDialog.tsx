import { useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { zh } from '../locales/zh-CN';
import { Modal } from './ui';
import { SqlEditor } from './SqlEditor';
import { SqlTextPreview } from './SqlTextPreview';
import '../savedQueryPages.css';

/** 完整原文由调用方在打开窗口前核验，预览不持有原编辑器或数据库的操作权限。 */
export function ResultSqlDialog({ title, hint, statement, sourceSql, dialect, onClose }: {
  title: string; hint: string; statement: string; sourceSql?: string; dialect?: ConnectionProfile['dialect']; onClose(): void;
}) {
  const [full, setFull] = useState(false);
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const fullVisible = full && sourceSql !== undefined;
  return <Modal title={title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{fullVisible ? zh.query.resultSqlFullHint : hint}</p>
      {sourceSql !== undefined && <button ref={sourceTrigger} type="button" aria-expanded={fullVisible}
        onClick={() => setFull(value => !value)}>{fullVisible ? zh.query.resultSqlShowReceipt : zh.query.resultSqlShowFull}</button>}
      {fullVisible ? <SqlTextPreview title={zh.query.resultSqlFullTitle} sql={sourceSql} onClose={() => {
        setFull(false);
        sourceTrigger.current?.focus();
      }}/> : <SqlEditor value={statement} dialect={dialect} height={280} readOnly/>}
    </div>
    <footer className="modal-footer"><span className="grow"/>
      <button type="button" onClick={onClose}>{zh.common.close}</button>
    </footer>
  </Modal>;
}
