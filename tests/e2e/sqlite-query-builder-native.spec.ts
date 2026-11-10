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
import { tableFilterGroupsZh as groups } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { queryViewDraftZh as viewDraft } from '../../src/renderer/locales/queryViewDraft.zh-CN';
import { sqliteObjectsZh as objects } from '../../src/renderer/locales/sqliteObjects.zh-CN';
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
  const editor = page.getByRole('dialog', { name: objects.title('create', 'view'), exact: true });
  const viewButton = (name: string) => editor.getByRole('button', { name, exact: true });
  async function prepareView(name: string) {
    await editor.getByLabel(objects.name, { exact: true }).fill(name);
    await viewButton(objects.read).click();
    await expect(editor.getByText(objects.absent, { exact: true })).toBeVisible();
    await viewButton(objects.preview).click();
    await expect(editor.getByLabel(objects.previewTitle)).toContainText(name);
    for (const item of await editor.getByRole('region', { name: objects.acknowledgements }).getByRole('checkbox').all()) await item.check();
    await editor.getByLabel(objects.confirmation, { exact: true }).fill('main.' + name);
  }
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
    setup('CREATE TABLE "JOIN起点" (id, note);' +
      "INSERT INTO \"JOIN起点\" VALUES (1,'整数一'),(2,'整数二'),(3,'整数三'),('1','同形文本');" +
      'CREATE TABLE "关联""表" (id, alternate_id, note);' +
      "INSERT INTO \"关联\"\"表\" VALUES (1,2,'关联命中'),(4,9,'仅右侧');" +
      'CREATE VIEW "关联视图" AS SELECT * FROM "关联""表";');
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
        sqlite: { fileToken: file.token, readOnly: false, busyTimeoutMs: 1000 } });
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
    await button(viewDraft.builderEntry).click();
    await expect(editor.locator('.monaco-editor .view-lines')).toContainText('HAVING');
    await viewButton(objects.close).click();
    await expect(sql).toHaveText(grouped);
    expect(readFileSync(database)).toEqual(originalFile);
    await button(viewDraft.builderEntry).click();
    await prepareView('builder_summary');
    await expect(editor.getByLabel(objects.previewTitle)).toContainText('ORDER BY 2 DESC LIMIT 2');
    await editor.getByLabel(objects.previewTitle).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sqlite-builder-view.png') });
    expect(readFileSync(database)).toEqual(originalFile);
    await viewButton(objects.apply.create).click();
    await expect(editor.getByText(objects.committed, { exact: true })).toBeVisible();
    await viewButton(objects.close).click();
    await expect(sql).toHaveText(grouped);
    const reader = new DatabaseSync(database, { readOnly: true });
    try {
      const read = reader.prepare('SELECT * FROM builder_summary');
      read.setReadBigInts(true);
      expect(read.all()).toEqual([{ label: '精确整数', 最终合计: BigInt(maxInteger) }]);
    } finally { reader.close(); }
    const fileAfterView = readFileSync(database);
    await builder.locator('summary').filter({ hasText: joinText.singleDesignTitle }).click();
    await builder.getByRole('textbox', { name: joinText.designName, exact: true }).fill('整数汇总');
    await button(joinText.designSave).click();
    await expect(builder.getByText(joinText.designSaved, { exact: true })).toBeVisible();
    await button(aggregate.remove(1)).click();
    await expect(builder.getByRole('alert')).toContainText(summary.havingStale);
    await expect(button(text.open)).toBeDisabled();
    await page.evaluate(expected => {
      const original = window.confirm;
      window.confirm = message => { window.confirm = original; if (message !== expected) throw Error('不是恢复设计的确认'); return true; };
    }, joinText.designRestoreConfirm);
    await button(joinText.designLoad).click();
    await expect(builder.getByText(joinText.designRestored, { exact: true })).toBeVisible();
    await expect(sql).toHaveText(grouped);
    await page.screenshot({ path: info.outputPath('sqlite-builder-design.png') });
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
    expect(readFileSync(database)).toEqual(fileAfterView);

    await selectSource('JOIN起点');
    await button(browse.addFilter).click();
    await builder.getByLabel(browse.filterOperator(1)).selectOption('gte');
    await builder.getByLabel(browse.filterKind(1)).selectOption('integer');
    await builder.getByLabel(browse.filterValue(1)).fill('1');
    const single = 'SELECT "id", "note" FROM "main"."JOIN起点" WHERE (typeof("id") = \'integer\' AND "id" >= 1);';
    await expect(sql).toHaveText(single);
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    const joinPanel = builder.getByRole('group', { name: text.joins, exact: true });
    for (const [alias, left] of [['t2', 't1.id'], ['t3', 't2.id']]) {
      await joinPanel.getByLabel(text.joinTarget, { exact: true }).selectOption('关联视图');
      await joinPanel.getByRole('button', { name: text.joinAdd, exact: true }).click();
      const step = joinPanel.getByRole('group', { name: text.joinStep(alias), exact: true });
      await step.getByLabel(text.joinKind, { exact: true }).selectOption('LEFT');
      await step.getByLabel(text.joinLeft(1), { exact: true }).selectOption(left);
      await step.getByLabel(text.joinRight(1), { exact: true }).selectOption('id');
    }
    const third = joinPanel.getByRole('group', { name: text.joinStep('t3'), exact: true });
    for (const [position, right, operator] of [[2, 'alternate_id', '='], [3, 'id', '<=']] as const) {
      await third.getByRole('button', { name: text.joinAddPair, exact: true }).click();
      await third.getByLabel(text.joinLeft(position), { exact: true }).selectOption('t1.id');
      await third.getByLabel(text.joinRight(position), { exact: true }).selectOption(right);
      await third.getByLabel(text.joinOperator(position), { exact: true }).selectOption(operator);
    }
    await third.getByRole('button', { name: text.joinGroups, exact: true }).click();
    const on = third.getByRole('region', { name: text.joinGroupTitle, exact: true });
    await on.getByRole('button', { name: groups.addGroup(), exact: true }).click();
    for (const position of [1, 2]) await on.getByLabel(groups.destination(position), { exact: true }).selectOption({ label: groups.group('1') });
    await on.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sqlite-builder-join.png') });
    await on.getByRole('button', { name: groups.apply, exact: true }).click();
    await button(text.none).click();
    for (const field of ['t1.id', 't3.note']) await builder.getByRole('checkbox', { name: text.choose(field), exact: true }).check();
    await button(browse.addSort).click();
    const joinFrom = ' FROM "main"."JOIN起点" AS t1 LEFT JOIN "main"."关联视图" AS t2 ON (t1."id" = t2."id")' +
      ' LEFT JOIN "main"."关联视图" AS t3 ON (t1."id" <= t3."id" AND (t2."id" = t3."id" OR t1."id" = t3."alternate_id"))' +
      ' WHERE (typeof(t1."id") = \'integer\' AND t1."id" >= 1)';
    const joined = 'SELECT t1."id" AS "t1.id", t3."note" AS "t3.note"' + joinFrom + ' ORDER BY t1."id" ASC;';
    await expect(sql).toHaveText(joined);
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toBeVisible();
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(3), { exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: '关联命中', exact: true })).toHaveCount(1);
    await expect(results.getByRole('gridcell', { name: 'NULL', exact: true })).toHaveCount(2);
    const designs = builder.getByRole('group', { name: joinText.designTitle, exact: true });
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await designs.getByRole('textbox', { name: joinText.designName, exact: true }).fill('关联设计');
    await designs.getByRole('button', { name: joinText.designSave, exact: true }).click();
    await expect(designs.getByText(joinText.designSaved, { exact: true })).toBeVisible();
    await button(viewDraft.builderEntry).click();
    await prepareView('builder_join');
    await viewButton(objects.apply.create).click();
    await expect(editor.getByText(objects.committed, { exact: true })).toBeVisible();
    await viewButton(objects.close).click();
    const joinReader = new DatabaseSync(database, { readOnly: true });
    try {
      expect(joinReader.prepare('SELECT * FROM builder_join').all()).toEqual([
        { 't1.id': 1, 't3.note': '关联命中' }, { 't1.id': 2, 't3.note': null }, { 't1.id': 3, 't3.note': null },
      ]);
    } finally { joinReader.close(); }
    async function approve(label: string) {
      await page.evaluate(expected => {
        const original = window.confirm;
        window.confirm = message => { window.confirm = original; if (message !== expected) throw Error('不是预期的确认'); return true; };
      }, label);
    }
    await approve(text.joinBackConfirm);
    await joinPanel.getByRole('button', { name: text.joinBack, exact: true }).click();
    await expect(sql).toHaveText(single);
    await button(zh.common.cancel).click();
    await selectSource('JOIN起点');
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await designs.getByRole('button', { name: joinText.designRefresh, exact: true }).click();
    await designs.getByRole('combobox', { name: joinText.designTitle, exact: true }).selectOption({ label: '关联设计' });
    await approve(joinText.designRestoreConfirm);
    await designs.getByRole('button', { name: joinText.designLoad, exact: true }).click();
    await expect(sql).toHaveText(joined);
    const joinedFile = readFileSync(database);
    await button(text.open).click();
    await expect(builder).toBeHidden();
    await page.locator('.query-tab:visible .query-execute-split > button.primary').click();
    await expect(page.locator('.query-tab:visible').getByRole('gridcell', { name: '关联命中', exact: true })).toBeVisible();
    expect(readFileSync(database)).toEqual(joinedFile);

    await selectSource('JOIN起点');
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await designs.getByRole('button', { name: joinText.designRefresh, exact: true }).click();
    await designs.getByRole('combobox', { name: joinText.designTitle, exact: true }).selectOption({ label: '关联设计' });
    // 只重建相关视图，起始表和已确认的单表设计保持原样。
    setup('DROP VIEW builder_join; DROP VIEW "关联视图"; CREATE VIEW "关联视图" AS SELECT id, alternate_id AS changed, note FROM "关联""表";');
    await approve(joinText.designRestoreConfirm);
    await designs.getByRole('button', { name: joinText.designLoad, exact: true }).click();
    await expect(builder.locator('.modal-content > [role=alert]')).toContainText('SQLite 查询字段已变化');
    await expect(sql).toHaveText('SELECT "id", "note" FROM "main"."JOIN起点";');
    await button(zh.common.cancel).click();

    await selectSource(table);
    const beforeChange = await settings();
    await button(viewDraft.builderEntry).click();
    await prepareView('stale_builder_view');
    setup('ALTER TABLE "原""表" ADD COLUMN new_column TEXT;');
    const changedFile = readFileSync(database);
    await viewButton(objects.apply.create).click();
    await expect(editor.getByRole('alert')).toContainText('SQLite 查询来源已变化');
    expect(readFileSync(database)).toEqual(changedFile);
    await viewButton(objects.close).click();
    await viewButton(objects.discardClose).click();
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
