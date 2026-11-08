import { Client } from 'pg';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { postgresCreateViewZh as create } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { postgresDependenciesZh as dependencies } from '../../src/renderer/locales/postgresDependencies.zh-CN';
import { postgresViewEditZh as edit } from '../../src/renderer/locales/postgresViewEdit.zh-CN';
import { postgresMaterializedColumnNamesZh as materializedColumns } from '../../src/renderer/locales/postgresMaterializedColumnNames.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { viewOutputColumnsZh as columnsText } from '../../src/renderer/locales/viewOutputColumns.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import { zh } from '../../src/renderer/locales/zh-CN';

const enabled = process.env.DBARK_VIEW_INSPECT_ENABLED === '1';
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!enabled, '需显式启用 PostgreSQL 视图预览专项');

test('在原数据库预览视图并编辑列名，确认前无写入且依赖得到保留', async ({}, info) => {
  const database = process.env.DBARK_VIEW_INSPECT_DATABASE ?? '', password = process.env.DBARK_VIEW_INSPECT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_VIEW_INSPECT_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本例源码和隔离回环 PostgreSQL');
  const profile: PostgresConnectionProfile = { id: '', dialect: 'postgresql', name: '视图预览',
    group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };

  const observer = new Client({ host: profile.host, port, database, user: database, password });
  const oid = async () => (await observer.query("SELECT 'public.view_inspect_subject'::regclass::oid::text AS oid")).rows[0].oid;
  const names = async () => (await observer.query('SELECT * FROM public.view_inspect_subject LIMIT 0')).fields.map(field => field.name);
  try {
    await observer.connect();
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, profile);
    await page.reload();
    const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) });
    await connection.getByRole('button', { name: profile.name, exact: true }).click();
    const db = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await db.locator('.tree-label').click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const beforeHistory = await history();
    const viewNames = () => page.evaluate(async target => (await window.dbark.invoke('metadata.objects', target))
      .filter(object => object.kind === 'view').map(object => object.name), { connectionId, database });
    const beforeViews = await viewNames();
    const panel = (scope: Locator) => scope.getByRole('region', { name: inspect.region, exact: true });
    const sample = (scope: Locator) => panel(scope).getByRole('button', { name: inspect.rows, exact: true }).click();
    const plan = (scope: Locator) => panel(scope).getByRole('button', { name: inspect.explain, exact: true }).click();
    const cell = (scope: Locator, value: string) => panel(scope).getByRole('gridcell', { name: value, exact: true }).first();
    const table = page.locator('.postgres-table-tab:visible').getByRole('grid');
    const open = async (name: string, materialized = false) => {
      const title = materialized ? create.materializedTitle : create.title;
      await clickSidebarAction(db, { name: title, exact: true });
      const modal = page.getByRole('dialog', { name: title, exact: true });
      await modal.getByLabel(create.schema, { exact: true }).selectOption('public');
      await modal.getByLabel(materialized ? create.materializedName : create.name, { exact: true }).fill(name);
      return modal;
    };
    const definition = (modal: Locator) => modal.getByRole('textbox', { name: create.definition, exact: true });
    const columns = (scope: Locator) => scope.getByRole('group', { name: columnsText.title, exact: true });
    const column = (scope: Locator, index: number) => columns(scope).getByRole('textbox', { name: columnsText.column(index), exact: true });
    const columnButton = (scope: Locator, label: string) => columns(scope).getByRole('button', { name: label, exact: true });
    async function stageNames(scope: Locator, names: string[]) {
      await columnButton(scope, columnsText.fromPreview).click();
      for (const [index, name] of names.entries()) await column(scope, index + 1).fill(name);
      await columnButton(scope, columnsText.apply).click();
    }


    const modal = await open('view_inspect_subject');
    await expect(panel(modal).getByRole('button', { name: inspect.rows, exact: true })).toBeDisabled();
    await definition(modal).fill("SELECT value, current_setting('transaction_read_only') AS mode, current_setting('search_path') AS path FROM generate_series(1, 105) AS value ORDER BY value;");
    await sample(modal);
    await expect(panel(modal).getByText(inspect.truncated(100), { exact: true })).toBeVisible();
    await expect(cell(modal, 'on')).toBeVisible();
    await expect(cell(modal, 'pg_catalog')).toBeVisible();
    expect(await viewNames()).toEqual(beforeViews);

    // 改稿后原结果清空，慢查询的迟到响应也不能覆盖新草稿。
    await definition(modal).fill("SELECT pg_sleep(0.7), '旧结果' AS marker;");
    await expect(panel(modal).getByRole('grid')).toHaveCount(0);
    await sample(modal);
    await definition(modal).fill("SELECT nextval('public.fixture_seq') AS value;");
    await expect(panel(modal).getByRole('button', { name: inspect.rows, exact: true })).toBeEnabled();
    await expect(panel(modal).getByRole('grid')).toHaveCount(0);
    await plan(modal);
    await expect(panel(modal).getByRole('tree')).toBeVisible();
    await sample(modal);
    await expect(panel(modal).getByRole('alert')).toContainText(/read-only transaction/i);
    await definition(modal).fill("SELECT CASE WHEN is_called THEN '序列已改变' ELSE '序列原样' END AS marker FROM public.fixture_seq;");
    await sample(modal);
    await expect(cell(modal, '序列原样')).toBeVisible();

    await definition(modal).fill("SELECT '普通视图样本'::text AS marker, '辅助样本'::text AS other;");
    await sample(modal);
    await expect(cell(modal, '普通视图样本')).toBeVisible();
    await stageNames(modal, ['正文', '第二输出']);
    await sample(modal);
    await expect(panel(modal).getByRole('columnheader', { name: /正文/ })).toBeVisible();
    await modal.getByRole('button', { name: create.preview, exact: true }).click();
    await expect(modal.locator('.pg-create-sql')).toContainText('CREATE VIEW "public"."view_inspect_subject" ("正文", "第二输出")');
    expect(await viewNames()).toEqual(beforeViews);
    await modal.getByRole('button', { name: create.apply, exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(table.getByRole('gridcell', { name: '普通视图样本', exact: true })).toBeVisible();
    expect(await names()).toEqual(['正文', '第二输出']);
    const originalOid = await oid();
    await observer.query('CREATE VIEW public.view_inspect_depend AS SELECT "正文" FROM public.view_inspect_subject');
    const target = { connectionId, database, table: '"public"."view_inspect_subject"' };
    const rolledBack = await page.evaluate(async target => {
      const original = await window.dbark.invoke('postgres.structure.read', target);
      const preview = await window.dbark.invoke('postgres.editView.preview', { ...target,
        stamp: original.viewEditStamp!, definition: "SELECT 9::integer AS marker, 'x'::text AS other;",
        columnNames: ['第二输出', '正文'] });
      return window.dbark.invoke('postgres.editView.apply', { connectionId: target.connectionId, database: target.database, token: preview.token });
    }, target);
    expect(rolledBack.outcome).toBe('rolledBack');
    expect(await names()).toEqual(['正文', '第二输出']);


    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const infoDialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await infoDialog.getByRole('button', { name: structure.sections.definition, exact: true }).click();
    await infoDialog.getByRole('button', { name: edit.title, exact: true }).click();
    const editPanel = infoDialog.getByRole('region', { name: edit.title, exact: true });
    await editPanel.getByRole('textbox', { name: edit.definition, exact: true }).fill("SELECT '更新前可预览'::text AS marker, '更新辅助'::text AS other;");
    await sample(editPanel);
    await expect(cell(editPanel, '更新前可预览')).toBeVisible();
    await stageNames(editPanel, ['第二输出', '正文']);
    await expect(table.getByRole('gridcell', { name: '普通视图样本', exact: true })).toBeVisible();
    await editPanel.getByRole('button', { name: edit.preview, exact: true }).click();
    await expect(editPanel.getByLabel(edit.sql)).toContainText('RENAME COLUMN');
    expect(await names()).toEqual(['正文', '第二输出']);
    await editPanel.getByRole('button', { name: edit.apply, exact: true }).click();
    await expect(editPanel).toBeHidden();
    await infoDialog.locator('.modal-footer').getByRole('button', { name: structure.close, exact: true }).click();
    await expect(table.getByRole('gridcell', { name: '更新前可预览', exact: true })).toBeVisible();
    expect(await oid()).toBe(originalOid);
    expect(await names()).toEqual(['第二输出', '正文']);
    expect((await observer.query('SELECT "正文" FROM public.view_inspect_depend')).rows).toEqual([{ 正文: '更新前可预览' }]);

    const renameOnly = await page.evaluate(async target => {
      const original = await window.dbark.invoke('postgres.structure.read', target);
      const preview = await window.dbark.invoke('postgres.editView.preview', { ...target,
        stamp: original.viewEditStamp!, definition: original.viewDefinition!, columnNames: ['原位置的新列名'] });
      const result = await window.dbark.invoke('postgres.editView.apply', { connectionId: target.connectionId, database: target.database, token: preview.token });
      return { statements: preview.statements, outcome: result.outcome };
    }, target);
    expect(renameOnly.outcome).toBe('committed');
    expect(renameOnly.statements).toHaveLength(3);
    expect(renameOnly.statements[0]).toContain('SET SCHEMA');
    expect(renameOnly.statements.slice(1).every(sql => /^ALTER VIEW .* RENAME COLUMN /.test(sql))).toBe(true);
    expect(await oid()).toBe(originalOid);
    expect(await names()).toEqual(['原位置的新列名', '正文']);
    expect((await observer.query('SELECT "正文" FROM public.view_inspect_depend')).rows).toEqual([{ 正文: '更新前可预览' }]);

    await observer.query('CREATE SCHEMA "源.表"; CREATE TABLE "源.表"."基""表" (n integer PRIMARY KEY); INSERT INTO "源.表"."基""表" VALUES (2)');
    const materialized = await open('view_inspect_mv', true);
    await materialized.getByLabel(create.populate).uncheck();
    await definition(materialized).fill(`SELECT '物化视图样本'::text AS marker, n AS suffix
      FROM "源.表"."基""表" CROSS JOIN public.view_inspect_subject;`);
    await sample(materialized);
    await expect(cell(materialized, '物化视图样本')).toBeVisible();
    await columnButton(materialized, columnsText.add).click();
    await column(materialized, 1).fill('快照');
    await columnButton(materialized, columnsText.apply).click();
    expect((await viewNames()).some(name => name.includes('view_inspect_mv'))).toBe(false);
    await materialized.getByRole('button', { name: create.preview, exact: true }).click();
    await materialized.getByRole('button', { name: create.materializedApply, exact: true }).click();
    await expect(materialized).toBeHidden();
    const mvTarget = { connectionId, database, table: '"public"."view_inspect_mv"' };
    const readMaterialized = () => page.evaluate(target => window.dbark.invoke('postgres.structure.read', target), mvTarget);
    const previewMaterialized = (columnNames: string[]) => page.evaluate(async ({ target, columnNames }) => {
      const original = await window.dbark.invoke('postgres.structure.read', target);
      return window.dbark.invoke('postgres.viewManage.preview', { ...target, action: 'renameColumns',
        relationKind: 'materialized', stamp: original.materializedManageStamp!, columnNames });
    }, { target: mvTarget, columnNames });
    const applyMaterialized = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.viewManage.apply', input),
      { connectionId, database, token });
    const saved = await readMaterialized();
    expect(saved).toMatchObject({ kind: 'm', materialized: { populated: false } });
    expect(saved.columns.map(column => column.name)).toEqual(['快照', 'suffix']);
    const unfilledRename = await previewMaterialized(['缓存', 'suffix']);
    expect((await applyMaterialized(unfilledRename.token)).outcome).toBe('committed');
    const unfilled = await readMaterialized();
    expect(unfilled.materialized?.populated).toBe(false);
    expect(unfilled.columns.map(column => column.name)).toEqual(['缓存', 'suffix']);

    await observer.query(`
      REFRESH MATERIALIZED VIEW public.view_inspect_mv;
      CREATE UNIQUE INDEX view_inspect_mv_idx ON public.view_inspect_mv ("缓存");
      CREATE VIEW public.view_inspect_mv_dep AS SELECT "缓存" FROM public.view_inspect_mv;
      COMMENT ON MATERIALIZED VIEW public.view_inspect_mv IS '保留的视图备注';
      COMMENT ON COLUMN public.view_inspect_mv."缓存" IS '原第一列备注';
    `);
    const storage = async () => (await observer.query(`
      SELECT c.oid::text, c.relfilenode::text, c.relispopulated,
        'public.view_inspect_mv_idx'::regclass::oid::text AS index_oid
      FROM pg_catalog.pg_class c WHERE c.oid = 'public.view_inspect_mv'::regclass
    `)).rows[0];
    const beforeStorage = await storage();
    const staleNames = await previewMaterialized(['计划列', 'suffix']);
    await observer.query('ALTER MATERIALIZED VIEW public.view_inspect_mv RENAME COLUMN suffix TO outside_rename');
    const stale = await applyMaterialized(staleNames.token);
    expect(stale).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原视图已变化') });
    expect((await readMaterialized()).columns.map(column => column.name)).toEqual(['缓存', 'outside_rename']);
    await observer.query('ALTER MATERIALIZED VIEW public.view_inspect_mv RENAME COLUMN outside_rename TO suffix');

    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const mvStructure = page.getByRole('dialog', { name: structure.title, exact: true });
    await mvStructure.getByRole('button', { name: materializedColumns.title, exact: true }).click();
    const namesPanel = mvStructure.getByRole('region', { name: materializedColumns.title, exact: true });
    const previewNames = namesPanel.getByRole('button', { name: materializedColumns.preview, exact: true });
    await expect(previewNames).toBeDisabled();
    await namesPanel.getByRole('textbox', { name: materializedColumns.name('缓存'), exact: true }).fill('suffix');
    await namesPanel.getByRole('textbox', { name: materializedColumns.name('suffix'), exact: true }).fill('缓存');
    await previewNames.click();
    await expect(namesPanel.getByLabel(materializedColumns.sql)).toContainText('ALTER MATERIALIZED VIEW "public"."view_inspect_mv" RENAME COLUMN');
    expect((await readMaterialized()).columns.map(column => column.name)).toEqual(['缓存', 'suffix']);
    expect(await storage()).toEqual(beforeStorage);
    await namesPanel.getByRole('button', { name: materializedColumns.apply, exact: true }).click();
    await expect(namesPanel).toBeHidden();
    await expect(mvStructure.getByRole('rowheader', { name: 'suffix', exact: true })).toBeVisible();
    await mvStructure.getByRole('button', { name: dependencies.open, exact: true }).click();
    const links = page.getByRole('dialog', { name: dependencies.title, exact: true });
    const linkPreview = links.getByRole('region', { name: dependencies.definitionTitle, exact: true });
    const linkSql = linkPreview.locator('.monaco-editor .view-lines');
    const closeDefinition = linkPreview.getByRole('button', { name: dependencies.closeDefinition, exact: true });
    const references = links.getByRole('region', { name: dependencies.references, exact: true });
    const downstream = links.getByRole('region', { name: dependencies.referencedBy, exact: true });
    const link = (scope: Locator, label: string) => scope.getByRole('row').filter({ hasText: label })
      .getByRole('button', { name: /查看.+的定义/ });
    await link(references, '"源.表"."基""表".n').click();
    await expect(linkSql).toContainText('CREATE TABLE "源.表"."基""表"');
    await expect(linkSql).toContainText('PRIMARY KEY');
    await closeDefinition.click();
    const dependent = link(downstream, 'view_inspect_mv_dep');
    await dependent.click();
    await expect(linkSql).toContainText('CREATE VIEW "public"."view_inspect_mv_dep"');
    await closeDefinition.click();
    // 原视图仍绑定改名前的字段身份；随后同名重建才按新列名绑定。
    expect((await observer.query('SELECT "缓存" FROM public.view_inspect_mv_dep')).rows).toEqual([{ 缓存: '物化视图样本' }]);
    await observer.query(`DROP VIEW public.view_inspect_mv_dep;
      CREATE VIEW public.view_inspect_mv_dep AS SELECT "缓存" FROM public.view_inspect_mv WHERE "缓存" = 2`);
    await dependent.click();
    await expect(linkPreview.getByRole('alert')).toContainText('定义对象已变化');
    await expect(linkSql).toHaveCount(0);
    await links.getByRole('button', { name: zh.common.refresh, exact: true }).click();
    await dependent.click();
    await expect(linkSql).toContainText('CREATE VIEW "public"."view_inspect_mv_dep"');
    await expect(linkSql).toContainText('WHERE');
    await closeDefinition.click();
    await links.getByRole('button', { name: dependencies.back, exact: true }).click();
    await expect(mvStructure.getByRole('rowheader', { name: 'suffix', exact: true })).toBeVisible();
    await mvStructure.locator('.modal-footer').getByRole('button', { name: structure.close, exact: true }).click();
    const final = await readMaterialized();
    expect(final.comment).toBe('保留的视图备注');
    expect(final.columns.map(column => [column.name, column.comment])).toEqual([['suffix', '原第一列备注'], ['缓存', null]]);
    expect(await storage()).toEqual(beforeStorage);
    expect((await observer.query('SELECT suffix, "缓存" FROM public.view_inspect_mv')).rows).toEqual([{ suffix: '物化视图样本', 缓存: 2 }]);
    expect((await observer.query('SELECT "缓存" FROM public.view_inspect_mv_dep')).rows).toEqual([{ 缓存: 2 }]);
    await observer.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.view_inspect_mv');
    expect((await observer.query('SELECT suffix FROM public.view_inspect_mv')).rows).toEqual([{ suffix: '物化视图样本' }]);
    await clickSidebarAction(connection.locator('.object-row').filter({ hasText: 'view_inspect_subject' }),
      { name: structure.open + ' "public"."view_inspect_subject"', exact: true });
    await infoDialog.getByRole('button', { name: dependencies.open, exact: true }).click();
    await link(downstream, 'view_inspect_mv').click();
    await expect(linkSql).toContainText('CREATE MATERIALIZED VIEW "public"."view_inspect_mv"');
    await expect(linkSql).toContainText('view_inspect_mv_idx');
    await closeDefinition.click();
    await links.getByRole('button', { name: dependencies.back, exact: true }).click();
    await infoDialog.locator('.modal-footer').getByRole('button', { name: structure.close, exact: true }).click();
    expect(await history()).toEqual(beforeHistory);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer.end();
  }
});
