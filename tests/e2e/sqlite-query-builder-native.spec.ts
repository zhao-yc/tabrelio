import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteQueryBuilderZh as text } from '../../src/renderer/locales/sqliteQueryBuilder.zh-CN';
import { sqliteTableBrowseZh as browse } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import { tableForeignKeyJoinZh as joinText } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { tableForeignKeyJoinSummaryZh as aggregate } from '../../src/renderer/locales/tableForeignKeyJoinSummary.zh-CN';
import { queryBuilderSummaryZh as summary } from '../../src/renderer/locales/queryBuilderSummary.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_QUERY_BUILDER_NATIVE !== '1', '需显式启用 SQLite 查询构建器专项');

test('SQLite 从新建查询选择表或视图，真实预览并拒绝已变化的来源', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('只允许本例源码和临时 SQLite 文件');
  const database = join(realpathSync(dataDir), 'query-builder.sqlite');
  const table = '原"表', view = '查询视图', connectionId = 'sqlite-query-builder-fixture';
  const maxInteger = '9223372036854775807';
  function setup(sql: string) {
    const writer = new DatabaseSync(database);
    try { writer.exec(sql); } finally { writer.close(); }
  }
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const builder = page.getByRole('dialog', { name: text.title, exact: true });
  const results = builder.getByRole('region', { name: text.inspectLabels.region, exact: true });
  const button = (name: string) => builder.getByRole('button', { name, exact: true });
  async function selectSource(name: string) {
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true })).click();
    await page.getByRole('dialog', { name: zh.common.newQuery, exact: true }).getByRole('button', { name: joinText.builderEntry, exact: true }).click();
    await button(text.catalog).click();
    await builder.getByRole('searchbox', { name: text.search }).fill(name);
    await builder.getByRole('combobox', { name: text.source, exact: true }).selectOption(name);
    await button(text.read).click();
    await expect(builder.getByRole('region', { name: text.preview })).toBeVisible();
  }
  try {
    setup(`CREATE TABLE "原""表" (value, label TEXT, ignored BLOB);
      WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<105)
      INSERT INTO "原""表" SELECT n, '普通行', X'00ff' FROM seq;
      INSERT INTO "原""表" VALUES (${maxInteger}, '精确整数', NULL), ('${maxInteger}', '同形文本', NULL);
      CREATE VIEW "查询视图" AS SELECT value, label FROM "原""表";`);
    const originalFile = readFileSync(database);
    // 只替换本例文件选择，目录、数据、计划与执行使用真实 IPC 和 SQLite 文件。
    await desktop.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (!(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('本例仅授权 SQLite 文件');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, database);
    await page.evaluate(async id => {
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('本例 SQLite 文件未获授权');
      await window.dbark.invoke('connections.save', { id, name: 'SQLite 构建器样本', dialect: 'sqlite', group: '', color: '#51bda5',
        sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const previous = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...previous, activeTabId: 'original', tabs: [
        { id: 'original', kind: 'query', title: '原查询', connectionId: id, database: 'main', databaseContext: { state: 'known', database: 'main' }, sql: 'SELECT 7;' },
      ] });
    }, connectionId);
    await page.reload();
    const originalTabs = (await settings()).tabs, originalHistory = await history();

    await selectSource(table);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.truncated(100), { exact: true })).toBeVisible();
    await button(zh.common.cancel).click();

    await selectSource(view);
    await builder.getByRole('checkbox', { name: text.choose('value'), exact: true }).uncheck();
    await button(browse.addFilter).click();
    await builder.getByLabel(browse.filterColumn(1)).selectOption('value');
    await builder.getByLabel(browse.filterKind(1)).selectOption('integer');
    await builder.getByLabel(browse.filterValue(1)).fill(maxInteger);
    await builder.getByRole('checkbox', { name: text.distinct }).check();
    await button(browse.addSort).click();
    await builder.getByLabel(browse.sortColumn(1)).selectOption('label');
    await builder.getByLabel(browse.sortDirection(1)).selectOption('desc');
    await builder.getByLabel(text.limit, { exact: true }).fill('3');
    const sql = builder.getByRole('region', { name: text.preview }).locator('pre');
    const expected = 'SELECT DISTINCT "label" FROM "main"."查询视图" WHERE (typeof("value") = \'integer\' AND "value" = ' +
      maxInteger + ') ORDER BY "label" DESC LIMIT 3;';
    await expect(sql).toHaveText(expected);
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toContainText(table);
    await builder.getByLabel(text.limit, { exact: true }).fill('2');
    await expect(results.getByRole('tree')).toHaveCount(0);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(1), { exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: '精确整数', exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: '同形文本', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sqlite-query-builder.png') });
    const summaryMode = builder.getByRole('checkbox', { name: summary.enabled, exact: true });
    await summaryMode.check();
    await expect(button(text.open)).toBeDisabled();
    await button(aggregate.addGroup).click();
    await builder.getByRole('combobox', { name: aggregate.groupColumn(1), exact: true }).selectOption('label');
    await button(aggregate.addAggregate).click();
    await builder.getByRole('combobox', { name: aggregate.fn(1), exact: true }).selectOption('SUM');
    await button(sort.add).click();
    await builder.getByRole('combobox', { name: sort.field(1), exact: true }).selectOption({ label: '统计_1' });
    await builder.getByRole('textbox', { name: aggregate.alias(1), exact: true }).fill('精确合计');
    await builder.getByRole('combobox', { name: sort.direction(1), exact: true }).selectOption('DESC');
    const having = builder.getByRole('group', { name: summary.having, exact: true });
    await having.getByRole('button', { name: browse.addFilter, exact: true }).click();
    await having.getByLabel(browse.filterColumn(1)).selectOption({ label: '精确合计' });
    await having.getByLabel(browse.filterKind(1)).selectOption('integer');
    await having.getByLabel(browse.filterValue(1)).fill(maxInteger);
    await builder.getByRole('textbox', { name: aggregate.alias(1), exact: true }).fill('最终合计');
    const grouped = 'SELECT "label", SUM("value") AS "最终合计" FROM "main"."查询视图" WHERE (typeof("value") = \'integer\' AND "value" = ' +
      maxInteger + ') GROUP BY "label" HAVING (typeof(SUM("value")) = \'integer\' AND SUM("value") = ' + maxInteger + ') ORDER BY 2 DESC LIMIT 2;';
    await expect(sql).toHaveText(grouped);
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toBeVisible();
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(1), { exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: maxInteger, exact: true })).toBeVisible();
    await sql.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sqlite-query-summary.png') });
    await button(aggregate.remove(1)).click();
    await expect(builder.getByRole('alert')).toContainText(summary.havingStale);
    await expect(button(text.open)).toBeDisabled();
    await summaryMode.uncheck();
    await expect(sql).toHaveText(expected.replace('LIMIT 3', 'LIMIT 2'));
    expect(await history()).toEqual(originalHistory);
    expect((await settings()).tabs).toEqual(originalTabs);
    await button(text.open).click();
    await expect(builder).toBeHidden();
    await expect.poll(async () => {
      const saved = await settings();
      return saved.tabs.find(tab => tab.id === saved.activeTabId);
    }).toMatchObject({ kind: 'query', connectionId, database: 'main', databaseContext: { state: 'known', database: 'main' },
      sql: expected.replace('LIMIT 3', 'LIMIT 2') });
    expect((await settings()).tabs.find(tab => tab.id === 'original')).toEqual(originalTabs[0]);
    expect(await history()).toEqual(originalHistory);
    await page.locator('.query-tab:visible .query-execute-split > button.primary').click();
    await expect(page.locator('.query-tab:visible').getByRole('gridcell', { name: '精确整数', exact: true })).toBeVisible();
    expect(readFileSync(database)).toEqual(originalFile);

    await selectSource(table);
    const beforeChange = await settings();
    setup('ALTER TABLE "原""表" ADD COLUMN new_column TEXT;');
    const changedFile = readFileSync(database);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByRole('alert')).toContainText('SQLite 查询来源已变化');
    await button(text.open).click();
    await expect(builder.locator('.modal-content > [role=alert]')).toContainText('SQLite 查询来源已变化');
    await expect(button(text.open)).toBeEnabled();
    expect((await settings()).tabs).toEqual(beforeChange.tabs);
    expect(readFileSync(database)).toEqual(changedFile);
    expect(pageErrors).toEqual([]);
    await button(zh.common.cancel).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
