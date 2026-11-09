import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { desktop, page, dataDir, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { primaryKeyCopyZh as copy } from '../../src/renderer/locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh as update } from '../../src/renderer/locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh as remove } from '../../src/renderer/locales/deleteSqlCopy.zh-CN';
import { copyInsertSqlZh as insert } from '../../src/shared/copyInsertSql.zh-CN';
import { sqliteTableEditZh as edit } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { expectPrimaryKeyQueryDraft } from './primary-key-query-draft';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_COPY_PRIMARY_KEY_NATIVE_TEST !== '1', '需要显式启用离线 SQLite 专项');

test('SQLite 复制复合原主键查询，沿索引排序规则匹配原记录', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许离线 SQLite 源码验收');
  const path = join(realpathSync(dataDir), '原主键查询.sqlite'), table = 'key"table', target = '"key""table"';
  const source = new DatabaseSync(path);
  try {
    source.exec('CREATE TABLE ' + target + ' (id INTEGER, scope TEXT COLLATE NOCASE, raw BLOB, note TEXT, ' +
      'PRIMARY KEY(scope COLLATE BINARY,raw,id)); CREATE VIEW copy_key_view AS SELECT * FROM ' + target);
    source.exec('INSERT INTO ' + target + " VALUES (9007199254740993,'Key',X'00ff','目标甲')," +
      "(9007199254740993,'key',X'00ff','相似键'),(9007199254740994,'Key',X'00ff','交叉键')," +
      "(9007199254740994,'key',X'00ff','目标乙'),(3,NULL,X'','空键甲'),(3,NULL,X'','空键乙')");
  } finally { source.close(); }
  function read(sql: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const statement = db.prepare(sql);
      statement.setReadBigInts(true);
      return statement.all().map(row => row.note).sort();
    }
    finally { db.close(); }
  }
  const baseline = read('SELECT note FROM ' + target);
  const originalBytes = readFileSync(path);
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
      const write = await profile('sqlite-copy-key-rw', false), read = await profile('sqlite-copy-key-ro', true);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'copy', tabs: [
        { id: 'copy', title: '原主键查询', kind: 'table', connectionId: write.id, database: 'main', table },
        { id: 'copy-readonly', title: '只读原表', kind: 'table', connectionId: read.id, database: 'main', table },
        { id: 'copy-view', title: '只读视图', kind: 'table', connectionId: write.id, database: 'main', table: 'copy_key_view' },
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
      Object.assign(globalThis, { sqliteKeyCopy: values });
    });
    const captured = () => page.evaluate(() => (globalThis as typeof globalThis & {
      sqliteKeyCopy: { text: string; formats: string[] }[];
    }).sqliteKeyCopy);
    const tab = page.locator('.sqlite-table-tab:visible'), button = (name: string) => tab.getByRole('button', { name, exact: true });
    const cell = (name: string) => tab.getByRole('gridcell', { name, exact: true });
    const check = (note: string) => cell('TEXT · ' + note).locator('..').getByRole('checkbox');
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const open = (id: string, title: string) =>
      page.locator('[data-workspace-tab-id="' + id + '"]').getByRole('button', { name: title, exact: true }).click();
    await expect(cell('TEXT · 目标甲')).toBeVisible();
    await expect(button(copy.action)).toBeDisabled();
    const before = await tasks();
    const historyBefore = await history();
    await cell('TEXT · 目标甲').click();
    await button(copy.action).click();
    const [first] = await captured();
    expect(first.formats).toEqual(['text/plain']);
    expect(first.text).toContain('"scope" COLLATE BINARY');
    expect(first.text).toContain('9007199254740993');
    expect(read(first.text)).toEqual(['目标甲']);

    await check('目标乙').check();
    await check('目标甲').check();
    await cell('TEXT · 交叉键').click();
    await page.screenshot({ path: info.outputPath('SQLite原主键查询复制.png') });
    await button(copy.action).click();
    const [, batch] = await captured();
    expect(batch.formats).toEqual(['text/plain']);
    expect(read(batch.text)).toEqual(['目标乙', '目标甲']);
    await button(copy.open).click();
    await expectPrimaryKeyQueryDraft('copy', batch.text);
    await page.screenshot({ path: info.outputPath('SQLite原主键查询草稿.png') });
    expect(await tasks()).toEqual(before);
    await open('copy', '原主键查询');
    // SQLite 的干净表页重新激活时按原规则重读，基于新页重新勾选来验证拒绝分支。
    await check('目标甲').check();
    await check('目标乙').check();
    const beforeInvalid = await tasks();
    await check('空键甲').check();
    await button(copy.open).click();
    await expect(tab.getByRole('alert').filter({ hasText: copy.incomplete })).toBeVisible();
    await expect(page.locator('.tab-strip [data-workspace-tab-id]')).toHaveCount(4);
    expect(await captured()).toHaveLength(2);
    expect(await tasks()).toEqual(beforeInvalid);

    await check('空键甲').uncheck();
    await check('目标甲').uncheck();
    await check('目标乙').uncheck();
    await cell('TEXT · 目标甲').locator('..').getByRole('gridcell', { name: 'TEXT · Key', exact: true }).dblclick();
    const field = page.getByRole('dialog', { name: edit.editCell, exact: true });
    await field.getByLabel(edit.value('scope'), { exact: true }).fill('仅本地新键');
    await field.getByRole('button', { name: edit.saveInput, exact: true }).click();
    await cell('TEXT · 仅本地新键').click();
    for (const action of [insert.open, update.open, remove.open]) {
      await button(action).click();
      await expect(tab.getByRole('alert')).toContainText('草稿');
      await expect(page.locator('.tab-strip [data-workspace-tab-id]')).toHaveCount(4);
    }
    await button(copy.action).click();
    expect((await captured()).at(-1)).toEqual(first);
    const beforeDirty = await tasks();
    await button(copy.open).click();
    await expectPrimaryKeyQueryDraft('copy', first.text);
    expect(await tasks()).toEqual(beforeDirty);
    await open('copy', '原主键查询');
    await expect(cell('TEXT · 仅本地新键')).toBeVisible();
    expect(read('SELECT note FROM ' + target)).toEqual(baseline);
    await button(edit.undo).click();

    const predicate = first.text.split('\nWHERE ')[1];
    const deletePrefix = 'DELETE FROM "main".' + target + '\nWHERE ';
    const deletes = batch.text.split('\nWHERE ')[1].slice(0, -1).split('\n   OR ')
      .map(condition => deletePrefix + condition + ';').join('\n');
    for (const [labels, sql] of [
      [insert, 'INSERT INTO "main".' + target + ' ("id", "scope", "raw", "note") VALUES (9007199254740993, \'Key\', X\'00ff\', \'目标甲\');'],
      [update, 'UPDATE "main".' + target + '\nSET "note" = \'目标甲\'\nWHERE ' + predicate],
      [remove, deletes],
    ] as const) {
      if (labels === remove) {
        await check('目标甲').check();
        await check('目标乙').check();
        await cell('TEXT · 交叉键').click();
      } else await cell('TEXT · 目标甲').click();
      const noExecution = await tasks();
      await button(labels.open).click();
      await expectPrimaryKeyQueryDraft('copy', sql);
      await expect(page.getByRole('button', { name: labels.queryTitle(table), exact: true })).toBeVisible();
      expect(await tasks()).toEqual(noExecution);
      expect(await history()).toEqual(historyBefore);
      expect(await captured()).toHaveLength(3);
      expect(readFileSync(path)).toEqual(originalBytes);
      await open('copy', '原主键查询');
    }

    await open('copy-readonly', '只读原表');
    await cell('目标甲').click();
    await button(copy.action).click();
    expect((await captured()).at(-1)).toEqual(first);
    await button(copy.open).click();
    await expectPrimaryKeyQueryDraft('copy-readonly', first.text);
    expect(await captured()).toHaveLength(4);
    expect(await history()).toEqual(historyBefore);
    await open('copy-view', '只读视图');
    await expect(cell('目标甲')).toBeVisible();
    await expect(button(copy.action)).toHaveCount(0);
    await expect(button(copy.open)).toHaveCount(0);
    await expect(button(update.open)).toHaveCount(0);
    await expect(button(remove.open)).toHaveCount(0);
    await expect(button(insert.open)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
