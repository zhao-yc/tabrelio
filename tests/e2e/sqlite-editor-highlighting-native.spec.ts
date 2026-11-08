import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_EDITOR_HIGHLIGHTING_NATIVE !== '1', '需要显式启用离线 SQLite 着色专项');

test('SQLite 方言着色区分绑定参数、BLOB 和三种标识符并保留折叠', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许离线 SQLite 源码验收');
  const path = join(realpathSync(dataDir), 'sqlite-editor-highlighting.sqlite');
  const db = new DatabaseSync(path);
  try { db.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY)'); }
  finally { db.close(); }
  const source = [
    "SeLeCt [字段--甲], `字段``乙`, \"字段--丙\", X'00ff', ?12, :编号, @标记, $scope::name(suffix), 1_000, 0xFF;",
    "/* 外层 /* 内层 */ SELECT 42; -- 真注释",
    "SELECT [跨行",
    "-- 名称], '首行",
    "-- 文本内''仍是' AS label;",
  ].join('\n');
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许本窗口选择本例 SQLite 文件');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, path);
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.evaluate(async source => {
      const id = 'sqlite-highlighting';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('本例文件未获授权');
      const profile = await window.dbark.invoke('connections.save', { id, name: 'SQLite 方言着色', dialect: 'sqlite',
        group: '', color: '#123456', sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const other = await window.dbark.invoke('connections.save', { id: '', name: '离线 MySQL 对照', dialect: 'mysql',
        group: '', color: '#654321', host: '127.0.0.1', port: 1, user: 'offline' });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, editorSqlFolding: true, activeTabId: 'sqlite-editor', tabs: [
        { id: 'sqlite-editor', title: 'SQLite 着色', kind: 'query', connectionId: profile.id, database: 'main', sql: source },
        { id: 'mysql-editor', title: 'MySQL 对照', kind: 'query', connectionId: other.id, sql: 'SELECT 42;' },
      ] });
    }, source);
    await page.reload();
    const editor = page.locator('.query-tab:visible .monaco-editor');
    const box = editor.getByRole('textbox');
    await expect(box).toBeVisible();
    // 通过实际模型与 Monaco 的 tokenizer 验证跨行语法边界，同时从渲染结果读取颜色。
    const inspect = () => editor.evaluate(element => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(editor => editor.getContainerDomNode().contains(element));
      const model = instance?.getModel();
      if (!api || !model) throw Error('未找到真实编辑器模型');
      const sql = model.getValue(), language = model.getLanguageId();
      const lines = model.getLinesContent(), tokens = api.editor.tokenize(sql, language);
      const at = (line: number, text: string) => {
        const offset = lines[line]?.indexOf(text) ?? -1;
        return offset >= 0 ? tokens[line]?.filter(token => token.offset <= offset).at(-1)?.type : undefined;
      };
      const color = (line: number, text: string) => {
        const rendered = element.querySelectorAll('.view-lines .view-line')[line];
        const span = [...(rendered?.querySelectorAll(':scope > span > span') ?? [])].find(span => span.textContent?.includes(text));
        return span ? getComputedStyle(span).color : '';
      };
      return { sql, language, id: model.id,
        scopes: [at(0, 'SeLeCt'), at(0, '--甲'), at(0, '字段``乙'), at(0, '--丙'), at(0, "X'00ff'"), at(0, '?12'), at(0, ':编号'),
          at(0, '@标记'), at(0, 'suffix'), at(0, '1_000'), at(0, '0xFF'), at(1, '内层'), at(1, 'SELECT'), at(1, '真注释'),
          at(3, '-- 名称'), at(4, '-- 文本内'), at(4, 'AS label')],
        colors: [color(0, 'SeLeCt'), color(0, "X'00ff'"), color(1, '真注释'), color(4, '文本内')],
      };
    });
    const scopes = ['keyword', 'identifier', 'identifier', 'identifier', 'string.blob', 'variable', 'variable',
      'variable', 'variable', 'number', 'number.hex', 'comment', 'keyword', 'comment', 'identifier', 'string', 'keyword'];
    await expect.poll(async () => (await inspect()).scopes).toEqual(scopes.map(scope => scope + '.sql'));
    const initial = await inspect();
    expect(initial).toMatchObject({ sql: source, language: 'dbark-sqlite' });
    await expect.poll(async () => {
      const [keyword, blob, comment, string] = (await inspect()).colors;
      return !!keyword && !!blob && !!comment && !!string && keyword !== comment && string !== comment;
    }).toBe(true);
    await page.screenshot({ path: info.outputPath('SQLite方言着色.png') });
    const open = (id: string, title: string) => page.locator('[data-workspace-tab-id="' + id + '"]').getByRole('button', { name: title, exact: true }).click();
    await open('mysql-editor', 'MySQL 对照');
    await expect.poll(async () => (await inspect()).language).toBe('sql');
    await open('sqlite-editor', 'SQLite 着色');
    await expect.poll(async () => (await inspect()).id).toBe(initial.id);
    await box.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('SELECT 1;\nSELECT\n  2;\nSELECT 3;');
    const expanded = editor.locator('.codicon-folding-expanded');
    const collapsed = editor.locator('.codicon-folding-collapsed');
    await expect(expanded).toHaveCount(1);
    await expanded.click();
    await expect(collapsed).toHaveCount(1);
    await expect(editor.locator('.view-lines')).not.toContainText('2;');
    await expect(editor.locator('.view-lines')).toContainText('SELECT 3;');
    await collapsed.click();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
