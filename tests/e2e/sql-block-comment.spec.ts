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

for (const dialect of ['mysql', 'postgresql'] as const) {
  test(`${dialect} SQL 剪贴板栈选择早期复制、拒绝漂移选区并一步撤销`, async ({}, info) => {
    const lines = ["SELECT '早期🚢';", "SELECT '最近';", 'SELECT 3;'];
    const sql = lines.join('\n');
    await seed(dialect, sql);
    /** 仅向原 Monaco 文本输入派发内存 ClipboardEvent，不访问系统剪贴板。 */
    async function model(command?: { line: number; text?: string; kind?: 'copy' | 'cut' }) {
      return activeEditor().evaluate((element, command) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const original = editor?.getModel();
        if (!editor || !original) throw Error('原模型不可用');
        if (command) {
          if (command.kind) editor.focus();
          editor.setSelection({ startLineNumber: command.line, endLineNumber: command.line, startColumn: 1,
            endColumn: (command.text?.length ?? 0) + 1 });
          if (command.kind) {
            const target = document.activeElement;
            if (!target || !element.contains(target)) throw Error('复制目标不是原编辑器');
            const data = new DataTransfer();
            const event = new ClipboardEvent(command.kind, { bubbles: true, cancelable: true, clipboardData: data });
            target.dispatchEvent(event);
            if (!event.defaultPrevented || data.getData('text/plain') !== command.text) throw Error('Monaco 未写入准确的内存剪贴板');
          }
        }
        return original.getValue().replaceAll('\r\n', '\n');
      }, command);
    }
    const dialog = page.getByRole('dialog', { name: 'SQL 剪贴板栈', exact: true });
    const paste = dialog.getByRole('button', { name: '粘贴所选文本', exact: true });
    await model({ line: 1, text: lines[0], kind: 'copy' });
    await model({ line: 2, text: lines[1], kind: 'cut' });
    await expect.poll(() => model()).toBe([lines[0], '', lines[2]].join('\n'));
    await model({ line: 3, text: lines[2] });
    await activeEditor().getByRole('textbox').focus();
    await page.keyboard.press(modifier + '+Shift+v');
    await expect(dialog.getByRole('combobox')).toHaveValue('0');
    await expect(dialog.locator('pre')).toHaveText(lines[1]);
    await dialog.getByRole('combobox').selectOption('1');
    await expect(dialog.locator('pre')).toHaveText(lines[0]);
    if (dialect === 'mysql') await page.screenshot({ path: info.outputPath('SQL剪贴板栈.png') });
    await model({ line: 1 });
    await paste.click();
    await expect(dialog.getByRole('alert')).toHaveText('原查询编辑器或选区已变化，请重新打开剪贴板栈。');
    await page.keyboard.press('Escape');
    await model({ line: 3, text: lines[2] });
    await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-clipboard-stack')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-clipboard-stack'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('剪贴板栈原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    await dialog.getByRole('combobox').selectOption('1');
    await paste.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => model()).toBe([lines[0], '', lines[0]].join('\n'));
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toBe([lines[0], '', lines[2]].join('\n'));
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toBe(sql);
    await page.keyboard.press(modifier + '+Shift+v');
    await dialog.getByRole('button', { name: '清空剪贴板栈', exact: true }).click();
    await page.keyboard.press(modifier + '+Shift+v');
    await expect(dialog.getByText('还没有从查询编辑器复制或剪切的文本。', { exact: true })).toBeVisible();
    await expect(paste).toBeDisabled();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
