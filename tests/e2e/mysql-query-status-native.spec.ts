import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuCheckbox, navigationMenuItem } from './navigation-menu';
import { mysqlQueryStatusZh as text } from '../../src/renderer/locales/mysqlQueryStatus.zh-CN';
import { queryContinueOnErrorZh } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { queryWarningsZh } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('查询状态按语句记录真实协议字节，诊断及参数不会进入状态明细', async ({}, info) => {
  const dialect = process.env.DBARK_QUERY_STATUS_DIALECT;
  test.skip(!dialect, '仅在显式启用的隔离源码验收运行');
  const database = process.env.DBARK_QUERY_STATUS_DATABASE ?? '';
  const port = Number(process.env.DBARK_QUERY_STATUS_PORT);
  const password = process.env.DBARK_QUERY_STATUS_PASSWORD ?? '';
  const headerBytes = Number(process.env.DBARK_QUERY_STATUS_HEADER_BYTES);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      ![5, 7].includes(headerBytes))
    throw Error('只允许本例源码与隔离回环数据库');
  try {
    const profile: NetworkConnectionProfile = { id: '', dialect, name: '协议状态验收', host: '127.0.0.1', database,
      user: database, password, port, group: '', color: '#123456', rememberPassword: false };
    await page.evaluate(async profile => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'query-status', resultLimit: 1, tabs: [
        { id: 'query-status', kind: 'query', title: '执行状态验收', connectionId: connection.id, database: profile.database, sql: 'SELECT 1' },
      ] });
    }, profile);
    await page.reload();
    const query = page.locator('.query-tab:visible');
    const editor = query.locator('.query-layout-editor .monaco-editor').getByRole('textbox');
    const panel = query.locator('.mysql-query-status'), table = panel.getByRole('table', { name: text.title, exact: true });
    const rows = table.locator('tbody tr');
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const option = (name: string) => navigationMenuCheckbox(query, { name, exact: true });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const write = async (sql: string) => {
      await editor.focus();
      await page.keyboard.press(modifier + '+a');
      await page.keyboard.insertText(sql);
    };
    const run = async (sql: string) => {
      const before = (await history()).length;
      await write(sql);
      await editor.press(modifier + '+r');
      await expect.poll(async () => (await history()).length).toBe(before + 1);
    };
    const sent = (sql: string) => Buffer.byteLength(sql) + headerBytes;
    const cell = (row: number, col: number) => rows.nth(row).getByRole('cell').nth(col);
    const numeric = async (row: number, col: number) => Number((await cell(row, col).innerText()).replaceAll(',', ''));

    await expect(await option(text.collect)).not.toBeChecked();
    await run('SELECT 1 AS initial_value');
    await expect(panel).toHaveCount(0);
    await (await option(text.collect)).check();
    const large = "SELECT CONCAT('汉字', REPEAT('a', 70000)) AS value UNION ALL SELECT REPEAT('b', 70000)";
    const failure = 'SELECT missing_query_status_column', trailing = 'SELECT 77 AS reached_end';
    const script = [large, failure, trailing].join(';\n');
    await run(script);
    const settledHistory = await history(), settledTasks = await tasks();
    await panel.locator('summary').click();
    await expect(rows).toHaveCount(2);
    await expect(cell(0, 0)).toHaveText(text.completed);
    await expect(cell(1, 0)).toHaveText(text.failed);
    expect(await numeric(0, 2)).toBe(sent(large));
    expect(await numeric(0, 3)).toBeGreaterThan(140000);
    expect(await numeric(1, 2)).toBe(sent(failure));
    expect(await numeric(1, 3)).toBeGreaterThan(0);
    expect(settledHistory[0].success).toBe(false);
    expect(await history()).toEqual(settledHistory);
    expect(await tasks()).toEqual(settledTasks);
    await panel.screenshot({ path: info.outputPath('查询状态与首错.png') });

    await (await option(queryContinueOnErrorZh.option)).check();
    await run(script);
    await panel.locator('summary').click();
    await expect(rows).toHaveCount(3);
    await expect(cell(2, 0)).toHaveText(text.completed);
    expect(await numeric(2, 2)).toBe(sent(trailing));

    await (await option(queryContinueOnErrorZh.option)).uncheck();
    const call = 'CALL status_results()';
    await run(call);
    await panel.locator('summary').click();
    await expect(rows).toHaveCount(1);
    expect(await numeric(0, 2)).toBe(sent(call));
    await expect(query.locator('.query-result-tabs button')).toHaveCount(3);

    await (await option(queryWarningsZh.option)).check();
    const warning = "SELECT CAST('warning-value' AS UNSIGNED) AS sample", other = 'SELECT 42 AS marker';
    await run(warning + ';\n' + other);
    await panel.locator('summary').click();
    await expect(rows).toHaveCount(2);
    expect(await numeric(0, 2)).toBe(sent(warning));
    expect(await numeric(1, 2)).toBe(sent(other));

    await (await option(queryWarningsZh.option)).uncheck();
    const parameterSql = 'SELECT :token AS marker';
    await write(parameterSql);
    await (await navigationMenuItem(query, { name: parameterZh.open, exact: true })).click();
    const parameter = page.getByRole('dialog', { name: parameterZh.title, exact: true });
    await parameter.getByRole('textbox', { name: parameterZh.value + ' token', exact: true }).fill('内部测试值');
    const before = (await history()).length;
    await parameter.getByRole('button', { name: parameterZh.execute, exact: true }).click();
    await expect.poll(async () => (await history()).length).toBe(before + 1);
    await panel.locator('summary').click();
    await expect(rows).toHaveCount(1);
    expect(await numeric(0, 2)).toBeGreaterThan(0);
    await expect(panel).not.toContainText('内部测试值');
    expect((await history())[0].sql).toBe(parameterSql);

    await (await option(text.collect)).uncheck();
    await run('SELECT 2 AS disabled_again');
    await expect(panel).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
