import { Client } from 'pg';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { expectCopiedBuilderSql } from './query-builder-output';
import { queryBuilderOutputZh as output } from '../../src/renderer/locales/queryBuilderOutput.zh-CN';
import { postgresQueryBuilderZh as text } from '../../src/renderer/locales/postgresQueryBuilder.zh-CN';
import { tableForeignKeyJoinZh as joinText } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { tableForeignKeyJoinSummaryZh as aggregate } from '../../src/renderer/locales/tableForeignKeyJoinSummary.zh-CN';
import { queryBuilderSummaryZh as summary } from '../../src/renderer/locales/queryBuilderSummary.zh-CN';
import { queryViewDraftZh as viewDraft } from '../../src/renderer/locales/queryViewDraft.zh-CN';
import { postgresCreateViewZh as create } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { tableFilterGroupsZh as groups } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { queryBuilderProjectionZh as projection } from '../../src/renderer/locales/queryBuilderProjection.zh-CN';
import { queryBuilderPaginationZh as pagination } from '../../src/renderer/locales/queryBuilderPagination.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';

import { linkJoinFields } from './join-field-mapping';

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
  const approve = (label: string) => page.evaluate(expected => {
    const original = window.confirm;
    window.confirm = message => { window.confirm = original; if (message !== expected) throw Error('不是预期的设计确认'); return true; };
  }, label);
  async function selectSource(name: string, search = name === table ? 'Raw' : 'Exact') {
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true })).click();
    const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
    await query.getByLabel(zh.app.text050, { exact: true }).fill(database);
    await query.getByRole('button', { name: joinText.builderEntry, exact: true }).click();
    await button(text.catalogue).click();
    await builder.getByRole('combobox', { name: text.schema, exact: true }).selectOption(schema);
    await builder.getByRole('searchbox', { name: text.search, exact: true }).fill(search);
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
      CREATE TABLE public.builder_link (id bigint PRIMARY KEY, note text, alternate_id bigint);
      INSERT INTO public.builder_link VALUES (${min}, '匹配来源', ${max});
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
    const summaryMode = builder.getByRole('checkbox', { name: summary.enabled, exact: true });
    await summaryMode.check();
    await button(aggregate.addGroup).click();
    await builder.getByRole('combobox', { name: aggregate.groupColumn(1), exact: true }).selectOption('label');
    await builder.getByLabel(aggregate.groupAlias(1), { exact: true }).fill('类别"名称');
    await button(aggregate.addAggregate).click();
    await button(aggregate.addAggregate).click();
    await builder.getByRole('combobox', { name: aggregate.fn(1), exact: true }).selectOption('AVG_DISTINCT');
    await builder.getByRole('combobox', { name: aggregate.fn(2), exact: true }).selectOption('SUM_DISTINCT');
    await builder.getByRole('textbox', { name: aggregate.alias(1), exact: true }).fill('去重均值');
    await builder.getByRole('textbox', { name: aggregate.alias(2), exact: true }).fill('合计');
    await button(sort.add).click();
    await builder.getByRole('combobox', { name: sort.field(1), exact: true }).selectOption({ label: '合计' });
    await builder.getByRole('combobox', { name: sort.direction(1), exact: true }).selectOption('DESC');
    await builder.getByRole('combobox', { name: sort.nulls(1), exact: true }).selectOption('LAST');
    const having = builder.getByRole('group', { name: summary.having, exact: true });
    await having.getByLabel(zh.table.text009).selectOption({ label: '合计' });
    await having.getByLabel(zh.table.filterOperatorLabel).selectOption('<');
    await having.getByLabel(zh.table.text011).fill(max);
    await having.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await builder.getByRole('textbox', { name: aggregate.alias(2), exact: true }).fill('最终合计');
    const grouped = `SELECT "label" AS "类别""名称", pg_catalog.AVG(DISTINCT "id") AS "去重均值", pg_catalog.SUM(DISTINCT "id") AS "最终合计" FROM ${view} WHERE "id" >= E'${min}' GROUP BY "label" HAVING pg_catalog.SUM(DISTINCT "id") < E'${max}' ORDER BY 3 DESC NULLS LAST LIMIT 2;`;
    // 此阈值下重复值若未去重，HAVING 会淘汰本应保留的分组。
    const duplicate = (await observer.query('INSERT INTO ' + table + ' VALUES ($1, $2, NULL) RETURNING ctid::text', [min, '精确整数'])).rows[0].ctid;
    await expect(sql).toHaveText(grouped);
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toBeVisible();
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(1), { exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: max, exact: true })).toHaveCount(0);
    await expect(results.getByRole('gridcell', { name: min, exact: true }).first()).toBeVisible();
    await sql.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-group-alias.png') });
    await summaryMode.uncheck();
    await expect(sql).toHaveText(expected.replace('LIMIT 3', 'LIMIT 2'));
    await summaryMode.check();
    await expect(sql).toHaveText(grouped);
    const editor = page.getByRole('dialog', { name: create.title, exact: true });
    const viewButton = (name: string) => editor.getByRole('button', { name, exact: true });
    const definition = editor.getByRole('textbox', { name: create.definition, exact: true });
    await button(viewDraft.builderEntry).click();
    await expect(definition).toHaveValue(grouped.slice(0, -1) + '\n');
    await viewButton(zh.common.close).click();
    await expect(sql).toHaveText(grouped);
    await button(viewDraft.builderEntry).click();
    await expect(editor.getByLabel(create.schema, { exact: true })).toHaveValue(schema);
    await editor.getByRole('textbox', { name: create.name, exact: true }).fill('builder_summary');
    await viewButton(create.preview).click();
    await expect(editor.locator('.pg-create-sql')).toContainText('CREATE VIEW "odd.schema"."builder_summary"');
    await expect(editor.locator('.pg-create-sql')).toContainText(grouped.slice(0, -1));
    expect((await observer.query("SELECT to_regclass('\"odd.schema\".builder_summary') AS relation")).rows[0].relation).toBeNull();
    await page.screenshot({ path: info.outputPath('postgres-builder-view.png') });
    await viewButton(create.apply).click();
    await expect(sql).toHaveText(grouped);
    expect((await observer.query('SELECT "类别""名称", "最终合计", "去重均值" = "最终合计" AS "均值正确" FROM "odd.schema".builder_summary')).rows).toEqual([
      { '类别"名称': '精确整数', 均值正确: true, 最终合计: min },
    ]);
    await observer.query('DELETE FROM ' + table + ' WHERE ctid = $1::tid', [duplicate]);
    await builder.locator('summary').filter({ hasText: joinText.singleDesignTitle }).click();
    await builder.getByRole('textbox', { name: joinText.designName, exact: true }).fill('条件汇总');
    await button(joinText.designSave).click();
    await expect(builder.getByText(joinText.designSaved, { exact: true })).toBeVisible();
    await button(zh.common.cancel).click();
    await selectSource(view);
    await builder.locator('summary').filter({ hasText: joinText.singleDesignTitle }).click();
    await button(joinText.designRefresh).click();
    await builder.getByRole('combobox', { name: joinText.singleDesignTitle, exact: true }).selectOption({ label: '条件汇总' });
    await page.evaluate(expected => {
      const original = window.confirm;
      window.confirm = message => { window.confirm = original; if (message !== expected) throw Error('不是恢复设计的确认'); return true; };
    }, joinText.designRestoreConfirm);
    await button(joinText.designLoad).click();
    await expect(builder.getByText(joinText.designRestored, { exact: true })).toBeVisible();
    await expect(sql).toHaveText(grouped);
    await page.screenshot({ path: info.outputPath('postgres-builder-design.png') });
    expect(await history()).toEqual(originalHistory);
    expect((await settings()).tabs).toEqual(originalTabs);
    await button(text.open).click();
    await expect(builder).toBeHidden();
    await expect.poll(async () => {
      const saved = await settings();
      return saved.tabs.find(tab => tab.id === saved.activeTabId);
    }).toMatchObject({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, sql: grouped });
    expect((await settings()).tabs.find(tab => tab.id === 'original')).toEqual(originalTabs[0]);
    expect(await history()).toEqual(originalHistory);
    const query = page.locator('.query-tab.postgres-query:visible');
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(query.getByRole('gridcell', { name: '精确整数', exact: true })).toBeVisible();

    await selectSource(view);
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    const joinPanel = builder.getByRole('group', { name: text.joins, exact: true });
    async function addJoin(alias: string, left: string) {
      await joinPanel.getByRole('combobox', { name: text.joinTarget, exact: true }).selectOption('"public"."builder_link"');
      await joinPanel.getByRole('button', { name: text.joinAdd, exact: true }).click();
      const step = joinPanel.getByRole('group', { name: text.joinStep(alias), exact: true });
      await step.getByRole('combobox', { name: text.joinKind, exact: true }).selectOption('LEFT');
      const panel = await linkJoinFields(step, alias === 't2' ? 0 : 1, 'id', 'id', alias === 't2' ? 'drag' : 'keyboard');
      await expect(step.getByRole('combobox', { name: text.joinLeft(1), exact: true })).toHaveValue(left);
      if (alias === 't2') {
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath('postgres-builder-field-mapping.png') });
      }
    }
    await addJoin('t2', 't1.id');
    await addJoin('t3', 't2.id');
    const third = joinPanel.getByRole('group', { name: text.joinStep('t3'), exact: true });
    async function addPair(position: number, right: string, operator: string) {
      await third.getByRole('button', { name: text.joinAddPair, exact: true }).click();
      await third.getByRole('combobox', { name: text.joinLeft(position), exact: true }).selectOption('t1.id');
      await third.getByRole('combobox', { name: text.joinRight(position), exact: true }).selectOption(right);
      await third.getByRole('combobox', { name: text.joinOperator(position), exact: true }).selectOption(operator);
    }
    await linkJoinFields(third, 0, 'id', 'alternate_id', 'keyboard');
    await addPair(3, 'id', '<=');
    const openGroups = third.getByRole('button', { name: text.joinGroups, exact: true });
    const groupEditor = third.getByRole('region', { name: text.joinGroupTitle, exact: true });
    await openGroups.click();
    await groupEditor.getByRole('button', { name: groups.addGroup(), exact: true }).click();
    await expect(button(text.open)).toBeDisabled();
    await groupEditor.getByRole('button', { name: groups.apply, exact: true }).click();
    await expect(groupEditor.getByRole('alert')).toContainText('筛选子组不能为空');
    await groupEditor.getByRole('button', { name: groups.cancel, exact: true }).click();
    await expect(sql).toContainText('ON (t2."id" = t3."id" AND t1."id" = t3."alternate_id" AND t1."id" <= t3."id")');
    await openGroups.click();
    await groupEditor.getByRole('button', { name: groups.addGroup(), exact: true }).click();
    for (const position of [1, 2]) {
      await groupEditor.getByRole('combobox', { name: groups.destination(position), exact: true })
        .selectOption({ label: groups.group('1') });
    }
    await groupEditor.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-on-groups.png') });
    await groupEditor.getByRole('button', { name: groups.apply, exact: true }).click();
    await button(text.none).click();
    await builder.getByRole('checkbox', { name: text.choose('t1.id'), exact: true }).check();
    await builder.getByRole('checkbox', { name: text.choose('t3.note'), exact: true }).check();
    await builder.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption('t1.id');
    await builder.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption('>=');
    await builder.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(min);
    await button(zh.table.text013).click();
    const joins = ` FROM ${view} AS t1 LEFT JOIN "public"."builder_link" AS t2 ON (t1."id" = t2."id") LEFT JOIN "public"."builder_link" AS t3 ON (t1."id" <= t3."id" AND (t2."id" = t3."id" OR t1."id" = t3."alternate_id")) WHERE t1."id" >= E'${min}'`;
    const joinSql = 'SELECT t1."id" AS "t1.id", t3."note" AS "t3.note"' + joins + ';';
    await expect(sql).toHaveText(joinSql);
    await expectCopiedBuilderSql(builder, joinSql);
    await builder.getByText(output.save, { exact: true }).click();
    await builder.getByLabel(output.name, { exact: true }).fill('PostgreSQL 跨 schema 脚本');
    const tabsBeforeSave = (await settings()).tabs;
    await button(output.confirm).click();
    await expect.poll(() => page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([
      expect.objectContaining({ name: 'PostgreSQL 跨 schema 脚本', sql: joinSql, connectionId, databaseContext: { state: 'known', database } }),
    ]);
    expect((await settings()).tabs).toEqual(tabsBeforeSave);
    await page.screenshot({ path: info.outputPath('postgres-builder-output.png') });
    await button(text.inspectLabels.explain).click();
    await expect(results.getByRole('tree')).toBeVisible();
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(2), { exact: true })).toBeVisible();
    await expect(results.getByRole('row').filter({ hasText: max })).toContainText('NULL');
    await expect(results.getByRole('row').filter({ hasText: min })).toContainText('匹配来源');
    await sql.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-join.png') });
    await summaryMode.check();
    await button(aggregate.addGroup).click();
    await button(aggregate.addAggregate).click();
    await builder.getByRole('combobox', { name: aggregate.fn(1), exact: true }).selectOption('COUNT');
    await builder.getByRole('combobox', { name: aggregate.column(1), exact: true }).selectOption('t3.note');
    const joinSummarySql = 'SELECT t1."id" AS "t1.id", pg_catalog.COUNT(t3."note") AS "统计_1"' + joins + ' GROUP BY t1."id";';
    await expect(sql).toHaveText(joinSummarySql);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByRole('row').filter({ hasText: max }).getByRole('gridcell', { name: '0', exact: true })).toBeVisible();
    const savedJoins = builder.getByRole('group', { name: joinText.designTitle, exact: true });
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await savedJoins.getByRole('textbox', { name: joinText.designName, exact: true }).fill('跨 schema 汇总');
    await savedJoins.getByRole('button', { name: joinText.designSave, exact: true }).click();
    await expect(savedJoins.getByText(joinText.designSaved, { exact: true })).toBeVisible();
    await addPair(4, 'id', '>=');
    await expect(sql).toContainText('OR t1."id" = t3."alternate_id") AND t1."id" >= t3."id")');
    await third.getByRole('button', { name: text.joinRemovePair(1), exact: true }).click();
    await expect(sql).toContainText('ON (t1."id" <= t3."id" AND (t1."id" = t3."alternate_id") AND t1."id" >= t3."id")');
    await approve(text.joinBackConfirm);
    await joinPanel.getByRole('button', { name: text.joinBack, exact: true }).click();
    await expect(sql).toHaveText('SELECT "id", "label", "ignored", "read_mode" FROM ' + view + ';');
    await button(zh.common.cancel).click();
    await selectSource(view);
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await savedJoins.getByRole('button', { name: joinText.designRefresh, exact: true }).click();
    await savedJoins.getByRole('combobox', { name: joinText.designTitle, exact: true }).selectOption({ label: '跨 schema 汇总' });
    await approve(joinText.designRestoreConfirm);
    await savedJoins.getByRole('button', { name: joinText.designLoad, exact: true }).click();
    await expect(savedJoins.getByText(joinText.designRestored, { exact: true })).toBeVisible();
    await expect(sql).toHaveText(joinSummarySql);
    await savedJoins.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-join-design.png') });
    await summaryMode.uncheck();
    await expect(sql).toHaveText(joinSql);
    await button(text.open).click();
    await expect(builder).toBeHidden();
    await expect.poll(async () => {
      const saved = await settings(); return saved.tabs.find(tab => tab.id === saved.activeTabId)?.sql;
    }).toBe(joinSql);
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(query.getByRole('gridcell', { name: '匹配来源', exact: true })).toBeVisible();

    await selectSource(view);
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    await builder.locator('summary').filter({ hasText: joinText.designTitle }).click();
    await savedJoins.getByRole('button', { name: joinText.designRefresh, exact: true }).click();
    await savedJoins.getByRole('combobox', { name: joinText.designTitle, exact: true }).selectOption({ label: '跨 schema 汇总' });
    await observer.query('ALTER TABLE public.builder_link RENAME COLUMN alternate_id TO changed_alternate');
    await approve(joinText.designRestoreConfirm);
    await savedJoins.getByRole('button', { name: joinText.designLoad, exact: true }).click();
    await expect(builder.getByRole('alert')).toContainText('查询字段已变化');
    await expect(sql).toHaveText('SELECT "id", "label", "ignored", "read_mode" FROM ' + view + ';');
    await button(zh.common.cancel).click();

    const parent = '"odd.schema"."FK Parent"';
    await observer.query('CREATE TABLE ' + parent + ' (id bigint, region bigint, PRIMARY KEY (region,id));' +
      'CREATE TABLE public.fk_child (ref_region bigint, ref_id bigint, alternate_id bigint, ' +
      'CONSTRAINT main_link FOREIGN KEY (ref_region,ref_id) REFERENCES ' + parent + ', ' +
      'CONSTRAINT alt_link FOREIGN KEY (ref_region,alternate_id) REFERENCES ' + parent + ');' +
      'INSERT INTO ' + parent + ' VALUES (7,2),(8,4); INSERT INTO public.fk_child VALUES (2,7,7);');
    await selectSource(parent, 'FK Parent');
    await builder.locator('summary').filter({ hasText: text.joins }).click();
    const nextTable = joinPanel.getByLabel(text.joinTarget, { exact: true });
    const chooseKey = joinPanel.getByLabel(text.joinKeys, { exact: true });
    await nextTable.selectOption('"public"."fk_child"');
    await button(text.joinReadKeys).click();
    await expect(chooseKey.locator('option')).toHaveCount(3);
    await expect(button(text.joinAddKey)).toBeDisabled();
    await chooseKey.selectOption({ label: 't1 · 被目标引用 · main_link · region = ref_region，id = ref_id' });
    await chooseKey.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-join-keys.png') });
    await button(text.joinAddKey).click();
    const mapped = ' FROM ' + parent + ' AS t1 INNER JOIN "public"."fk_child" AS t2 ON (t1."region" = t2."ref_region" AND t1."id" = t2."ref_id")';
    await expect(sql).toContainText(mapped);
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(1), { exact: true })).toBeVisible();
    await nextTable.selectOption(parent);
    await button(text.joinReadKeys).click();
    await chooseKey.selectOption({ label: 't2 · 引用目标 · main_link · ref_region = region，ref_id = id' });
    await observer.query('ALTER TABLE public.fk_child DROP CONSTRAINT main_link');
    await button(text.joinAddKey).click();
    await expect(builder.locator('.modal-content > [role=alert]')).toContainText('外键或字段映射已变化');
    await expect(sql).toContainText(mapped + ';');
    await button(text.joinReadKeys).click();
    await expect(chooseKey.locator('option:checked')).toContainText('t2 · 引用目标 · alt_link');
    await button(text.joinAddKey).click();
    await expect(sql).toContainText(mapped + ' INNER JOIN ' + parent + ' AS t3 ON (t2."ref_region" = t3."region" AND t2."alternate_id" = t3."id")');
    const crossStep = joinPanel.getByRole('group', { name: text.joinStep('t3'), exact: true });
    const crossKind = crossStep.getByLabel(text.joinKind, { exact: true });
    await approve(text.crossConfirm);
    await crossKind.selectOption('CROSS');
    await expect(crossStep.getByLabel(text.joinLeft(1), { exact: true })).toHaveCount(0);
    await expect(sql).toContainText(mapped + ' CROSS JOIN ' + parent + ' AS t3;');
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(2), { exact: true })).toBeVisible();
    await crossKind.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-cross-join.png') });
    await button(zh.common.cancel).click();

    await selectSource(table);
    const beforeChange = await settings();
    await button(text.none).click();
    await builder.getByRole('checkbox', { name: text.choose('id'), exact: true }).check();
    await builder.getByRole('checkbox', { name: text.choose('label'), exact: true }).check();
    await builder.getByText(projection.order, { exact: true }).click();
    await button(projection.earlier('label')).click();
    const idAlias = builder.getByRole('textbox', { name: projection.alias('id'), exact: true });
    const labelAlias = builder.getByRole('textbox', { name: projection.alias('label'), exact: true });
    await labelAlias.fill('id');
    await expect(builder.getByRole('alert')).toContainText('输出别名不能与其他输出列同名');
    await idAlias.fill('原编号');
    await builder.getByRole('checkbox', { name: text.distinct }).check();
    await button(text.sort).click();
    await button(sort.add).click();
    await builder.getByRole('combobox', { name: sort.field(1), exact: true }).selectOption('id');
    await button(sort.apply).click();
    const offset = builder.getByLabel(pagination.offset, { exact: true });
    await offset.fill('1');
    const ordered = 'SELECT DISTINCT "label" AS "id", "id" AS "原编号" FROM ' + table + ' ORDER BY ' + table + '."id" ASC';
    await expect(sql).toHaveText(ordered + ' OFFSET 1;');
    await builder.getByLabel(text.limit, { exact: true }).fill('1');
    await expect(sql).toHaveText(ordered + ' LIMIT 1 OFFSET 1;');
    await button(text.inspectLabels.rows).click();
    await expect(results.getByText(inspect.count(1), { exact: true })).toBeVisible();
    await expect(results.getByRole('columnheader', { name: '原编号 BIGINT', exact: true })).toBeVisible();
    await expect(results.getByRole('gridcell', { name: '2', exact: true })).toBeVisible();
    await offset.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('postgres-builder-offset.png') });
    await observer.query('ALTER TABLE ' + table + ' ADD COLUMN new_column text');
    await builder.getByText(output.save, { exact: true }).click();
    await builder.getByLabel(output.name, { exact: true }).fill('过期来源');
    await button(output.confirm).click();
    await expect(builder.locator('.modal-content > [role=alert]')).toContainText('来源已变化');
    expect(await page.evaluate(async () => (await window.dbark.invoke('queries.list', {})).map(item => item.name))).toEqual(['PostgreSQL 跨 schema 脚本']);
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
