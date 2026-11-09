import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from '../../src/main/storage';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { sqlBlockCommentZh as messages } from '../../src/renderer/locales/sqlBlockComment.zh-CN';
import { dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const label = uiCommandLabels['sql-toggle-block-comment'];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const activeEditor = () => page.locator('.query-tab:visible .monaco-editor');

/** 用正式存储准备离线查询和本例专用的 SQLite 文件，实际操作经过原生窗口。 */
async function seed(dialect: 'mysql' | 'mariadb' | 'sqlite' | 'postgresql', sql: string) {
  await quitDesktop();
  const id = 'block-comment-offline', database = dialect === 'sqlite' ? 'main' : 'offline_db';
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'),
    { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    const profile = { id, name: '离线块注释', group: '', color: '#123456' };
    if (dialect === 'sqlite') {
      const filePath = join(realpathSync(dataDir), 'block-comment.sqlite');
      const db = new DatabaseSync(filePath);
      try { db.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY)'); }
      finally { db.close(); }
      store.saveConnection({ ...profile, dialect, sqlite: { filePath, readOnly: true, busyTimeoutMs: 1000 } });
    } else {
      store.saveConnection({ ...profile, dialect, database, host: '127.0.0.1', port: 1, user: 'offline' });
    }
    store.saveSettings({ ...store.settings(), activeTabId: id, tabs: [
      { id, kind: 'query', title: '原查询', connectionId: id, database, sql },
    ] });
  } finally { store.close(); }
  await launchDesktop();
  await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
  await page.reload();
  await expect(activeEditor().getByRole('textbox')).toBeVisible();
}

for (const dialect of ['mysql', 'mariadb', 'sqlite', 'postgresql'] as const) {
  test(`${dialect} 块注释按原选区往返，保护冲突分隔符且零执行`, async () => {
    const body = dialect === 'postgresql' ? "SELECT '船🚢'; /* 内层 */" : "SELECT '船🚢';";
    const lines = ['SELECT 0;', body, 'SELECT 3;'];
    const unsafe = dialect === 'mysql' ? '/*!50100 SELECT 4 */' : dialect === 'mariadb' ? '/*M! SELECT 4 */' : "SELECT '*/';";
    const sql = [...lines, unsafe].join('\n');
    await seed(dialect, sql);
    function model(edit?: { line: number; end: number }) {
      return activeEditor().evaluate((element, edit) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const original = instance?.getModel();
        if (!instance || !original) throw Error('当前模型不可读');
        if (edit) {
          instance.focus();
          instance.setSelection({ startLineNumber: edit.line, endLineNumber: edit.line, startColumn: 1, endColumn: edit.end });
        }
        const range = instance.getSelection();
        const bounds = instance.getDomNode()!.getBoundingClientRect();
        const point = instance.getScrolledVisiblePosition({ lineNumber: 2, column: 7 });
        if (!point) throw Error('目标选区未显示');
        return { id: original.id, sql: original.getValue().replaceAll('\r\n', '\n'),
          selected: range ? original.getValueInRange(range) : '', x: bounds.x + point.left, y: bounds.y + point.top + point.height / 2 };
      }, edit);
    }
    const initial = await model({ line: 2, end: body.length + 1 });
    await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-toggle-block-comment')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-toggle-block-comment'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('块注释原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    const wrapped = '/* ' + body + ' */', expected = [lines[0], wrapped, lines[2], unsafe].join('\n');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql: expected, selected: wrapped });
    await page.mouse.click(initial.x, initial.y, { button: 'right' });
    await page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: label, exact: true }).click({ delay: 120 });
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql, selected: body });
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql: expected });
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql });
    await model({ line: 4, end: unsafe.length + 1 });
    await page.keyboard.press('Alt+Shift+a');
    await expect(page.getByText(dialect === 'mysql' || dialect === 'mariadb' ? messages.directive : messages.delimiters, { exact: true })).toBeVisible();
    expect(await model()).toMatchObject({ id: initial.id, sql, selected: unsafe });
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
