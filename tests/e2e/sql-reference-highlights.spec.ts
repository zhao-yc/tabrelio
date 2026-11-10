import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { localRenameZh } from '../../src/renderer/locales/localRename.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQL_REFERENCE_HIGHLIGHTS_TEST !== '1', '仅在隔离的源码窗口验收局部引用高亮');

const sql = ['SELECT s.id,', '(SELECT s.id FROM child s)', 'FROM parent s', 'WHERE s.id=1;'].join('\n');
const cteSql = 'WITH local_cte AS (SELECT 1 AS id) SELECT local_cte.id FROM local_cte;';
const command = 'editor-local-references';

for (const dialect of ['sqlite', 'mysql', 'mariadb', 'postgresql'] as const) {
  test(`${dialect} 真实光标高亮区分内外层别名，开关保存且不执行查询`, async ({}, info) => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
      throw Error('局部引用高亮验收只允许隔离源码窗口');
    try {
      if (dialect === 'sqlite') {
        const file = join(realpathSync(dataDir), 'reference-highlights.sqlite');
        const database = new DatabaseSync(file); database.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY)'); database.close();
        await desktop.evaluate(({ dialog }, file) => {
          const original = dialog.showOpenDialog;
          dialog.showOpenDialog = (async (...args: unknown[]) => {
            dialog.showOpenDialog = original;
            if (!(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
              throw Error('只允许选择本例临时SQLite文件');
            return { canceled: false, filePaths: [file] };
          }) as typeof original;
        }, file);
      }
      await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
      // 真实持久化接口准备草稿，网络方言使用不可连接的回环配置，无需实库或凭据。
      await page.evaluate(async ({ dialect, sql, cteSql }) => {
        const id = 'sql-reference-highlights', base = { id, name: '引用高亮样本', group: '', color: '#51bda5' };
        if (dialect === 'sqlite') {
          const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
          if (!file) throw Error('SQLite文件选择未完成');
          await window.dbark.invoke('connections.save', { ...base, dialect, sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
        } else {
          await window.dbark.invoke('connections.save', { ...base, dialect, host: '127.0.0.1', port: 1, user: 'offline' });
        }
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: id, tabs: [
          { id, kind: 'query', title: '引用高亮草稿', connectionId: id, ...(dialect === 'sqlite' ? { database: 'main' } : {}), sql },
          { id: 'other', kind: 'query', title: '另一个查询', connectionId: id, sql: 'SELECT 1;' },
          ...(dialect === 'postgresql' ? [{ id: 'cte', kind: 'query' as const, title: 'CTE 导航草稿', connectionId: id, sql: cteSql }] : []),
        ] });
      }, { dialect, sql, cteSql });
      await page.reload();
      const tab = page.locator('.query-tab:visible'), input = tab.locator('.monaco-editor').getByRole('textbox');
      const lines = tab.locator('.view-lines .view-line');
      const highlights = tab.locator('.sql-local-reference, .sql-local-declaration');
      const toggle = async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: uiCommandLabels[command], exact: true })).click();
      const setting = async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).editorLocalReferences;
      // 只读公开Monaco接口检查版本和撤销栈，不直接调用编辑器或装饰操作。
      const snapshot = () => page.evaluate(() => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const model = api?.editor.getEditors().find(editor => editor.hasTextFocus())?.getModel();
        if (!model) throw Error('缺少原聚焦模型');
        return { uri: model.uri.toString(), source: model.getValue(), version: model.getVersionId(), undo: model.canUndo(), redo: model.canRedo() };
      });
      async function move(line: number, column: number) {
        await input.focus();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
        for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
        for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
      }
      await expect(input).toBeVisible(); await move(0, 8);
      const before = await snapshot(); expect(before.source).toBe(sql); expect(await setting()).toBeUndefined();
      await expect(highlights).toHaveCount(0);
      await toggle(); await expect.poll(setting).toBe(true); await move(0, 8);
      await expect(highlights).toHaveCount(3, { timeout: 13000 });
      await expect(lines.nth(0).locator('.sql-local-reference')).toHaveText('s');
      await expect(lines.nth(1).locator('.sql-local-reference, .sql-local-declaration')).toHaveCount(0);
      await expect(lines.nth(2).locator('.sql-local-declaration')).toHaveText('s');
      await expect(lines.nth(3).locator('.sql-local-reference')).toHaveText('s');
      expect(await snapshot()).toEqual(before);
      await tab.screenshot({ path: info.outputPath(`${dialect}-外层引用高亮.png`) });

      await move(1, 9);
      await expect(highlights).toHaveCount(2, { timeout: 13000 });
      await expect(lines.nth(1).locator('.sql-local-reference')).toHaveText('s');
      await expect(lines.nth(1).locator('.sql-local-declaration')).toHaveText('s');
      expect(await snapshot()).toEqual(before);

      await page.locator('.tab-strip').getByRole('button', { name: '另一个查询', exact: true }).click();
      await expect(page.locator('.sql-local-reference, .sql-local-declaration')).toHaveCount(0);
      await page.locator('.tab-strip').getByRole('button', { name: '引用高亮草稿', exact: true }).click();
      await move(0, 8); await expect(highlights).toHaveCount(3, { timeout: 13000 });
      await toggle(); await expect.poll(setting).toBe(false); await move(0, 8);
      await expect(highlights).toHaveCount(0); expect(await snapshot()).toEqual(before);

      if (dialect === 'postgresql') {
        const cursorOffset = () => page.evaluate(() => {
          const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
          const editor = api?.editor.getEditors().find(editor => editor.hasTextFocus());
          const model = editor?.getModel(), position = editor?.getPosition();
          return model && position ? model.getOffsetAt(position) : -1;
        });
        // 高亮已关闭，真实 F12 和 Shift+F12 仍能定位各自的原文范围。
        await page.keyboard.press('F12');
        await expect.poll(cursorOffset).toBe(sql.indexOf('parent s') + 'parent '.length);
        await page.keyboard.press('Shift+F12');
        const peek = tab.locator('.peekview-widget.reference-zone-widget');
        const rows = peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]');
        await expect(peek).toBeVisible();
        await expect(rows).toHaveCount(3);
        await expect(peek.locator('.ref-tree .monaco-list-row[aria-selected="true"]')).toHaveCount(1);
        await expect(rows.last()).toContainText('WHERE');
        await tab.screenshot({ path: info.outputPath('postgresql-局部引用导航.png') });
        await rows.last().dblclick();
        await expect(peek).not.toBeVisible();
        await input.focus();
        await expect.poll(cursorOffset).toBe(sql.lastIndexOf('s.id') + 1);
        expect(await snapshot()).toEqual(before);

        const renameInput = tab.locator('.rename-box input.rename-input');
        const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
        const enterRename = async (original: string, name: string) => {
          await page.keyboard.press('F2');
          await expect(renameInput).toHaveValue(original);
          await renameInput.fill(name);
          await renameInput.press('Enter');
          await expect(renameInput).not.toBeVisible();
          await input.focus();
        };
        await move(0, 8);
        await enterRename('s', 'parent');
        await expect(tab.getByRole('status').filter({ hasText: localRenameZh.collision })).toBeVisible();
        expect(await snapshot()).toEqual(before);
        await move(0, 8);
        await enterRename('s', '外层');
        const renamed = 'SELECT "外层".id,\n(SELECT s.id FROM child s)\nFROM parent "外层"\nWHERE "外层".id=1;';
        await expect.poll(async () => (await snapshot()).source).toBe(renamed);
        await tab.screenshot({ path: info.outputPath('postgresql-局部重命名.png') });
        await page.keyboard.press(undo);
        await expect.poll(async () => (await snapshot()).source).toBe(sql);

        await page.locator('.tab-strip').getByRole('button', { name: 'CTE 导航草稿', exact: true }).click();
        const cteReference = cteSql.lastIndexOf('local_cte') + 2;
        await move(0, cteReference);
        const cteBefore = await snapshot();
        expect(cteBefore.source).toBe(cteSql);
        await expect.poll(cursorOffset).toBe(cteReference);
        await page.keyboard.press('F12');
        await expect.poll(cursorOffset).toBe('WITH '.length);
        expect(await snapshot()).toEqual(cteBefore);
        await enterRename('local_cte', '明细🚢');
        await expect.poll(async () => (await snapshot()).source).toBe(cteSql.replaceAll('local_cte', '"明细🚢"'));
        await page.keyboard.press(undo);
        await expect.poll(async () => (await snapshot()).source).toBe(cteSql);
      }
      expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }))).toEqual({ tasks: [], history: [] });
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
  });
}
