import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir, desktop, expect, page, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryViewDraftZh as text } from '../../src/renderer/locales/queryViewDraft.zh-CN';
import { postgresCreateViewZh as pg } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { sqliteObjectsZh as sqlite } from '../../src/renderer/locales/sqliteObjects.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

for (const dialect of ['sqlite', 'mysql', 'mariadb', 'postgresql'] as const) {
  test(dialect + ' 查询草稿转普通视图设计，保留原模型和数据库', async ({}, info) => {
    const database = dialect === 'sqlite' ? 'main' : 'intended_db';
    const path = join(realpathSync(dataDir), 'query-view.sqlite');
    const statement = 'SELECT id AS kept FROM sample';
    const script = 'SELECT 1;\n' + statement + ';\nSELECT 3;';
    if (dialect === 'sqlite') {
      const sample = new DatabaseSync(path);
      try { sample.exec('CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES(42);'); }
      finally { sample.close(); }
      // 仅替换文件对话框，SQLite 目录、预览及写入继续使用真实 IPC。
      await desktop.evaluate(({ dialog }, file) => {
        const open = dialog.showOpenDialog;
        dialog.showOpenDialog = (async () => {
          dialog.showOpenDialog = open;
          return { canceled: false, filePaths: [file] };
        }) as typeof open;
      }, path);
    }
    await page.evaluate(async ({ dialect, database, script }) => {
      const id = 'query-view-fixture';
      if (dialect === 'sqlite') {
        const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
        if (!file) throw Error('未选中独占测试文件');
        await window.dbark.invoke('connections.save', { id, name: id, dialect, group: '', color: '#51bda5',
          sqlite: { fileToken: file.token, readOnly: false, busyTimeoutMs: 1000 } });
      } else {
        await window.dbark.invoke('connections.save', { id, name: id, dialect, group: '', color: '#51bda5',
          host: '127.0.0.1', port: 1, user: 'offline', database: 'other_db' });
      }
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'source', tabs: [
        { id: 'source', kind: 'query', title: '原查询', connectionId: id, database, databaseContext: { state: 'known', database }, sql: script },
      ] });
    }, { dialect, database, script });
    // 只替换 PostgreSQL schema 目录的返回值，拒绝任何超出本例的服务器连接或写请求。
    await desktop.evaluate(({ ipcMain }, fixture) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const original = handlers.get('dbark:request');
      if (!original) throw Error('缺少生产 IPC 入口');
      const seen: string[] = [];
      Object.assign(globalThis, { __queryViewCommands: seen });
      handlers.set('dbark:request', (event, payload) => {
        const { command, input } = payload as { command: string; input?: { connectionId?: string; database?: string } };
        seen.push(command);
        if (command === 'postgres.createTable.schemas') {
          if (fixture.dialect !== 'postgresql' || input?.connectionId !== 'query-view-fixture' || input.database !== fixture.database) throw Error('测试 schema 目标不匹配');
          return Promise.resolve({ ok: true, result: ['public'] });
        }
        if (fixture.dialect !== 'sqlite' && (command === 'connections.open' || /^(query|schema|sessions|postgres)\./.test(command))) {
          throw Error('离线视图设计意外请求 ' + command);
        }
        return original(event, payload);
      });
    }, { dialect, database });
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.reload();
    const editor = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
    const menu = () => navigationMenuItem(page.locator('.query-tab:visible'), { name: text.entry, exact: true });
    const model = (dialog: boolean) => page.evaluate(dialog => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const visible = api?.editor.getEditors().find(item => !!item.getContainerDomNode().closest(dialog ? '[role=dialog]' : '.query-tab'));
      const model = visible?.getModel();
      return model && { sql: model.getValue().replaceAll('\r\n', '\n'), uri: model.uri.toString(), version: model.getVersionId() };
    }, dialog);
    const disk = dialect === 'sqlite' ? readFileSync(path) : undefined;
    await expect(editor).toBeVisible();
    const original = await model(false);
    expect(original?.sql).toBe(script);
    await editor.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(dialect === 'sqlite' ? 'ArrowRight' : 'Shift+ArrowDown');
    await (await menu()).click();
    const dialog = page.getByRole('dialog', { name: dialect === 'sqlite' ? sqlite.createView : dialect === 'postgresql' ? pg.title : zh.schema.text058, exact: true });
    await expect(dialog.getByText(text.context, { exact: true })).toBeVisible();
    const openingCommands = await desktop.evaluate(() => (globalThis as typeof globalThis & { __queryViewCommands: string[] }).__queryViewCommands);
    expect(openingCommands.filter(command => command === 'connections.open' || /^(query|schema|sessions|sqlite|postgres)\./.test(command)))
      .toEqual(dialect === 'postgresql' ? ['postgres.createTable.schemas'] : []);
    expect(await model(false)).toEqual(original);
    if (dialect === 'postgresql') {
      await expect(dialog.getByLabel(pg.definition)).toHaveValue(statement + '\n');
      await expect(dialog.getByLabel(pg.schema)).toHaveValue('public');
    } else if (dialect === 'sqlite') {
      expect(readFileSync(path)).toEqual(disk);
      await expect.poll(async () => (await model(true))?.sql).toBe('CREATE VIEW main."new_view" AS\n' + statement + '\n;');
      const name = 'selected_view';
      await dialog.getByLabel(sqlite.name).fill(name);
      await expect.poll(async () => (await model(true))?.sql).toBe('CREATE VIEW main."selected_view" AS\n' + statement + '\n;');
      await dialog.getByRole('button', { name: sqlite.read, exact: true }).click();
      await expect(dialog.getByText(sqlite.absent, { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: sqlite.preview, exact: true }).click();
      await expect(dialog.getByText(sqlite.previewHint)).toBeVisible();
      expect(readFileSync(path)).toEqual(disk);
      await dialog.getByLabel(sqlite.confirmation).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('query-view-draft.png') });
      const acknowledgements = dialog.getByRole('checkbox');
      const count = await acknowledgements.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) await acknowledgements.nth(index).check();
      const confirmation = 'main.' + name;
      await expect(dialog.getByText(sqlite.confirmationHint(confirmation), { exact: true })).toBeVisible();
      await dialog.getByLabel(sqlite.confirmation).fill(confirmation);
      const create = dialog.getByRole('button', { name: sqlite.apply.create, exact: true });
      await expect(create).toBeEnabled();
      await create.click();
      await expect(dialog.getByText(sqlite.committed, { exact: true })).toBeVisible();
      const stored = new DatabaseSync(path, { readOnly: true });
      try { expect(stored.prepare('SELECT kept FROM selected_view').get()?.kept).toBe(42); }
      finally { stored.close(); }
    } else {
      await dialog.getByLabel(zh.schema.text059).fill('selected_view');
      await expect.poll(async () => (await model(true))?.sql).toBe('CREATE VIEW `intended_db`.`selected_view` AS\n' + statement + '\n;');
    }
    expect(await model(false)).toEqual(original);
  });
}
