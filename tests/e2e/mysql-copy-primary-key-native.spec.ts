import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { expect, page, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { primaryKeyCopyZh as text } from '../../src/renderer/locales/primaryKeyCopy.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_MYSQL_COPY_PRIMARY_KEY_NATIVE !== '1', '需要本轮回环隔离网络库');

test('MySQL 和 MariaDB 复制精确复合原主键并跨时区回放', async ({}, info) => {
  const dialect = process.env.DBARK_CHECKED_RECORD_EDIT_DIALECT, database = process.env.DBARK_CHECKED_RECORD_EDIT_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_RECORD_EDIT_USER, password = process.env.DBARK_CHECKED_RECORD_EDIT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_CHECKED_RECORD_EDIT_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(database) ||
      user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      (dialect !== 'mysql' && dialect !== 'mariadb')) throw Error('需要本轮独占回环库');
  const profile: NetworkConnectionProfile = { id: '', name: '主键复制专项', dialect, group: '', color: '#123456',
    host, port, user, password, database, rememberPassword: false };
  const observer = await createConnection({ host, port, user, password, database, connectTimeout: 5000,
    supportBigNumbers: true, bigNumberStrings: true });
  const read = async (sql: string) => (await observer.query<RowDataPacket[]>(sql))[0].map(row => row.note).sort();
  try {
    await observer.query("SET SESSION time_zone = '+09:00', sql_mode = 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES'");
    const baseline = await read('SELECT note FROM key_rows');
    expect(baseline).toEqual(['交叉键甲', '交叉键乙', '时刻邻行', '目标乙', '目标甲'].sort());
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, profile);
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'primary-key-copy',
        tabs: [{ id: 'primary-key-copy', title: '原主键查询', kind: 'table', connectionId, database, table: 'key_rows' }] });
    }, { connectionId, database });
    await page.reload();
    await page.evaluate(() => {
      const captures: { text: string; formats: string[] }[] = [];
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        captures.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { mysqlKeyCopies: captures });
    });
    const captured = () => page.evaluate(() => (globalThis as typeof globalThis & {
      mysqlKeyCopies: { text: string; formats: string[] }[];
    }).mysqlKeyCopies);
    const tab = page.locator('.table-tab:visible');
    const cell = (name: string) => tab.getByRole('gridcell', { name, exact: true });
    const check = (name: string) => cell(name).locator('..').getByRole('checkbox');
    const button = () => navigationMenuItem(tab, { name: text.action, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    async function captureCount(count: number) {
      await expect.poll(async () => ({
        count: (await captured()).length,
        errors: await tab.getByRole('alert').allTextContents(),
      })).toEqual({ count, errors: [] });
    }

    await cell('目标甲').click();
    const before = await tasks();
    await (await button()).click();
    await captureCount(1);
    const [single] = await captured();
    expect(single.formats).toEqual(['text/plain']);
    expect(single.text).toContain("SELECT * FROM `" + database + "`.`key_rows`");
    expect(single.text).toContain('18446744073709551615');
    expect(single.text).toContain('UNIX_TIMESTAMP(`stamp`)');
    expect(single.text).toContain("X'00ff'");
    expect(await read(single.text)).toEqual(['目标甲']);

    await check('目标乙').check();
    await check('目标甲').check();
    await cell('交叉键甲').click();
    const action = await button();
    await page.screenshot({ path: info.outputPath('原主键查询复制-' + dialect + '.png') });
    await action.click();
    await captureCount(2);
    const [, batch] = await captured();
    expect(batch.formats).toEqual(['text/plain']);
    expect(await read(batch.text)).toEqual(['目标乙', '目标甲']);
    await expect(check('目标甲')).toBeChecked();
    await expect(check('目标乙')).toBeChecked();
    expect(await tasks()).toEqual(before);
    expect(await read('SELECT note FROM key_rows')).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
