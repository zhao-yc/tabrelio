import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuCheckbox, navigationMenuItem } from './navigation-menu';
import { mysqlQueryStatusZh as text } from '../../src/renderer/locales/mysqlQueryStatus.zh-CN';
import { queryContinueOnErrorZh } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { queryWarningsZh } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { createConnection, type RowDataPacket } from 'mysql2/promise';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('查询状态按语句记录真实协议字节，诊断及参数不会进入状态明细', async ({}, info) => {
  const dialect = process.env.DBARK_QUERY_STATUS_DIALECT;
  test.skip(!dialect, '仅在显式启用的隔离源码验收运行');
  const database = process.env.DBARK_QUERY_STATUS_DATABASE ?? '';
  const port = Number(process.env.DBARK_QUERY_STATUS_PORT);
  const password = process.env.DBARK_QUERY_STATUS_PASSWORD ?? '';
  const headerBytes = Number(process.env.DBARK_QUERY_STATUS_HEADER_BYTES);
  const stageMode = process.env.DBARK_QUERY_STAGE_EXPECT;
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      ![5, 7].includes(headerBytes))
    throw Error('只允许本例源码与隔离回环数据库');
  try {
    if (stageMode && !['ready', 'disabled', 'unavailable'].includes(stageMode)) throw Error('未知的隔离阶段采集预期');
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
    if (stageMode === 'ready') await (await option(text.collectStages)).check();
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
    if (stageMode === 'ready') await expect(table.getByRole('button', { name: text.stageDetails(1), exact: true })).toBeVisible();

    // 按已核实的服务器回执区分两种路径。MySQL 单独的 SLEEP 正常回包，MariaDB 返回中断错误。
    for (const { slow, expected } of [
      { slow: 'SELECT SLEEP(25)', expected: dialect === 'mysql' ? text.completed : text.failed },
      { slow: 'SELECT id FROM status_cancel_wait WHERE SLEEP(25)=id', expected: text.failed },
    ]) {
      const prefix = 'SELECT 10 AS completed_prefix';
      const cancelledSql = [prefix, slow, 'SELECT 99 AS cancelled_tail'].join(';');
      const knownTasks = new Set((await tasks()).map(item => item.id));
      await write(cancelledSql);
      await editor.press(modifier + '+r');
      await expect.poll(async () => (await tasks()).find(item => !knownTasks.has(item.id) && item.kind === 'query.execute')?.status).toBe('running');
      await expect(query.getByRole('gridcell', { name: '10', exact: true })).toBeVisible();
      const observer = await createConnection({ host: '127.0.0.1', port, database, user: database, password });
      try {
        await expect.poll(async () => {
          const [processes] = await observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST');
          return processes.some(item => item.User === database && item.Info === slow);
        }).toBe(true);
      } finally { await observer.end(); }
      const running = (await tasks()).find(item => !knownTasks.has(item.id) && item.kind === 'query.execute')!;
      await (await navigationMenuItem(query, { name: '停止', exact: true })).click();
      await expect.poll(async () => (await tasks()).find(item => item.id === running.id)?.status).toBe('cancelled');
      await expect(panel).toBeVisible();
      await panel.locator('summary').click();
      await expect(panel.getByRole('status')).toHaveText(text.cancelled);
      await expect(rows).toHaveCount(2);
      await expect(cell(0, 0)).toHaveText(text.completed);
      await expect(cell(1, 0)).toHaveText(expected);
      expect(await numeric(0, 2)).toBe(sent(prefix));
      expect(await numeric(1, 2)).toBe(sent(slow));
      if (stageMode === 'ready') await expect(table.getByRole('button', { name: text.stageDetails(1), exact: true })).toBeVisible();
      await expect(query.getByRole('gridcell', { name: '99', exact: true })).toHaveCount(0);
      expect((await tasks()).find(item => item.id === running.id)).not.toHaveProperty('mysqlQueryStatus');
      const cancelledHistory = await history(), cancelledTasks = await tasks();
      if (slow.includes('status_cancel_wait')) await panel.screenshot({ path: info.outputPath('取消后保留执行状态.png') });
      expect(await history()).toEqual(cancelledHistory);
      expect(await tasks()).toEqual(cancelledTasks);
    }

    await (await option(text.collect)).uncheck();
    if (stageMode === 'ready') await (await option(text.collectStages)).uncheck();
    await run('SELECT 2 AS disabled_again');
    await expect(panel).toHaveCount(0);

    if (stageMode) {
      await expect(await option(text.collectStages)).not.toBeChecked();
      await (await option(text.collectStages)).check();
      const stageSql = [
        'DO SLEEP(0.08)',
        'CREATE TEMPORARY TABLE status_stage_write (id INT PRIMARY KEY)',
        'INSERT INTO status_stage_write VALUES (1),(2)',
        'SELECT ROW_COUNT() + 120 AS original_affected',
      ];
      await run(stageSql.join(';\n'));
      expect((await history())[0].success).toBe(true);
      await query.locator('.query-result-tabs button').nth(3).click();
      // 观察必须在独立物理连接。插入后的 ROW_COUNT 不可被诊断语句覆盖。
      await expect(query.getByRole('gridcell', { name: '122', exact: true })).toBeVisible();
      await panel.locator('summary').click();
      await expect(rows).toHaveCount(4);
      for (let index = 0; index < stageSql.length; index++) expect(await numeric(index, 2)).toBe(sent(stageSql[index]));
      if (stageMode === 'ready') {
        const stageDialog = (ordinal: number) => page.getByRole('dialog', { name: text.stageTable(ordinal), exact: true });
        await table.getByRole('button', { name: text.stageDetails(4), exact: true }).click();
        await expect(stageDialog(4)).toBeVisible();
        await expect(stageDialog(4)).not.toContainText(/User sleep/i);
        await page.keyboard.press('Escape');
        await expect(stageDialog(4)).toHaveCount(0);
        await table.getByRole('button', { name: text.stageDetails(1), exact: true }).click();
        const dialog = stageDialog(1), sleep = dialog.getByRole('row').filter({ hasText: /User sleep/i });
        await expect(sleep).toHaveCount(1);
        expect(Number((await sleep.getByRole('cell').last().innerText()).replaceAll(',', ''))).toBeGreaterThanOrEqual(60);
        await dialog.screenshot({ path: info.outputPath('服务端阶段.png') });
        await page.keyboard.press('Escape');
      } else {
        await expect(panel).toContainText(stageMode === 'disabled' ? text.stageDisabled : text.stageUnavailable);
        await expect(table.getByRole('button')).toHaveCount(0);
      }
      expect((await history())[0].sql).toBe(stageSql.join(';\n'));
      await (await option(text.collectStages)).uncheck();
      await run('SELECT 3 AS stage_disabled_again');
      await expect(panel).toHaveCount(0);
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
