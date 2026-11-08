import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createConnection } from 'mysql2/promise';
import { desktop, page, dataDir, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { tableCheckedExportZh as text } from '../../src/renderer/locales/tableCheckedExport.zh-CN';
import { postgresTableZh as postgresText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import type { ConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_NETWORK_CHECKED_EXPORT_NATIVE !== '1', '需要本轮回环隔离网络库');

test('网络表页跨页收集、替换并写出原值，刷新撤销原收集', async ({}, info) => {
  const dialect = process.env.DBARK_CHECKED_EXPORT_DIALECT, database = process.env.DBARK_CHECKED_EXPORT_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_EXPORT_USER, password = process.env.DBARK_CHECKED_EXPORT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_CHECKED_EXPORT_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^(tabrelio_pg_|tabrelio_cmp_)[a-f0-9]{12}$/.test(database) ||
    user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
    (dialect !== 'mysql' && dialect !== 'mariadb' && dialect !== 'postgresql')) throw Error('需要本轮独占回环库');
  const pg = dialect === 'postgresql';
  const profile: ConnectionProfile = { id: '', name: '跨页导出专项', dialect, group: '', color: '#123456', host, port, user, password, database, rememberPassword: false };
  const observer = pg ? new Client({ host, port, user, password, database, connectionTimeoutMillis: 5000 }) : undefined;
  const mysql = pg ? undefined : await createConnection({ host, port, user, password, database, connectTimeout: 5000 });
  const measure = async () => observer
    ? (await observer.query('SELECT COUNT(*)::text AS n FROM public.checked_rows')).rows[0].n
    : String((await mysql!.query<import('mysql2').RowDataPacket[]>('SELECT COUNT(*) AS n FROM checked_rows'))[0][0].n);
  try {
    if (observer) {
      await observer.connect();
      await observer.query(`CREATE TABLE public.checked_rows(id bigint PRIMARY KEY, note text, amount numeric(28,12), payload bytea);
        INSERT INTO public.checked_rows VALUES
        (1,'记录 1',NULL,NULL),(2,'记录 2',1234567890123456.123456789012,decode('00ff','hex')),
        (3,'记录 3',NULL,NULL),(4,'记录 4',NULL,NULL),(5,'记录 5',NULL,NULL)`);
    }
    expect(await measure()).toBe('5');
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, profile);
    await page.evaluate(async ({ connectionId, database, pg }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-export',
        tabs: [{ id: 'checked-export', title: '跨页导出', kind: 'table', connectionId, database,
          table: pg ? '"public"."checked_rows"' : 'checked_rows' }] });
    }, { connectionId, database, pg });
    await page.reload();

    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const group = tab.getByRole('group', { name: text.region, exact: true });
    const button = (name: string) => group.getByRole('button', { name, exact: true });
    const checkbox = (number: number) => tab.getByRole('gridcell', { name: '记录 ' + number, exact: true }).locator('..').getByRole('checkbox');
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await checkbox(1).check();
    await button(text.collect).click();
    await expect(group.getByRole('status')).toHaveText(text.summary(1, 1));
    await tab.getByRole('button', { name: pg ? postgresText.next : zh.common.pageNext, exact: true }).click();
    await checkbox(3).check();
    await button(text.collect).click();
    await expect(group.getByRole('status')).toHaveText(text.summary(2, 2));
    await tab.getByRole('button', { name: pg ? postgresText.first : zh.table.firstPage, exact: true }).click();
    // MySQL/MariaDB 可以恢复缓存页的原勾选。明确取消旧项后再覆盖本页收集。
    await checkbox(1).uncheck();
    await checkbox(2).check();
    await button(text.replace).click();
    await expect(group.getByRole('status')).toHaveText(text.summary(2, 2));
    await page.screenshot({ path: info.outputPath('跨页勾选-' + dialect + '.png') });

    const output = join(dataDir, '跨页勾选.json');
    // 只为本窗口返回独占临时保存路径，文件令牌与实际写入继续走正式入口。
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
          throw Error('仅允许本例 JSON 保存选择');
        return { canceled: false, filePath };
      }) as typeof original;
    }, output);
    const before = await tasks();
    await button(text.export).click();
    const modal = page.getByRole('dialog', { name: text.export, exact: true });
    await expect(modal.getByText(text.exportRows(2), { exact: true })).toBeVisible();
    await expect(modal.getByRole('gridcell', { name: '记录 1', exact: true })).toHaveCount(0);
    expect(await tasks()).toEqual(before);
    await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
    await modal.locator('.file-picker').click();
    await modal.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
    await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([
      { id: '2', note: '记录 2', amount: '1234567890123456.123456789012', payload: { type: 'binary', base64: 'AP8=' } },
      { id: '3', note: '记录 3', amount: null, payload: null },
    ]);
    expect(await measure()).toBe('5');

    await checkbox(2).uncheck();
    await button(text.replace).click();
    await expect(group.getByRole('status')).toHaveText(text.summary(1, 1));
    if (pg) await tab.getByRole('button', { name: postgresText.refresh, exact: true }).click();
    else await (await navigationMenuItem(tab.locator('.table-command-toolbar'), { name: zh.common.refresh, exact: true })).click();
    await expect(checkbox(1)).toBeVisible();
    await expect(button(text.export)).toBeDisabled();
    await expect(group.getByRole('status')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer?.end();
    await mysql?.end();
  }
});
