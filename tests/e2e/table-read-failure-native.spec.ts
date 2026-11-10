import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { postgresTableZh as postgres } from '../../src/renderer/locales/postgresTable.zh-CN';
import { sqliteTableBrowseZh as sqlite } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { tableReadHistoryZh as historyText } from '../../src/renderer/locales/tableReadHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('隔离数据库保留未完成的末页读取模板并允许恢复', async ({}, info) => {
  const dialect = process.env.DBARK_TABLE_READ_FAILURE_DIALECT;
  test.skip(!dialect, '需要显式启用独占表页读取专项');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_USER_DATA ||
      (dialect === 'sqlite' ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1'))
    throw Error('仅允许本例隔离源码桌面');
  const table = 'update_subject', label = 'row C';
  const applyKey = process.platform === 'darwin' ? 'Meta+r' : 'Control+r';
  let updateFixture: (oversize: boolean) => Promise<void>;
  try {
    if (dialect === 'sqlite') {
      const file = join(await realpath(dataDir), 'table-read-failure.sqlite');
      const fixture = new DatabaseSync(file);
      try {
        fixture.exec("CREATE TABLE update_subject(id INTEGER PRIMARY KEY, label TEXT, payload BLOB);" +
          " INSERT INTO update_subject VALUES(1,'row A',X''),(2,'row C',X'');");
      } finally { fixture.close(); }
      updateFixture = async oversize => {
        const observer = new DatabaseSync(file);
        try { expect(observer.prepare('UPDATE update_subject SET payload=zeroblob(?) WHERE id=2')
          .run(oversize ? 18 * 1024 * 1024 : 0).changes).toBe(1); }
        finally { observer.close(); }
      };
      await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          if (args[0] !== BrowserWindow.getAllWindows()[0] ||
              !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
            throw Error('越过本例文件选择范围');
          dialog.showOpenDialog = original;
          return { canceled: false, filePaths: [file] };
        }) as typeof original;
      }, file);
      await page.evaluate(async table => {
        const id = 'table-read-failure-sqlite';
        const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
        if (!picked) throw Error('未取得本例 SQLite 文件授权');
        const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite',
          group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: true, busyTimeoutMs: 1000 } });
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: table, tabs: [
          { id: table, kind: 'table', title: table, table, connectionId: connection.id, database: 'main' },
        ] });
      }, table);
    } else {
      if (dialect !== 'postgresql' && dialect !== 'mysql' && dialect !== 'mariadb') throw Error('数据库类型不符');
      const database = process.env.DBARK_TABLE_READ_FAILURE_DATABASE ?? '';
      const port = Number(process.env.DBARK_TABLE_READ_FAILURE_PORT);
      const password = process.env.DBARK_TABLE_READ_FAILURE_PASSWORD ?? '';
      if (!/^tabrelio_hd_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
          !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本例独占回环实库');
      const connection = { host: '127.0.0.1', port, database, user: database, password };
      const profile: NetworkConnectionProfile | PostgresConnectionProfile = {
        ...connection, id: '', name: dialect, dialect, group: '', color: '#123456', rememberPassword: false,
      };
      // 旁观连接只改本例专属表的合成 BLOB。生产分页仍从 Electron 真实入口读取。
      updateFixture = async oversize => {
        if (dialect === 'postgresql') {
          const observer = new Client(connection);
          try {
            await observer.connect();
            expect((await observer.query("UPDATE ONLY public.update_subject SET payload=decode(repeat('00',$1),'hex') WHERE label=$2",
              [oversize ? 9 * 1024 * 1024 : 0, label])).rowCount).toBe(1);
          } finally { await observer.end(); }
        } else {
          const observer = await mysql.createConnection(connection);
          try {
            const [result] = await observer.execute<mysql.ResultSetHeader>('UPDATE update_subject SET payload=REPEAT(?,?) WHERE label=?',
              ['x', oversize ? 512 * 1024 : 0, label]);
            expect(result.affectedRows).toBe(1);
          } finally { await observer.end(); }
        }
      };
      await page.evaluate(async ({ profile, table }) => {
        const connection = await window.dbark.invoke('connections.save', profile);
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: table, tabs: [
          { id: table, kind: 'table', title: table, table: profile.dialect === 'postgresql' ? '"public"."update_subject"' : table,
            connectionId: connection.id, database: profile.database },
        ] });
      }, { profile, table });
    }
    await page.reload();
    const tab = page.locator('.sqlite-table-tab:visible, .postgres-table-tab:visible, .table-tab:visible');
    const other = tab.getByRole('gridcell').filter({ hasText: /row A$/ });
    const row = tab.getByRole('gridcell').filter({ hasText: /row C$/ });
    const menu = (name: string) => navigationMenuItem(tab, { name, exact: true });
    const last = tab.getByRole('button', { name: dialect === 'sqlite' ? sqlite.last : dialect === 'postgresql' ? postgres.lastPage : zh.table.lastPage, exact: true });
    await expect(other).toBeVisible();
    if (dialect === 'sqlite') {
      await (await menu(sqlite.conditions)).click();
      await tab.getByRole('button', { name: sqlite.addFilter, exact: true }).click();
      await tab.getByLabel(sqlite.filterColumn(1), { exact: true }).selectOption('label');
      const value = tab.getByLabel(sqlite.filterValue(1), { exact: true });
      await value.fill(label);
      await value.press(applyKey);
    } else if (dialect === 'postgresql') {
      await tab.getByLabel(postgres.filterColumn, { exact: true }).selectOption('label');
      const value = tab.getByLabel(postgres.filterText, { exact: true });
      await value.fill(label);
      await value.press(applyKey);
    } else {
      await (await menu(zh.table.text006)).click();
      const form = tab.locator('.filter-rule-form');
      await form.getByLabel(zh.table.text009, { exact: true }).selectOption('label');
      const value = form.getByLabel(zh.table.text011, { exact: true });
      await value.fill(label);
      await value.press(applyKey);
    }
    await expect(other).toHaveCount(0);
    await expect(row).toBeVisible();
    await expect(last).toBeEnabled();

    await updateFixture(true);
    await last.click();
    const error = tab.locator('.error-box');
    await expect(error).toContainText(dialect === 'sqlite' ? 'SQLite语句执行失败' : /预算|上限|大字段|计数与本次页|超出/);
    await (await menu(historyText.title)).click();
    const history = page.getByRole('region', { name: historyText.title, exact: true });
    const failed = history.locator('details').filter({ hasText: historyText.readFailed });
    await expect(failed).toHaveCount(1);
    await expect(failed).toBeVisible();
    const statements = failed.locator('pre');
    await expect(statements).toHaveCount(2);
    await expect(statements.first()).toContainText(/count\(\*\)/i);
    await expect(statements.last()).toContainText('LIMIT');
    for (const sql of [statements.first(), statements.last()]) {
      await expect(sql).toContainText(table);
      await expect(sql).toContainText(/WHERE.+(\?|\$[0-9]+)/);
    }
    await expect(history).not.toContainText(label);
    await expect(history).not.toContainText(Buffer.from(label).toString('hex'));
    await expect(history).not.toContainText((await error.textContent())!.trim());
    await history.getByRole('button', { name: historyText.close, exact: true }).last().click();

    await updateFixture(false);
    // SQLite 失败后保留条件并清除已交付页，使用正常刷新入口重新加载。
    if (dialect === 'sqlite') await (await menu('刷新 SQLite 表数据')).click();
    else await last.click();
    await expect(error).toBeHidden();
    await expect(row).toBeVisible();
    const preflight = await page.evaluate(async ({ dialect, tabId }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      const target = settings.tabs.find(item => item.id === tabId);
      if (!target?.database) throw Error('缺少本例活动表页');
      const base = { connectionId: target.connectionId, database: target.database, includeReadStatements: true as const };
      const table = 'missing_read_failure_fixture';
      let recorded = false;
      const receive = () => { recorded = true; };
      try {
        if (dialect === 'sqlite') await window.dbark.invoke('sqlite.tablePage', { ...base, database: 'main', table,
          taskId: crypto.randomUUID(), offset: 0, limit: 10, sort: [], filters: [], mode: 'and' }, receive);
        else if (dialect === 'postgresql') await window.dbark.invoke('postgres.table.page', { ...base,
          table: '"public"."missing_read_failure_fixture"', tabId: 'missing-fixture', offset: 0, limit: 10, sort: [] }, receive);
        else await window.dbark.invoke('table.page', { ...base, table, copySource: true,
          taskId: crypto.randomUUID(), page: 1, pageSize: 10, filters: [], sort: [] }, receive);
        return { rejected: false, recorded };
      } catch { return { rejected: true, recorded }; }
    }, { dialect, tabId: table });
    expect(preflight).toEqual({ rejected: true, recorded: false });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
