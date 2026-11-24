import { txtImportZh } from '../../src/shared/txtImport';
import { parse as parseTxt } from 'csv-parse/sync';
import { Client } from 'pg';
import { to as copyTo } from 'pg-copy-streams';
import ExcelJS from 'exceljs';
import { listExcelSheets, readExcelRows } from '../../src/engine/excelFiles';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { test, expect, page, desktop, pageErrors, quitDesktop, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { UiCommandId } from '../../src/shared/uiCommands';
import { queryResultNavigatorZh as resultNavText } from '../../src/renderer/locales/queryResultNavigator.zh-CN';
import { queryResultColumnsZh as resultColumnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { queryResultFilterZh as organizationFilterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSortZh as organizationSortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { savedQueryOrganizationZh as groupText } from '../../src/renderer/locales/savedQueryOrganization.zh-CN';
import { statementNavigationZh as navigationText } from '../../src/renderer/locales/statementNavigation.zh-CN';
import { resultSqlZh } from '../../src/shared/resultSql.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { queryLayoutZh } from '../../src/renderer/locales/queryLayout.zh-CN';
import { postgresQueryExportZh as fullExportText } from '../../src/renderer/locales/postgresQueryExport.zh-CN';
import { fullQueryExportProfilesZh as profileText } from '../../src/renderer/locales/fullQueryExportProfiles.zh-CN';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryParameterReuseZh as reuseText } from '../../src/renderer/locales/queryParameterReuse.zh-CN';
import { queryFailureSourceZh as failureText } from '../../src/renderer/locales/queryFailureSource.zh-CN';
import { observeQueryMarkerText } from './query-failure-source-observer';
import { queryPartialOutcomeZh as partialText } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { queryContinueOnErrorZh as continueText } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { postgresTransactionSettingsZh as transactionText } from '../../src/renderer/locales/postgresTransactionSettings.zh-CN';
import { postgresSearchPathZh as searchPathText } from '../../src/renderer/locales/postgresSearchPath.zh-CN';
import { postgresQueryTimeoutsZh as timeoutText } from '../../src/renderer/locales/postgresQueryTimeouts.zh-CN';
import { postgresNoticesZh as noticesText } from '../../src/renderer/locales/postgresNotices.zh-CN';
import { postgresNoticeHiddenMessage } from '../../src/shared/postgresNotices';
import { localRenameZh } from '../../src/renderer/locales/localRename.zh-CN';
import { objectDefinitionZh } from '../../src/renderer/locales/objectDefinition.zh-CN';
import { postgresSyntaxCheckZh } from '../../src/renderer/locales/sqlSyntaxCheck.zh-CN';

test.use({trace: 'off', video: 'off', screenshot: 'off'});
const tab = () => page.locator('.postgres-query:visible');
const editor = () => tab().locator('.postgres-editor .monaco-editor[role="code"]');
const script = "SELECT '选区原值' AS result;\nSELECT '第二句原值' AS result;";

async function prepare(connection: Extract<ConnectionProfile, {dialect: 'postgresql'}>, sql: string, resultLimit?: number) {
  await page.addInitScript(() => { self.MonacoEnvironment = {...self.MonacoEnvironment, globalAPI: true}; });
  await page.evaluate(async ({connection, sql, resultLimit}) => {
    const profile = await window.dbark.invoke('connections.save', connection);
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', {...settings, resultLimit: resultLimit ?? settings.resultLimit, activeTabId: 'pg-original', tabs: [
      {id: 'pg-original', kind: 'query', title: '原 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql},
      {id: 'pg-other', kind: 'query', title: '另一 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql: '-- 保留另一草稿'},
    ]});
  }, {connection, sql, resultLimit});
  await page.reload();
  await expect(editor().getByRole('textbox')).toBeVisible();
}

/** 测试从 Electron 实际菜单分发，不替换渲染处理器或后端会话。 */
async function enabled(id: UiCommandId) {
  return desktop.evaluate(({Menu}, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, id);
}
async function command(id: UiCommandId) {
  await expect.poll(() => enabled(id), {message: '等待原生菜单命令 ' + id}).toBe(true);
  await desktop.evaluate(({Menu, BrowserWindow}, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('原生命令或所属窗口已经改变');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  }, id);
}

async function modelSelection(line: number, start: number, end = start) {
  await editor().evaluate((element, range) => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少当前 PostgreSQL 编辑器');
    instance.focus();
    instance.setSelection({startLineNumber: range.line, endLineNumber: range.line, startColumn: range.start, endColumn: range.end});
  }, {line, start, end});
}
async function inspectModel() {
  return editor().evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少当前 PostgreSQL 编辑器');
    const model = instance.getModel()!, selection = instance.getSelection();
    return {sql: model.getValue(), language: model.getLanguageId(), position: instance.getPosition(), selected: selection ? model.getValueInRange(selection) : '',
      identity: [instance.getId(), model.id]};
  });
}

const navigationPanel = () => tab().getByRole('region', {name: navigationText.title, exact: true});
const ambiguousScript = String.raw`SELECT 'a\'; SELECT 2; -- '`;
const ambiguousFoldingScript = ["SELECT 'a\\';", 'SELECT', '2;', "-- close '", ';', 'SELECT 3;'].join('\n');
async function replaceDraft(sql: string) {
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(sql);
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
}

test('PostgreSQL 查询超时分别中止慢语句和锁等待并可恢复', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const dialog = () => page.getByRole('dialog', {name: timeoutText.title, exact: true});
  const toolbar = () => tab().getByRole('button', {name: timeoutText.open, exact: true});
  const field = (name: string) => dialog().getByLabel(name, {exact: true});
  const button = (name: string) => dialog().getByRole('button', {name, exact: true});
  const open = async () => { await toolbar().click(); await expect(dialog()).toContainText(timeoutText.ready); };
  const close = () => button(timeoutText.close).click();
  const grid = () => tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid, state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  const records = async () => (await observer.query('SELECT value FROM public.query_timeout_guard')).rows.map(row => row.value);
  try {
    await observer.query('CREATE TABLE public.query_timeout_guard (value int)');
    await observer.query('INSERT INTO public.query_timeout_guard VALUES (1)');
    await prepare({id: '', name: '隔离 PostgreSQL 查询超时', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '原结果' AS value;");
    await command('execute-all'); await expect(grid()).toContainText('原结果');
    const baseline = await history(), original = await sessions(); expect(original).toHaveLength(1);
    await expect(toolbar()).toBeVisible(); await open();
    const defaults = [await field(timeoutText.statement).inputValue(), await field(timeoutText.lock).inputValue()];
    await field(timeoutText.statement).fill('1.5');
    await expect(dialog()).toContainText(timeoutText.invalid);
    await expect(button(timeoutText.apply)).toBeDisabled();
    await field(timeoutText.statement).fill('600'); await field(timeoutText.lock).fill('150');
    await button(timeoutText.apply).click(); await expect(dialog()).toContainText(timeoutText.applied);
    await expect(field(timeoutText.statement)).toHaveValue('600'); await expect(field(timeoutText.lock)).toHaveValue('150');
    await page.screenshot({path: info.outputPath('PostgreSQL会话查询超时.png')});
    await close();
    expect(await history()).toEqual(baseline); expect(await sessions()).toEqual(original);
    await expect(grid()).toContainText('原结果');

    const choice = tab().getByRole('checkbox', {name: continueText.option, exact: true});
    await replaceDraft('SELECT pg_sleep(2); INSERT INTO public.query_timeout_guard VALUES (9);');
    await choice.check(); await command('execute-all');
    await expect(tab()).toContainText('statement timeout'); await expect(tab()).toContainText(continueText.counts(1, 0, 1));
    expect(await records()).toEqual([1]);
    await choice.uncheck();
    await observer.query('BEGIN'); await observer.query('SELECT * FROM public.query_timeout_guard FOR UPDATE');
    await replaceDraft('UPDATE public.query_timeout_guard SET value = 2;'); await command('execute-all');
    await expect(tab()).toContainText('lock timeout');
    expect(await records()).toEqual([1]); await observer.query('ROLLBACK');
    await expect.poll(sessions).toEqual(original);

    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
    await open();
    await expect(field(timeoutText.statement)).toHaveValue(defaults[0]); await expect(field(timeoutText.lock)).toHaveValue(defaults[1]); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click();
    await open(); await expect(field(timeoutText.statement)).toHaveValue('600');
    await button(timeoutText.reset).click(); await expect(dialog()).toContainText(timeoutText.applied);
    await expect(field(timeoutText.statement)).toHaveValue(defaults[0]); await expect(field(timeoutText.lock)).toHaveValue(defaults[1]); await close();
    await command('execute-all');
    await expect(tab().getByRole('group', {name: postgresZh.receipt, exact: true})).toContainText('服务器回执 UPDATE');
    expect(await records()).toEqual([2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 会话搜索路径显示实际优先级并隔离查询标签', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const schema = '报告, "近况"', quoted = postgresIdentifier(schema);
  const sql = 'SELECT marker FROM search_path_items;';
  const dialog = () => page.getByRole('dialog', {name: searchPathText.title, exact: true});
  const path = () => dialog().getByLabel(searchPathText.configured, {exact: true});
  const effective = () => dialog().getByRole('list', {name: searchPathText.effective, exact: true}).getByRole('listitem');
  const button = (name: string) => dialog().getByRole('button', {name, exact: true});
  const open = () => tab().getByRole('button', {name: searchPathText.open, exact: true}).click();
  const close = () => button(searchPathText.close).click();
  const grid = () => tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid, state, query, xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  try {
    await observer.query('CREATE SCHEMA ' + quoted);
    for (const [owner, marker] of [['public', '默认表'], [quoted, '路径前置表']]) {
      await observer.query('CREATE TABLE ' + owner + '.search_path_items (marker text)');
      await observer.query('INSERT INTO ' + owner + '.search_path_items VALUES ($1)', [marker]);
    }
    await prepare({id: '', name: '隔离 PostgreSQL 搜索路径', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await command('execute-all'); await expect(grid()).toContainText('默认表');
    const baseline = await history(), initial = await sessions(); expect(initial).toHaveLength(1);
    await open(); await expect(dialog()).toContainText(searchPathText.ready);
    await expect(dialog()).toContainText(searchPathText.identity(user, user, initial[0].pid));
    const defaultPath = await path().inputValue();
    await expect(effective()).toHaveText(['pg_catalog', 'public']);
    await dialog().getByLabel(searchPathText.candidates, {exact: true}).selectOption(schema);
    await button(searchPathText.append).click(); await expect(path()).toHaveValue(defaultPath + ', ' + quoted);
    const next = '"缺少的 schema", ' + quoted + ', public';
    await path().fill(next); await button(searchPathText.apply).click();
    await expect(dialog()).toContainText(searchPathText.applied);
    await expect(path()).toHaveValue(next);
    await expect(effective()).toHaveText(['pg_catalog', schema, 'public']);
    await page.screenshot({path: info.outputPath('PostgreSQL会话搜索路径.png')});
    await path().fill('"未闭合'); await button(searchPathText.apply).click();
    await expect(dialog()).toContainText('未取得完整的设置回执');
    await expect(button(searchPathText.apply)).toBeDisabled();
    await button(searchPathText.refresh).click(); await expect(path()).toHaveValue(next);
    await close();
    expect(await history()).toEqual(baseline);
    await expect(grid()).toContainText('默认表');
    await command('execute-all'); await expect(grid()).toContainText('路径前置表');
    expect((await sessions()).map(item => item.pid)).toEqual([initial[0].pid]);

    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
    await open(); await expect(dialog()).toContainText(searchPathText.ready);
    await expect(path()).toHaveValue(defaultPath); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click();
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const transaction = await sessions();
    await open(); await expect(dialog()).toContainText('请先明确提交或回滚原事务，再读取搜索路径');
    await expect(button(searchPathText.reset)).toBeDisabled(); await close();
    expect(await sessions()).toEqual(transaction);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await replaceDraft(sql);
    await open(); await expect(path()).toHaveValue(next);
    await button(searchPathText.reset).click(); await expect(dialog()).toContainText(searchPathText.applied);
    await expect(path()).toHaveValue(defaultPath); await close();
    await command('execute-all'); await expect(grid()).toContainText('默认表');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 会话事务默认设置保持原结果并按实际事务隔离、只读及延期生效', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const dialog = () => page.getByRole('dialog', {name: transactionText.title, exact: true});
  const open = async () => {
    await tab().getByRole('button', {name: transactionText.open, exact: true}).click();
    await expect(dialog().getByText(transactionText.ready, {exact: true})).toBeVisible();
  };
  const close = () => dialog().getByRole('button', {name: transactionText.close, exact: true}).click();
  const apply = async (isolation: string, readOnly: boolean, deferrable: boolean) => {
    await dialog().getByLabel(transactionText.isolation, {exact: true}).selectOption(isolation);
    await dialog().getByRole('checkbox', {name: transactionText.readOnly, exact: true}).setChecked(readOnly);
    await dialog().getByRole('checkbox', {name: transactionText.deferrable, exact: true}).setChecked(deferrable);
    await dialog().getByRole('button', {name: transactionText.apply, exact: true}).click();
    await expect(dialog().getByText(transactionText.applied, {exact: true})).toBeVisible();
  };
  const sessions = async () => (await observer.query("SELECT pid,state,xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  const records = async () => (await observer.query('SELECT id FROM public.transaction_settings_sentinel ORDER BY id')).rows;
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  try {
    await observer.query('CREATE TABLE public.transaction_settings_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 事务设置', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '原结果保持' AS original;");
    await command('execute-all'); const grid = tab().locator('.postgres-results .rdg'); await expect(grid).toContainText('原结果保持');
    const originalResult = await grid.innerText(), before = await history(), original = await sessions(); expect(original).toHaveLength(1);
    await open(); await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('READ COMMITTED');
    await expect(dialog().getByRole('button', {name: transactionText.apply, exact: true})).toBeDisabled();
    await apply('SERIALIZABLE', true, true); expect(await sessions()).toEqual(original); expect(await history()).toEqual(before);
    expect(await grid.innerText()).toBe(originalResult);
    await page.screenshot({path: info.outputPath('PostgreSQL会话事务默认设置.png')}); await close();
    await replaceDraft("SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly, current_setting('transaction_deferrable') AS deferred;");
    await command('execute-all'); await expect(grid).toContainText('serializable'); await expect(grid.getByRole('gridcell').filter({hasText: /^on$/})).toHaveCount(2);
    await replaceDraft('INSERT INTO public.transaction_settings_sentinel VALUES (1);'); await command('execute-all');
    await expect(tab()).toContainText('read-only transaction'); expect(await records()).toEqual([]);
    await open(); await apply('REPEATABLE READ', false, false); await close();
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const active = await sessions(), beforeRead = await history();
    await open(); await expect(dialog()).toContainText(transactionText.active);
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toBeDisabled();
    await expect(dialog().getByRole('button', {name: transactionText.apply, exact: true})).toBeDisabled();
    await close(); expect(await sessions()).toEqual(active); expect(await history()).toEqual(beforeRead);
    // SHOW未提前固定事务快照；用户仍能在第一条SELECT前明确改变当前事务隔离级别。
    const transactional = 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; INSERT INTO public.transaction_settings_sentinel VALUES (2) RETURNING id;';
    await replaceDraft(transactional);
    await command('execute-all'); await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await expect.poll(async () => (await history()).find(entry => entry.sql === transactional)?.success).toBe(true); expect(await records()).toEqual([]);
    await replaceDraft('SELECT missing_column;'); await command('execute-all');
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.failedTransaction);
    const failed = await observer.query("SELECT pid,state,query FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user]);
    await tab().getByRole('button', {name: transactionText.open, exact: true}).click();
    await expect(dialog()).toContainText('原会话状态未知或事务已失败'); await close();
    expect((await observer.query("SELECT pid,state,query FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows).toEqual(failed.rows);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(await records()).toEqual([]); expect((await sessions())[0].pid).toBe(original[0].pid);
    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click(); await open();
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('READ COMMITTED');
    await expect(dialog().getByRole('checkbox', {name: transactionText.readOnly, exact: true})).not.toBeChecked(); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click(); await open();
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('REPEATABLE READ'); await close();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 成功结果查看实际 SQL 并定位原模型范围', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const duplicate = "SELECT '重复🧭' AS result", commandOnly = 'CREATE TEMP TABLE result_source_guard (id int)';
  const script = [duplicate, 'SELECT missing_column', '/* 第二份😀 */ ' + duplicate, commandOnly].join(';\r\n') + ';';
  const receipt = () => tab().getByRole('group', {name: postgresZh.receipt, exact: true});
  const picker = () => tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const locate = () => receipt().getByRole('button', {name: postgresZh.locateResult, exact: true});
  const view = () => receipt().getByRole('button', {name: zh.query.resultSql, exact: true});
  const dialog = () => page.getByRole('dialog', {name: zh.query.resultSqlTitle, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const close = () => dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  const originalSql = () => dialog().locator('.monaco-editor').evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少结果来源编辑器');
    return {sql: instance.getValue().trim(), readOnly: instance.getRawOptions().readOnly};
  });
  await prepare({id: '', name: '隔离 PostgreSQL 结果来源', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, script);
  await tab().getByRole('checkbox', {name: continueText.option, exact: true}).check(); await command('execute-all');
  await expect(receipt()).toContainText('第 1 条语句');
  const before = await history();
  await picker().selectOption('1');
  await expect(locate()).toBeEnabled();
  await locate().click();
  await expect.poll(async () => {
    const model = await inspectModel(); return [model.position?.lineNumber, model.selected];
  }).toEqual([3, duplicate]);
  await view().click();
  await expect.poll(originalSql).toEqual({sql: '/* 第二份😀 */ ' + duplicate, readOnly: true});
  await expect(dialog().locator('.view-lines')).toContainText('第二份😀');
  await expect.poll(() => enabled('execute-all')).toBe(false);
  await page.screenshot({path: info.outputPath('PostgreSQL结果来源.png')});
  await close();
  await picker().selectOption('2');
  await view().click(); await expect.poll(originalSql).toEqual({sql: commandOnly, readOnly: true}); await close();
  await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(commandOnly);

  await replaceDraft('SELECT 3 AS revised;');
  await expect(locate()).toBeDisabled();
  await view().click(); await expect.poll(originalSql).toEqual({sql: commandOnly, readOnly: true}); await close();
  expect(await history()).toEqual(before);

  // Monaco 插入文本时沿用当前模型的 CRLF 格式。
  const two = duplicate + ';\r\n' + duplicate + ';';
  await replaceDraft(two);
  await modelSelection(2, 1, duplicate.length + 1);
  await command('execute-selection');
  await expect(locate()).toBeEnabled();
  await modelSelection(1, 1);
  await locate().click();
  await expect.poll(async () => {
    const model = await inspectModel(); return [model.position?.lineNumber, model.selected];
  }).toEqual([2, duplicate]);

  const template = 'SELECT length([$needle]::text) AS size', secret = '参数绑定原值🧭';
  await replaceDraft(template + ';');
  await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
  const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
  await form.getByLabel(parameterZh.value + ' needle', {exact: true}).fill(secret);
  await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
  await expect(locate()).toBeEnabled();
  await view().click(); await expect.poll(originalSql).toEqual({sql: template, readOnly: true});
  await expect(dialog().getByText(postgresZh.resultSqlHint, {exact: true})).toBeVisible();
  await dialog().screenshot({path: info.outputPath('PostgreSQL命名参数原模板.png')});
  await close();
  await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(template);
  expect(JSON.stringify(await history())).not.toContain(secret); expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 查询回执区分原编号、事务回执和实际接收行数', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const receipt = () => tab().getByRole('group', {name: postgresZh.receipt, exact: true});
  const picker = () => tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const status = () => tab().locator('.tab-status');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.receipt_rows ORDER BY id')).rows.map(row => row.id);
  try {
    await observer.query('CREATE TABLE public.receipt_rows (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 查询回执', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, [
      'INSERT INTO public.receipt_rows VALUES (1) RETURNING id;',
      'SELECT missing_column;',
      'BEGIN;',
      'INSERT INTO public.receipt_rows VALUES (9);',
      'SELECT another_missing;',
      'COMMIT;',
      'UPDATE public.receipt_rows SET id = 2 WHERE id = 1 RETURNING id;',
      'DELETE FROM public.receipt_rows WHERE false;',
      '/*NAME: 实库四行 */ SELECT generate_series(1, 4) AS number;',
    ].join('\n'), 3);
    const choice = tab().getByRole('checkbox', {name: continueText.option, exact: true});
    await choice.check(); await command('execute-all');
    await expect(picker().getByRole('option')).toHaveText([
      '1 · INSERT · 1 行', '3 · BEGIN · 0 行', '4 · INSERT · 0 行', '6 · ROLLBACK · 0 行',
      '7 · UPDATE · 1 行', '8 · DELETE · 0 行', '9 · 实库四行 · SELECT · 1 行',
    ]);
    await expect(receipt()).toContainText('第 1 条语句 · 服务器回执 INSERT · 服务端计数 1 行 · 已接收 1 行');
    await expect(status()).toContainText(/本次总耗时 \d+ ms/);
    await expect(status()).toContainText(postgresZh.idle);
    await expect(tab().getByRole('status', {name: continueText.title, exact: true})).toContainText(continueText.counts(9, 7, 2));
    const before = await history();
    await picker().selectOption('2');
    await expect(receipt()).toContainText('第 4 条语句 · 服务器回执 INSERT · 服务端计数 1 行');
    await expect(receipt()).not.toContainText('已接收');
    await picker().selectOption('3');
    await expect(receipt()).toContainText('第 6 条语句 · 服务器回执 ROLLBACK');
    await expect(receipt()).not.toContainText('服务端计数');
    await picker().selectOption('5');
    await expect(receipt()).toContainText('第 8 条语句 · 服务器回执 DELETE · 服务端计数 0 行');
    await picker().selectOption('6');
    await expect(receipt()).toContainText(/第 9 条语句 · 服务器回执 SELECT · 服务端计数 4 行 · 已接收 1 行 · 本条耗时 \d+ ms/);
    await expect(tab()).toContainText(postgresZh.truncated);
    await status().scrollIntoViewIfNeeded();
    await receipt().scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('PostgreSQL查询回执.png')});
    await picker().selectOption('4');
    await tab().getByRole('button', {name: zh.query.pinResult, exact: true}).click();
    await expect(receipt()).toHaveCount(0);
    await expect(status()).not.toContainText('本次总耗时');
    await tab().getByRole('button', {name: zh.query.currentResults, exact: true}).click();
    await expect(receipt()).toContainText('第 7 条语句 · 服务器回执 UPDATE · 服务端计数 1 行 · 已接收 1 行');
    expect(await history()).toEqual(before); expect(await records()).toEqual([2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 服务端消息保留失败前提示、原文定位、参数隐私及有界续执行', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const first = "DO $$ BEGIN RAISE NOTICE '普通消息🧭' USING DETAIL = '原始详情', HINT = '原始提示'; RAISE WARNING '实际警告'; END; $$";
  const failed = "DO $$ BEGIN RAISE NOTICE '失败前消息'; RAISE EXCEPTION '预期首错'; END; $$";
  const panel = () => tab().locator('details.postgres-notices');
  const open = (n: number) => panel().getByText(noticesText.count(n), {exact: true}).click();
  const entry = (message: string) => panel().getByRole('listitem').filter({hasText: message});
  const search = () => panel().getByRole('searchbox', {name: noticesText.search, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.notice_calls ORDER BY id')).rows.map(row => row.id);
  try {
    await observer.query('CREATE TABLE public.notice_calls (id int)');
    await observer.query(`CREATE FUNCTION public.notice_echo(v text) RETURNS int LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.notice_calls VALUES (1);
        RAISE NOTICE '回显 %', v USING DETAIL = '详情 ' || v, HINT = '提示 ' || v;
        RETURN 1;
      END; $$`);
    await prepare({id: '', name: '隔离 PostgreSQL 服务端消息', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false},
    first + ';\nSELECT 1;\n' + failed + ';\nINSERT INTO public.notice_calls VALUES (9);');
    await command('execute-all');
    const error = () => tab().getByRole('status', {name: partialText.title, exact: true});
    await expect(error()).toContainText(partialText.position(3, 2));
    await expect(tab()).toContainText('预期首错');
    await open(3);
    await expect(panel()).toContainText(noticesText.retained(3, 3));
    await expect(entry('普通消息🧭')).toContainText('NOTICE · 00000');
    await expect(entry('实际警告')).toContainText('WARNING · 01000');
    await expect(entry('失败前消息')).toContainText(noticesText.ordinal(3));
    const beforeLocate = await history();
    for (const [message, ordinal, statement] of [['普通消息🧭', 1, first], ['失败前消息', 3, failed]] as const) {
      await entry(message).getByRole('button', {name: noticesText.locate(ordinal), exact: true}).click();
      await expect.poll(async () => (await inspectModel()).selected).toBe(statement);
    }
    await entry('普通消息🧭').getByRole('button', {name: noticesText.locate(1), exact: true}).click();
    await error().getByRole('button', {name: failureText.locate, exact: true}).click();
    await expect.poll(async () => (await inspectModel()).selected).toBe(failed);
    expect(await history()).toEqual(beforeLocate); expect(await records()).toEqual([]);
    await search().fill('原始提示');
    await expect(panel().getByRole('listitem')).toHaveCount(1);
    for (const [label, value] of [[noticesText.detail, '原始详情'], [noticesText.hint, '原始提示'], [noticesText.context, 'PL/pgSQL']] as const) {
      await entry('普通消息🧭').getByText(label, {exact: true}).click();
      await expect(entry('普通消息🧭').getByText(value, {exact: label !== noticesText.context})).toBeVisible();
    }
    await page.screenshot({path: info.outputPath('PostgreSQL服务端消息.png')});

    await replaceDraft('SELECT public.notice_echo($1::text) AS call_result;');
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true}), secret = '仅参数消息保密😀';
    await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await open(1);
    await expect(panel()).toContainText(noticesText.redacted);
    await expect(panel()).toContainText(postgresNoticeHiddenMessage);
    await expect(panel()).not.toContainText(secret);
    expect(await records()).toEqual([1]);
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('settings.get', {})))).not.toContain(secret);

    await replaceDraft("DO $$ BEGIN FOR i IN 1..205 LOOP RAISE NOTICE '批次 %', i; END LOOP; END; $$;\nINSERT INTO public.notice_calls VALUES (2);");
    await command('execute-all'); await open(205);
    await expect(panel()).toContainText(noticesText.retained(205, 200));
    await expect(panel()).toContainText(noticesText.truncated);
    await expect(panel()).toContainText(noticesText.page(1, 8));
    await panel().getByRole('button', {name: noticesText.next, exact: true}).click();
    await expect(panel().getByText('批次 26', {exact: true})).toBeVisible();
    await search().fill('批次 200'); await expect(panel().getByRole('listitem')).toHaveCount(1);
    await search().fill('批次 205'); await expect(panel()).toContainText(noticesText.empty);
    expect(await records()).toEqual([1, 2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 显式遇错继续保留多错定位、原事务、取消及参数隐私', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = 'INSERT INTO public.continue_sentinel VALUES (1);\nSELECT missing_column;\nINSERT INTO public.continue_sentinel VALUES (2);\nSELECT 1/0;\nINSERT INTO public.continue_sentinel VALUES (3);';
  const choice = () => tab().getByRole('checkbox', {name: continueText.option, exact: true});
  const report = () => tab().getByRole('status', {name: continueText.title, exact: true});
  const records = async () => (await observer.query('SELECT id FROM public.continue_sentinel ORDER BY id')).rows.map(row => row.id);
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  try {
    await observer.query('CREATE TABLE public.continue_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 遇错继续', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await expect.poll(() => enabled('find-query-receipts')).toBe(false);
    await expect(choice()).not.toBeChecked(); await command('execute-all');
    await expect(tab().getByRole('status', {name: partialText.title, exact: true})).toContainText(partialText.position(2, 1));
    expect(await records()).toEqual([1]); await expect(report()).toHaveCount(0);
    const original = await sessions(); expect(original).toHaveLength(1); expect(original[0].state).toBe('idle');
    await observer.query('TRUNCATE public.continue_sentinel');
    await choice().check(); await command('execute-all');
    await expect(report()).toContainText(continueText.counts(5, 3, 2)); await expect(report()).toContainText(continueText.reachedEnd);
    const executionMarkers = () => page.evaluate(observeQueryMarkerText, failureText.markerSource);
    await expect.poll(async () => (await executionMarkers()).sort()).toEqual(['SELECT 1/0', 'm']);
    await modelSelection(2, 8);
    await page.keyboard.press('ControlOrMeta+K'); await page.keyboard.press('ControlOrMeta+I');
    await expect(tab().locator('.monaco-hover:visible')).toContainText('column "missing_column" does not exist');
    await page.keyboard.press('Escape');
    expect(await records()).toEqual([1, 2, 3]); expect(await sessions()).toEqual(original);
    const beforeLocate = await history();
    for (const [ordinal, statement] of [[2, 'SELECT missing_column'], [4, 'SELECT 1/0']] as const) {
      await report().getByRole('button', {name: continueText.locate(ordinal), exact: true}).click();
      await expect.poll(async () => (await inspectModel()).selected).toBe(statement);
    }
    await report().getByRole('button', {name: failureText.locatePositionFor(2), exact: true}).click();
    await expect.poll(inspectModel).toMatchObject({selected: 'm', position: {lineNumber: 2, column: 9}});
    await expect(report().getByRole('button', {name: failureText.locatePositionFor(4), exact: true})).toHaveCount(0);
    const navigator = report().getByRole('group', {name: continueText.navigation, exact: true});
    await command('next-query-error');
    await expect.poll(inspectModel).toMatchObject({selected: 'SELECT 1/0'});
    await expect(navigator).toContainText(continueText.located(4, 2, 2));
    await navigator.getByRole('button', {name: continueText.next, exact: true}).click();
    await expect.poll(inspectModel).toMatchObject({selected: 'm', position: {lineNumber: 2, column: 9}});
    await expect.poll(() => enabled('execute-selection')).toBe(true);
    await modelSelection(1, 1);
    await expect.poll(() => enabled('execute-selection')).toBe(false);
    const resultNavigation = tab().getByRole('button', {name: resultNavText.open, exact: true});
    await command('find-query-receipts');
    const resultDialog = page.getByRole('dialog', {name: resultNavText.open, exact: true});
    const resultSearch = resultDialog.getByRole('combobox', {name: resultNavText.input, exact: true});
    await expect(resultDialog.getByRole('checkbox', {name: resultNavText.includeFailures, exact: true})).toBeChecked();
    const receiptOptions = resultDialog.getByRole('option');
    await expect(receiptOptions).toHaveCount(5);
    await expect(receiptOptions.nth(1)).toContainText(resultNavText.failedStatement(2));
    await expect(receiptOptions.nth(3)).toContainText(resultNavText.failedStatement(4));
    await resultSearch.fill('missing_column');
    await expect(receiptOptions).toHaveCount(1);
    await expect(resultDialog.getByRole('region', {name: resultNavText.errorDetail, exact: true})).toContainText('missing_column');
    await resultDialog.getByRole('button', {name: resultNavText.locateError, exact: true}).click();
    await expect.poll(inspectModel).toMatchObject({selected: 'm', position: {lineNumber: 2, column: 9}});
    await resultNavigation.click();
    await resultSearch.fill('@3'); await expect(resultDialog.getByRole('option')).toHaveCount(1);
    await expect(resultDialog.getByRole('option')).toContainText(resultNavText.result(2));
    await expect(resultDialog.getByRole('option')).toContainText(resultNavText.statement(3));
    await resultDialog.getByRole('button', {name: queryDuplicateZh.resultStatement, exact: true}).click();
    const target = page.getByRole('dialog', {name: queryDuplicateZh.targetAction, exact: true});
    await expect(resultDialog).toHaveCount(0);
    await target.getByRole('button', {name: zh.common.cancel, exact: true}).click();
    await resultNavigation.click(); await resultSearch.fill('@3');
    await resultSearch.press('Enter');
    const resultChoice = tab().getByLabel('PostgreSQL结果集', {exact: true});
    await expect(resultChoice).toHaveValue('1');
    await command('next-query-result');
    await expect(resultChoice).toHaveValue('2');
    await page.keyboard.press('ControlOrMeta+Shift+PageDown');
    await expect(resultChoice).toHaveValue('0');
    await command('previous-query-result');
    await expect(resultChoice).toHaveValue('2');
    expect(await history()).toEqual(beforeLocate); expect(await records()).toEqual([1, 2, 3]);
    expect(beforeLocate[0].success).toBe(false);
    await page.screenshot({path: info.outputPath('PostgreSQL遇错继续摘要.png')});

    const transactional = 'BEGIN;\nINSERT INTO public.continue_sentinel VALUES (4);\nSELECT missing_column;\nINSERT INTO public.continue_sentinel VALUES (5);\nROLLBACK;\nINSERT INTO public.continue_sentinel VALUES (6);';
    await replaceDraft(transactional); await expect.poll(executionMarkers).toEqual([]);
    await expect.poll(() => enabled('next-query-error')).toBe(false);
    await command('execute-all');
    await expect(report()).toContainText(continueText.counts(6, 4, 2)); await expect(report()).toContainText(continueText.reachedEnd);
    expect(await records()).toEqual([1, 2, 3, 6]); expect(await sessions()).toEqual(original);
    await expect(report()).toContainText('current transaction is aborted');

    await replaceDraft('SELECT missing_column;\nSELECT pg_sleep(20);\nINSERT INTO public.continue_sentinel VALUES (7);');
    await command('execute-all');
    await expect.poll(async () => (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' AND state='active' AND query LIKE '%pg_sleep(20)%'", [user])).rows[0].n).toBe(1);
    await tab().getByRole('button', {name: postgresZh.stop, exact: true}).click();
    await expect(report()).toContainText(continueText.counts(2, 0, 2)); await expect(report()).toContainText(continueText.stopped);
    expect(await records()).toEqual([1, 2, 3, 6]); await expect.poll(sessions).toEqual(original);

    await replaceDraft('SELECT $1::int AS parameter_error;');
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true}), secret = '续执行参数秘密😀';
    await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(report()).toContainText(continueText.counts(1, 0, 1)); await expect(report()).toContainText('SQLSTATE 22P02');
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(settings)).not.toContain(secret); expect(settings.tabs.every(item => !Object.hasOwn(item, 'continueOnError'))).toBe(true);
    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click(); await expect(choice()).not.toBeChecked();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click(); await expect(choice()).toBeChecked();

    await replaceDraft([
      'SELECT 10 AS layout_key, 100 AS layout_note UNION ALL SELECT 13, 100 UNION ALL SELECT 11, 100;',
      'SELECT 21 AS layout_key, 200 AS layout_note UNION ALL SELECT 22, 200 UNION ALL SELECT 20, 200;',
    ].join('\n'));
    await command('execute-all');
    const layoutGrid = tab().getByRole('grid');
    const noteHeader = layoutGrid.getByRole('columnheader', {name: /^layout_note/});
    const columns = page.getByRole('dialog', {name: resultColumnsText.title, exact: true});
    const openColumns = () => tab().getByRole('button', {name: resultColumnsText.open, exact: true}).click();
    const applyColumns = async () => {
      await columns.getByRole('button', {name: resultColumnsText.apply, exact: true}).click();
      await expect(columns).toBeHidden();
    };
    const applyOrganization = async (upper: number, direction: 'ASC' | 'DESC') => {
      await tab().getByRole('button', {name: organizationFilterText.open, exact: true}).click();
      const filter = page.getByRole('dialog', {name: organizationFilterText.title, exact: true});
      await filter.getByRole('button', {name: organizationFilterText.add, exact: true}).click();
      await filter.getByLabel(`${organizationFilterText.operator} 1`, {exact: true}).selectOption('lt');
      await filter.getByLabel(`${organizationFilterText.input} 1`, {exact: true}).fill(String(upper));
      await filter.getByRole('button', {name: organizationFilterText.apply, exact: true}).click();
      await expect(filter).toBeHidden();
      await tab().getByRole('button', {name: organizationSortText.panelTitle, exact: true}).click();
      const sort = page.getByRole('dialog', {name: organizationSortText.panelTitle, exact: true});
      await sort.getByRole('button', {name: organizationSortText.panelAdd, exact: true}).click();
      await sort.getByLabel(organizationSortText.panelDirection(1), {exact: true}).selectOption(direction);
      await sort.getByRole('button', {name: organizationSortText.panelApply, exact: true}).click();
      await expect(sort).toBeHidden();
    };
    const layoutValues = () => layoutGrid.getByRole('gridcell').filter({hasText: /^(10|11|13|20|21|22)$/});
    await expect(layoutGrid.getByRole('gridcell', {name: '10', exact: true})).toBeVisible();
    const afterLayoutExecution = await history();
    await openColumns(); await columns.getByLabel(resultColumnsText.visible(2), {exact: true}).uncheck(); await applyColumns();
    await expect(noteHeader).toHaveCount(0);
    await applyOrganization(12, 'DESC');
    await expect(layoutValues()).toHaveText(['11', '10']);
    await resultChoice.selectOption('1');
    await expect(layoutGrid.getByRole('gridcell', {name: '20', exact: true})).toBeVisible();
    await openColumns(); await columns.getByLabel(resultColumnsText.width(2), {exact: true}).fill('215'); await applyColumns();
    await applyOrganization(22, 'ASC');
    await resultChoice.selectOption('0'); await expect(noteHeader).toHaveCount(0);
    await expect(layoutValues()).toHaveText(['11', '10']);
    await resultChoice.selectOption('1'); await expect(noteHeader).toHaveCSS('width', '215px');
    await expect(layoutValues()).toHaveText(['20', '21']);
    expect(await history()).toEqual(afterLayoutExecution);
    await command('execute-all');
    await expect.poll(async () => (await history()).length).toBe(afterLayoutExecution.length + 1);
    await expect(resultChoice).toHaveValue('0');
    await expect(noteHeader).toBeVisible();
    await expect(layoutValues()).toHaveText(['10', '13', '11']);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 多语句参数执行与光标当前语句保留原模板', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本轮隔离的回环 PostgreSQL');

  const id = '9007199254740993', value = "参数脚本样本'😀";
  const sql = [
    'CREATE TEMP TABLE parameter_script_probe(n bigint, note text);',
    'INSERT INTO parameter_script_probe VALUES ([$id]::bigint, [$note]::text);',
    'SELECT [$note]::text AS shared_note, [$id]::bigint AS shared_id, n, note FROM parameter_script_probe;',
  ].join('\n');
  await prepare({id: '', name: '隔离 PostgreSQL 参数脚本', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, password, database: user}, sql);
  const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
  const result = tab().getByLabel('PostgreSQL结果集', {exact: true});
  const grid = tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const fill = async (name: string, value: string, type = 'text') => {
    await form.getByLabel(parameterZh.type + ' ' + name, {exact: true}).selectOption(type);
    await form.getByLabel(parameterZh.value + ' ' + name, {exact: true}).fill(value);
  };
  const submit = async () => {
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(form).toBeHidden();
  };
  await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
  await fill('id', id, 'integer');
  await fill('note', value);
  await expect(form.locator('.parameter-row')).toHaveCount(2);
  expect(await history()).toEqual([]);
  await submit();
  await result.selectOption('2');
  await expect(grid).toContainText(id);
  await expect(grid).toContainText(value);
  await expect.poll(async () => (await history()).some(entry => entry.sql === sql && entry.success)).toBe(true);

  const current = '/* 光标内参数 */ SELECT [$here]::bigint AS current_value, COUNT(*)::int AS total FROM parameter_script_probe';
  const script = 'INSERT INTO parameter_script_probe VALUES ([$before], NULL);\n' + current +
    ';\nINSERT INTO parameter_script_probe VALUES ([$after], NULL);';
  await replaceDraft(script);
  await modelSelection(2, current.indexOf('[$here]') + 1);
  await tab().getByRole('button', {name: postgresZh.parameterCurrent, exact: true}).click();
  await fill('here', '42', 'integer');
  await expect(form.locator('.parameter-row')).toHaveCount(1);
  await expect(form.locator('.view-lines')).toContainText('current_value');
  await expect(form.locator('.view-lines')).not.toContainText('[$before]');
  await form.screenshot({path: info.outputPath('PostgreSQL参数执行当前语句.png')});
  await submit();
  await expect(grid.getByRole('gridcell', {name: '42', exact: true})).toBeVisible();
  await expect(grid.getByRole('gridcell', {name: '1', exact: true})).toBeVisible();
  await expect.poll(async () => (await history()).some(entry => entry.sql.trim() === current && entry.success)).toBe(true);

  const continuing = 'SELECT [$n]::int AS before_error;\nSELECT [$bad]::int AS expected_error;\nSELECT [$n]::int + 1 AS recovered;';
  await replaceDraft(continuing);
  await tab().getByRole('checkbox', {name: continueText.option, exact: true}).check();
  await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
  await fill('n', '70', 'integer');
  await fill('bad', value);
  await submit();
  await result.selectOption('1');
  await expect(grid.getByRole('gridcell', {name: '71', exact: true})).toBeVisible();
  await expect(tab()).toContainText('SQLSTATE 22P02');
  await expect(tab()).not.toContainText(value);
  await expect.poll(async () => (await history()).some(entry => entry.sql === continuing && !entry.success)).toBe(true);
  expect(JSON.stringify(await history())).not.toContain(value);
  expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(value);
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 失败语句定位覆盖脚本、选区、当前及参数，保持提交事实和原事务', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = "/* 已完成😀 */ INSERT INTO public.failure_sentinel VALUES (1) RETURNING id;\r\n/* 未完成🧭 */ SELECT missing_column FROM public.failure_sentinel;\r\nINSERT INTO public.failure_sentinel VALUES (2);";
  const notice = () => tab().getByRole('status', {name: partialText.title, exact: true});
  const locate = () => notice().getByRole('button', {name: failureText.locate, exact: true});
  const precise = () => notice().getByRole('button', {name: failureText.locatePosition, exact: true});
  const openFailureDraft = () => notice().getByRole('button', {name: queryDuplicateZh.failureStatement, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.failure_sentinel ORDER BY id')).rows;
  const select = async (start: number, end = start) => editor().evaluate((element, offsets) => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element)), model = instance?.getModel();
    if (!instance || !model) throw Error('缺少原查询模型');
    const from = model.getPositionAt(offsets.start), to = model.getPositionAt(offsets.end);
    instance.setSelection({startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column}); instance.focus();
  }, {start, end});
  const unchangedLocate = async (expected: string) => {
    await expect(locate()).toBeEnabled(); const before = await history();
    await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(expected);
    await expect.poll(() => editor().evaluate(element => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element)), selection = instance?.getSelection();
      if (!instance || !selection) return JSON.stringify({visible: false});
      const position = instance.getScrolledVisiblePosition(selection.getStartPosition()), layout = instance.getLayoutInfo();
      return JSON.stringify({visible: !!position && position.top >= 0 && position.top + position.height <= layout.height - layout.horizontalScrollbarHeight,
        position, editorHeight: layout.height, scrollbarHeight: layout.horizontalScrollbarHeight, scrollTop: instance.getScrollTop()});
    }), {message: '失败语句正文起点应完整显示在编辑区内'}).toContain('"visible":true');
    expect(await history()).toEqual(before); expect(await records()).toEqual([{id: 1}]);
  };
  const preciseLocate = async (start: number, expected: string) => {
    const before = await history(), model = await inspectModel();
    const lines = model.sql.slice(0, start + expected.length).split(/\r\n|\n/);
    await expect(precise()).toBeEnabled(); await precise().click();
    await expect.poll(inspectModel).toMatchObject({sql: model.sql, identity: model.identity, selected: expected,
      position: {lineNumber: lines.length, column: lines.at(-1)!.length + 1}});
    expect(await history()).toEqual(before); expect(await records()).toEqual([{id: 1}]);
  };
  try {
    await observer.query('CREATE TABLE public.failure_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 失败定位', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    const actual = (await inspectModel()).sql, firstEnd = actual.indexOf(';'), secondEnd = actual.indexOf(';', firstEnd + 1);
    await command('execute-all'); await expect(notice()).toContainText(partialText.position(2, 1));
    await expect(tab().locator('.postgres-results .rdg')).toContainText('id');
    await tab().getByLabel(queryLayoutZh.placement, {exact: true}).selectOption('results');
    await expect(editor()).toBeHidden(); await preciseLocate(actual.indexOf('missing_column'), 'm');
    await unchangedLocate(actual.slice(actual.indexOf('SELECT missing_column'), secondEnd)); await expect(editor()).toBeVisible();
    await page.screenshot({path: info.outputPath('PostgreSQL未完成语句定位.png')});
    await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(' '); await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(actual); await expect(locate()).toBeDisabled();
    await expect(precise()).toBeDisabled();
    await expect(openFailureDraft()).toBeDisabled();

    const selectedScript = "INSERT INTO public.failure_sentinel VALUES (3);\r\nSELECT '选区🧭' AS selected_ok;\r\nSELECT missing_column FROM public.failure_sentinel;\r\nINSERT INTO public.failure_sentinel VALUES (4);";
    await replaceDraft(selectedScript);
    const start = selectedScript.indexOf('SELECT'), failedStart = selectedScript.indexOf(';', start) + 1, end = selectedScript.indexOf(';', failedStart);
    await select(start, end + 1); await command('execute-selection');
    await expect(notice()).toContainText(partialText.position(2, 1));
    await preciseLocate(selectedScript.indexOf('missing_column'), 'm');
    await unchangedLocate(selectedScript.slice(failedStart, end).trimStart());
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    // 等待 BEGIN 已回执且原标签结束忙态，再投递下一条原生命令。
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await expect(tab().getByRole('button', {name: postgresZh.commit, exact: true})).toBeEnabled();
    await expect.poll(() => enabled('execute-selection')).toBe(true);
    await select(selectedScript.indexOf('missing_column'));
    // 收起选区还会更新原生菜单代次，等可用性同步后才点击原生菜单。
    await expect.poll(() => enabled('execute-selection')).toBe(false);
    await command('execute-current');
    await expect(notice()).toContainText(partialText.position(1, 0));
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.failedTransaction);
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const failedSession = await sessions(); expect(failedSession).toHaveLength(1); expect(failedSession[0].state).toBe('idle in transaction (aborted)');
    await preciseLocate(selectedScript.indexOf('missing_column'), 'm');
    await unchangedLocate(selectedScript.slice(failedStart, end).trimStart()); expect(await sessions()).toEqual(failedSession);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);

    const parameterSql = 'SELECT [$bad]::int AS parameter_failure;', secret = '参数失败不应留存😀';
    await replaceDraft(parameterSql); await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    await form.getByLabel(parameterZh.value + ' bad', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(notice()).toContainText(partialText.position(1, 0)); await expect(tab()).toContainText('SQLSTATE 22P02');
    await expect(precise()).toHaveCount(0);
    await unchangedLocate(parameterSql.slice(0, -1));
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('settings.get', {})))).not.toContain(secret);

    const named = "SELECT '前导😀', [$diagnostic_long_name]::text, missing_column;";
    await replaceDraft(named); await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    await form.getByLabel(parameterZh.value + ' diagnostic_long_name', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(tab()).toContainText('SQLSTATE 42703'); await preciseLocate(named.indexOf('missing_column'), 'm');
    expect(JSON.stringify(await history())).not.toContain(secret);
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const beforeDraft = await settings(), beforeDraftHistory = await history(), beforeDraftSessions = await sessions();
    const sourceTab = beforeDraft.tabs.find(item => item.id === beforeDraft.activeTabId)!;
    const destination = page.getByRole('dialog', {name: queryDuplicateZh.targetAction, exact: true});
    await tab().getByRole('button', {name: resultNavText.open, exact: true}).click();
    const navigator = page.getByRole('dialog', {name: resultNavText.open, exact: true});
    await expect(navigator.getByRole('option')).toContainText(resultNavText.failedStatement(1));
    await navigator.getByRole('button', {name: queryDuplicateZh.failureStatement, exact: true}).click();
    await expect(navigator).toHaveCount(0);
    await destination.getByLabel(queryDuplicateZh.targetConnection, {exact: true}).selectOption(sourceTab.connectionId);
    await destination.getByRole('button', {name: queryDuplicateZh.targetOpen, exact: true}).click();
    await expect.poll(async () => {
      const current = await settings();
      return current.tabs.find(item => item.id === current.activeTabId);
    }).toMatchObject({sql: named.slice(0, -1), connectionId: sourceTab.connectionId});
    expect(JSON.stringify(await settings())).not.toContain(secret);
    expect(await history()).toEqual(beforeDraftHistory);
    expect(await sessions()).toEqual(beforeDraftSessions);
    await page.locator('.tab-strip').getByRole('button', {name: sourceTab.title, exact: true}).click();
    await expect.poll(async () => (await inspectModel()).sql).toBe(named);

    const internal = 'DO $$ BEGIN PERFORM internal_missing; END $$;';
    await replaceDraft(internal); await command('execute-all');
    await expect(tab()).toContainText('column "internal_missing" does not exist');
    await expect(precise()).toHaveCount(0);
    await unchangedLocate(internal.slice(0, -1));

    const unexpectedEnd = 'SELECT 1 +;';
    await replaceDraft(unexpectedEnd); await command('execute-all');
    await expect(tab()).toContainText('syntax error at end of input');
    await preciseLocate(unexpectedEnd.length - 1, '');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 参数显式暂存与填入保持原事务，忘记及正文撤销后不复活', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = 'SELECT $1::numeric(60,38) AS amount, $2::bytea AS bytes, $3::text AS note;',
    decimal = '0.12345678901234567890123456789012345678', secret = '仅本标签暂存😀';
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 参数暂存', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const sessions = async () => (await observer.query("SELECT pid,state,xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const original = await sessions(); expect(original).toHaveLength(1); expect(original[0].state).toBe('idle in transaction');
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    const value = (name: string) => form.getByLabel(parameterZh.value + ' ' + name, {exact: true});
    const fill = form.getByRole('button', {name: reuseText.fill, exact: true});
    const remember = form.getByRole('checkbox', {name: reuseText.remember, exact: true});
    const open = async () => {
      await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
      await expect(value('p1')).toBeVisible(); await expect(form.getByRole('button', {name: parameterZh.execute, exact: true})).toBeEnabled();
    };
    const close = () => form.getByRole('button', {name: zh.common.cancel, exact: true}).click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await open(); await expect(remember).not.toBeChecked(); await expect(fill).toBeDisabled();
    await expect(form.getByText(parameterZh.namesDynamic, {exact: true})).toHaveCount(0);
    await form.getByLabel(parameterZh.type + ' p1', {exact: true}).selectOption('decimal'); await value('p1').fill(decimal);
    await form.getByLabel(parameterZh.type + ' p2', {exact: true}).selectOption('binary'); await value('p2').fill('00f');
    await value('p3').fill(secret);
    const nameFilter = form.getByRole('searchbox', {name: parameterZh.findName, exact: true}), beforeFilterHistory = await history();
    await nameFilter.fill('P3');
    await expect(value('p2')).toHaveCount(0);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(value('p2')).toBeFocused(); await expect(form.getByRole('alert')).toContainText('偶数位十六进制');
    expect(await history()).toEqual(beforeFilterHistory);
    await value('p2').fill('00ff'); await nameFilter.fill('P3');
    await expect(value('p3')).toHaveValue(secret);
    await remember.check();
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg'); await expect(grid).toContainText(secret); await expect(grid).toContainText(decimal);
    await expect.poll(sessions).toEqual(original);
    const afterExecution = await history(); expect(afterExecution.some(entry => entry.sql === sql && entry.success)).toBe(true);
    await open(); await expect(fill).toBeEnabled(); await expect(remember).not.toBeChecked(); await expect(value('p1')).toHaveValue('');
    await fill.click(); await expect(value('p1')).toHaveValue(decimal); await expect(value('p2')).toHaveValue('00ff'); await expect(value('p3')).toHaveValue(secret);
    await expect(form.getByLabel(parameterZh.type + ' p1', {exact: true})).toHaveValue('decimal');
    await expect(form.getByLabel(parameterZh.type + ' p2', {exact: true})).toHaveValue('binary');
    expect(await history()).toEqual(afterExecution); await expect.poll(sessions).toEqual(original);
    await page.screenshot({path: info.outputPath('PostgreSQL参数显式填入.png')});
    await close(); await open(); await expect(fill).toBeEnabled(); await fill.click();
    await form.getByRole('button', {name: reuseText.forget, exact: true}).click();
    await expect(fill).toBeDisabled(); await expect(value('p3')).toHaveValue(secret);
    await remember.check(); await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect.poll(async () => (await history()).filter(entry => entry.sql === sql && entry.success).length)
      .toBe(afterExecution.filter(entry => entry.sql === sql && entry.success).length + 1);
    await open(); await expect(fill).toBeEnabled(); await close();
    await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(' ');
    await page.keyboard.press('ControlOrMeta+Z'); await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
    await open(); await expect(fill).toBeDisabled(); await expect(value('p3')).toHaveValue(''); await close();
    const persisted = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(persisted)).not.toContain(secret); expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    await expect.poll(sessions).toEqual(original);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

for (const parameterStyle of ['位置', '命名'] as const) test('PostgreSQL 完整导出按协议绑定' + parameterStyle + '参数并保留原会话及参数隐私', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 导出参数', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, 'SELECT 1 AS original;');
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect.poll(() => grid.innerText()).toContain('original');
    const result = await grid.innerText(), history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    const names = parameterStyle === '位置' ? ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] : ['id', 'amount', 'note', 'bytes', 'nil', 'max_rows'];
    const [id, amount, note, bytes, nil, limit] = names.map((name, index) => parameterStyle === '位置' ? '$' + (index + 1) : '[$' + name + ']');
    const literal = parameterStyle === '位置' ? '$6' : '[$max_rows]';
    const body = parameterStyle === '位置' ? ' $7 ' : ' [$body] ';
    const sql = 'SELECT ' + id + '::bigint AS id, ' + amount + '::numeric(60,38) AS amount, ' + note + '::text AS note, ' +
      bytes + '::bytea AS bytes, ' + nil + "::text AS nullable, '" + literal + "' AS literal, $$" + body +
      "$$ AS body, current_setting('transaction_isolation') AS isolation FROM generate_series(1,130) AS g WHERE g <= " +
      limit + '::int AND ' + id + '::bigint > 0;';
    const isolation = (await observer.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation;
    const value = "导出参数原文😀'; SELECT '文本内容\n第二行", decimal = '0.12345678901234567890123456789012345678';
    await replaceDraft(sql);
    await tab().getByRole('button', {name: fullExportText.open, exact: true}).click();
    const dialog = page.getByRole('dialog', {name: fullExportText.title, exact: true});
    await dialog.getByRole('button', {name: fullExportText.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    const values = [['integer', '9007199254740993'], ['decimal', decimal], ['text', value], ['binary', '00ff'], ['null', ''], ['integer', '129']] as const;
    const fillParameters = async () => {
      for (const [index, [type, value]] of values.entries()) {
        const name = names[index];
        await form.getByLabel(parameterZh.type + ' ' + name, {exact: true}).selectOption(type);
        if (type !== 'null') await form.getByLabel(parameterZh.value + ' ' + name, {exact: true}).fill(value);
      }
    };
    await fillParameters();
    await expect(form.getByLabel(parameterZh.name + ' 7', {exact: true})).toHaveCount(0);
    await form.getByRole('button', {name: fullExportText.applyParameters, exact: true}).click();
    await expect(dialog).toContainText(fullExportText.parameterCount(6));
    await dialog.getByLabel(zh.resultExport.format).selectOption('json');
    const path = info.outputPath('绑定参数完整结果.json');
    await mkdir(info.outputDir, {recursive: true});
    await desktop.evaluate(({dialog, BrowserWindow}, path) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes('json')))
          throw Error('拒绝本例范围外的文件选择');
        return {canceled: false, filePath: path};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePgParameterExportPicker: () => { dialog.showSaveDialog = original; }});
    }, path);
    await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await dialog.getByRole('button', {name: fullExportText.start, exact: true}).click();
    await expect(dialog.getByText(fullExportText.done(129), {exact: true})).toBeVisible();
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.results[0].rows).toEqual(Array.from({length: 129}, () => ({id: '9007199254740993', amount: decimal,
      note: value, bytes: {type: 'binary', base64: 'AP8='}, nullable: null, literal, body, isolation})));
    await page.screenshot({path: info.outputPath('PostgreSQL参数完整导出.png')});
    await dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    await expect.poll(sessions).toEqual(originalSessions);
    expect(await grid.innerText()).toBe(result);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    const persisted = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(persisted)).not.toContain('导出参数原文😀');
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain('导出参数原文😀');
    await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgParameterExportPicker(): void}).restorePgParameterExportPicker());
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    await fillParameters();
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(grid).toContainText(decimal);
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('history.list', {}))).some(entry => entry.sql === sql && entry.success)).toBe(true);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('history.list', {})))).not.toContain('导出参数原文😀');
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

for (const format of ['xlsx', 'json'] as const)
test(`PostgreSQL 完整查询${format === 'xlsx' ? '工作簿' : '多结果 JSON'}共用快照、命名参数并保护目标文件`, async ({}, info) => {
  const workbookFormat = format === 'xlsx';
  const outputKind = workbookFormat ? '工作簿' : '多结果 JSON';
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  test.setTimeout(90_000);
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    const relation = 'public.query_export_' + format;
    await observer.query(`CREATE TABLE ${relation} (id bigint PRIMARY KEY, note text);
      INSERT INTO ${relation} VALUES (9223372036854775807, '原快照');`);
    await prepare({id: '', name: '隔离 PostgreSQL 查询' + outputKind, dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, [
      'SELECT [$id]::bigint AS value, pg_advisory_xact_lock(62308915)::text AS barrier;',
      ...(workbookFormat ? [] : ['-- NAME: 月报/明细']),
      `SELECT id AS value, note AS value, decode('00ff','hex') AS bytes FROM ${relation} CROSS JOIN generate_series(1,205) AS g WHERE id=[$id]::bigint ORDER BY g;`,
      'SELECT [$last_note]::text AS note, [$id]::bigint AS id;',
      ...(workbookFormat ? [] : ['-- NAME: 空结果', 'SELECT 1 AS empty WHERE false;']),
    ].join('\n'));
    await mkdir(info.outputDir, {recursive: true});
    const output = info.outputPath(`PostgreSQL 完整查询${outputKind}.${format}`);
    await desktop.evaluate(({dialog, BrowserWindow}, {filePath, format}) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (++count > 4 || args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes(format)))
          throw Error('仅允许本例的导出文件选择器');
        return {canceled: false, filePath};
      }) as typeof original;
      Object.assign(globalThis, {restorePgQueryWorkbookPicker: () => { dialog.showSaveDialog = original; return count; }});
    }, {filePath: output, format});
    const modal = page.getByRole('dialog', {name: fullExportText.title, exact: true});
    const open = async () => {
      await tab().getByRole('button', {name: fullExportText.open, exact: true}).click();
      await modal.getByRole('combobox', {name: zh.resultExport.format, exact: true}).selectOption(format);
      await expect(modal.getByText(workbookFormat ? fullExportText.workbookHint : fullExportText.jsonHint, {exact: true})).toBeVisible();
    };
    const start = async () => {
      await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
      await expect(modal.getByRole('button', {name: basename(output), exact: true})).toBeVisible();
      await modal.getByRole('button', {name: fullExportText.start, exact: true}).click();
    };
    const close = () => modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    const waitForCursor = () => expect.poll(async () => Number((await observer.query(`SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory'`)).rows[0].n), {timeout: 8_000}).toBe(1);
    await open();
    await modal.getByRole('button', {name: fullExportText.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    await form.getByLabel(parameterZh.type + ' id', {exact: true}).selectOption('integer');
    await form.getByLabel(parameterZh.value + ' id', {exact: true}).fill('9223372036854775807');
    await form.getByLabel(parameterZh.value + ' last_note', {exact: true}).fill('只用于第三条查询');
    await form.getByRole('button', {name: fullExportText.applyParameters, exact: true}).click();
    await observer.query('SELECT pg_advisory_lock(62308915)');
    try {
      await start(); await waitForCursor();
      await observer.query(`UPDATE ${relation} SET note='并发已提交'`);
    } finally { await observer.query('SELECT pg_advisory_unlock(62308915)'); }
    await expect(modal.getByRole('status')).toContainText(fullExportText.done(207));
    if (workbookFormat) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(output);
      expect(workbook.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([['结果 1', 2], ['结果 2', 206], ['结果 3', 2]]);
      expect(workbook.worksheets[0].getCell('A2').text).toBe('9223372036854775807');
      expect(['A206', 'B1', 'B206', 'C206'].map(cell => workbook.worksheets[1].getCell(cell).text))
        .toEqual(['9223372036854775807', 'value [2]', '原快照', '\\B:AP8=']);
      expect(['A1', 'A2', 'B2'].map(cell => workbook.worksheets[2].getCell(cell).text))
        .toEqual(['note', '只用于第三条查询', '9223372036854775807']);
    } else {
      const json = JSON.parse(await readFile(output, 'utf8'));
      expect(json).toMatchObject({format: 'DBArk-query-results', version: 1});
      expect(json.results).toHaveLength(4);
      for (const [index, result] of json.results.entries())
        expect(result).toMatchObject({resultOrdinal: index + 1, statementOrdinal: index + 1, rowResultOrdinal: index + 1});
      expect(json.results[0].rows[0].value).toBe('9223372036854775807');
      expect(json.results[1].label).toBe('月报/明细');
      expect(json.results[1].rows).toEqual(Array.from({length: 205}, () => ({
        value: '9223372036854775807', 'value [2]': '原快照', bytes: {type: 'binary', base64: 'AP8='},
      })));
      expect(json.results[2].rows).toEqual([{note: '只用于第三条查询', id: '9223372036854775807'}]);
      expect(json.results[3]).toMatchObject({label: '空结果', columns: [{name: 'empty'}], rows: []});
    }
    await modal.screenshot({path: info.outputPath('PostgreSQL 完整查询' + outputKind + '.png')});
    const original = await readFile(output);

    await close();
    await replaceDraft(workbookFormat ? "SELECT '先完成'; SELECT repeat('x',32768)"
      : "SELECT '先完成', set_config('standard_conforming_strings','off',false); SELECT 2");
    await open(); await start();
    await expect(modal.getByRole('alert')).toContainText(workbookFormat ? '32767' : '字符串模式变化');
    expect(await readFile(output)).toEqual(original);

    await close();
    await replaceDraft(`SELECT '先完成'; WITH changed AS (UPDATE ${relation} SET note='意外修改' RETURNING id) SELECT id FROM changed`);
    await open(); await start();
    await expect(modal.getByRole('alert')).toBeVisible();
    expect(await readFile(output)).toEqual(original);
    expect((await observer.query(`SELECT note FROM ${relation}`)).rows[0].note).toBe('并发已提交');

    await close();
    await replaceDraft("SELECT '先完成'; SELECT pg_advisory_xact_lock(62308915)::text AS barrier;");
    await open();
    await observer.query('SELECT pg_advisory_lock(62308915)');
    try {
      await start(); await waitForCursor();
      await modal.getByRole('button', {name: zh.common.cancel, exact: true}).click();
      await expect(modal.getByRole('alert')).toBeVisible();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .some(task => task.kind === 'postgres.query.export' && task.status === 'cancelled'))).toBe(true);
    } finally { await observer.query('SELECT pg_advisory_unlock(62308915)'); }
    expect(await readFile(output)).toEqual(original);
    expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgQueryWorkbookPicker(): number})
      .restorePgQueryWorkbookPicker())).toBe(4);
  } finally { await observer.end(); }
});

test('PostgreSQL 完整查询导出分批保存 CSV、JSON 和 Excel 并保护原事务及目标文件', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query('CREATE SEQUENCE export_guard');
    const csv = info.outputPath('完整结果.csv'), json = info.outputPath('完整结果.json'), xlsx = info.outputPath('完整结果.xlsx');
    const insertFile = info.outputPath('完整结果.sql'), cancelledSql = info.outputPath('原文件.sql');
    const html = info.outputPath('完整结果.html'), cancelledHtml = info.outputPath('原文件.html');
    const xml = info.outputPath('完整结果.xml');
    const unchanged = info.outputPath('原文件.csv'), cancelledExcel = info.outputPath('原文件.xlsx');
    await mkdir(info.outputDir, {recursive: true});
    await writeFile(unchanged, '原文件哨兵');
    await writeFile(cancelledExcel, 'Excel 原文件哨兵');
    await writeFile(cancelledSql, 'SQL 原文件哨兵');
    await writeFile(cancelledHtml, 'HTML 原文件哨兵');
    await prepare({id: '', name: '隔离 PostgreSQL 查询导出', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '保留原结果' AS marker;");
    const execute = tab().getByRole('button', {name: postgresZh.execute, exact: true});
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await execute.click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect.poll(() => grid.innerText()).toContain('保留原结果');
    const original = await grid.innerText();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const baseline = await history();
    const sessions = () => observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user]);
    const owner = (await sessions()).rows;
    expect(owner).toHaveLength(1);
    expect(owner[0].state).toBe('idle in transaction');
    const recordXml = info.outputPath('完整查询记录属性.xml');
    const txt = info.outputPath('完整查询.txt');
    const output = [csv, csv, json, xlsx, html, xml, insertFile, unchanged, cancelledExcel, cancelledSql, cancelledHtml, recordXml, txt];
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const path = paths[count];
        if (!path || BrowserWindow.getAllWindows().length !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes(path.split('.').at(-1)!)))
          throw Error('拒绝本例范围外的文件选择');
        count++;
        return {canceled: false, filePath: path};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePgFullExportPicker: () => { dialog.showSaveDialog = original; return count; }});
    }, output);
    const dialog = page.getByRole('dialog', {name: fullExportText.title, exact: true});
    const open = () => tab().getByRole('button', {name: fullExportText.open, exact: true}).click();
    const close = () => dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    const start = async () => {
      await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
      await dialog.getByRole('button', {name: fullExportText.start, exact: true}).click();
    };
    const sql = "WITH data AS (SELECT g FROM generate_series(1,4099) AS g) SELECT 9007199254740993 + g AS id, 0.12345678901234567890::numeric(30,20) AS id, CASE WHEN g % 2 = 0 THEN NULL ELSE '行' || g END AS note, decode('00ff','hex') AS bytes FROM data ORDER BY g;";
    await replaceDraft("SELECT '选区以外';\n" + sql);
    await modelSelection(2, 1, sql.length + 1);
    await open();
    await expect(dialog.getByLabel(fullExportText.source)).toHaveText(sql);
    await dialog.getByLabel(csvExportZh.label).selectOption(';');
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.name, {exact: true}).fill('分号报表');
    await dialog.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(dialog.getByText(profileText.saved, {exact: true})).toBeVisible();
    await dialog.getByLabel(csvExportZh.label).selectOption(',');
    await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await expect(dialog.getByRole('button', {name: fullExportText.start, exact: true})).toBeEnabled();
    await dialog.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(dialog.getByLabel(csvExportZh.label)).toHaveValue(';');
    await expect(dialog.getByRole('button', {name: fullExportText.start, exact: true})).toBeDisabled();
    await dialog.getByText(profileText.title, {exact: true}).click();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const lines = (await readFile(csv, 'utf8')).split('\r\n');
    expect(lines[0]).toBe('id;id [2];note;bytes');
    expect(lines.slice(1, -1)).toEqual(Array.from({length: 4099}, (_, i) =>
      `${9007199254740994n + BigInt(i)};0.12345678901234567890;${i % 2 === 0 ? `行${i + 1}` : '\\N'};base64:AP8=`));
    await close();
    await replaceDraft("SELECT nextval('export_guard'); -- 前置🚢\n" + sql + "\nSELECT nextval('export_guard');");
    await modelSelection(2, 10);
    await tab().getByRole('button', {name: fullExportText.openCurrent, exact: true}).click();
    await expect(dialog.getByText(fullExportText.currentSource, {exact: true})).toBeVisible();
    await expect(dialog.getByLabel(fullExportText.source)).toContainText(sql);
    await expect(dialog.getByLabel(fullExportText.source)).not.toContainText("nextval('export_guard')");
    await dialog.getByLabel(zh.resultExport.format).selectOption('json');
    await dialog.getByLabel(zh.resultExport.encoding).selectOption('utf16le');
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const bytes = await readFile(json);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('fffe');
    const parsed = JSON.parse(bytes.toString('utf16le').slice(1));
    expect(parsed.results[0].rows).toEqual(Array.from({length: 4099}, (_, i) => ({id: String(9007199254740994n + BigInt(i)),
      'id [2]': '0.12345678901234567890', note: i % 2 === 0 ? `行${i + 1}` : null, bytes: {type: 'binary', base64: 'AP8='}})));
    await dialog.getByLabel(zh.resultExport.format).selectOption('xlsx');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toHaveValue('utf8');
    await expect(dialog.getByLabel(csvExportZh.label)).toHaveCount(0);
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const [sheet] = await listExcelSheets({filePath: xlsx});
    let rowIndex = 0;
    for await (const row of readExcelRows({filePath: xlsx, sheetId: sheet.id, protocol: 'dbark-v1'})) {
      expect(Object.keys(row)).toEqual(['id', 'id [2]', 'note', 'bytes']);
      expect(row).toEqual({id: String(9007199254740994n + BigInt(rowIndex)), 'id [2]': '0.12345678901234567890',
        note: rowIndex % 2 === 0 ? `行${rowIndex + 1}` : null, bytes: {type: 'binary', base64: 'AP8='}});
      rowIndex++;
    }
    expect(rowIndex).toBe(4099);
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询导出Excel.png')});
    await dialog.getByLabel(zh.resultExport.format).selectOption('html');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const webpage = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      const table = doc.querySelector('table')!;
      const body = table.tBodies[0];
      return {headers: [...table.querySelectorAll('th')].map(cell => cell.textContent), count: body.rows.length,
        last: [...body.rows[body.rows.length - 1].cells].map(cell => cell.textContent)};
    }, await readFile(html, 'utf8'));
    expect(webpage).toEqual({headers: ['id', 'id [2]', 'note', 'bytes'], count: 4099,
      last: ['9007199254745092', '0.12345678901234567890', '行4099', 'base64:AP8=']});
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询HTML.png')});
    await dialog.getByLabel(zh.resultExport.format).selectOption('xml');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const xmlResult = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'application/xml');
      const records = doc.querySelectorAll('record');
      return {root: doc.documentElement.localName, headers: [...doc.querySelectorAll('column')].map(column => column.textContent),
        count: records.length, last: [...records[records.length - 1].children].map(cell => cell.textContent)};
    }, await readFile(xml, 'utf8'));
    expect(xmlResult).toEqual({root: 'tabrelio-data', headers: ['id', 'id', 'note', 'bytes'], count: 4099,
      last: ['9007199254745092', '0.12345678901234567890', '行4099', 'AP8=']});
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询XML.png')});
    await dialog.getByLabel(zh.resultExport.format).selectOption('sql');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await expect(dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true})).toBeDisabled();
    await dialog.getByLabel(fullExportText.insertDatabase, {exact: true}).fill('回放"模式');
    await dialog.getByLabel(fullExportText.insertTable, {exact: true}).fill('导出结果');
    await dialog.getByLabel(fullExportText.insertColumns, {exact: true}).fill('exact_id\nexact_amount\nnote\nbytes');
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.name, {exact: true}).fill('回放列映射');
    await dialog.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(dialog.getByText(profileText.saved, {exact: true})).toBeVisible();
    await close();
    await modelSelection(2, 10);
    await tab().getByRole('button', {name: fullExportText.openCurrent, exact: true}).click();
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.select, {exact: true}).selectOption('回放列映射');
    await dialog.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(dialog.getByLabel(fullExportText.insertDatabase, {exact: true})).toHaveValue('回放"模式');
    await expect(dialog.getByLabel(fullExportText.insertColumns, {exact: true})).toHaveValue('exact_id\nexact_amount\nnote\nbytes');
    await dialog.getByRole('button', {name: profileText.update, exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询导出方案.png')});
    await dialog.getByText(profileText.title, {exact: true}).click();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const generated = await readFile(insertFile, 'utf8');
    expect(generated).toContain('INSERT INTO "回放""模式"."导出结果" ("exact_id", "exact_amount", "note", "bytes")');
    expect(generated).toContain("pg_catalog.set_config(E'DateStyle'");
    expect(generated).not.toContain("nextval('export_guard')");
    await observer.query('CREATE SCHEMA "回放""模式"; CREATE TABLE "回放""模式"."导出结果"(exact_id bigint, exact_amount numeric(30,20), note text, bytes bytea)');
    const beforeSettings = (await observer.query('SHOW DateStyle')).rows;
    await observer.query(generated);
    expect((await observer.query('SHOW DateStyle')).rows).toEqual(beforeSettings);
    const restored = await observer.query(`SELECT exact_id AS id, exact_amount AS "id [2]", note, encode(bytes, 'hex') AS bytes FROM "回放""模式"."导出结果" ORDER BY exact_id`);
    expect(restored.rows).toEqual(parsed.results[0].rows.map((row: {bytes: unknown}) => ({...row, bytes: '00ff'})));
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询INSERT.png')});
    await close();

    await replaceDraft("SELECT nextval('export_guard');");
    await open(); await start();
    await expect(dialog.locator('.error-box')).toContainText(/read.only|只读/i);
    expect(await readFile(unchanged, 'utf8')).toBe('原文件哨兵');
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await close();

    await replaceDraft("SELECT g, CASE WHEN g > 64 THEN pg_sleep(30)::text ELSE '' END AS delay FROM generate_series(1,65) AS g;");
    for (const [format, filename, previous] of [
      ['xlsx', cancelledExcel, 'Excel 原文件哨兵'],
      ['sql', cancelledSql, 'SQL 原文件哨兵'],
      ['html', cancelledHtml, 'HTML 原文件哨兵'],
    ]) {
      await open();
      await dialog.getByLabel(zh.resultExport.format).selectOption(format);
      if (format === 'sql') await dialog.getByLabel(fullExportText.insertTable, {exact: true}).fill('cancelled_export');
      await start();
      // 暂存已存在，且真实后端进入下一批 FETCH 时取消。
      await expect.poll(async () => (await readdir(info.outputDir)).some(name => name.startsWith(basename(filename) + '.dbark-') && name.endsWith('.partial'))).toBe(true);
      await expect.poll(async () => (await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename=$1 AND state='active' AND query LIKE 'FETCH FORWARD 64 FROM dbark_query_export%'", [user])).rows[0].count).toBe(1);
      await dialog.getByRole('button', {name: zh.common.cancel, exact: true}).click();
      await expect(dialog.locator('.error-box')).toContainText(/取消|cancel/i);
      expect(await readFile(filename, 'utf8')).toBe(previous);
      expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
      await close();
    }
    await replaceDraft(sql.replace('numeric(30,20) AS id', 'numeric(30,20) AS amount'));
    await open();
    await dialog.getByLabel(zh.resultExport.format).selectOption('xml-attributes');
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const recordResult = await page.evaluate(markup => {
      const root = new DOMParser().parseFromString(markup, 'application/xml').documentElement;
      const record = root.lastElementChild!;
      return {root: root.localName, count: root.childElementCount, last: [...record.attributes].map(field => [field.name, field.value])};
    }, await readFile(recordXml, 'utf8'));
    expect(recordResult).toEqual({root: 'RECORDS', count: 4099,
      last: [['id', '9007199254745092'], ['amount', '0.12345678901234567890'], ['note', '行4099'], ['bytes', 'AP8=']]});
    await close();
    await open();
    await dialog.getByLabel(zh.resultExport.format).selectOption('txt');
    await dialog.getByLabel(zh.resultExport.encoding).selectOption('utf16le');
    await dialog.getByLabel(txtImportZh.delimiter, {exact: true}).selectOption('|');
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const txtBytes = await readFile(txt);
    expect(txtBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    const txtRows = parseTxt(txtBytes.toString('utf16le'), {bom: true, delimiter: '|'}) as string[][];
    expect(txtRows.shift()).toEqual(['id', 'amount', 'note', 'bytes']);
    expect(txtRows).toHaveLength(4099);
    expect(txtRows[1][2]).toBe('\\N');
    expect(txtRows.at(-1)).toEqual(['9007199254745092', '0.12345678901234567890', '行4099', 'base64:AP8=']);
    await dialog.screenshot({path: info.outputPath('PostgreSQL完整查询TXT.png')});
    await close();
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgFullExportPicker(): number}).restorePgFullExportPicker())).toBe(13);
    await expect.poll(async () => (await sessions()).rows).toEqual(owner);
    expect(await history()).toEqual(baseline);
    expect(await grid.innerText()).toBe(original);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 命名结果按实际执行语句区分并随固定结果保留', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const sql = [
    '/*NAME: 不显示的事务回执 */ BEGIN;',
    '/* 前导 /*NAME: 忽略内层 */ 注释 */',
    '--NAME: 月度汇总😀',
    'SELECT 9007199254740993 AS id;',
    '/*NAME: 月度汇总😀 */ SELECT 9007199254740994 AS id;',
    'SELECT $$/*NAME: 字符串内容 */;$$ AS note;',
  ].join('\n');
  await prepare({id: '', name: '隔离 PostgreSQL 命名结果', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
  const execute = tab().getByRole('button', {name: postgresZh.execute, exact: true});
  const picker = tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const grid = tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  await execute.click();
  await expect(picker.getByRole('option')).toHaveText([
    '1 · BEGIN · 0 行', '2 · 月度汇总😀 · SELECT · 1 行', '3 · 月度汇总😀 · SELECT · 1 行', '4 · SELECT · 1 行',
  ]);
  await picker.selectOption('1');
  await expect(grid).toContainText('9007199254740993');
  await picker.selectOption('2');
  await expect(grid).toContainText('9007199254740994');
  await expect(grid).not.toContainText('9007199254740993');
  await page.screenshot({path: info.outputPath('PostgreSQL命名结果.png')});
  const baseline = await history();
  const next = '/*NAME: 本次单组😀 */ SELECT 7 AS latest;';
  await replaceDraft(next);
  await expect(picker.locator('option:checked')).toHaveText('3 · 月度汇总😀 · SELECT · 1 行');
  await tab().getByRole('button', {name: zh.query.pinResult, exact: true}).click();
  const pinned = tab().getByRole('button', {name: '固定 1 · 月度汇总😀', exact: true});
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  expect(await history()).toEqual(baseline);

  await modelSelection(1, next.indexOf('SELECT') + 1);
  await tab().getByRole('button', {name: postgresZh.current, exact: true}).click();
  await expect(tab().locator('.postgres-result-name')).toHaveText('本次单组😀');
  await expect(grid).toContainText('latest');
  await pinned.click();
  await expect(grid).toContainText('9007199254740994');
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  const rollback = tab().getByRole('button', {name: postgresZh.rollback, exact: true});
  await rollback.click();
  await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
  await expect(rollback).toBeDisabled();
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

async function resizeQueryWindow(width: number, height: number, zoom = 1) {
  await desktop.evaluate(({BrowserWindow}, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(Math.round(720 * size.zoom), Math.round(320 * size.zoom));
    window.webContents.setZoomFactor(size.zoom);
    window.setContentSize(Math.round(size.width * size.zoom), Math.round(size.height * size.zoom));
  }, {width, height, zoom});
}

test('PostgreSQL 查询布局支持原生拖动、键盘和窄窗回退并保留草稿', async ({}, info) => {
  const original = "SELECT 1;\nSELECT '原草稿😀';";
  await prepare({id: '', name: '离线 PostgreSQL 布局', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, original);
  // 在较小的原生屏幕上也给实际分栏留足 CSS 像素，继续验证原高度和宽度。
  await resizeQueryWindow(1280, 1000, 0.7);
  const placement = tab().getByRole('combobox', {name: queryLayoutZh.placement, exact: true});
  const heightBar = tab().getByRole('separator', {name: queryLayoutZh.separator, exact: true});
  const widthBar = tab().getByRole('separator', {name: queryLayoutZh.widthSeparator, exact: true});
  const height = () => tab().locator('.postgres-editor').evaluate(node => Math.round(node.getBoundingClientRect().height));
  const width = () => tab().locator('.query-layout-editor').evaluate(node => Math.round(node.getBoundingClientRect().width));
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const saved = async () => (await settings()).tabs.find(item => item.id === 'pg-original');
  await expect(placement).toHaveValue('below');
  await expect.poll(height).toBe(300);
  const maximum = Number(await heightBar.getAttribute('aria-valuemax'));
  expect(maximum).toBeGreaterThanOrEqual(320);
  const draggedHeight = Math.min(360, maximum - 10), savedHeight = draggedHeight + 10;
  const identity = (await inspectModel()).identity;
  await modelSelection(2, original.split('\n')[1].length + 1);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original + ' ');
  const dragHeight = async (delta: number) => {
    const box = await heightBar.boundingBox(); if (!box) throw Error('缺少真实高度分隔条');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + delta, {steps: 4});
  };
  await dragHeight(50);
  await expect.poll(height).toBe(Math.min(350, maximum));
  expect((await saved())?.queryEditorHeight).toBeUndefined();
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(height).toBe(300);
  expect((await saved())?.queryEditorHeight).toBeUndefined();
  await dragHeight(draggedHeight - 300); await page.mouse.up();
  await expect.poll(async () => (await saved())?.queryEditorHeight).toBe(draggedHeight);
  await heightBar.focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await saved())?.queryEditorHeight).toBe(savedHeight);
  await placement.selectOption('beside');
  await expect(tab()).toHaveAttribute('data-result-layout', 'beside');
  await expect.poll(width).toBe(420);
  await widthBar.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await saved())?.queryEditorWidth).toBe(470);
  await expect.poll(width).toBe(470);
  await page.screenshot({path: info.outputPath('PostgreSQL查询左右布局.png')});

  await resizeQueryWindow(790, 500, 0.7);
  await expect(tab()).toHaveAttribute('data-result-layout', 'below');
  await expect(tab().getByText(queryLayoutZh.besideNarrow, {exact: true})).toBeVisible();
  await expect.poll(height).toBeLessThan(savedHeight);
  expect(await saved()).toMatchObject({queryResultPlacement: 'beside', queryEditorWidth: 470, queryEditorHeight: savedHeight});
  await resizeQueryWindow(1280, 1000, 0.7);
  await expect(tab()).toHaveAttribute('data-result-layout', 'beside');
  await expect.poll(width).toBe(470);
  await placement.selectOption('results');
  await expect(editor()).toBeHidden();
  await command('find');
  await expect(editor().locator('.find-widget')).toBeVisible();
  await expect(placement).toHaveValue('beside');
  await page.keyboard.press('Escape');
  await widthBar.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await saved())?.queryEditorWidth).toBe(460);
  expect((await inspectModel()).identity).toEqual(identity);
  expect((await inspectModel()).sql).toBe(original + ' ');
  await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  await expect.poll(async () => (await saved())?.sql).toBe(original);
  await placement.selectOption('results');
  await page.reload();
  await expect(placement).toHaveValue('beside');
  await expect.poll(width).toBe(460);
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  expect((await settings()).tabs.find(item => item.id === 'pg-other')).toMatchObject({sql: '-- 保留另一草稿'});
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 查询布局切换保留原结果勾选与活动事务', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE layout_source(id bigint PRIMARY KEY,note text); INSERT INTO layout_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE layout_source SET note='布局前未提交' RETURNING id,note,pg_backend_pid() AS session_id;";
    await prepare({id: '', name: '隔离 PostgreSQL 查询布局', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await resizeQueryWindow(1280, 820);
    const identity = (await inspectModel()).identity;
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg'), row = grid.locator('.rdg-row').filter({hasText: '9007199254740993'});
    await expect.poll(() => grid.innerText()).toContain('布局前未提交');
    await row.getByRole('checkbox').check();
    const result = await grid.innerText(), history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1); expect(originalSessions[0].state).toBe('idle in transaction');
    const placement = tab().getByRole('combobox', {name: queryLayoutZh.placement, exact: true});
    for (const layout of ['beside', 'results', 'below'] as const) {
      await placement.selectOption(layout);
      await expect(tab()).toHaveAttribute('data-result-layout', layout);
      await expect.poll(() => grid.innerText()).toBe(result);
      await expect(row.getByRole('checkbox')).toBeChecked();
      if (layout === 'beside') await page.screenshot({path: info.outputPath('PostgreSQL查询事务左右布局.png')});
    }
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await inspectModel()).sql).toBe(sql);
    expect(await sessions()).toEqual(originalSessions);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    expect((await observer.query('SELECT note FROM layout_source')).rows).toEqual([{note: '服务器原值'}]);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM layout_source')).rows).toEqual([{note: '服务器原值'}]);
    await replaceDraft('SELECT 9007199254740993 AS id;');
    await tab().getByRole('button', {name: postgresZh.explain, exact: true}).click();
    const plan = tab().locator('.postgres-results .explain-view');
    await expect(plan).toContainText('Result');
    await placement.selectOption('results');
    await expect(plan).toBeVisible();
    await expect(plan).toContainText('Result');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

async function triggerSuggestions() {
  await editor().evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance) throw Error('缺少当前 PostgreSQL 编辑器');
    instance.focus(); instance.trigger('keyboard', 'editor.action.triggerSuggest', {});
  });
}

test('PostgreSQL 名称补全插入用户原文和方言模板并保留一次撤销', async ({}, info) => {
  const name = 'pgQuick原文', sql = "-- 原样 $1 ${name}😀\n  SELECT 9007199254740993, 0.12345678901234567890;";
  // 在编辑器加载其片段缓存之前写入测试数据。
  await page.evaluate(({name, sql}) => window.dbark.invoke('snippets.save', {id: 'pg-completion', name, group: '离线', description: '', sql, updatedAt: ''}), {name, sql});
  await prepare({id: '', name: '离线 PostgreSQL 片段补全', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, 'SELECT 0;\n  ');
  await resizeQueryWindow(1280, 920, 0.75);
  await modelSelection(2, 3);
  await page.keyboard.type('pgQuick');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 10});
  await triggerSuggestions();
  const widget = () => page.locator('.suggest-widget.visible');
  await expect(widget().locator('.monaco-list-row.focused .label-name')).toHaveText(name);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT 0;\n  ' + sql);
  await expect(editor().locator('.view-lines')).toContainText('原样 $1 ${name}😀');
  await page.screenshot({path: info.outputPath('PostgreSQL片段名称补全.png')});
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT 0;\n  pgQuick');
  await replaceDraft('按条件');
  await triggerSuggestions();
  await expect(widget().locator('.monaco-list-row.focused .label-name')).toHaveText(zh.snippets.selectColumns);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT "id", "name"\nFROM "your_table"\nWHERE "id" > 0\nORDER BY "id"\nLIMIT 100;');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe('按条件');
  await triggerSuggestions();
  await expect(widget().locator('.monaco-list-row.focused .label-name')).toHaveText(zh.snippets.selectColumns);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await inspectModel()).selected).toBe('id');
  await page.keyboard.type('record_id');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await inspectModel()).selected).toBe('name');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT "record_id", "name"\nFROM "your_table"\nWHERE "record_id" > 0\nORDER BY "record_id"\nLIMIT 100;');
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 片段补全沿原会话字符串模式且保留事务和结果', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 片段补全', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, '');
    const snippet = "SELECT '$1 ${name}😀' AS literal;", name = 'pgQuick会话';
    await page.evaluate(({name, sql}) => window.dbark.invoke('snippets.save', {id: 'pg-mode-snippet', name, group: '', description: '', sql, updatedAt: ''}), {name, sql: snippet});
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    for (const mode of ['off', 'on'] as const) {
      await replaceDraft(`SELECT set_config('standard_conforming_strings','${mode}',true) AS mode;`);
      await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
      const grid = tab().locator('.postgres-results .rdg');
      // 先等可见网格完成布局，再用相同的innerText口径捕获前后结果。
      await expect.poll(() => grid.innerText()).toContain(mode);
      await expect(tab().getByRole('button', {name: postgresZh.execute, exact: true})).toBeEnabled();
      const result = await grid.innerText(), originalSessions = await sessions();
      expect(originalSessions).toHaveLength(1); expect(originalSessions[0].state).toBe('idle in transaction');
      const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
      // 尾部注释中的闭引号让输入桥不额外补引号，光标处在两种服务器模式下仍有相反归属。
      const source = "SELECT 'a\\';\npgQuick\n-- close '";
      await replaceDraft(source); await modelSelection(2, 8); await triggerSuggestions();
      const widget = page.locator('.suggest-widget.visible');
      if (mode === 'off') {
        await expect(widget).toContainText('No suggestions.');
        await expect(widget.locator('.label-name')).toHaveCount(0);
        await page.keyboard.press('Escape');
        expect((await inspectModel()).sql).toBe(source);
      } else {
        await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText(name);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await inspectModel()).sql).toBe("SELECT 'a\\';\n" + snippet + "\n-- close '");
        await page.keyboard.press('ControlOrMeta+Z');
        await expect.poll(async () => (await inspectModel()).sql).toBe(source);
      }
      expect(await grid.innerText()).toBe(result); expect(await sessions()).toEqual(originalSessions);
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    }
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(async () => (await sessions()).map(row => row.state)).toEqual(['idle']);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 片段库支持选区建片段、纯文本插入撤销及失效选区保护', async ({}, info) => {
  const snippet = "SELECT '片段😀', '$1', '${name}', 0.12345678901234567890;", name = 'PostgreSQL 原文片段';
  const original = `SELECT 0;\n${snippet}\nSELECT 9;`;
  const dialog = () => page.getByRole('dialog', {name: zh.snippets.title, exact: true});
  const choose = (name: string) => dialog().getByRole('button', {name: formatText(zh.snippets.selectName, name), exact: true});
  await prepare({id: '', name: '离线 PostgreSQL 片段', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, original);
  await modelSelection(2, 1, snippet.length + 1);
  await page.keyboard.press('Shift+F10');
  await page.locator('.monaco-menu-container:visible').getByRole('menuitem', {name: uiCommandLabels['sql-selection-to-snippet'], exact: true}).click({delay: 120});
  await expect(dialog().getByRole('textbox', {name: zh.snippets.sql, exact: true})).toHaveValue(snippet);
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  expect(await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).toEqual([]);
  await modelSelection(2, 1, snippet.length + 1);
  await command('sql-selection-to-snippet');
  await expect(dialog().getByRole('textbox', {name: zh.snippets.sql, exact: true})).toHaveValue(snippet);
  await dialog().getByLabel(zh.snippets.name, {exact: true}).fill(name);
  await dialog().getByRole('button', {name: zh.common.save, exact: true}).click();
  await expect(dialog().getByRole('button', {name: zh.snippets.edit, exact: true})).toBeVisible();
  const saved = await page.evaluate(() => window.dbark.invoke('snippets.list', {}));
  expect(saved).toMatchObject([{name, sql: snippet}]);
  await dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  expect((await inspectModel()).sql).toBe(original);

  const placeholder = 'PLACEHOLDER', before = `SELECT 0;\n${placeholder}\nSELECT 9;`;
  await replaceDraft(before);
  await modelSelection(2, 1, placeholder.length + 1);
  await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
  await choose(zh.snippets.selectColumns).click();
  await expect(dialog().locator('.snippet-details .view-lines')).toContainText('SELECT "id", "name"');
  await expect(dialog().getByRole('button', {name: zh.snippets.edit, exact: true})).toHaveCount(0);
  await choose(name).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await dialog().getByRole('button', {name: zh.snippets.insert, exact: true}).click();
  await expect(dialog()).toHaveCount(0);
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  await expect(editor().locator('.view-lines')).toContainText('片段😀');
  await page.screenshot({path: info.outputPath('PostgreSQL片段插入.png')});
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(before);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);

  await modelSelection(2, 1, snippet.length + 1);
  await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
  await choose(name).click();
  // 公开编辑器API模拟选区漂移及恢复，旧意图不能因回到相同选区而复活。
  await modelSelection(1, 1);
  await modelSelection(2, 1, snippet.length + 1);
  await dialog().getByRole('button', {name: zh.snippets.insert, exact: true}).click();
  await expect(dialog().getByText(zh.snippets.insertChanged, {exact: true})).toBeVisible();
  expect((await inspectModel()).sql).toBe(original);
  await dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  expect(await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).toEqual(saved);
  await modelSelection(2, 1, snippet.length + 1);
  await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
  await choose(zh.snippets.parameterName).click();
  await dialog().getByRole('button', {name: zh.snippets.insert, exact: true}).click();
  await expect(dialog()).toHaveCount(0);
  await expect(editor().getByRole('textbox')).toBeFocused();
  await expect.poll(async () => (await inspectModel()).selected).toBe('value');
  await page.keyboard.type('customer_id');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await inspectModel()).selected).toBe('result');
  await page.keyboard.type('customer');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT 0;\nSELECT [$customer_id] AS customer;\nSELECT 9;');
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 片段插入保留原事务、结果和会话且不自动执行', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE snippet_source(id bigint PRIMARY KEY,note text); INSERT INTO snippet_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE snippet_source SET note='片段前未提交事务' WHERE id=9007199254740993 RETURNING id,note,pg_backend_pid() AS session_id;";
    const snippet = "\nSELECT '$1'::text AS literal, '${name}'::text AS placeholder;";
    await prepare({id: '', name: '本轮隔离 PostgreSQL 片段', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await page.evaluate(sql => window.dbark.invoke('snippets.save', {id: 'pg-live-snippet', name: '实库原文片段', group: '', description: '', sql, updatedAt: ''}), snippet);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect(grid).toContainText('片段前未提交事务');
    await expect(tab().getByRole('button', {name: zh.snippets.title, exact: true})).toBeEnabled();
    const originalResult = await grid.innerText();
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    await modelSelection(1, sql.length + 1);
    await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
    const dialog = page.getByRole('dialog', {name: zh.snippets.title, exact: true});
    await dialog.getByRole('button', {name: formatText(zh.snippets.selectName, '实库原文片段'), exact: true}).click();
    await dialog.getByRole('button', {name: zh.snippets.insert, exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql + snippet);
    expect(await grid.innerText()).toBe(originalResult);
    expect(await sessions()).toEqual(originalSessions);
    expect((await observer.query('SELECT note FROM snippet_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    await editor().getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM snippet_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 复制查询保留当前全文和库，副本与保存来源及原撤销记录独立', async ({}, info) => {
  const name = '已保存 PostgreSQL 来源', savedSql = "SELECT '保存原文';";
  const draft = ["-- 当前完整草稿😀", "SELECT '0.12345678901234567890', '$1';"].join(process.platform === 'win32' ? '\r\n' : '\n');
  await prepare({id: '', name: '离线 PostgreSQL 复制', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'configured_database'}, savedSql);
  await page.evaluate(async ({name, sql}) => {
    const settings = await window.dbark.invoke('settings.get', {});
    const original = settings.tabs.find(tab => tab.id === 'pg-original');
    if (!original) throw Error('原查询缺失');
    const saved = await window.dbark.invoke('queries.create', {
      name, sql, connectionId: original.connectionId, context: {state: 'known', database: 'saved_database'},
    });
    await window.dbark.invoke('settings.save', {...settings, tabs: settings.tabs.map(tab => tab.id === original.id
      ? {...tab, title: name, database: 'saved_database', sourceBinding: saved.source, databaseContext: {state: 'known', database: 'saved_database'}} : tab)});
  }, {name, sql: savedSql});
  await page.reload();
  await expect(editor().getByRole('textbox')).toBeVisible();
  await replaceDraft(draft);
  // 先记录真实编辑器的一步撤销结果。输入桥可能保留多个原生撤销组，复制须保持同一基线。
  await page.keyboard.press('ControlOrMeta+Z');
  const undoBaseline = (await inspectModel()).sql;
  expect(undoBaseline).not.toBe(draft);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect.poll(async () => (await settings()).tabs.find(tab => tab.id === 'pg-original')?.sql).toBe(draft);
  const original = (await settings()).tabs.find(tab => tab.id === 'pg-original')!;
  const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  await tab().getByRole('button', {name: queryDuplicateZh.action, exact: true}).click();
  await expect.poll(async () => (await settings()).tabs.length).toBe(3);
  const copiedSettings = await settings(), copied = copiedSettings.tabs.find(tab => tab.id === copiedSettings.activeTabId)!;
  expect(copied).toMatchObject({kind: 'query', title: name + queryDuplicateZh.suffix, sql: draft,
    connectionId: original.connectionId, database: 'saved_database', databaseContext: {state: 'known', database: 'saved_database'}});
  expect(copied.id).not.toBe(original.id);
  expect(copied.sourceBinding).toBeUndefined();
  expect(copied.fileSourceBinding).toBeUndefined();
  expect(copiedSettings.tabs.find(tab => tab.id === original.id)).toEqual(original);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
  await expect(editor().locator('.view-lines')).toContainText('当前完整草稿');
  await page.screenshot({path: info.outputPath('PostgreSQL复制为新查询.png')});
  await replaceDraft("SELECT '仅修改副本';");
  await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name, exact: true}).click();
  expect((await inspectModel()).sql).toBe(draft);
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(undoBaseline);
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual(saved);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 复制查询保留原事务、结果和会话且副本不自动执行', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE duplicate_source(id bigint PRIMARY KEY,note text); INSERT INTO duplicate_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE duplicate_source SET note='原未提交事务' WHERE id=9007199254740993 RETURNING id,note,pg_backend_pid() AS session_id";
    await prepare({id: '', name: '本轮隔离 PostgreSQL 复制', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect(grid).toContainText('原未提交事务');
    await expect(tab().getByRole('button', {name: queryDuplicateZh.action, exact: true})).toBeEnabled();
    const originalResult = await grid.innerText();
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    await tab().getByRole('button', {name: queryDuplicateZh.action, exact: true}).click();
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    await expect(tab().locator('.postgres-results .rdg')).toHaveCount(0);
    expect((await inspectModel()).sql).toBe(sql);
    expect(await sessions()).toEqual(originalSessions);
    expect((await observer.query('SELECT note FROM duplicate_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name: '原 PostgreSQL 查询', exact: true}).click();
    await expect.poll(() => grid.innerText()).toBe(originalResult);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeDisabled();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM duplicate_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 查询结果 INSERT 文件预览、截断范围、勾选和真实回放', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const schema = '结果😀', fields = ['id', 'Value', 'value', 'bytes', 'nullable', 'stamp'];
  const table = (name: string) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const values = [
    ['9007199254740993', '0.12345678901234567890', "中'\\\n😀", Buffer.from([0, 255]), null, '2026-11-07 12:34:56.123456'],
    ['9007199254740994', '-9.87654321098765432100', '', Buffer.alloc(0), '', '2026-11-08 01:02:03.000004'],
    ['9007199254740995', '1', '超出已返回范围', Buffer.from([1]), '第三行', '2026-11-09 00:00:00'],
  ];
  const allFile = info.outputPath('已返回结果.sql'), selectedFile = info.outputPath('勾选结果.sql');
  try {
    await observer.query('CREATE SCHEMA ' + postgresIdentifier(schema));
    for (const name of ['source', 'all_rows', 'selected_rows'])
      await observer.query('CREATE TABLE ' + table(name) + ' (id bigint PRIMARY KEY, "Value" numeric(38,20), "value" text, bytes bytea, nullable text, stamp timestamp(6))');
    for (const row of values) await observer.query('INSERT INTO ' + table('source') + ' VALUES ($1,$2,$3,$4,$5,$6)', row);
    const sourceSql = 'SELECT id AS duplicate, "Value" AS duplicate, "value", bytes, nullable, stamp FROM ' + table('source') + ' ORDER BY id';
    await prepare({id: '', name: '本轮隔离 PostgreSQL 结果', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sourceSql);
    await page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', {...settings, resultLimit: 2});
    });
    await page.reload();
    await expect(editor().getByRole('textbox')).toBeVisible();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    await expect(tab().locator('.postgres-results .rdg')).toContainText('9007199254740994');
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (BrowserWindow.getAllWindows().length !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes('sql')) || !paths[count])
          throw Error('拒绝本例范围外的文件选择');
        return {canceled: false, filePath: paths[count++]};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePostgresResultSqlPicker: () => { dialog.showSaveDialog = original; return count; }});
    }, [allFile, selectedFile]);
    for (const [selected, target, path] of [[false, 'all_rows', allFile], [true, 'selected_rows', selectedFile]] as const) {
      if (selected) await tab().locator('.postgres-results .rdg-row').filter({hasText: '9007199254740994'}).getByRole('checkbox').check();
      await tab().getByRole('button', {name: selected ? zh.resultExport.selectedTitle : zh.resultExport.title, exact: true}).click();
      const dialog = page.getByRole('dialog', {name: selected ? zh.resultExport.selectedTitle : zh.resultExport.title, exact: true});
      await dialog.getByLabel(zh.resultExport.format).selectOption('sql');
      await expect(dialog.getByLabel(zh.resultExport.encoding)).toHaveValue('utf8');
      await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
      if (!selected) await expect(dialog).toContainText(zh.resultExport.truncated);
      await dialog.getByLabel(resultSqlZh.postgresDatabase).fill(schema);
      await dialog.getByLabel(resultSqlZh.table).fill(target);
      for (const [index, name] of fields.entries()) await dialog.getByLabel(resultSqlZh.column(index + 1)).fill(name);
      await dialog.getByRole('button', {name: resultSqlZh.preview, exact: true}).click();
      await expect(dialog.locator('.result-sql-preview')).toContainText('INSERT INTO ' + table(target));
      if (!selected) {
        await dialog.locator('.result-sql-preview').scrollIntoViewIfNeeded();
        await page.screenshot({path: info.outputPath('PostgreSQL查询结果SQL预览.png')});
      }
      await dialog.getByRole('button').filter({hasText: zh.resultExport.chooseFile}).click();
      await dialog.getByLabel(resultSqlZh.postgresConfirmation).fill(schema + '.' + target);
      await dialog.getByRole('checkbox', {name: resultSqlZh.acknowledge, exact: true}).check();
      await dialog.getByRole('button', {name: zh.resultExport.start, exact: true}).click();
      await expect(dialog.locator('.success-box')).toContainText('已导出 ' + (selected ? 1 : 2) + ' 行');
      const generated = await readFile(path, 'utf8');
      expect(generated).not.toContain('超出已返回范围');
      for (const mode of ['on', 'off']) {
        await observer.query('TRUNCATE ' + table(target));
        await observer.query('SET standard_conforming_strings = ' + mode);
        await observer.query(generated);
        const actual = (await observer.query('SELECT id::text, "Value"::text AS numeric, "value" AS note, encode(bytes, \'hex\') AS bytes, nullable, to_char(stamp, \'YYYY-MM-DD HH24:MI:SS.US\') AS stamp FROM ' + table(target) + ' ORDER BY id')).rows;
        const expected = (selected ? values.slice(1, 2) : values.slice(0, 2)).map(row => ({
          id: row[0], numeric: row[1], note: row[2], bytes: (row[3] as Buffer).toString('hex'), nullable: row[4], stamp: row[5],
        }));
        expect(actual).toEqual(expected);
      }
      await dialog.getByRole('button', {name: zh.common.done, exact: true}).click();
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePostgresResultSqlPicker(): number}).restorePostgresResultSqlPicker())).toBe(2);
    expect((await observer.query('SELECT count(*)::int AS n FROM ' + table('source'))).rows[0].n).toBe(3);
    expect(pageErrors).toEqual([]);
  } finally {
    await observer.end();
  }
  await quitDesktop();
});

test('PostgreSQL 方言着色跨行匹配 dollar 标签和嵌套注释', async ({}, info) => {
  const sql = [
    'SeLeCt $Body$第一行',
    '-- 字符串正文 $body$ /* 正文 */ $inner$',
    "末行$Body$ AS quoted, '同类字符串' AS sample, $1::bigint;",
    '/* 外层 /* 内层 */ 仍在外注释',
    '结束外注释 */ SELECT 42; -- 真注释',
  ].join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 着色', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel();
  expect(initial.language).toBe('dbark-postgresql');
  const colors = () => editor().locator('.view-lines').evaluate(node => {
    const lines = node.querySelectorAll('.view-line');
    return [
      [0, 'SeLeCt'], [1, '字符串正文'], [2, '同类字符串'], [3, '仍在外注释'], [4, 'SELECT'], [4, '真注释'],
    ].map(([index, text]) => {
      const span = Array.from(lines[Number(index)]?.querySelectorAll(':scope > span > span') ?? [])
        .find(part => part.textContent?.includes(String(text)));
      return span ? getComputedStyle(span).color : '';
    });
  });
  const correct = async () => {
    const [opening, body, literal, outer, following, comment] = await colors();
    return !!opening && !!literal && !!comment && opening === following && body === literal && outer === comment &&
      new Set([opening, literal, comment]).size === 3;
  };
  await expect.poll(correct).toBe(true);
  await page.screenshot({path: info.outputPath('PostgreSQL方言着色.png')});
  const broken = sql.replace('末行$Body$', '末行$body$');
  const tagColumn = '末行$'.length + 1;
  await modelSelection(3, tagColumn, tagColumn + 1);
  await page.keyboard.press('b');
  await expect.poll(async () => (await inspectModel()).sql).toBe(broken);
  await expect.poll(async () => {
    const [, body, , outer, , comment] = await colors();
    return !!body && body === outer && body === comment;
  }).toBe(true);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  await expect.poll(correct).toBe(true);
  expect((await inspectModel()).identity).toEqual(initial.identity);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线整组重命名投影列并保留物理字段和内层同名列', async ({}, info) => {
  const lines = ['WITH q(amount) AS (SELECT s.amount FROM ledger s),',
    '  copied AS (SELECT q.* FROM q)',
    'SELECT c.amount, (SELECT d.amount FROM (SELECT 2 AS amount) d) AS other_value',
    'FROM copied c', 'ORDER BY amount;'];
  const sql = lines.join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 投影改名', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel(), column = lines[2].indexOf('amount') + 3;
  const input = editor().locator('.rename-box input.rename-input');
  const enter = async (value: string) => {
    await modelSelection(3, column);
    await page.keyboard.press('F2');
    await expect(input).toHaveValue('amount');
    await input.fill(value);
    await input.press('Enter');
    await expect(input).not.toBeVisible();
  };
  await enter('other_value');
  await expect(tab().getByRole('status').filter({hasText: localRenameZh.collision})).toBeVisible();
  expect((await inspectModel()).sql).toBe(sql);

  await enter('total_usd');
  const expected = [lines[0].replace('q(amount)', 'q("total_usd")'), lines[1],
    lines[2].replace('c.amount', 'c."total_usd"'), lines[3], 'ORDER BY "total_usd";'].join('\n');
  await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
  await modelSelection(3, column);
  await page.keyboard.press('F12');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: lines[0].indexOf('amount') + 1});
  await page.screenshot({path: info.outputPath('PostgreSQL投影列成组改名.png'), animations: 'disabled'});
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  expect((await inspectModel()).identity).toEqual(initial.identity);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线定位整体 JOIN 和 USING AS 别名并独立改名', async ({}, info) => {
  const first = [
    'SELECT j.key, (SELECT j.id FROM (VALUES (8)) j(id)) AS retained',
    'FROM ((VALUES (4)) j(id) JOIN (VALUES (4)) r(id) ON j.id=r.id) AS j(key,other)',
    'WHERE j.key>0;',
  ];
  const second = [
    'WITH a(id,n) AS (VALUES (4,7)), b(id,m) AS (VALUES (4,9))',
    'SELECT id.id, a.n FROM a JOIN b USING (id) AS id',
    'WHERE id.id>0;',
  ];
  await prepare({id: '', name: '离线 PostgreSQL 连接别名', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, first.join('\n'));
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel(), input = editor().locator('.rename-box input.rename-input');
  const cases = [
    { lines: first, row: 1, original: 'j', name: 'whole_pair', changed: [
      first[0].replace('SELECT j.key', 'SELECT "whole_pair".key'),
      first[1].replace('AS j(key,other)', 'AS "whole_pair"(key,other)'),
      first[2].replace('j.key', '"whole_pair".key'),
    ] },
    { lines: second, row: 2, original: 'id', name: 'join_key', changed: [
      second[0],
      second[1].replace('SELECT id.id', 'SELECT "join_key".id').replace('AS id', 'AS "join_key"'),
      second[2].replace('id.id', '"join_key".id'),
    ] },
  ];
  for (const { lines, row, original, name, changed } of cases) {
    const sql = lines.join('\n'), column = lines[row - 1].indexOf('SELECT ') + 'SELECT '.length + 1;
    await replaceDraft(sql);
    await modelSelection(row, column);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({
      lineNumber: 2, column: lines[1].lastIndexOf('AS ' + original) + 'AS '.length + 1,
    });
    await page.keyboard.press('Shift+F12');
    const peek = editor().locator('.peekview-widget.reference-zone-widget');
    await expect(peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(peek).not.toBeVisible();
    await modelSelection(row, column);
    await page.keyboard.press('F2');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    await input.fill(name);
    await input.press('Enter');
    await expect(input).not.toBeVisible();
    await expect.poll(async () => (await inspectModel()).sql).toBe(changed.join('\n'));
    await page.screenshot({path: info.outputPath(name + '.png'), animations: 'disabled'});
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  }
  expect((await inspectModel()).identity).toEqual(initial.identity);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线命名窗口补全、定位声明和整组改名', async ({}, info) => {
  const lines = ['SELECT count(*) OVER buSuffix, count(*) OVER derived',
    'FROM (VALUES (1),(1),(2)) q(grp)', 'WINDOW bucket AS (PARTITION BY grp),', '  derived AS (bucket ORDER BY grp);'];
  const source = lines.join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 命名窗口', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, source);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel(), column = lines[0].indexOf('buSuffix') + 3;
  await modelSelection(1, column);
  await triggerSuggestions();
  const suggestion = tab().locator('.suggest-widget.visible .monaco-list-row.focused');
  await expect(suggestion.locator('.label-name')).toHaveText('bucket');
  await page.keyboard.press('Enter');
  const completed = source.replace('buSuffix', '"bucket"');
  await expect.poll(async () => (await inspectModel()).sql).toBe(completed);

  await modelSelection(1, column);
  await page.keyboard.press('F12');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 3, column: 8});
  await page.keyboard.press('Shift+F12');
  const peek = editor().locator('.peekview-widget.reference-zone-widget');
  await expect(peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(peek).not.toBeVisible();

  await modelSelection(1, column);
  await page.keyboard.press('F2');
  const input = editor().locator('.rename-box input.rename-input');
  await expect(input).toHaveValue('bucket');
  await input.fill('group_window');
  await input.press('Enter');
  const renamed = completed.replace('"bucket"', '"group_window"').replace('WINDOW bucket', 'WINDOW "group_window"')
    .replace('(bucket ORDER', '("group_window" ORDER');
  await expect.poll(async () => (await inspectModel()).sql).toBe(renamed);
  await page.screenshot({path: info.outputPath('PostgreSQL命名窗口改名.png'), animations: 'disabled'});
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(source);
  expect((await inspectModel()).identity).toEqual(initial.identity);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线语法检查定位原文并随草稿编辑清除标记', async ({}, info) => {
  const source = "SELECT '中文😀';\nSELECT [$needle], FROM t;";
  await prepare({id: '', name: '离线 PostgreSQL 语法检查', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, source);
  await resizeQueryWindow(1280, 920, 0.75);
  const panel = tab().getByRole('region', {name: postgresSyntaxCheckZh.title, exact: true});
  const markers = () => editor().evaluate((element, label) => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const model = api?.editor.getEditors().find(instance => instance.getContainerDomNode().contains(element))?.getModel();
    if (!api || !model) throw Error('语法检查的原模型不可用');
    return api.editor.getModelMarkers({resource: model.uri}).filter(marker => marker.source === label)
      .map(marker => [marker.startLineNumber, marker.startColumn, marker.endColumn]);
  }, postgresSyntaxCheckZh.title);
  const before = await inspectModel();
  await command('syntax-check');
  await expect(panel.getByRole('status')).toHaveText('1 ' + postgresSyntaxCheckZh.issues, {timeout: 12000});
  const expectedColumn = source.split('\n')[1].indexOf('FROM') + 1;
  expect(await markers()).toEqual([[2, expectedColumn, expectedColumn + 4]]);
  await panel.getByRole('list').getByRole('button').filter({hasText: postgresSyntaxCheckZh.position(2, expectedColumn)}).click();
  expect(await inspectModel()).toMatchObject({sql: source, identity: before.identity, selected: 'FROM'});
  await page.screenshot({path: info.outputPath('PostgreSQL本地语法定位.png'), animations: 'disabled'});
  const valid = source.replace('[$needle], FROM t', '[$needle]::int');
  await replaceDraft(valid);
  await expect(panel.getByRole('status')).toHaveText(postgresSyntaxCheckZh.reasons.stale);
  expect(await markers()).toEqual([]);
  await panel.getByRole('button', {name: postgresSyntaxCheckZh.recheck, exact: true}).click();
  await expect(panel.getByRole('status')).toHaveText(postgresSyntaxCheckZh.clean, {timeout: 12000});
  await panel.getByRole('button', {name: postgresSyntaxCheckZh.close, exact: true}).click();
  await expect(panel).toHaveCount(0);
  await tab().locator('.postgres-toolbar').getByRole('button', {name: postgresSyntaxCheckZh.entry, exact: true}).click();
  await expect(panel.getByRole('status')).toHaveText(postgresSyntaxCheckZh.clean, {timeout: 12000});
  expect(await inspectModel()).toMatchObject({sql: valid, identity: before.identity});
  const counts = await page.evaluate(async () => ({
    tasks: (await window.dbark.invoke('tasks.list', {})).length, history: (await window.dbark.invoke('history.list', {})).length,
  }));
  expect(counts).toEqual({tasks: 0, history: 0});
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线区分 GROUP BY 输入列和 ORDER BY 输出列', async ({}, info) => {
  const lines = ['WITH q AS (SELECT 1 AS bucket)', 'SELECT 2 AS bucket FROM q', 'GROUP BY bucket', 'ORDER BY bucket;'];
  const sql = lines.join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 分组列改名', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel();
  const input = editor().locator('.rename-box input.rename-input');
  for (const entry of [
    { referenceLine: 3, declarationLine: 1, name: 'source_bucket' },
    { referenceLine: 4, declarationLine: 2, name: 'shown_bucket' },
  ]) {
    const { referenceLine, declarationLine, name } = entry;
    const column = lines[referenceLine - 1].indexOf('bucket') + 3;
    await modelSelection(referenceLine, column);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({
      lineNumber: declarationLine, column: lines[declarationLine - 1].indexOf('bucket') + 1,
    });
    await modelSelection(referenceLine, column);
    await page.keyboard.press('F2');
    await expect(input).toHaveValue('bucket');
    await input.fill(name);
    await input.press('Enter');
    const expected = lines.map((line, index) => [referenceLine, declarationLine].includes(index + 1)
      ? line.replace('bucket', `"${name}"`) : line).join('\n');
    await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
    await page.screenshot({path: info.outputPath(`${name}.png`), animations: 'disabled'});
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  }
  expect((await inspectModel()).identity).toEqual(initial.identity);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 离线定位 CTE 列声明并高亮同一投影的引用', async ({}, info) => {
  const lines = ['WITH q AS (SELECT 1 AS amount),',
    '  copied AS (SELECT q.amount FROM q)',
    'SELECT c.amount, (SELECT d.amount FROM (SELECT 2 AS amount) d) AS other_value',
    'FROM copied c', 'ORDER BY amount;'];
  const sql = lines.join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 投影引用', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel(), column = lines[2].indexOf('amount') + 3;
  await modelSelection(3, column);
  await command('editor-local-references');
  await modelSelection(3, column);
  const rendered = editor().locator('.view-lines .view-line');
  await expect(rendered.nth(0).locator('.sql-local-declaration')).toHaveText('amount');
  for (const line of [1, 2, 4]) await expect(rendered.nth(line).locator('.sql-local-reference')).toHaveText('amount');
  await expect(editor().locator('.sql-local-declaration')).toHaveCount(1);
  await expect(editor().locator('.sql-local-reference')).toHaveCount(3);

  await page.keyboard.press('F12');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: lines[0].indexOf('amount') + 1});
  await page.keyboard.press('Shift+F12');
  const peek = editor().locator('.peekview-widget.reference-zone-widget');
  const rows = peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]');
  await expect(rows).toHaveCount(4);
  await expect(peek.locator('.ref-tree .monaco-list-row[aria-selected="true"]')).toHaveCount(1);
  await expect(rows.last()).toContainText('ORDER BY');
  await page.screenshot({path: info.outputPath('PostgreSQL投影字段引用.png'), animations: 'disabled'});
  await rows.last().dblclick();
  await expect(peek).not.toBeVisible();
  await expect.poll(async () => (await inspectModel()).position?.lineNumber).toBe(5);
  expect(await inspectModel()).toMatchObject({sql, selected: 'amount', identity: initial.identity});
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 命名参数离线补全已有名称并悬停查看引用次数', async ({}, info) => {
  const sql = ["SELECT [$needle], [$near], [$Needle], '[$never]';", 'SELECT [$near], ['].join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 参数补全', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  await modelSelection(2, sql.split('\n')[1].length + 1);
  await page.keyboard.press('$');
  const widget = tab().locator('.suggest-widget.visible');
  const labels = widget.locator('.monaco-list-row .label-name');
  await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText('[$near]');
  await expect(labels).toHaveText(['[$near]', '[$needle]', '[$Needle]']);
  await page.keyboard.press('n');
  await expect(labels).toHaveText(['[$near]', '[$needle]']);
  await page.keyboard.press('Enter');
  const completed = sql.slice(0, -1) + '[$near]';
  await expect.poll(async () => (await inspectModel()).sql).toBe(completed);

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ControlOrMeta+K');
  await page.keyboard.press('ControlOrMeta+I');
  const hover = tab().locator('.monaco-hover:visible');
  await expect(hover).toContainText(postgresZh.parameterEditor.title);
  await expect(hover).toContainText(postgresZh.parameterEditor.references(2, 3));
  await page.screenshot({path: info.outputPath('PostgreSQL命名参数悬停.png')});
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql + '$n');
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 命名参数离线跨语句高亮、跳转及一次撤销改名', async ({}, info) => {
  const sql = ["SELECT [$needle], '[$needle]', [$Needle];", '-- [$needle]',
    'SELECT [$needle] AS next_value, $$[$needle]$$;'].join('\n');
  await prepare({id: '', name: '离线 PostgreSQL 参数引用', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const initial = await inspectModel();
  await modelSelection(1, 10);
  await command('editor-local-references');
  await modelSelection(1, 10);
  const lines = editor().locator('.view-lines .view-line');
  for (const line of [0, 2]) await expect(lines.nth(line).locator('.sql-local-reference').first()).toBeVisible();
  await expect(lines.nth(1).locator('.sql-local-reference')).toHaveCount(0);
  await expect(editor().locator('.sql-local-declaration')).toHaveCount(0);

  await page.keyboard.press('Shift+F12');
  const peek = editor().locator('.peekview-widget.reference-zone-widget');
  const rows = peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]');
  await expect(peek).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(peek.locator('.ref-tree .monaco-list-row[aria-selected="true"]')).toHaveCount(1);
  await expect(rows.last()).toContainText('next_value');
  await page.screenshot({path: info.outputPath('PostgreSQL命名参数引用.png')});
  await rows.last().dblclick();
  await expect(peek).not.toBeVisible();
  await expect.poll(async () => (await inspectModel()).position?.lineNumber).toBe(3);
  expect((await inspectModel()).selected).toBe('[$needle]');

  const rename = editor().locator('.rename-box input.rename-input');
  const submitRename = async (name: string) => {
    await page.keyboard.press('F2');
    await expect(rename).toHaveValue('needle');
    await rename.fill(name);
    await rename.press('Enter');
    await expect(rename).not.toBeVisible();
  };
  await modelSelection(3, 10);
  await submitRename('Needle');
  await expect(tab().getByRole('status').filter({hasText: localRenameZh.parameterCollision})).toBeVisible();
  expect((await inspectModel()).sql).toBe(sql);
  await modelSelection(3, 10);
  await submitRename('new_name');
  const expected = ["SELECT [$new_name], '[$needle]', [$Needle];", '-- [$needle]',
    'SELECT [$new_name] AS next_value, $$[$needle]$$;'].join('\n');
  await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  expect((await inspectModel()).identity).toEqual(initial.identity);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 语句折叠离线保留标题和同行的下一条 SQL', async ({}, info) => {
  const sql = "SELECT 0;\n/* 外层 /* 内层; */ */\nDO $body$\nBEGIN\nPERFORM 42;\nEND;\n$body$; SELECT '相邻语句';";
  await prepare({id: '', name: '离线 PostgreSQL 折叠', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const expanded = editor().locator('.codicon-folding-expanded');
  const collapsed = editor().locator('.codicon-folding-collapsed');
  const lines = editor().locator('.view-lines');
  await modelSelection(3, 1);
  await expect(expanded).toHaveCount(0);
  await command('editor-sql-folding');
  await expect(expanded).toHaveCount(1);
  await expanded.click();
  await expect(lines).not.toContainText('PERFORM 42');
  await expect(lines).toContainText('DO $body$');
  await expect(lines).toContainText('外层');
  await expect(lines).toContainText('相邻语句');
  await page.screenshot({path: info.outputPath('PostgreSQL语句折叠.png')});
  await collapsed.click();
  await expect(lines).toContainText('PERFORM 42');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).editorSqlFolding).toBe(true);
  const nested = ['WITH', 'subject AS (', "SELECT $value$保留 ) 字面$value$ AS nested_value", '),',
    'adjacent AS (SELECT 22)', 'SELECT * FROM subject;'].join('\n');
  await replaceDraft(nested);
  await modelSelection(2, 1);
  await expect(expanded).toHaveCount(2);
  const point = await page.evaluate(() => {
    const monaco = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    const instance = monaco?.editor.getEditors().find(item => item.getContainerDomNode().closest('.postgres-query'));
    const position = instance?.getScrolledVisiblePosition({ lineNumber: 2, column: 1 }), host = instance?.getDomNode();
    if (!position || !host) throw Error('缺少原 PostgreSQL 第二行');
    const y = host.getBoundingClientRect().top + position.top + position.height / 2;
    const button = Array.from(host.querySelectorAll('.codicon-folding-expanded'), icon => icon.getBoundingClientRect())
      .find(rect => rect.top <= y && y < rect.bottom);
    if (!button) throw Error('缺少原 CTE 折叠按钮');
    return { x: button.left + button.width / 2, y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(lines).not.toContainText('nested_value');
  await expect(lines).toContainText('),');
  await expect(lines).toContainText('adjacent AS (SELECT 22)');
  await page.screenshot({path: info.outputPath('PostgreSQL子查询折叠.png')});
  await collapsed.click();
  await expect(lines).toContainText('nested_value');
  await expect.poll(async () => (await inspectModel()).sql).toBe(nested);
  await replaceDraft(ambiguousFoldingScript);
  await expect(expanded).toHaveCount(0);
  await command('editor-sql-folding');
  await expect(expanded).toHaveCount(0);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 语句折叠使用真实会话缓存更新范围', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const set = 'SET standard_conforming_strings = ';
  await page.addInitScript(source => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const request = message as {source?: string; dialect?: string; mode?: {noBackslashEscapes?: boolean}};
      if (request?.source === source && request.dialect === 'postgresql')
        (window as Window & {foldingMode?: boolean}).foldingMode = request.mode?.noBackslashEscapes;
      Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
  }, ambiguousFoldingScript);
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, set + 'off');
  const lines = editor().locator('.view-lines');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const originalModel = (await inspectModel()).identity;
  await command('editor-sql-folding');
  for (const mode of ['off', 'on'] as const) {
    if (mode === 'on') await replaceDraft(set + mode);
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === set + mode)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history();
    await replaceDraft(ambiguousFoldingScript);
    await expect.poll(async () => (await inspectModel()).language).toBe(mode === 'on' ? 'dbark-postgresql' : 'dbark-postgresql-backslash');
    expect((await inspectModel()).identity).toEqual(originalModel);
    const foldStart = mode === 'off' ? 1 : 2;
    await modelSelection(foldStart, 1);
    await expect.poll(() => page.evaluate(() => (window as Window & {foldingMode?: boolean}).foldingMode)).toBe(mode === 'on');
    const locate = () => editor().evaluate((element, line) => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const position = instance?.getScrolledVisiblePosition({lineNumber: line, column: 1});
      const root = instance?.getDomNode();
      if (!position || !root) return undefined;
      const y = root.getBoundingClientRect().top + position.top + position.height / 2;
      const rect = Array.from(root.querySelectorAll('.codicon-folding-expanded'), icon => icon.getBoundingClientRect())
        .find(bounds => bounds.top <= y && y < bounds.bottom);
      return rect && {x: rect.left + rect.width / 2, y};
    }, foldStart);
    await expect.poll(async () => !!await locate(), {message: '等待实际折叠首行 · ' + mode}).toBe(true);
    const clickPoint = await locate();
    if (!clickPoint) throw Error('折叠按钮在点击前失效');
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(editor().locator('.codicon-folding-collapsed')).toHaveCount(1);
    await expect(lines).not.toContainText('2;');
    if (mode === 'off') await expect(lines).not.toContainText('-- close');
    else await expect(lines).toContainText('-- close');
    await expect(lines).toContainText('SELECT 3;');
    expect((await inspectModel()).sql).toBe(ambiguousFoldingScript);
    expect(await history()).toEqual(baseline);
    await editor().locator('.codicon-folding-collapsed').click();
  }
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL JOIN USING 补全按原目录建议共有列并保留连接输出', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query('CREATE SCHEMA using_scope; ' +
      'CREATE TABLE public.using_left (raw_id int, region text, left_only text); ' +
      'CREATE TABLE public.using_right (id int, region text, right_only text); ' +
      'CREATE TABLE public.using_earlier (id int, right_decoy text); ' +
      'CREATE TABLE public.using_later (match_key int, right_later text); ' +
      'CREATE TABLE using_scope.using_left (scoped_key int, region text); ' +
      'CREATE TABLE using_scope.using_right (scoped_key int, region text); ' +
      "INSERT INTO public.using_left VALUES (4,'东','左'); INSERT INTO public.using_right VALUES (4,'东','右'); " +
      "INSERT INTO public.using_earlier VALUES (4,'早'); INSERT INTO public.using_later VALUES (4,'晚');");
    const sql = 'SELECT * FROM public.using_left l(id) JOIN public.using_right r USING (region, i_tail);';
    await prepare({id: '', name: '隔离 PostgreSQL 共有列', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, sql);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const identity = (await inspectModel()).identity;
    const accept = async (source: string, placeholder: string, name: string,
      {onlyColumn = true, prefixLength = 1, qualifier = ''} = {}) => {
      await replaceDraft(source);
      const baseline = await history();
      await modelSelection(1, source.indexOf(placeholder) + prefixLength + 1);
      await triggerSuggestions();
      const names = tab().locator('.suggest-widget.visible .monaco-list-row .label-name');
      if (onlyColumn) await expect(names).toHaveText([name]);
      else await expect(tab().locator('.suggest-widget.visible .monaco-list-row.focused .label-name')).toHaveText(name);
      await page.keyboard.press('Enter');
      const insertion = qualifier ? postgresIdentifier(qualifier) + '.' + postgresIdentifier(name) : postgresIdentifier(name);
      const expected = source.replace(placeholder, insertion);
      await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
      expect((await inspectModel()).identity).toEqual(identity);
      expect(await history()).toEqual(baseline);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(source);
      return expected;
    };
    const filled = await accept(sql, 'i_tail', 'id');
    expect((await observer.query({text: filled, rowMode: 'array'})).rows).toEqual([['东', 4, '左', '右']]);
    const joined = await accept('SELECT i_tail FROM public.using_left l(id) JOIN public.using_right r USING (id)', 'i_tail', 'id', {onlyColumn: false});
    expect(joined.startsWith('SELECT "id"')).toBe(true);
    expect((await observer.query({text: joined, rowMode: 'array'})).rows).toEqual([[4]]);
    const cte = await accept('WITH merged AS (SELECT * FROM public.using_left l(id) FULL JOIN public.using_right r USING (id)) ' +
      'SELECT q.r_tail FROM merged q("合并键")', 'r_tail', 'right_only');
    expect((await observer.query({text: cte, rowMode: 'array'})).rows).toEqual([['右']]);
    const alias = await accept('SELECT q.地_tail FROM (public.using_left NATURAL JOIN public.using_right) q("地区")', '地_tail', '地区');
    expect((await observer.query({text: alias, rowMode: 'array'})).rows).toEqual([['东']]);
    const keys = await accept('SELECT shared.i_tail FROM public.using_left l(id) JOIN public.using_right r USING (id) AS shared', 'i_tail', 'id');
    expect((await observer.query({text: keys, rowMode: 'array'})).rows).toEqual([[4]]);
    const conditionOptions = {prefixLength: 6, qualifier: 'r'};
    const condition = await accept('SELECT r.right_only FROM public.using_earlier e, public.using_left l(id) ' +
      "JOIN public.using_right r ON right_tail = '右' JOIN public.using_later c ON r.id=c.match_key", 'right_tail', 'right_only', conditionOptions);
    expect((await observer.query({text: condition, rowMode: 'array'})).rows).toEqual([['右']]);
    const mergedCondition = await accept('SELECT pair.right_only FROM public.using_earlier e, ' +
      '(public.using_left l(id) JOIN public.using_right r USING (id)) pair ' +
      'JOIN public.using_later c ON id_tail=c.match_key', 'id_tail', 'id', {onlyColumn: false, prefixLength: 2});
    expect((await observer.query({text: mergedCondition, rowMode: 'array'})).rows).toEqual([['右']]);
    await expect(observer.query(condition.replace('"r"."right_only"', 'e.right_decoy'))).rejects.toMatchObject({code: '42P01'});
    await expect(observer.query(condition.replace('"r"."right_only"', 'c.right_later'))).rejects.toMatchObject({code: '42P01'});
    const sources = 'public.using_left l(id) JOIN public.using_right r ON right_tail = \'右\' WHERE e.id=r.id';
    for (const statement of ['UPDATE public.using_earlier e SET right_decoy=r.right_only FROM ', 'DELETE FROM public.using_earlier e USING ']) {
      const completed = await accept(statement + sources, 'right_tail', 'right_only', conditionOptions);
      expect((await observer.query('EXPLAIN ' + completed)).rows.length).toBeGreaterThan(0);
      await expect(observer.query('EXPLAIN ' + completed.replace('"r"."right_only"', 'e.right_decoy'))).rejects.toMatchObject({code: '42P01'});
    }
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    const changeSession = async (statement: string) => {
      await replaceDraft(statement);
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === statement)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
    };
    await changeSession('SET search_path TO using_scope, public');
    await accept('SELECT * FROM using_left JOIN using_right USING (region, s_tail)', 's_tail', 'scoped_key');
    await changeSession('CREATE TEMP TABLE using_left (temp_key int); CREATE TEMP TABLE using_right (temp_key int)');
    const final = await accept('SELECT * FROM using_left JOIN using_right USING (t_tail)', 't_tail', 'temp_key');
    expect(final).toContain('"temp_key"');
    await page.screenshot({path: info.outputPath('PostgreSQL共有列真实目录.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 普通 RETURNING 补全前后行、来源及写入 CTE 的返回列', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL 18');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query('CREATE TABLE public.returning_items (id int PRIMARY KEY, qty int DEFAULT 0); ' +
      'INSERT INTO public.returning_items VALUES (1,3);');
    await prepare({id: '', name: '隔离 PostgreSQL 返回列补全', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, 'SELECT 1');
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const baseline = await history(), identity = (await inspectModel()).identity;
    const verify = async (source: string, placeholder: string, column: string, rows: unknown[][]) => {
      await replaceDraft(source);
      await modelSelection(1, source.indexOf(placeholder) + 2);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = source.replace(placeholder, postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect((await inspectModel()).identity).toEqual(identity);
      expect(await history()).toEqual(baseline);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(source);
      // 只在专用连接中执行验收 SQL，每条单独回滚，让下一条继续使用原始记录。
      await observer.query('BEGIN');
      try { expect((await observer.query({text: completed, rowMode: 'array'})).rows).toEqual(rows); }
      finally { await observer.query('ROLLBACK'); }
    };
    await verify('UPDATE public.returning_items item SET qty=qty+1 WHERE id=1 ' +
      'RETURNING WITH (OLD AS "旧行", NEW AS next_row) "旧行".q_tail AS prior, next_row.qty', 'q_tail', 'qty', [[3,4]]);
    await verify('INSERT INTO public.returning_items VALUES (1,9) ON CONFLICT (id) DO UPDATE SET qty=excluded.qty ' +
      'RETURNING old.q_tail, new.qty', 'q_tail', 'qty', [[3,9]]);
    await verify("DELETE FROM public.returning_items item USING (VALUES (1,'来源甲')) AS src(id,label) WHERE item.id=src.id " +
      'RETURNING WITH (OLD AS before) before.q_tail, src.label', 'q_tail', 'qty', [[3,'来源甲']]);
    await verify("WITH changed AS (UPDATE public.returning_items item SET qty=5 FROM (VALUES (1,'来源乙')) src(id, source_label) " +
      'WHERE item.id=src.id RETURNING *) SELECT changed.s_tail FROM changed', 's_tail', 'source_label', [['来源乙']]);
    expect((await observer.query({text: 'SELECT id,qty FROM public.returning_items', rowMode: 'array'})).rows).toEqual([[1,3]]);
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    await page.screenshot({path: info.outputPath('PostgreSQL返回列补全.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 冲突更新按真实会话的 SELECT 和 UPDATE 列权限补全', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.upsert_access (id int PRIMARY KEY, count_read int, count_write int, count_hidden int);
      INSERT INTO public.upsert_access VALUES (1,3,0,4);
      CREATE ROLE upsert_column_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO upsert_column_role;
      GRANT INSERT (id,count_read), SELECT (id,count_read), UPDATE (count_write) ON public.upsert_access TO upsert_column_role;`);
    const setRole = 'SET ROLE upsert_column_role';
    await prepare({id: '', name: '隔离 PostgreSQL 冲突更新补全', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, setRole);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === setRole)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, column: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf('count_tail') + 'count_'.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = draft.replace('count_tail', postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).identity).toEqual(identity);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const header = 'INSERT INTO public.upsert_access AS t (id,count_read) VALUES (1,9) ON CONFLICT (id) DO UPDATE SET ';
    const left = await accept(header + 'count_tail=excluded.count_read WHERE excluded.count_read>t.count_read', 'count_write');
    const right = await accept(left.replace('=excluded.count_read', '=excluded.count_tail'), 'count_read');
    const predicate = await accept(right.replace('WHERE excluded.count_read', 'WHERE excluded.count_tail'), 'count_read');
    // 独立连接用相同角色执行完整语句，验收后回滚以保留原行和权限状态。
    await observer.query('BEGIN');
    try {
      await observer.query('SET LOCAL ROLE upsert_column_role');
      expect((await observer.query(predicate)).rowCount).toBe(1);
      await observer.query('RESET ROLE');
      expect((await observer.query({text: 'SELECT * FROM public.upsert_access', rowMode: 'array'})).rows).toEqual([[1,3,9,4]]);
    } finally { await observer.query('ROLLBACK'); }
    expect((await observer.query({text: 'SELECT * FROM public.upsert_access', rowMode: 'array'})).rows).toEqual([[1,3,0,4]]);
    await page.screenshot({path: info.outputPath('PostgreSQL冲突更新列权限.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 普通 UPDATE 和 DELETE 按会话权限补全赋值、条件及返回列', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.assignment_items (id int PRIMARY KEY, count_read int, count_write int, amount_write int, vals int[]);
      CREATE TABLE public.assignment_feed (id int, count_source int, count_hidden int, slot_cursor int);
      INSERT INTO public.assignment_items VALUES (1,3,0,0,ARRAY[11,12]);
      INSERT INTO public.assignment_feed VALUES (1,9,30,2);
      CREATE ROLE assignment_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO assignment_role;
      GRANT SELECT (id,count_read,vals), UPDATE (count_write,amount_write,vals) ON public.assignment_items TO assignment_role;
      GRANT DELETE ON public.assignment_items TO assignment_role;
      GRANT SELECT (id,count_source,slot_cursor), UPDATE (count_hidden) ON public.assignment_feed TO assignment_role;`);
    const setRole = 'SET ROLE assignment_role';
    await prepare({id: '', name: '隔离 PostgreSQL UPDATE 补全', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, setRole);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === setRole)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, slot: string, prefix: string, column: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(slot) + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(slot, postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).identity).toEqual(identity);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const prefix = 'UPDATE ONLY (public.assignment_items) AS d SET ';
    const suffix = ' FROM public.assignment_feed s WHERE d.id=s.id';
    const left = await accept(prefix + 'count_tail=s.count_source' + suffix, 'count_tail', 'count_', 'count_write');
    const scalar = await accept(left.replace('s.count_source', 's.count_tail'), 'count_tail', 'count_', 'count_source');
    const tupleLeft = await accept(prefix + '(count_write, amount_tail)=(s.count_source, d.count_read)' + suffix,
      'amount_tail', 'amount_', 'amount_write');
    const tuple = await accept(tupleLeft.replace('d.count_read', 'd.count_tail'), 'count_tail', 'count_', 'count_read');
    const array = await accept(prefix + 'vals[s.slot_tail]=s.count_source' + suffix, 'slot_tail', 'slot_', 'slot_cursor');
    const update = await accept(scalar + ' AND d.count_tail=3 RETURNING new.count_read', 'count_tail', 'count_', 'count_read');
    const deletion = await accept('DELETE FROM ONLY (public.assignment_items) AS d USING public.assignment_feed s ' +
      'WHERE d.id=s.id AND EXISTS (SELECT 1 WHERE s.count_tail=9) RETURNING WITH (OLD AS before) before.count_tail',
      'count_tail', 'count_', 'count_source');
    const removed = await accept(deletion, 'count_tail', 'count_', 'count_read');
    const observe = 'SELECT count_read,count_write,amount_write,vals FROM public.assignment_items';
    for (const [sql, expected] of [[scalar, [[3,9,0,[11,12]]]], [tuple, [[3,9,3,[11,12]]]], [array, [[3,0,0,[11,9]]]]] as const) {
      await observer.query('BEGIN');
      try {
        await observer.query('SET LOCAL ROLE assignment_role');
        expect((await observer.query(sql)).rowCount).toBe(1);
        await observer.query('RESET ROLE');
        expect((await observer.query({text: observe, rowMode: 'array'})).rows).toEqual(expected);
      } finally { await observer.query('ROLLBACK'); }
    }
    for (const [sql, expected] of [[update, [[3,9,0,[11,12]]]], [removed, []]] as const) {
      await observer.query('BEGIN');
      try {
        await observer.query('SET LOCAL ROLE assignment_role');
        expect((await observer.query({text: sql, rowMode: 'array'})).rows).toEqual([[3]]);
        await observer.query('RESET ROLE');
        expect((await observer.query({text: observe, rowMode: 'array'})).rows).toEqual(expected);
      } finally { await observer.query('ROLLBACK'); }
    }
    expect((await observer.query({text: observe, rowMode: 'array'})).rows).toEqual([[3,0,0,[11,12]]]);
    await page.screenshot({path: info.outputPath('PostgreSQL-UPDATE赋值补全.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 时区值补全使用数据库目录并保留字面量边界', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("SET TIME ZONE 'UTC'");
    const startup = "SET TIME ZONE 'UTC'";
    await prepare({id: '', name: '隔离 PostgreSQL 时区目录', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, startup);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === startup)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, prefix: string, expected: string) => {
      const original = "'" + prefix + "tail'";
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(original) + prefix.length + 2);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([expected]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(original, "'" + expected + "'");
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const shifted = await accept("SELECT (TIMESTAMPTZ '2020-01-15 01:00:00+00' AT TIME ZONE 'America/New_Ytail')::text AS local_time",
      'America/New_Y', 'America/New_York');
    const truncated = await accept("SELECT pg_catalog.date_trunc('day', TIMESTAMPTZ '2020-07-01 03:00:00+00', 'Asia/Toktail')::text AS day_start",
      'Asia/Tok', 'Asia/Tokyo');
    const setting = await accept("SET LOCAL TIME ZONE 'Asia/Shangtail'", 'Asia/Shang', 'Asia/Shanghai');
    await replaceDraft(setting);
    await modelSelection(1, setting.indexOf('Asia/Shanghai') + 4);
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('ControlOrMeta+I');
    const hover = tab().locator('.monaco-hover:visible');
    for (const term of ['Asia/Shanghai', '查询时 UTC 偏移：UTC+08:00', '查询时使用夏令时：否']) await expect(hover).toContainText(term);
    await page.screenshot({path: info.outputPath('PostgreSQL-时区原生目录悬停.png'), animations: 'disabled'});
    await page.keyboard.press('Escape');
    expect(await history()).toEqual(baseline);
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await observer.query(shifted)).rows).toEqual([{local_time: '2020-01-14 20:00:00'}]);
    expect((await observer.query(shifted.replace('2020-01-15', '2020-07-15'))).rows).toEqual([{local_time: '2020-07-14 21:00:00'}]);
    expect((await observer.query(truncated)).rows).toEqual([{day_start: '2020-06-30 15:00:00+00'}]);
    await observer.query('BEGIN');
    try {
      await observer.query(setting);
      expect((await observer.query("SELECT current_setting('TimeZone') AS zone")).rows).toEqual([{zone: 'Asia/Shanghai'}]);
    } finally { await observer.query('ROLLBACK'); }
    expect((await observer.query("SELECT current_setting('TimeZone') AS zone")).rows).toEqual([{zone: 'UTC'}]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL COLLATE 按原会话解析同名规则并悬停目录信息', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA compare_binary;
      CREATE SCHEMA compare_ci;
      CREATE COLLATION compare_binary."SortRule" FROM pg_catalog."C";
      CREATE COLLATION compare_ci."SortRule" (provider=icu,locale='und-u-ks-level2',deterministic=false);
      CREATE TABLE public.collate_ui_rows (label text);
      INSERT INTO public.collate_ui_rows VALUES ('A'), ('a');`);
    const ciPath = 'SET search_path TO compare_ci, compare_binary, pg_catalog, public';
    const binaryPath = 'SET search_path TO compare_binary, compare_ci, pg_catalog, public';
    await prepare({id: '', name: '隔离 PostgreSQL 排序规则目录', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, ciPath);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const runPath = async (sql: string) => {
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === sql)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
    };
    const accept = async (draft: string, schema: string, explicit = false) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf('Sorttail') + 'Sort'.length + 1);
      await triggerSuggestions();
      const widget = tab().locator('.suggest-widget.visible');
      await expect(widget.locator('.monaco-list-row .label-name')).toHaveText(['SortRule']);
      await expect(widget).toContainText(schema);
      await page.keyboard.press('Enter');
      const name = postgresIdentifier('SortRule');
      const completed = draft.replace('"Sorttail"', explicit ? name : postgresIdentifier(schema) + '.' + name);
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    await runPath(ciPath);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const comparison = `SELECT 'a'::text = ('A'::text COLLATE "Sorttail") AS same`;
    const ci = await accept(comparison, 'compare_ci');
    const hoverSql = comparison.replace('Sorttail', 'SortRule');
    await replaceDraft(hoverSql);
    await modelSelection(1, hoverSql.indexOf('SortRule') + 3);
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('ControlOrMeta+I');
    const hover = tab().locator('.monaco-hover:visible');
    for (const term of ['"compare_ci"."SortRule"', 'ICU', '确定性：否', 'und-u-ks-level2']) await expect(hover).toContainText(term);
    await page.screenshot({path: info.outputPath('PostgreSQL-COLLATE目录悬停.png'), animations: 'disabled'});
    await page.keyboard.press('Escape');
    expect(await history()).toEqual(baseline);
    await replaceDraft(binaryPath);
    await runPath(binaryPath);
    const secondBaseline = await history();
    const binary = await accept(comparison, 'compare_binary');
    const index = await accept('CREATE INDEX collate_ui_idx ON public.collate_ui_rows (label COLLATE compare_ci."Sorttail")', 'compare_ci', true);
    expect(await history()).toEqual(secondBaseline);
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await observer.query(ci)).rows).toEqual([{same: true}]);
    expect((await observer.query(binary)).rows).toEqual([{same: false}]);
    await observer.query('BEGIN');
    try {
      await observer.query(index);
      const definition = await observer.query("SELECT pg_get_indexdef('public.collate_ui_idx'::regclass) AS sql");
      expect(definition.rows[0].sql).toContain('compare_ci."SortRule"');
    } finally { await observer.query('ROLLBACK'); }
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 递归 SEARCH 和 CYCLE 补全真实键并定位生成列', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.recursive_search_edges (node_id int PRIMARY KEY, next_id int);
      INSERT INTO public.recursive_search_edges VALUES (1,2), (2,1), (3,NULL);`);
    const warmup = 'SELECT 1 AS recursive_search_ready';
    await prepare({id: '', name: '隔离 PostgreSQL 递归键', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, warmup);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === warmup)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, prefix: string, name: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(prefix + 'tail') + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([name]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(prefix + 'tail', postgresIdentifier(name));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const header = 'WITH RECURSIVE walk AS (SELECT e.node_id,e.next_id FROM public.recursive_search_edges e WHERE e.node_id=1 ' +
      "UNION ALL SELECT n.node_id,n.next_id FROM public.recursive_search_edges n JOIN walk w ON n.node_id=w.next_id WHERE w.cycle_state='new') ";
    const tail = "SEARCH BREADTH FIRST BY node_tail SET visit_order CYCLE node_id SET cycle_state TO 'again' DEFAULT 'new' USING visit_path " +
      ', result AS (SELECT w.*,w.visit_order,w.cycle_state,w.visit_path FROM walk w) ' +
      'SELECT r.node_id,r.cycle_tail,cardinality(r.visit_path) AS depth FROM result r ORDER BY r.visit_order';
    const withKey = await accept(header + tail, 'node_', 'node_id');
    const completed = await accept(withKey, 'cycle_', 'cycle_state');
    const fromCatalog = await accept(header.replace('e.node_id,e.next_id', 'e.*') + tail.replace('cycle_tail', 'cycle_state'), 'node_', 'node_id');
    await replaceDraft(completed);
    await modelSelection(1, completed.lastIndexOf('cycle_state') + 2);
    await page.keyboard.press('F12');
    const cycleDeclaration = completed.indexOf('SET cycle_state') + 'SET '.length + 1;
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: cycleDeclaration});
    await page.keyboard.press('F2');
    const rename = editor().locator('.rename-box input.rename-input');
    await expect(rename).toHaveValue('cycle_state');
    await rename.fill('seen_again');
    await rename.press('Enter');
    const renamed = completed.replace('SET cycle_state', 'SET "seen_again"')
      .replaceAll('w.cycle_state', 'w."seen_again"').replace('r."cycle_state"', 'r."seen_again"');
    await expect.poll(async () => (await inspectModel()).sql).toBe(renamed);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
    expect(await history()).toEqual(baseline);
    expect((await inspectModel()).identity).toEqual(identity);
    const expected = [[1, 'new', 1], [2, 'new', 2], [1, 'again', 3]];
    for (const [label, sql] of [['显式投影', completed], ['目录展开', fromCatalog], ['生成列已改名', renamed]]) {
      await test.step(label, async () => {
        expect((await observer.query({text: sql, rowMode: 'array'})).rows).toEqual(expected);
      });
    }
    const cte = completed.slice(0, completed.indexOf(', result'));
    expect((await observer.query(cte + ' SELECT * FROM walk')).fields.map(field => field.name))
      .toEqual(['node_id', 'next_id', 'visit_order', 'cycle_state', 'visit_path']);
    expect((await observer.query(cte + ', nested_rows AS (SELECT w.* FROM walk w) SELECT * FROM nested_rows')).fields.map(field => field.name))
      .toEqual(['node_id', 'next_id']);
    await page.screenshot({path: info.outputPath('PostgreSQL-递归列原文定位.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL TABLESAMPLE 按原会话补全实际方法并保留字段导航', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.sample_method_rows (id int PRIMARY KEY);
      INSERT INTO public.sample_method_rows VALUES (1), (2), (3);
      CREATE SCHEMA sample_extension;
      CREATE FUNCTION sample_extension."SampleRows"(internal) RETURNS tsm_handler AS 'tsm_system_handler' LANGUAGE internal;
      CREATE FUNCTION sample_extension."SampleFake"(int) RETURNS int LANGUAGE SQL AS 'SELECT $1';`);
    const initialPath = 'SET search_path TO pg_catalog, public';
    const customPath = 'SET search_path TO sample_extension, pg_catalog, public';
    await prepare({id: '', name: '隔离 PostgreSQL 抽样方法目录', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, initialPath);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const runPath = async (sql: string) => {
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === sql)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
    };
    const accept = async (draft: string, prefix: string, name: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(prefix + 'tail') + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([name]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(prefix + 'tail', name);
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    await runPath(initialPath);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const prefix = 'SELECT j.id FROM public.sample_method_rows j TABLESAMPLE ';
    const suffix = ' (100) REPEATABLE (0.25) WHERE j.id > 0 ORDER BY j.id';
    const qualified = await accept(prefix + 'sample_extension."Sampletail"' + suffix, 'Sample', 'SampleRows');
    expect(await history()).toEqual(baseline);
    await replaceDraft(customPath);
    await runPath(customPath);
    const secondBaseline = await history();
    const visible = await accept(prefix + '"Sampletail"' + suffix, 'Sample', 'SampleRows');
    await replaceDraft(visible);
    await modelSelection(1, 'SELECT '.length + 1);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: prefix.indexOf('j TABLESAMPLE') + 1});
    expect(await history()).toEqual(secondBaseline);
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await observer.query(qualified)).rows).toEqual([{id: 1}, {id: 2}, {id: 3}]);
    await observer.query(customPath);
    expect((await observer.query(visible)).rows).toEqual([{id: 1}, {id: 2}, {id: 3}]);
    await page.screenshot({path: info.outputPath('PostgreSQL-TABLESAMPLE目录和导航.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 行锁 OF 补全实际目标并定位分组连接中的别名', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const options = {host, port, user, password, database: user, connectionTimeoutMillis: 3000};
  const blocker = new Client(options), observer = new Client(options);
  await blocker.connect();
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.lock_claim_jobs (id int PRIMARY KEY);
      CREATE TABLE public.lock_claim_notes (id int PRIMARY KEY);
      INSERT INTO public.lock_claim_jobs VALUES (1), (2);
      INSERT INTO public.lock_claim_notes VALUES (1);`);
    const draft = 'SELECT pair.id FROM (public.lock_claim_jobs "Claim Jobs" ' +
      'LEFT JOIN public.lock_claim_notes "Claim Notes" USING (id)) pair ORDER BY pair.id FOR NO Ktail /* 模式 */ UPDATE OF "Cltail" SKtail LOCKED';
    await prepare({id: '', name: '离线 PostgreSQL 行锁目标', dialect: 'postgresql', group: '', color: '#123456',
      host, port: 1, user: 'offline', database: 'postgres'}, draft);
    await resizeQueryWindow(1280, 920, 0.75);
    const identity = (await inspectModel()).identity;
    const accept = async (source: string, prefix: string, label: string) => {
      await modelSelection(1, source.indexOf(prefix + 'tail') + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([label]);
      await page.keyboard.press('Enter');
      const filled = source.replace(prefix + 'tail', label);
      await expect.poll(async () => (await inspectModel()).sql).toBe(filled);
      return filled;
    };
    const strength = await accept(draft, 'K', 'KEY');
    const wait = await accept(strength, 'SK', 'SKIP');
    const sql = await accept(wait, 'Cl', 'Claim Jobs');
    await modelSelection(1, sql.lastIndexOf('Claim Jobs') + 2);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: sql.indexOf('"Claim Jobs"') + 1});
    await page.keyboard.press('F2');
    const rename = editor().locator('.rename-box input.rename-input');
    await expect(rename).toHaveValue('Claim Jobs');
    await rename.fill('Claim Rows');
    await rename.press('Enter');
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql.replaceAll('Claim Jobs', 'Claim Rows'));
    for (const expected of [sql, wait, strength, draft]) {
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
    }
    const noWaitDraft = sql.replace('SKIP LOCKED', 'Ntail');
    await replaceDraft(noWaitDraft);
    const noWait = await accept(noWaitDraft, 'N', 'NOWAIT');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(noWaitDraft);
    expect((await inspectModel()).identity).toEqual(identity);
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);

    await blocker.query('BEGIN');
    try {
      await blocker.query('SELECT id FROM public.lock_claim_jobs WHERE id=1 FOR UPDATE');
      await observer.query("SET statement_timeout='3s'");
      expect((await observer.query(sql)).rows).toEqual([{id: 2}]);
      await expect(observer.query(noWait)).rejects.toMatchObject({code: '55P03'});
    } finally { await blocker.query('ROLLBACK'); }
    expect((await observer.query(sql)).rows).toEqual([{id: 1}, {id: 2}]);
    await page.screenshot({path: info.outputPath('PostgreSQL-行锁目标导航.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all([observer.end(), blocker.end()]); }
  await quitDesktop();
});

test('PostgreSQL 从查询创建表和视图时补全正文与递归字段', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.create_query_source (data_value int);
      INSERT INTO public.create_query_source VALUES (7), (14);
      CREATE SCHEMA workflow_shadow;
      CREATE TABLE workflow_shadow."Walk" (node_shadow int);
      INSERT INTO workflow_shadow."Walk" VALUES (9);`);
    const searchPath = 'SET search_path TO workflow_shadow, public';
    await prepare({id: '', name: '隔离 PostgreSQL 创建查询', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, searchPath);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === searchPath)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, prefix: string, column: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(prefix + 'tail') + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(prefix + 'tail', postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const source = 'SELECT s.data_tail FROM public.create_query_source s';
    const table = await accept(`CREATE TEMP TABLE query_stage (result_value) USING heap ON COMMIT PRESERVE ROWS AS ${source} WITH NO DATA`,
      'data_', 'data_value');
    const view = await accept(`CREATE OR REPLACE VIEW public.query_view (result_value) WITH (security_invoker=true) AS ${source} WHERE s.data_value>8 WITH LOCAL CHECK OPTION`,
      'data_', 'data_value');
    const materialized = await accept(`CREATE MATERIALIZED VIEW public.query_materialized (result_value) AS (${source}) WITH NO DATA`,
      'data_', 'data_value');
    const plan = await accept(`EXPLAIN (FORMAT JSON) CREATE TEMP TABLE query_plan_only AS ${source}`, 'data_', 'data_value');
    const recursive = await accept('CREATE RECURSIVE VIEW public."Walk" (node_number) AS SELECT 1 AS seed_number ' +
      'UNION ALL SELECT w.node_tail+1 FROM "Walk" w WHERE w.node_number < 3', 'node_', 'node_number');
    await replaceDraft(recursive);
    await modelSelection(1, recursive.indexOf('FROM "Walk"') + 'FROM "'.length + 1);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: recursive.indexOf('"Walk"') + 1});
    expect(await history()).toEqual(baseline);
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await observer.query("SELECT to_regclass('public.query_view') AS view_oid, to_regclass('public.query_materialized') AS mat_oid")).rows)
      .toEqual([{view_oid: null, mat_oid: null}]);
    await observer.query('BEGIN');
    try {
      await observer.query(`SET LOCAL search_path TO workflow_shadow, public`);
      for (const sql of [table, view, materialized, recursive]) await observer.query(sql);
      expect((await observer.query('SELECT * FROM query_stage')).rows).toEqual([]);
      expect((await observer.query('SELECT * FROM public.query_view')).rows).toEqual([{result_value: 14}]);
      expect((await observer.query("SELECT relispopulated FROM pg_class WHERE oid='public.query_materialized'::regclass")).rows)
        .toEqual([{relispopulated: false}]);
      await observer.query('REFRESH MATERIALIZED VIEW public.query_materialized');
      expect((await observer.query('SELECT * FROM public.query_materialized ORDER BY result_value')).rows).toEqual([{result_value: 7}, {result_value: 14}]);
      expect((await observer.query('SELECT * FROM public."Walk" ORDER BY node_number')).rows)
        .toEqual([{node_number: 1}, {node_number: 2}, {node_number: 3}]);
      expect((await observer.query(plan)).rows[0]['QUERY PLAN'][0].Plan['Relation Name']).toBe('create_query_source');
      expect((await observer.query("SELECT to_regclass('pg_temp.query_plan_only') AS plan_oid")).rows).toEqual([{plan_oid: null}]);
    } finally { await observer.query('ROLLBACK'); }
    await page.screenshot({path: info.outputPath('PostgreSQL-递归视图原文导航.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 包装语句复用正文补全、权限与原文导航', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.wrapped_query_rows (read_total int, target_read int, target_write int);
      INSERT INTO public.wrapped_query_rows VALUES (12,34,0);
      CREATE ROLE wrapped_query_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO wrapped_query_role;
      GRANT SELECT (read_total,target_read), UPDATE (target_write) ON public.wrapped_query_rows TO wrapped_query_role;`);
    const setRole = 'SET ROLE wrapped_query_role';
    await prepare({id: '', name: '隔离 PostgreSQL 包装语句', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, setRole);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === setRole)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, prefix: string, column: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(prefix + 'tail') + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(prefix + 'tail', postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const select = 'SELECT r.read_tail FROM public.wrapped_query_rows r';
    const plan = await accept('EXPLAIN (FORMAT JSON, ANALYZE FALSE) UPDATE public.wrapped_query_rows SET target_tail=9', 'target_', 'target_write');
    const prepared = await accept(`PREPARE wrapped_plan (integer) AS ${select} WHERE r.read_total > $1`, 'read_', 'read_total');
    const cursor = await accept(`DECLARE wrapped_cursor NO SCROLL CURSOR FOR ${select}`, 'read_', 'read_total');
    const copy = await accept(`COPY (${select}) TO STDOUT WITH (FORMAT CSV)`, 'read_', 'read_total');
    const local = `COPY (WITH copied AS (${select.replace('read_tail', 'read_total')}) SELECT * FROM copied) TO STDOUT`;
    await replaceDraft(local);
    await modelSelection(1, local.lastIndexOf('copied') + 2);
    await page.keyboard.press('F12');
    await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 1, column: local.indexOf('copied') + 1});
    expect(await history()).toEqual(baseline);
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await inspectModel()).sql).toBe(local);
    await observer.query(setRole);
    expect((await observer.query(plan)).rows[0]['QUERY PLAN'][0].Plan['Node Type']).toBe('ModifyTable');
    await observer.query(prepared);
    expect((await observer.query('EXECUTE wrapped_plan(11)')).rows).toEqual([{read_total: 12}]);
    await observer.query('DEALLOCATE wrapped_plan');
    await observer.query('BEGIN');
    try {
      await observer.query(cursor);
      expect((await observer.query('FETCH ALL FROM wrapped_cursor')).rows).toEqual([{read_total: 12}]);
    } finally { await observer.query('ROLLBACK'); }
    const chunks: Buffer[] = [];
    for await (const chunk of observer.query(copyTo(copy))) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe('12\n');
    await observer.query('RESET ROLE');
    expect((await observer.query('SELECT target_write FROM public.wrapped_query_rows')).rows).toEqual([{target_write: 0}]);
    await page.screenshot({path: info.outputPath('PostgreSQL-包装语句正文导航.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL MERGE 按原会话列权限补全条件和写入分支', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.merge_access_items (id int PRIMARY KEY, field_read int, field_update int, field_insert int);
      CREATE TABLE public.merge_access_feed (id int, field_source int, field_hidden int);
      INSERT INTO public.merge_access_items VALUES (1,3,0,0), (3,4,0,0);
      INSERT INTO public.merge_access_feed VALUES (1,9,30), (2,8,31);
      CREATE ROLE merge_access_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO merge_access_role;
      GRANT SELECT (id,field_read), UPDATE (field_update), INSERT (id,field_insert) ON public.merge_access_items TO merge_access_role;
      GRANT SELECT (id,field_source), UPDATE (field_hidden) ON public.merge_access_feed TO merge_access_role;`);
    const setRole = 'SET ROLE merge_access_role';
    await prepare({id: '', name: '隔离 PostgreSQL MERGE 分支', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, setRole);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === setRole)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, column: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf('field_tail') + 'field_'.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([column]);
      await page.keyboard.press('Enter');
      const completed = draft.replace('field_tail', postgresIdentifier(column));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).identity).toEqual(identity);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    let draft = 'MERGE INTO public.merge_access_items d USING public.merge_access_feed s ON d.id=s.id ' +
      'WHEN MATCHED AND s.field_tail>0 THEN UPDATE SET field_tail=s.field_source+d.field_tail ' +
      'WHEN NOT MATCHED BY TARGET THEN INSERT (id,field_tail) VALUES (s.id,s.field_source) ' +
      'WHEN NOT MATCHED BY SOURCE AND d.field_tail>0 THEN UPDATE SET field_update=d.field_read ' +
      'RETURNING merge_action(),new.id';
    for (const column of ['field_source', 'field_update', 'field_read', 'field_insert', 'field_read']) draft = await accept(draft, column);
    const inspect = 'SELECT id,field_read,field_update,field_insert FROM public.merge_access_items ORDER BY id';
    await observer.query('BEGIN');
    try {
      await observer.query('SET LOCAL ROLE merge_access_role');
      const done = await observer.query({text: draft, rowMode: 'array'});
      expect(done.rows.sort((left, right) => Number(left[1]) - Number(right[1]))).toEqual([['UPDATE',1], ['INSERT',2], ['UPDATE',3]]);
      await observer.query('RESET ROLE');
      expect((await observer.query({text: inspect, rowMode: 'array'})).rows).toEqual([[1,3,12,0], [2,null,null,8], [3,4,4,0]]);
    } finally { await observer.query('ROLLBACK'); }
    expect((await observer.query({text: inspect, rowMode: 'array'})).rows).toEqual([[1,3,0,0], [3,4,0,0]]);
    await page.screenshot({path: info.outputPath('PostgreSQL-MERGE分支权限.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL INSERT SELECT 隔离目标列权限和读取来源', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.insert_copy_dst (id int PRIMARY KEY, copy_value text, copy_readonly text DEFAULT '保留');
      CREATE TABLE public.insert_copy_src (id int, copy_value text);
      CREATE TABLE public.insert_copy_other (id int, copy_other text);
      INSERT INTO public.insert_copy_src VALUES (1,'甲');
      INSERT INTO public.insert_copy_other VALUES (2,'乙');
      CREATE ROLE insert_copy_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO insert_copy_role;
      GRANT INSERT (id,copy_value), SELECT (copy_readonly) ON public.insert_copy_dst TO insert_copy_role;
      GRANT SELECT ON public.insert_copy_src, public.insert_copy_other TO insert_copy_role;`);
    const setRole = 'SET ROLE insert_copy_role';
    await prepare({id: '', name: '隔离 PostgreSQL INSERT 来源', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, setRole);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === setRole)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const accept = async (draft: string, slot: string, prefix: string, name: string) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(slot) + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText([name]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(slot, postgresIdentifier(name));
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).identity).toEqual(identity);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const prefix = 'INSERT INTO public.insert_copy_dst AS dst (id, ';
    const target = await accept(prefix + 'copy_tail) SELECT src.id, src.copy_value FROM public.insert_copy_src src', 'copy_tail', 'copy_', 'copy_value');
    const first = await accept(target.replace('src.copy_value', 'copy_tail'), 'copy_tail', 'copy_', 'copy_value');
    const compound = await accept(first + ' UNION ALL SELECT alt.id, alt.copy_tail FROM public.insert_copy_other alt', 'copy_tail', 'copy_', 'copy_other');
    const table = await accept(prefix + 'copy_value) TABLE public.insert_copy_src_tail', 'insert_copy_src_tail', 'insert_copy_src', 'insert_copy_src');
    for (const [sql, rows] of [[compound, [[1,'甲','保留'], [2,'乙','保留']]], [table, [[1,'甲','保留']]]] as const) {
      await observer.query('BEGIN');
      try {
        await observer.query('SET LOCAL ROLE insert_copy_role');
        expect((await observer.query(sql)).rowCount).toBe(rows.length);
        await observer.query('RESET ROLE');
        expect((await observer.query({text: 'SELECT * FROM public.insert_copy_dst ORDER BY id', rowMode: 'array'})).rows).toEqual(rows);
      } finally { await observer.query('ROLLBACK'); }
    }
    expect((await observer.query('SELECT * FROM public.insert_copy_dst')).rows).toEqual([]);
    await page.screenshot({path: info.outputPath('PostgreSQL-INSERT来源补全.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 冲突目标按原会话补全复合键和可用约束', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    const path = 'SET search_path TO conflict_scope, public';
    await observer.query(`CREATE SCHEMA conflict_scope;
      CREATE TABLE public.arbiter_probe (legacy int PRIMARY KEY);
      CREATE TABLE conflict_scope.arbiter_probe (
        id int PRIMARY KEY, realm int, entry_code text, payload text, partial_key text, slow_key int, era int4range,
        CONSTRAINT "Pair ""键""" UNIQUE (realm,entry_code) INCLUDE (payload),
        CONSTRAINT slow_constraint UNIQUE (slow_key) DEFERRABLE INITIALLY IMMEDIATE,
        CONSTRAINT range_guard EXCLUDE USING gist (era WITH &&));
      CREATE UNIQUE INDEX immediate_slow ON conflict_scope.arbiter_probe (slow_key);
      CREATE UNIQUE INDEX only_some ON conflict_scope.arbiter_probe (partial_key) WHERE payload <> '';
      CREATE UNIQUE INDEX expression_key ON conflict_scope.arbiter_probe (lower(entry_code));
      CREATE UNIQUE INDEX mixed_target ON conflict_scope.arbiter_probe (realm, lower(partial_key)) WHERE payload IS NOT NULL;
      INSERT INTO conflict_scope.arbiter_probe VALUES (1,9,'甲','原值','ActIF',1,'[1,3)');
      CREATE ROLE conflict_column_role NOLOGIN;
      GRANT USAGE ON SCHEMA conflict_scope TO conflict_column_role;
      GRANT INSERT (id,realm,entry_code,payload), SELECT (id,partial_key) ON conflict_scope.arbiter_probe TO conflict_column_role;
      ${path}`);
    await prepare({id: '', name: '隔离 PostgreSQL 冲突目标', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, path);
    await resizeQueryWindow(1280, 920, 0.75);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const executeSetting = async (statement: string) => {
      await replaceDraft(statement);
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === statement)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
    };
    await executeSetting(path);
    const baseline = await history(), identity = (await inspectModel()).identity;
    const show = async (draft: string, slot: string, prefix: string, names: string[]) => {
      await replaceDraft(draft);
      await modelSelection(1, draft.indexOf(slot) + prefix.length + 1);
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row .label-name')).toHaveText(names);
    };
    const accept = async (draft: string, slot: string, prefix: string, label: string, insert: string) => {
      await show(draft, slot, prefix, [label]);
      await page.keyboard.press('Enter');
      const completed = draft.replace(slot, insert);
      await expect.poll(async () => (await inspectModel()).sql).toBe(completed);
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).identity).toEqual(identity);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
      return completed;
    };
    const base = "INSERT INTO arbiter_probe (id,realm,entry_code,payload) VALUES (2,9,'甲','新值') ON CONFLICT ";
    const update = ' DO UPDATE SET payload=excluded.payload';
    await show(base + '(key_tail)' + update, 'key_tail', '', ['id', 'realm, entry_code']);
    await show(base + 'ON CONSTRAINT key_tail' + update, 'key_tail', '', ['arbiter_probe_pkey', 'Pair "键"']);
    const whole = await accept(base + 'ent_tail' + update, 'ent_tail', 'ent', 'entry_code, realm', '("entry_code", "realm")');
    const remainder = await accept(base + '(realm, ent_tail)' + update, 'ent_tail', 'ent', 'entry_code', '"entry_code"');
    const named = await accept(base + 'ON CONSTRAINT Pa_tail' + update, 'Pa_tail', 'Pa', 'Pair "键"', postgresIdentifier('Pair "键"'));
    const excluded = await accept("INSERT INTO arbiter_probe (id,realm,entry_code,era) VALUES (3,10,'乙',int4range(2,4)) " +
      'ON CONFLICT ON CONSTRAINT ra_tail DO NOTHING', 'ra_tail', 'ra', 'range_guard', '"range_guard"');
    const definitions = (await observer.query(`SELECT c.relname, pg_get_indexdef(i.indexrelid, i.indnkeyatts::int, false) AS term,
      pg_get_expr(i.indpred, i.indrelid, false) AS predicate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='conflict_scope.arbiter_probe'::regclass
        AND c.relname IN ('only_some','expression_key','mixed_target')`)).rows;
    const partialDefinition = definitions.find(item => item.relname === 'only_some');
    const expressionDefinition = definitions.find(item => item.relname === 'expression_key');
    const mixedDefinition = definitions.find(item => item.relname === 'mixed_target');
    const partial = await accept("INSERT INTO arbiter_probe (id,realm,entry_code,payload,partial_key) VALUES (4,11,'丙','新值','ActIF') " +
      'ON CONFLICT par_tail' + update, 'par_tail', 'par', 'partial_key', '("partial_key") WHERE (' + partialDefinition.predicate + ')');
    const expression = await accept("INSERT INTO arbiter_probe (id,realm,entry_code,payload) VALUES (5,12,'甲','新值') ON CONFLICT ex_tail" +
      update, 'ex_tail', 'ex', expressionDefinition.term, '((' + expressionDefinition.term + '))');
    const mixed = await accept("INSERT INTO arbiter_probe (id,realm,entry_code,payload,partial_key) VALUES (6,9,'丁','新值','actif') " +
      'ON CONFLICT mix_tail' + update, 'mix_tail', 'mix', 'realm, ' + mixedDefinition.term,
      '("realm", (' + mixedDefinition.term + ')) WHERE (' + mixedDefinition.predicate + ')');
    // 每个候选独立执行并回滚，核对真实冲突结果及原行恢复。
    for (const sql of [whole, remainder, named, excluded, partial, expression, mixed]) {
      await observer.query('BEGIN');
      try {
        expect((await observer.query(sql)).rowCount).toBe(sql === excluded ? 0 : 1);
        expect((await observer.query({text: 'SELECT id,payload FROM arbiter_probe', rowMode: 'array'})).rows)
          .toEqual([[1, sql === excluded ? '原值' : '新值']]);
      } finally { await observer.query('ROLLBACK'); }
    }
    expect((await observer.query({text: 'SELECT id,payload FROM arbiter_probe', rowMode: 'array'})).rows).toEqual([[1,'原值']]);
    await executeSetting('SET ROLE conflict_column_role');
    await show(base + '(key_tail) DO NOTHING', 'key_tail', '', ['id']);
    await show(base + 'key_tail DO NOTHING', 'key_tail', '', ['id']);
    await show(base + 'ON CONSTRAINT key_tail DO NOTHING', 'key_tail', '', ['arbiter_probe_pkey']);
    await page.screenshot({path: info.outputPath('PostgreSQL冲突目标补全.png'), animations: 'disabled'});
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 字段悬停读取真实目录并区分同名、临时和歧义来源', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA hover_source;
      CREATE TABLE public.hover_probe ("Amount" numeric(28,7) NOT NULL DEFAULT 17.25, amount text,
        "Calculated" numeric(28,7) GENERATED ALWAYS AS ("Amount" + 1) STORED);
      COMMENT ON COLUMN public.hover_probe."Amount" IS '<b>精确金额</b>';
      CREATE TABLE hover_source.hover_probe ("Amount" varchar(16) DEFAULT '路径优先');`);
    const sql = 'SELECT h."Amount" FROM public.hover_probe h;', history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await prepare({id: '', name: '隔离 PostgreSQL 字段悬停', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, sql);
    await resizeQueryWindow(1280, 920, 0.75);
    const identity = (await inspectModel()).identity;
    const hover = tab().locator('.monaco-hover:visible');
    const show = async (source: string, word: string, pointer = false) => {
      await replaceDraft(source);
      const position = {lineNumber: 1, column: source.indexOf(word) + 3};
      await modelSelection(position.lineNumber, position.column);
      if (pointer) {
        const point = await editor().evaluate((element, location) => {
          const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
          const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
          const cursor = instance?.getScrolledVisiblePosition(location), rect = instance?.getDomNode()?.getBoundingClientRect();
          if (!cursor || !rect) throw Error('缺少字段可见位置');
          return {x: rect.left + cursor.left, y: rect.top + cursor.top + cursor.height / 2};
        }, position);
        await page.mouse.move(point.x, point.y);
      } else {
        await page.keyboard.press('ControlOrMeta+K');
        await page.keyboard.press('ControlOrMeta+I');
      }
    };
    const read = async (source: string, word: string, expected: readonly string[], pointer = false) => {
      const baseline = await history();
      await show(source, word, pointer);
      for (const text of expected) await expect(hover).toContainText(text);
      if (pointer) {
        await expect(hover.locator('b')).toHaveCount(0);
        await page.screenshot({path: info.outputPath('PostgreSQL字段真实目录悬停.png'), animations: 'disabled'});
      }
      await page.keyboard.press('Escape');
      await expect(hover).not.toBeVisible();
      expect(await history()).toEqual(baseline);
      expect((await inspectModel()).sql).toBe(source);
      expect((await inspectModel()).identity).toEqual(identity);
    };
    await read(sql, 'Amount', ['"public"."hover_probe"."Amount"', 'numeric(28,7)', '允许NULL（目录）：否', '17.25', '<b>精确金额</b>'], true);
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    await read('SELECT h.amount FROM public.hover_probe h;', 'amount', ['"amount"', '类型：text']);
    await read('SELECT h."Calculated" FROM public.hover_probe h;', 'Calculated', ['生成表达式（目录文本）', '"Amount" +']);
    await read('SELECT "Amount" FROM public.hover_probe a CROSS JOIN hover_source.hover_probe b;', 'Amount',
      ['未限定字段存在多个候选来源', '"a" → "public"', '"b" → "hover_source"']);

    const execute = async (source: string) => {
      await replaceDraft(source);
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === source)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
    };
    await execute('SET search_path = hover_source, public');
    await execute('SELECT 8472 AS retained_result');
    const prior = tab().getByRole('gridcell', {name: '8472', exact: true});
    await expect(prior).toBeVisible();
    await read('SELECT h."Amount" FROM hover_probe h;', 'Amount', ['"hover_source"."hover_probe"', 'character varying(16)', '路径优先']);
    await expect(prior).toBeVisible();
    await execute('CREATE TEMP TABLE hover_probe ("Amount" bigint NOT NULL DEFAULT 99)');
    await read('SELECT h."Amount" FROM hover_probe h;', 'Amount', ['"pg_temp"."hover_probe"', '当前会话临时表', '类型：bigint', '99']);
    await read(sql, 'Amount', ['"public"."hover_probe"', 'numeric(28,7)']);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 查询光标查看对象定义按原搜索路径解析并保留原事务', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host, port, user, password, database: user, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query('CREATE SCHEMA editor_definition; CREATE TABLE public.catalog_probe(default_id integer); ' +
      'CREATE VIEW editor_definition.catalog_probe AS SELECT 31::bigint AS preferred_only;');
    const query = 'SELECT * FROM catalog_probe;', history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await prepare({id: '', name: '隔离 PostgreSQL 对象定义', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false}, query);
    await resizeQueryWindow(1280, 920, 0.75);
    const identity = (await inspectModel()).identity;
    const dialog = () => page.getByRole('dialog', {name: objectDefinitionZh.title, exact: true});
    const close = async () => { await page.keyboard.press('Escape'); await expect(dialog()).not.toBeVisible(); };
    const nativeOpen = () => command('object-definition');
    const toolbarOpen = () => tab().getByRole('button', {name: objectDefinitionZh.entry, exact: true}).click();
    const contextOpen = async () => {
      await editor().locator('.view-lines').getByText('catalog_probe', {exact: true}).click({button: 'right'});
      const item = page.locator('.monaco-menu-container:visible').getByRole('menuitem', {name: objectDefinitionZh.entry, exact: true});
      await item.hover();
      await expect(item).toBeFocused();
      await page.keyboard.press('Enter');
    };
    const open = async (sql: string, activate = nativeOpen) => {
      await replaceDraft(sql);
      await modelSelection(1, sql.lastIndexOf('catalog_probe') + 3);
      await activate();
      await expect(dialog()).toBeVisible();
    };
    const definition = async (sql: string, schema: string, field: string, activate = nativeOpen) => {
      const baseline = await history();
      await open(sql, activate);
      await expect(dialog().getByRole('status')).toContainText('模式 ' + schema);
      await expect(dialog().locator('.view-lines')).toContainText(field);
      if (activate === contextOpen) await page.screenshot({path: info.outputPath('PostgreSQL查询对象只读定义.png'), animations: 'disabled'});
      await close();
      expect((await inspectModel()).sql).toBe(sql);
      expect((await inspectModel()).identity).toEqual(identity);
      expect(await history()).toEqual(baseline);
    };
    await definition(query, 'public', 'default_id', toolbarOpen);
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    await open('WITH catalog_probe AS (SELECT 1) SELECT * FROM catalog_probe;');
    await expect(dialog().getByRole('alert')).toContainText(objectDefinitionZh.blocked);
    await close();
    expect(await history()).toEqual([]);

    const execute = async (sql: string) => {
      await replaceDraft(sql);
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.sql === sql && entry.success)).toBe(true);
      await expect.poll(() => enabled('object-definition')).toBe(true);
    };
    await execute('SET search_path = editor_definition, public');
    await execute('SELECT 1234 AS preserved_result');
    const result = tab().getByRole('gridcell', {name: '1234', exact: true});
    await expect(result).toBeVisible();
    await definition(query, 'editor_definition', 'preferred_only', contextOpen);
    await expect(result).toBeVisible();
    await open('SELECT * FROM nonexistent_catalog_probe.catalog_probe;');
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(dialog().locator('.view-lines')).toHaveCount(0);
    await close();
    await expect(result).toBeVisible();

    await execute('CREATE TEMP TABLE catalog_probe(temporary_only text)');
    await definition(query, 'pg_temp', 'temporary_only');
    await definition('SELECT * FROM public.catalog_probe;', 'public', 'default_id');
    await definition('SELECT * FROM pg_temp.catalog_probe;', 'pg_temp', 'temporary_only');

    await execute('BEGIN');
    const baseline = await history();
    await open(query);
    await expect(dialog().getByRole('alert')).toHaveText(objectDefinitionZh.transaction);
    await page.screenshot({path: info.outputPath('PostgreSQL事务中的对象定义保护.png'), animations: 'disabled'});
    await close();
    expect(await history()).toEqual(baseline);
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await execute('ROLLBACK');
    await definition(query, 'pg_temp', 'temporary_only');
    await execute("SELECT current_setting('search_path') AS search_path_probe");
    await expect(tab().getByRole('gridcell', {name: 'editor_definition, public', exact: true})).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 两种着色模式保留真实目录补全和参数提示', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({ host, port, user, password, database: user, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query("CREATE FUNCTION public.color_signature_marker(input_number integer, input_label text) RETURNS text LANGUAGE SQL AS 'SELECT input_label'");
    const modeSql = 'SET standard_conforming_strings = ';
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await prepare({ id: '', name: '隔离 PostgreSQL 方言服务', dialect: 'postgresql', group: '', color: '#123456',
      host, port, user, database: user, password, rememberPassword: false }, modeSql + 'off');
    const identity = (await inspectModel()).identity;
    for (const mode of ['off', 'on'] as const) {
      if (mode === 'on') await replaceDraft(modeSql + mode);
      await command('execute-all');
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === modeSql + mode)).toBe(true);
      await expect.poll(() => enabled('execute-all')).toBe(true);
      await expect.poll(async () => (await inspectModel()).language).toBe(mode === 'on' ? 'dbark-postgresql' : 'dbark-postgresql-backslash');
      const baseline = await history();
      await replaceDraft('SELECT public.color_signature_mar');
      await triggerSuggestions();
      await expect(tab().locator('.suggest-widget.visible .monaco-list-row.focused')).toContainText('color_signature_marker');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT public."color_signature_marker"()');
      const activeParameter = tab().locator('.parameter-hints-widget:visible .signature .parameter.active');
      await expect(activeParameter).toContainText('input_number');
      await page.keyboard.type('1,');
      await expect(activeParameter).toContainText('input_label');
      await page.keyboard.press('Escape');

      const parameters = "SELECT [$shared], [$], 'a\\', [$needle], '--' ;\n;";
      // 直接布置原模型的词法样本，避免键入时配对引号改变测试字符，再走正常补全入口。
      await editor().evaluate((element, sql) => {
        const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
        const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const model = instance?.getModel();
        if (!model || !instance?.executeEdits('parameter-fixture', [{range: model.getFullModelRange(), text: sql}])) throw Error('缺少原草稿模型');
      }, parameters);
      expect((await inspectModel()).sql).toBe(parameters);
      await modelSelection(1, parameters.indexOf('[$]') + 3);
      await triggerSuggestions();
      const names = tab().locator('.suggest-widget.visible .monaco-list-row .label-name');
      await expect(names).toHaveText(mode === 'on' ? ['[$shared]', '[$needle]'] : ['[$shared]']);
      await page.keyboard.press('Escape');
      expect((await inspectModel()).identity).toEqual(identity);
      expect(await history()).toEqual(baseline);
    }
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test.describe('MERGE 目录与例程补全', () => {
  test.use({ preserveOnUnconfirmedExit: true });
  test('PostgreSQL MERGE 实库目标、CTE、表函数和参数提示', async ({}, info) => {
    test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
    test.setTimeout(60000);
    const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
    const port = Number(process.env.DBARK_PGSEARCH_PORT), host = '127.0.0.1';
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
    const observer = new Client({ host, port, user, password, database: user, connectionTimeoutMillis: 3000 });
    try {
      await observer.connect();
      await observer.query(`CREATE SCHEMA merge_test;
        CREATE TABLE merge_test.dst_table(id integer, label text);
        CREATE VIEW merge_test.dst_view AS SELECT * FROM merge_test.dst_table;
        CREATE MATERIALIZED VIEW merge_test.dst_mat AS SELECT * FROM merge_test.dst_table;
        CREATE TABLE merge_test.dst_ruled(id integer);
        CREATE RULE no_insert AS ON INSERT TO merge_test.dst_ruled DO INSTEAD NOTHING;
        CREATE SEQUENCE merge_test.call_guard;
        CREATE FUNCTION merge_test.feed_rows(input_number integer, input_label text)
          RETURNS TABLE(id integer, label text) LANGUAGE SQL AS
          $$SELECT nextval('merge_test.call_guard')::integer, input_label$$;
        CREATE TYPE merge_test.pair_result AS ("编号" bigint, note text);
        CREATE FUNCTION merge_test.pairs() RETURNS SETOF merge_test.pair_result LANGUAGE SQL AS $$SELECT 1::bigint, ''::text$$;
        CREATE FUNCTION merge_test.overloaded(integer) RETURNS TABLE(common integer, first_only integer)
          LANGUAGE SQL AS $$SELECT 1, 2$$;
        CREATE FUNCTION merge_test.overloaded(text) RETURNS TABLE(common text, second_only text)
          LANGUAGE SQL AS $$SELECT 'a'::text, 'b'::text$$;
        CREATE FUNCTION merge_test.width_probe(integer) RETURNS TABLE(first_value integer, tail integer)
          LANGUAGE SQL AS $$SELECT 1, 2$$;
        CREATE FUNCTION merge_test.width_probe(text) RETURNS integer LANGUAGE SQL AS $$SELECT 1$$;
        CREATE TABLE merge_test.return_shape(first_value integer, removed text, tail_value text);
        ALTER TABLE merge_test.return_shape DROP COLUMN removed;
        CREATE FUNCTION merge_test.shaped() RETURNS SETOF merge_test.return_shape
          LANGUAGE SQL AS $$SELECT * FROM merge_test.return_shape$$;
        CREATE FUNCTION merge_test.match_label(input_label text)
          RETURNS boolean LANGUAGE SQL AS 'SELECT input_label IS NOT NULL'`);
      const into = 'MERGE INTO merge_test.dst_';
      await prepare({ id: '', name: 'MERGE 目录测试', dialect: 'postgresql', group: '', color: '#123456',
        host, port, user, database: user, password, rememberPassword: false }, into);
      const widget = tab().locator('.suggest-widget.visible');
      const rows = widget.locator('.monaco-list-row');
      const focused = widget.locator('.monaco-list-row.focused');
      const suggest = () => page.keyboard.press('Control+Space');
      const undo = () => page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await editor().getByRole('textbox').focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await expect.poll(async () => (await inspectModel()).position?.column).toBe(into.length + 1);
      await suggest();
      await expect(focused).toContainText('dst_table');
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: 'dst_view' })).toHaveCount(1);
      await tab().screenshot({ path: info.outputPath('postgresql-merge-target-catalog.png') });
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await inspectModel()).sql).toBe('MERGE INTO merge_test."dst_table"');
      await undo();
      await expect.poll(async () => (await inspectModel()).sql).toBe(into);

      const cte = 'WITH local_feed AS (SELECT 1 AS id) MERGE INTO merge_test.dst_table USING local_fe';
      await replaceDraft(cte);
      await suggest();
      await expect(focused).toContainText('local_feed');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await inspectModel()).sql).toBe(cte.replace(/local_fe$/, '"local_feed"'));

      const using = 'MERGE INTO merge_test.dst_table d USING merge_test.feed_ro';
      await replaceDraft(using);
      await suggest();
      await expect(focused).toContainText('feed_rows');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await inspectModel()).sql).toBe(using.replace(/feed_ro$/, '"feed_rows"()'));
      const active = tab().locator('.parameter-hints-widget:visible .signature .parameter.active');
      await expect(active).toContainText('input_number');
      await page.keyboard.type('1,');
      await expect(active).toContainText('input_label');
      await tab().screenshot({ path: info.outputPath('postgresql-merge-source-signature.png') });
      await page.keyboard.press('Escape');

      await replaceDraft('MERGE INTO merge_test.dst_table d USING (SELECT 1 id) s ON merge_test.match_la');
      await suggest();
      await expect(focused).toContainText('match_label');
      await page.keyboard.press('Escape');

      const functionColumn = 'MERGE INTO merge_test.dst_table d USING merge_test.feed_rows(1,\'a\') s ON s.lab';
      await replaceDraft(functionColumn);
      await suggest();
      await expect(focused).toContainText('label');
      await tab().screenshot({ path: info.outputPath('postgresql-function-return-columns.png') });
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await inspectModel()).sql).toBe(functionColumn.replace(/lab$/, '"label"'));

      await replaceDraft('SELECT * FROM merge_test.pairs() p WHERE p.编');
      await suggest();
      await expect(focused).toContainText('编号');
      await page.keyboard.press('Escape');

      await replaceDraft('SELECT * FROM merge_test.overloaded(1) a WHERE a.');
      await suggest();
      await expect(focused).toContainText('common');
      await expect(rows).toHaveCount(1);
      await page.keyboard.press('Escape');

      await replaceDraft('SELECT * FROM pg_catalog.generate_series(1,2) AS series WHERE series.ser');
      await suggest();
      await expect(focused).toContainText('series');
      await page.keyboard.press('Escape');

      const expectColumns = async (sql: string, names: string[]) => {
        await replaceDraft(sql);
        await suggest();
        await expect(rows).toHaveCount(names.length);
        for (const name of names) await expect(rows.filter({ hasText: name })).toHaveCount(1);
      };
      await expectColumns('SELECT * FROM merge_test.feed_rows(1,\'a\') WITH ORDINALITY AS r(ref) WHERE r.', ['label', 'ordinality', 'ref']);
      await page.keyboard.press('Escape');
      const grouped = "SELECT * FROM ROWS FROM (merge_test.feed_rows(1,'a'), jsonb_to_recordset('[]') AS (extra int)) WITH ORDINALITY AS r(ref,tag) WHERE r.";
      await expectColumns(grouped, ['extra', 'ordinality', 'ref', 'tag']);
      await tab().screenshot({ path: info.outputPath('postgresql-function-position-aliases.png') });
      await page.keyboard.press('Escape');
      await expectColumns("SELECT * FROM ROWS FROM (merge_test.width_probe(1), jsonb_to_recordset('[]') AS (near int,far text)) AS q(a_key,b_key) WHERE q.",
        ['a_key', 'b_key', 'far']);
      await page.keyboard.press('Escape');
      await expectColumns('SELECT * FROM merge_test.shaped() AS r(renamed) WHERE r.', ['renamed', 'tail_value']);
      await page.keyboard.press('Escape');
      expect((await observer.query('SELECT is_called FROM merge_test.call_guard')).rows).toEqual([{ is_called: false }]);
      await expect.poll(async () => (await observer.query('SELECT count(*)::int AS total FROM merge_test.dst_table')).rows[0].total).toBe(0);
      expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })))
        .toEqual({ tasks: [], history: [] });
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
    finally { await observer.end(); }
  });
});

test('PostgreSQL 语句导航支持离线目录、原生跳转、选中和编辑失效', async ({}, info) => {
  const body = 'DO $body$BEGIN PERFORM 1; END;$body$';
  const sql = '/* 外层😀 /* 内层; */ */\n' + body + ";\n--第二条\nSELECT '片段;二';\nSELECT 3";
  await prepare({id: '', name: '离线 PostgreSQL 导航', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  await page.evaluate(async () => {
    const organization = await window.dbark.invoke('queries.organizationGet', {});
    await window.dbark.invoke('queries.organizationApply', { expectedRevision: organization.revision,
      operation: { kind: 'create', name: 'PostgreSQL 常用查询', parentId: null } });
  });
  const panel = navigationPanel();
  await modelSelection(2, 8);
  await page.keyboard.press('ControlOrMeta+E');
  await expect.poll(async () => (await inspectModel()).selected).toBe(body);
  await expect(panel).toHaveCount(0);
  await command('statement-navigation');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await panel.getByRole('button', {name: navigationText.position(0, 2)}).click();
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 1});
  await command('next-statement');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 4, column: 1});
  await command('previous-statement');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 1});
  await command('select-current-statement');
  await expect.poll(async () => (await inspectModel()).selected).toBe(body);
  await panel.getByRole('textbox', {name: navigationText.search}).fill('片段;二');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(1));
  await panel.getByRole('button', {name: navigationText.select + ' 2'}).click();
  await expect.poll(async () => (await inspectModel()).selected).toBe("SELECT '片段;二'");
  await page.screenshot({path: info.outputPath('PostgreSQL语句导航.png')});

  await replaceDraft(ambiguousScript);
  await expect(panel.getByRole('status')).toHaveText(navigationText.reasons.stale);
  await panel.getByRole('button', {name: navigationText.refresh}).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.reasons.mode);
  await panel.getByRole('button', {name: navigationText.close}).click();
  await expect(panel).toHaveCount(0);
  await replaceDraft(sql);
  await command('statement-navigation');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await panel.getByRole('checkbox', {name: navigationText.check(2), exact: true}).check();
  await panel.getByRole('checkbox', {name: navigationText.check(0), exact: true}).check();
  const firstStatement = sql.slice(0, sql.indexOf(';\n--第二条') + 1);
  await panel.getByRole('button', {name: navigationText.library, exact: true}).click();
  await panel.getByRole('textbox', {name: navigationText.libraryName, exact: true}).fill('离线复用');
  await panel.getByRole('button', { name: groupText.chooseSaveGroup, exact: true }).click();
  await panel.getByRole('combobox', { name: groupText.saveGroup, exact: true }).selectOption({ label: 'PostgreSQL 常用查询' });
  await panel.getByRole('button', {name: navigationText.librarySave, exact: true}).click();
  await expect(page.getByText(navigationText.librarySaved('离线复用'), {exact: true})).toBeVisible();
  const saved = (await page.evaluate(() => window.dbark.invoke('queries.list', {}))).find(item => item.name === '离线复用');
  expect(saved).toMatchObject({ databaseContext: { state: 'known', database: 'offline_db' } });
  expect(saved?.sql.replaceAll('\r\n', '\n')).toBe(firstStatement + '\n\nSELECT 3');
  expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).activeTabId).toBe('pg-original');
  await panel.getByRole('button', {name: navigationText.openChecked, exact: true}).click();
  await expect(page.locator('[data-workspace-tab-id]').filter({hasText: queryDuplicateZh.statementsSuffix})).toHaveCount(1);
  await expect.poll(async () => (await inspectModel()).sql.replaceAll('\r\n', '\n')).toBe(firstStatement + '\n\nSELECT 3');
  await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name: '原 PostgreSQL 查询', exact: true}).click();
  await modelSelection(2, 8);
  await command('open-current-statement-query');
  await expect(page.locator('[data-workspace-tab-id]').filter({hasText: queryDuplicateZh.statementSuffix})).toHaveCount(1);
  await expect.poll(async () => (await inspectModel()).sql.replaceAll('\r\n', '\n')).toBe(sql.slice(0, sql.indexOf(';\n--第二条') + 1));
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.dbark.invoke('settings.get', {});
    return settings.tabs.find(item => item.id === settings.activeTabId);
  })).toMatchObject({ database: 'offline_db', kind: 'query' });
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name: '原 PostgreSQL 查询', exact: true}).click();
  await command('save-query');
  const save = page.getByRole('dialog', { name: queryBindingZh.title, exact: true });
  await save.getByLabel(queryBindingZh.name).fill('完整脚本');
  await save.getByRole('button', { name: groupText.chooseSaveGroup, exact: true }).click();
  await save.getByRole('combobox', { name: groupText.saveGroup, exact: true }).selectOption({ label: 'PostgreSQL 常用查询' });
  await page.screenshot({ path: info.outputPath('PostgreSQL查询保存分组.png') });
  await save.getByRole('button', { name: queryBindingZh.create, exact: true }).click();
  await expect(save).toHaveCount(0);
  expect(await page.evaluate(() => window.dbark.invoke('queries.organizationGet', {}))).toMatchObject({
    groups: [{ name: 'PostgreSQL 常用查询', count: 2 }], unfiledCount: 0,
  });
  const full = (await page.evaluate(() => window.dbark.invoke('queries.list', {}))).find(item => item.name === '完整脚本');
  expect(full).toMatchObject({ databaseContext: { state: 'known', database: 'offline_db' } });
  expect(full?.sql.replaceAll('\r\n', '\n')).toBe(sql);
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect.poll(async () => (await settings()).tabs.find(item => item.id === 'pg-original')?.sourceBinding?.id).toBe(full!.id);
  const before = await settings();
  await command('statement-navigation');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await panel.getByRole('checkbox', { name: navigationText.check(2), exact: true }).check();
  await panel.getByRole('checkbox', { name: navigationText.check(0), exact: true }).check();
  await panel.getByRole('button', { name: navigationText.openSeparately, exact: true }).click();
  await expect.poll(async () => (await settings()).tabs.length).toBe(before.tabs.length + 2);
  const after = await settings(), drafts = after.tabs.slice(-2);
  expect(after.tabs.slice(0, -2)).toEqual(before.tabs);
  expect(after.activeTabId).toBe(drafts[0].id);
  expect(drafts.map(item => item.sql?.replaceAll('\r\n', '\n'))).toEqual([firstStatement, sql.slice(sql.lastIndexOf('\nSELECT 3'))]);
  for (const draft of drafts) {
    expect(draft.databaseContext).toEqual({ state: 'known', database: 'offline_db' });
    expect(draft.sourceBinding).toBeUndefined();
    expect(draft.fileSourceBinding).toBeUndefined();
  }
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 语句导航读取真实会话字符串模式且不执行导航正文', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const sql = 'SET standard_conforming_strings = ';
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql + 'off');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  for (const [mode, count] of [['off', 1], ['on', 2]] as const) {
    if (mode === 'on') await replaceDraft(sql + mode);
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === sql + mode)).toBe(true);
    await expect(tab().getByText('原查询会话', {exact: true})).toBeVisible();
    const baseline = await history();
    await replaceDraft(ambiguousScript);
    const panel = navigationPanel();
    await tab().getByRole('button', {name: navigationText.entry, exact: true}).click();
    await expect(panel.getByRole('status')).toHaveText(navigationText.total(count));
    await panel.getByRole('button', {name: navigationText.select + ' ' + count}).click();
    await expect.poll(async () => (await inspectModel()).selected).toBe(mode === 'off' ? ambiguousScript : 'SELECT 2');
    expect(await history()).toEqual(baseline);
    await panel.getByRole('button', {name: navigationText.close}).click();
  }
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 原生菜单在活动查询中查找、替换、导航、编辑和保存', async ({}, info) => {
  const sql = '--紧邻注释😀\nselect (1 + 2) as value;\nselect 3 as tail;';
  await prepare({id: '', name: '离线 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  const body = async () => (await inspectModel()).sql;
  const undo = async (value = sql) => {
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(body).toBe(value);
  };
  await command('find');
  const widget = editor().locator('.find-widget');
  await expect(widget).toBeVisible();
  await widget.locator('.find-part textarea').fill('value');
  await command('replace');
  await widget.locator('.replace-part textarea').fill('replacement');
  await widget.getByRole('button', {name: /^Replace All/}).click();
  await page.keyboard.press('Escape');
  await expect(widget).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(body).toBe(sql.replace('value', 'replacement'));
  await undo();

  await command('sql-goto-line');
  const jump = page.locator('.quick-input-widget:visible input');
  await jump.fill(':2:8');
  await jump.press('Enter');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 8});
  await command('sql-goto-bracket');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 14});
  await command('sql-select-bracket');
  await expect.poll(async () => (await inspectModel()).selected).toBe('(1 + 2)');
  await expect.poll(() => enabled('sql-uppercase')).toBe(true);

  await modelSelection(1, 1);
  // 选区决定菜单可用性。等待主进程应用新选区的状态，再调用注释项。
  await expect.poll(() => enabled('sql-uppercase')).toBe(false);
  await command('sql-toggle-comment');
  await expect.poll(body).toBe(sql.replace('--紧邻', '紧邻'));
  await undo();
  await modelSelection(2, 1, 7);
  await command('sql-uppercase');
  await expect.poll(body).toBe(sql.replace('select', 'SELECT'));
  await undo();
  await modelSelection(3, 1);
  await expect.poll(() => enabled('sql-uppercase')).toBe(false);
  await command('sql-duplicate-lines');
  await expect.poll(body).toBe(sql + '\nselect 3 as tail;');
  await undo();
  await command('format');
  await expect.poll(body).not.toBe(sql);
  await undo();

  await command('save-query');
  const save = page.getByRole('dialog', {name: queryBindingZh.title, exact: true});
  await expect(save).toBeVisible();
  await expect.poll(() => enabled('execute-all')).toBe(false);
  await page.screenshot({path: info.outputPath('PostgreSQL原生菜单保存.png')});
  await save.getByLabel(queryBindingZh.name).fill('菜单保存的 PostgreSQL 查询');
  await save.getByRole('button', {name: queryBindingZh.create}).click();
  await expect(save).toHaveCount(0);
  const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(saved).toEqual([expect.objectContaining({name: '菜单保存的 PostgreSQL 查询', sql, database: 'offline_db'})]);
  await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
  await expect.poll(body).toBe('-- 保留另一草稿');
  await command('sql-toggle-comment');
  await expect.poll(body).toBe('保留另一草稿');
  await page.locator('.tab-strip [data-workspace-tab-id="pg-original"]').getByRole('button', {name: '菜单保存的 PostgreSQL 查询', exact: true}).click();
  await expect.poll(body).toBe(sql);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 编辑器右键切换注释、转换大小写及编辑行可一次撤销', async () => {
  const first = '--紧邻注释😀', second = 'select 2;', last = 'SELECT 3;';
  const sql = [first, second, last].join('\n');
  await prepare({ id: '', name: '离线右键编辑', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db' }, sql);
  await resizeQueryWindow(1280, 920, 0.75);
  const original = await inspectModel();
  async function editFromMenu(id: UiCommandId, lineNumber: number, column: number, expected: string) {
    const point = await editor().evaluate((element, position) => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const bounds = instance?.getDomNode()?.getBoundingClientRect(), visible = instance?.getScrolledVisiblePosition(position);
      if (!bounds || !visible) throw Error('当前编辑器未显示目标行');
      return { x: bounds.x + visible.left, y: bounds.y + visible.top + visible.height / 2 };
    }, { lineNumber, column });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page.locator('.monaco-menu-container:visible');
    // 菜单较长时定位器滚动会改变指针下的项，先确认焦点再走 Monaco 的键盘入口。
    const item = menu.getByRole('menuitem', { name: uiCommandLabels[id], exact: true });
    await item.hover();
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await inspectModel()).sql).toBe(expected);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(inspectModel).toMatchObject({ sql, identity: original.identity });
  }
  await modelSelection(1, 3);
  await editFromMenu('sql-toggle-comment', 1, 4, [first.slice(2), second, last].join('\n'));
  await modelSelection(2, 1, 7);
  await editFromMenu('sql-uppercase', 2, 4, [first, 'SELECT 2;', last].join('\n'));
  await modelSelection(3, 1, 7);
  await editFromMenu('sql-lowercase', 3, 4, [first, second, 'select 3;'].join('\n'));
  await modelSelection(2, 4);
  await editFromMenu('sql-duplicate-lines', 2, 4, [first, second, second, last].join('\n'));
  await editFromMenu('sql-move-lines-up', 2, 4, [second, first, last].join('\n'));
  await editFromMenu('sql-move-lines-down', 2, 4, [first, last, second].join('\n'));
  await editFromMenu('sql-delete-lines', 2, 4, [first, last].join('\n'));
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 原生查询菜单严格执行选区、当前语句、全部，并停止原任务', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, script);
  const rows = tab().locator('.postgres-results .rdg');
  const idle = () => expect.poll(() => enabled('execute-all')).toBe(true);

  await modelSelection(1, 1);
  await idle();
  await expect.poll(() => enabled('execute-selection')).toBe(false);
  await modelSelection(1, 1, script.indexOf('\n') + 1);
  await command('execute-selection');
  await expect(rows).toContainText('选区原值');
  await idle();
  await modelSelection(2, 10);
  await expect.poll(() => enabled('execute-selection')).toBe(false);
  await command('execute-current');
  await expect(rows).toContainText('第二句原值');
  await idle();

  await modelSelection(2, 1, script.split('\n')[1].length + 1);
  await expect.poll(() => enabled('execute-selection')).toBe(true);
  await command('execute-all');
  await expect(rows).toContainText('选区原值');
  await idle();
  const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
  expect(history.some(entry => entry.sql === script)).toBe(true);
  expect(history.some(entry => entry.sql === script.split('\n')[0])).toBe(true);

  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('SELECT pg_sleep(20) /* tabrelio_menu_cancel */;');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await command('execute');
    const active = async () => Number((await observer.query(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE $1",
      ['%tabrelio_menu_cancel%'],
    )).rows[0].n);
    await expect.poll(active).toBe(1);
    await expect.poll(() => enabled('execute-all')).toBe(false);
    await command('stop');
    await idle();
    await expect.poll(active).toBe(0);
    await expect.poll(() => enabled('stop')).toBe(false);
  } finally { await observer.end(); }
  await expect(tab().getByRole('button', {name: postgresZh.execute, exact: true})).toBeEnabled();
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});
