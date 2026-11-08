import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { desktop, page, dataDir, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { copyInsertSqlZh as copy } from '../../src/shared/copyInsertSql.zh-CN';
import { sqliteTableBrowseZh as browse } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableEditZh as edit } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_COPY_INSERT_NATIVE_TEST !== '1', '需要显式启用离线 SQLite 专项');

test('SQLite 表页复制 INSERT 原文并在另一编码的隔离库回放', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许离线 SQLite 源码验收');
  const path = join(realpathSync(dataDir), '复制INSERT.sqlite'), table = 'copy"insert', target = '"copy""insert"';
  const definition = 'CREATE TABLE ' + target + ' (id INTEGER PRIMARY KEY, v, raw BLOB, note TEXT, g TEXT GENERATED ALWAYS AS (typeof(v)) STORED)';
  const ids = ['9007199254740993', '9007199254740994', '9223372036854775807'];
  const source = new DatabaseSync(path);
  try {
    source.exec(definition + '; CREATE VIEW copy_insert_view AS SELECT * FROM ' + target);
    source.prepare('INSERT INTO ' + target + ' (id,v,raw,note) VALUES (9007199254740993, 1.0, X\'00FF\', ?), (9007199254740994, \'1\', X\'\', \'\'), (9223372036854775807, -9223372036854775808, NULL, NULL)')
      .run("前缀'\0🙂后缀");
  } finally { source.close(); }
  /** 观察端按数据库实际编码读回 TEXT 字节，包含 NUL 后的字符。 */
  function read(db: DatabaseSync, encoding: 'utf8' | 'utf16le') {
    return db.prepare('SELECT CAST(id AS TEXT) AS id, typeof(v) AS storage, CAST(v AS TEXT) AS v, ' +
      'typeof(raw) AS rawType, hex(raw) AS raw, typeof(note) AS noteType, hex(CAST(note AS BLOB)) AS note, g FROM ' + target + ' ORDER BY id')
      .all().map(row => ({ ...row, note: Buffer.from(String(row.note), 'hex').toString(encoding) }));
  }
  function disk() {
    const db = new DatabaseSync(path, { readOnly: true });
    try { return read(db, 'utf8'); } finally { db.close(); }
  }
  const baseline = disk();
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
      const original = dialog.showOpenDialog;
      let remaining = 2;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if (!remaining || args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许本窗口选取本例合成 SQLite 文件');
        if (!--remaining) dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
    }, path);
    await page.evaluate(async table => {
      async function profile(id: string, readOnly: boolean) {
        const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
        if (!file) throw Error('本例文件未获授权');
        return window.dbark.invoke('connections.save', { id, name: id, dialect: 'sqlite', group: '', color: '#123456',
          sqlite: { fileToken: file.token, readOnly, busyTimeoutMs: 1000 } });
      }
      const write = await profile('sqlite-copy-insert-rw', false), read = await profile('sqlite-copy-insert-ro', true);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'copy', tabs: [
        { id: 'copy', title: '复制 INSERT', kind: 'table', connectionId: write.id, database: 'main', table },
        { id: 'copy-readonly', title: '只读原表', kind: 'table', connectionId: read.id, database: 'main', table },
        { id: 'copy-view', title: '只读视图', kind: 'table', connectionId: write.id, database: 'main', table: 'copy_insert_view' },
      ] });
    }, table);
    await page.reload();
    await page.evaluate(() => {
      const values: { text: string; formats: string[] }[] = [];
      // 仅拦截本例页面的复制事件，留存原文及格式。
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制动作');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        values.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { sqliteInsertCopy: values });
    });
    const captured = () => page.evaluate(() => (globalThis as typeof globalThis & {
      sqliteInsertCopy: { text: string; formats: string[] }[];
    }).sqliteInsertCopy);
    const tab = page.locator('.sqlite-table-tab:visible'), button = (name: string) => tab.getByRole('button', { name, exact: true });
    const cell = (name: string) => tab.getByRole('gridcell', { name, exact: true });
    const checked = (id: string) => cell('INTEGER · ' + id).locator('..').getByRole('checkbox');
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await expect(cell('INTEGER · ' + ids[0])).toBeVisible();
    await tab.getByRole('textbox', { name: browse.pageSizeLabel, exact: true }).fill('2');
    await button(browse.pageSizeApply).click();
    await expect(cell('INTEGER · ' + ids[2])).toHaveCount(0);
    await expect(button(copy.current)).toBeDisabled();
    const before = await tasks();
    await cell('INTEGER · ' + ids[0]).click();
    await button(copy.current).click();
    const [first] = await captured();
    expect(first.text).toContain('INSERT INTO "main"."copy""insert" ("id", "v", "raw", "note")');
    expect(first.text).toContain("1.0, X'00ff'");
    expect(first.formats).toEqual(['text/plain']);
    await checked(ids[1]).check();
    await checked(ids[0]).check();
    await page.screenshot({ path: info.outputPath('SQLite表页复制INSERT.png') });
    await button(copy.selected).click();
    const [, batch] = await captured();
    expect(batch.text.startsWith(first.text + '\n')).toBe(true);
    expect(batch.text).toContain("9007199254740994, '1', X''");
    expect(batch.formats).toEqual(['text/plain']);
    expect(await tasks()).toEqual(before);
    expect(disk()).toEqual(baseline);

    const replay = new DatabaseSync(join(realpathSync(dataDir), '回放UTF16.sqlite'));
    try {
      replay.exec("PRAGMA encoding='UTF-16le';" + definition);
      replay.exec(batch.text);
      expect(read(replay, 'utf16le')).toEqual(baseline.slice(0, 2));
    } finally { replay.close(); }

    const original = cell('REAL · 1');
    await original.dblclick();
    const field = page.getByRole('dialog', { name: edit.editCell, exact: true });
    await field.getByLabel(edit.value('v'), { exact: true }).fill('2.5');
    await field.getByRole('button', { name: edit.saveInput, exact: true }).click();
    await cell('REAL · 2.5').click();
    await button(copy.current).click();
    await expect(tab.getByRole('alert').filter({ hasText: copy.draft })).toBeVisible();
    expect(await captured()).toHaveLength(2);
    expect(disk()).toEqual(baseline);
    await button(edit.undo).click();
    await button(browse.next).click();
    await expect(cell('INTEGER · ' + ids[2])).toBeVisible();
    await expect(button(copy.selected)).toBeDisabled();

    await page.locator('[data-workspace-tab-id="copy-readonly"]').getByRole('button', { name: '只读原表', exact: true }).click();
    await cell(ids[0]).click();
    await button(copy.current).click();
    expect((await captured()).at(-1)).toEqual(first);
    await page.locator('[data-workspace-tab-id="copy-view"]').getByRole('button', { name: '只读视图', exact: true }).click();
    await expect(cell(ids[0])).toBeVisible();
    await expect(button(copy.current)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
