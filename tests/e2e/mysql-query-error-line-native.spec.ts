import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, ownedDesktopResources, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { navigationMenuCheckbox, navigationMenuItem } from './navigation-menu';
import { observeQueryFailureSource } from './query-failure-source-observer';
import { queryFailureSourceZh as text } from '../../src/renderer/locales/queryFailureSource.zh-CN';
import { queryContinueOnErrorZh as continuing } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { queryWarningsZh } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { queryPartialOutcomeZh } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { currentStatementZh } from '../../src/renderer/locales/currentStatement.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.skip(process.env.DBARK_MYSQL_ERROR_LINE_NATIVE !== '1', '仅在本轮隔离 MySQL 或 MariaDB 实例运行');
test.use({trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true});
test.describe.configure({timeout: 90_000, retries: 0});

test('MySQL 系原生语法错误行对应原稿，兼容参数、警告与多错摘要', async ({}, info) => {
  const dialect = process.env.DBARK_MYERR_DIALECT, account = process.env.DBARK_MYERR_ACCOUNT ?? '';
  const port = Number(process.env.DBARK_MYERR_PORT), password = process.env.DBARK_MYERR_PASSWORD ?? '';
  const version = process.env.DBARK_MYERR_VERSION ?? '', host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !['5.7', '8.4', '11.4'].includes(version) ||
      !/^tabrelio_myerr_[a-f0-9]{12}$/.test(account) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535 || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL'].some(key => process.env[key]))
    throw Error('报错行验收仅允许本轮回环隔离库和源码窗口');
  const observer = await createConnection({host, port, user: account, password, database: account, charset: 'utf8mb4'});
  try {
    const [[identity]] = await observer.query<RowDataPacket[]>('SELECT @@hostname AS host, VERSION() AS version');
    expect(identity.host).toBe(account); expect(String(identity.version).startsWith(version + '.')).toBe(true);
    // 在测试窗口首次载入编辑器前启用 Monaco 官方观察 API，不替换原模型。
    await page.addInitScript(() => {
      let environment: Record<string, unknown> = {globalAPI: true};
      Object.defineProperty(window, 'MonacoEnvironment', {configurable: true, get: () => environment,
        set: value => { environment = {...value, globalAPI: true}; }});
    });
    await ownedDesktopResources(info).application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1460, 980));
    const profile: NetworkConnectionProfile = {id: '', dialect, name: '报错行隔离实例', host, port, user: account, password,
      database: account, color: '#123456', group: '', rememberPassword: false};
    await page.evaluate(async profile => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', {...settings, activeTabId: 'query-error', tabs: [
        {id: 'query-error', kind: 'query', title: '报错行验收', connectionId: connection.id, database: profile.database, sql: 'SELECT 1'},
      ]});
    }, profile);
    await page.reload();
    const query = page.locator('.query-tab:visible');
    const editor = query.locator('.query-layout-editor .monaco-editor').getByRole('textbox');
    const primary = query.getByRole('status', {name: queryPartialOutcomeZh.title, exact: true});
    const report = query.getByRole('status', {name: continuing.title, exact: true});
    const line = primary.getByRole('button', {name: text.locateLine, exact: true});
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const state = () => page.evaluate(observeQueryFailureSource);
    const write = async (sql: string, start = 0, end = start) => {
      await editor.evaluate((target, input) => {
        const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
        const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(target));
        const model = editor?.getModel();
        if (!editor || !model) throw Error('未找到原查询编辑器');
        // 固定夹具正文，避免真实输入的自动缩进改变报错行预期。
        model.setValue(input.sql);
        const from = model.getPositionAt(input.start), to = model.getPositionAt(input.end);
        editor.setSelection({startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column});
        editor.focus();
      }, {sql, start, end});
      await expect.poll(async () => (await state()).source).toBe(sql);
    };
    const execute = async (sql: string) => {
      const before = (await history()).length; await write(sql);
      await (await navigationMenuItem(query, {name: '执行全部', exact: true})).click();
      await expect.poll(async () => (await history()).length).toBe(before + 1);
    };
    const toggle = (name: string) => navigationMenuCheckbox(query, {name, exact: true});
    const locate = async (button: typeof line, expected: string) => {
      const before = await state(), entries = await history(), start = before.source.indexOf(expected);
      expect(start).toBeGreaterThanOrEqual(0);
      await expect(button).toBeEnabled(); await button.click();
      await expect.poll(state).toMatchObject({source: before.source, version: before.version,
        selections: [{start, end: start + expected.length, text: expected}]});
      expect(await history()).toEqual(entries);
    };
    const firstLine = '  FROM WHERE 1', secondLine = '  WHERE AND 2';
    const failed = "SELECT '前序🧭' AS prior;\nSELECT '同句😀' AS sample\n" + firstLine + ';';
    await execute(failed + '\nSELECT 9 AS tail;'); await locate(line, firstLine);
    const from = failed.indexOf("SELECT '同句");
    for (const target of [currentStatementZh.action, currentStatementZh.selectionOnly]) {
      const before = (await history()).length;
      await write(failed, from, target === currentStatementZh.action ? from : failed.length);
      await (await navigationMenuItem(query, {name: target, exact: true})).click();
      await expect.poll(async () => (await history()).length).toBe(before + 1);
      await locate(line, firstLine);
    }
    await execute('SELECT missing_native_field;'); await expect(primary).toBeVisible(); await expect(line).toHaveCount(0);

    await (await toggle(queryWarningsZh.option)).check();
    await execute(failed); await locate(line, firstLine);
    await (await toggle(queryWarningsZh.option)).uncheck();

    await (await toggle(continuing.option)).check();
    await execute(failed + '\nSELECT 2\n' + secondLine + ';\nSELECT 9 AS tail;');
    await expect(report).toContainText(continuing.counts(4, 2, 2));
    await locate(report.getByRole('button', {name: text.locateLineFor(2), exact: true}), firstLine);
    await locate(report.getByRole('button', {name: text.locateLineFor(3), exact: true}), secondLine);
    const navigator = report.getByRole('group', {name: continuing.navigation, exact: true});
    await locate(navigator.getByRole('button', {name: continuing.next, exact: true}), firstLine);
    await expect(navigator).toContainText(continuing.located(2, 1, 2));
    await locate(navigator.getByRole('button', {name: continuing.previous, exact: true}), secondLine);
    await page.screenshot({path: info.outputPath('原查询报错行.png'), animations: 'disabled'});
    await (await toggle(continuing.option)).uncheck();

    const parameterLine = '  FROM :value', template = "SELECT '中文🧭' AS sample\n" + parameterLine;
    await write(template); await (await navigationMenuItem(query, {name: parameterZh.open, exact: true})).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true}), sample = '内部合成参数\n🚢';
    await form.getByRole('textbox', {name: parameterZh.value + ' value', exact: true}).fill(sample);
    const beforeParameter = (await history()).length;
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(form).toBeHidden();
    await expect.poll(async () => (await history()).length).toBe(beforeParameter + 1);
    await locate(line, parameterLine);
    const entry = (await history()).find(item => item.sql === template);
    expect(entry?.success).toBe(false);
    expect(JSON.stringify(entry)).not.toContain('内部合成参数');
    expect(await query.locator('.error-box').innerText()).not.toContain(Buffer.from(sample).toString('hex'));
    await write('SELECT 5;'); await expect(line).toBeDisabled();
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    try { await confirmOwnedDesktopExit(info); } catch { retainOwnedDesktopResources(info); }
    throw reason;
  } finally { await observer.end(); }
});
