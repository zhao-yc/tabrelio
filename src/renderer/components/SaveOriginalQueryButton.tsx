import { useRef, useState } from 'react';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import { queryResultNavigatorZh as text } from '../locales/queryResultNavigator.zh-CN';
import { saveSqlFragment } from '../statementNavigationExtract';
import { errorMessage } from '../lib';
import { useWorkspace } from '../store';

interface OriginalStatement {
  sql: string;
  current(): boolean;
}

/** 只借用原模态和已核验正文。选择器晚回包时由同一归属函数拒绝写入。 */
export function SaveOriginalQueryButton({ disabled, capture }: {
  disabled?: boolean;
  capture(dialogCurrent: () => boolean): OriginalStatement | undefined;
}) {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  return <button type="button" disabled={disabled || saving} onClick={async event => {
    if (pending.current) return;
    const button = event.currentTarget, dialog = button.closest(appModalSelector) ?? undefined;
    const dialogCurrent = () => button.isConnected && gridDialogCurrent(button, () => dialog);
    if (!dialogCurrent()) return;
    pending.current = true;
    setSaving(true);
    try {
      const source = capture(dialogCurrent);
      if (!source?.current()) throw Error(text.originalUnavailable);
      await saveSqlFragment(() => source.sql, 'utf8', source.current, {
        fileName: text.originalFile, stale: text.originalUnavailable, saved: text.originalSaved,
      });
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
    finally {
      pending.current = false;
      if (button.isConnected) setSaving(false);
    }
  }}>{text.saveOriginal}</button>;
}
