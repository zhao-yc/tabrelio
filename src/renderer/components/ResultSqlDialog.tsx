import { useLayoutEffect, useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { zh } from '../locales/zh-CN';
import { queryResultNavigatorZh as text } from '../locales/queryResultNavigator.zh-CN';
import { ErrorBox, Modal } from './ui';
import { SqlEditor } from './SqlEditor';
import { SqlTextPreview } from './SqlTextPreview';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import { copyQuerySourceSql } from '../querySourceClipboard';
import { errorMessage } from '../lib';
import { SaveOriginalQueryButton } from './SaveOriginalQueryButton';
import '../savedQueryPages.css';

/** 完整原文由调用方在打开窗口前核验，预览不持有原编辑器或数据库的操作权限。 */
export function ResultSqlDialog({ title, hint, statement, sourceSql, dialect, onClose }: {
  title: string; hint: string; statement: string; sourceSql?: string; dialect?: ConnectionProfile['dialect']; onClose(): void;
}) {
  const [full, setFull] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ source: string; error?: string }>();
  const currentSource = useRef(sourceSql);
  useLayoutEffect(() => { currentSource.current = sourceSql; }, [sourceSql]);
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
      {copyFeedback && copyFeedback.source === sourceSql && (copyFeedback.error
        ? <ErrorBox message={copyFeedback.error}/> : <p role="status">{text.originalCopied}</p>)}
    </div>
    <footer className="modal-footer"><span className="grow"/>
      {sourceSql !== undefined && <button type="button" onClick={event => {
        const button = event.currentTarget, dialog = button.closest(appModalSelector) ?? undefined;
        try {
          copyQuerySourceSql(sourceSql, () => currentSource.current === sourceSql && button.isConnected && gridDialogCurrent(button, () => dialog));
          setCopyFeedback({source: sourceSql});
        } catch (reason) { setCopyFeedback({source: sourceSql, error: errorMessage(reason)}); }
      }}>{text.copyOriginal}</button>}
      {sourceSql !== undefined && <SaveOriginalQueryButton capture={dialogCurrent => ({
        sql: sourceSql, current: () => currentSource.current === sourceSql && dialogCurrent(),
      })}/>}
      <button type="button" onClick={onClose}>{zh.common.close}</button>
    </footer>
  </Modal>;
}
