import { Client } from 'pg';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { postgresQueryBuilderZh as text } from '../../src/renderer/locales/postgresQueryBuilder.zh-CN';
import { tableForeignKeyJoinZh as joinText } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_QUERY_BUILDER_NATIVE !== '1', '需显式启用 PostgreSQL 查询构建器专项');

test('PostgreSQL 新建查询按 schema 选表或视图，在真实只读事务预览并拒绝已变化的来源', async ({}, info) => {
  const database = process.env.DBARK_VIEW_INSPECT_DATABASE ?? '', password = process.env.DBARK_VIEW_INSPECT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_VIEW_INSPECT_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本例源码和隔离回环 PostgreSQL');
  const profile: PostgresConnectionProfile = { id: '', dialect: 'postgresql', name: '查询构建器样本',
    group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };
  const observer = new Client({ host: profile.host, port, database, user: database, password });
  const schema = 'odd.schema', table = '"odd.schema"."Raw""Rows"', view = '"odd.schema"."Exact View"';
  const min = '9223372036854775806', max = '9223372036854775807';
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const builder = page.getByRole('dialog', { name: text.title, exact: true });
  const results = builder.getByRole('region', { name: text.inspectLabels.region, exact: true });
  const button = (name: string) => builder.getByRole('button', { name, exact: true });
  async function selectSource(name: string) {
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true })).click();
    const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
    await query.getByLabel(zh.app.text050, { exact: true }).fill(database);
    await query.getByRole('button', { name: joinText.builderEntry, exact: true }).click();
    await button(text.catalogue).click();
    await builder.getByRole('combobox', { name: text.schema, exact: true }).selectOption(schema);
    await builder.getByRole('searchbox', { name: text.search, exact: true }).fill(name === table ? 'Raw' : 'Exact');
    const choices = builder.getByRole('combobox', { name: text.source, exact: true });
    await expect(choices.locator('option')).toHaveText([text.chooseSource, name]);
    await choices.selectOption(name);
    await button(text.read).click();
    await expect(builder.getByRole('region', { name: text.preview })).toBeVisible();
  }
  try {
    await observer.connect();
    await observer.query(`CREATE SCHEMA "odd.schema";
      CREATE TABLE ${table} (id bigint, label text, ignored bytea);
      CREATE TABLE public."Raw""Rows" (other integer);
      INSERT INTO ${table} SELECT id, '普通行', NULL FROM pg_catalog.generate_series(1, 105) AS id;
      INSERT INTO ${table} VALUES (${min}, '精确整数', NULL), (${max}, NULL, NULL);
      CREATE VIEW ${view} AS SELECT id, label, ignored, pg_catalog.current_setting('transaction_read_only') AS read_mode FROM ${table};`);
    const connectionId = await page.evaluate(async profile => {
      const { id } = await window.dbark.invoke('connections.save', profile);
      const previous = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...previous, activeTabId: 'original', tabs: [
        { id: 'original', kind: 'query', title: '原查询', connectionId: id, database: profile.database!,
          databaseContext: { state: 'known', database: profile.database! }, sql: 'SELECT 7;' },
      ] });
      return id;
    }, profile);
    await page.reload();
    const originalTabs = (await settings()).tabs, originalHistory = await history();

    await selectSource(table);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.truncated(100), { exact: true })).toBeVisible();
    await button(zh.common.cancel).click();

    await selectSource(view);
    await builder.getByRole('checkbox', { name: text.choose('ignored'), exact: true }).uncheck();
    await builder.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption('id');
    await builder.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption('>=');
    await builder.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(min);
    await button(zh.table.text013).click();
    await builder.getByRole('checkbox', { name: text.distinct }).check();
    await button(text.sort).click();
    await button(sort.add).click();
    await builder.getByRole('combobox', { name: sort.field(1), exact: true }).selectOption('label');
    await builder.getByRole('combobox', { name: sort.direction(1), exact: true }).selectOption('DESC');
    await builder.getByRole('combobox', { name: sort.nulls(1), exact: true }).selectOption('FIRST');
    await button(sort.apply).click();
    await builder.getByLabel(text.limit, { exact: true }).fill('3');
    const sql = builder.getByRole('region', { name: text.preview }).locator('pre');
    const expected = `SELECT DISTINCT "id", "label", "read_mode" FROM ${view} WHERE "id" >= E'${min}' ORDER BY "label" DESC NULLS FIRST LIMIT 3;`;
    await expect(sql).toHaveText(expected);
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toBeVisible();
    await builder.getByLabel(text.limit, { exact: true }).fill('2');
    await expect(results.getByRole('tree')).toHaveCount(0);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(2), { exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: 'on', exact: true }).first()).toBeVisible();
    await expect(results.getByRole('gridcell', { name: max, exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: min, exact: true })).toBeVisible();
    await expect(results.getByRole('grid').getByRole('row').nth(1)).toContainText(max);
    await sql.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-query-builder.png') });
    expect(await history()).toEqual(originalHistory);
    expect((await settings()).tabs).toEqual(originalTabs);
    await button(text.open).click();
    await expect(builder).toBeHidden();
    await expect.poll(async () => {
      const saved = await settings();
      return saved.tabs.find(tab => tab.id === saved.activeTabId);
    }).toMatchObject({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, sql: expected.replace('LIMIT 3', 'LIMIT 2') });
    expect((await settings()).tabs.find(tab => tab.id === 'original')).toEqual(originalTabs[0]);
    expect(await history()).toEqual(originalHistory);
    const query = page.locator('.query-tab.postgres-query:visible');
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(query.getByRole('gridcell', { name: '精确整数', exact: true })).toBeVisible();

    await selectSource(table);
    const beforeChange = await settings();
    await observer.query('ALTER TABLE ' + table + ' ADD COLUMN new_column text');
    await button(text.inspectLabels.rows).click();
    await expect(results.getByRole('alert')).toContainText('PostgreSQL 查询来源已变化');
    await button(text.open).click();
    await expect(builder.locator('.modal-content > [role=alert]')).toContainText('PostgreSQL 查询来源已变化');
    expect((await settings()).tabs).toEqual(beforeChange.tabs);
    await button(zh.common.cancel).click();
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
