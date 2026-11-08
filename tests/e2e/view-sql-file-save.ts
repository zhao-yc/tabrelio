import { basename } from 'node:path';
import type { Locator } from '@playwright/test';
import { viewSqlFileZh as text } from '../../src/renderer/locales/viewSqlFile.zh-CN';
import { desktop, expect } from './desktop-fixture';

/** 仅替换本窗口的一次保存对话框，原路径令牌、编码和原子写入仍由正式流程处理。 */
export async function saveViewSql(scope: Locator, filePath: string | null) {
  await desktop.evaluate(({ BrowserWindow, dialog }, filePath) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      const options = args[1] as Electron.SaveDialogOptions;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || !options.filters?.[0]?.extensions.includes('sql') ||
          !/^视图(?:定义|-[^<>:"/\\|?*]+)\.sql$/.test(options.defaultPath ?? '')) throw Error('只允许本窗口的一次视图 SQL 文件保存');
      return filePath ? { canceled: false, filePath } : { canceled: true };
    }) as typeof original;
  }, filePath);
  const button = scope.getByRole('button', { name: text.save, exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  if (filePath) await expect(scope.getByText(text.saved(basename(filePath)), { exact: true })).toBeVisible();
}
