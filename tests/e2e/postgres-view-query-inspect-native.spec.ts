import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { postgresCreateViewZh as create } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { postgresViewEditZh as edit } from '../../src/renderer/locales/postgresViewEdit.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { postgresViewQueryInspectZh as inspect } from '../../src/renderer/locales/postgresViewQueryInspect.zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';

const enabled = process.env.DBARK_VIEW_INSPECT_ENABLED === '1';
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!enabled, '需显式启用 PostgreSQL 视图预览专项');

test('视图定义数据预览和估算计划使用原数据库，只读且不创建视图', async ({}, info) => {
  const database = process.env.DBARK_VIEW_INSPECT_DATABASE ?? '', password = process.env.DBARK_VIEW_INSPECT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_VIEW_INSPECT_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本例源码和隔离回环 PostgreSQL');
  const profile: PostgresConnectionProfile = { id: '', dialect: 'postgresql', name: '视图预览',
    group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };

  try {
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

    await definition(modal).fill("SELECT '普通视图样本'::text AS marker;");
    await sample(modal);
    await expect(cell(modal, '普通视图样本')).toBeVisible();
    await modal.getByRole('button', { name: create.preview, exact: true }).click();
    await expect(modal.locator('.pg-create-sql')).toContainText('CREATE VIEW');
    expect(await viewNames()).toEqual(beforeViews);
    await modal.getByRole('button', { name: create.apply, exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(table.getByRole('gridcell', { name: '普通视图样本', exact: true })).toBeVisible();

    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const infoDialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await infoDialog.getByRole('button', { name: structure.sections.definition, exact: true }).click();
    await infoDialog.getByRole('button', { name: edit.title, exact: true }).click();
    const editPanel = infoDialog.getByRole('region', { name: edit.title, exact: true });
    await editPanel.getByRole('textbox', { name: edit.definition, exact: true }).fill("SELECT '更新前可预览'::text AS marker;");
    await sample(editPanel);
    await expect(cell(editPanel, '更新前可预览')).toBeVisible();
    await expect(table.getByRole('gridcell', { name: '普通视图样本', exact: true })).toBeVisible();
    await editPanel.getByRole('button', { name: edit.preview, exact: true }).click();
    await editPanel.getByRole('button', { name: edit.apply, exact: true }).click();
    await expect(editPanel).toBeHidden();
    await infoDialog.locator('.modal-footer').getByRole('button', { name: structure.close, exact: true }).click();
    await expect(table.getByRole('gridcell', { name: '更新前可预览', exact: true })).toBeVisible();

    const materialized = await open('view_inspect_mv', true);
    await materialized.getByLabel(create.populate).uncheck();
    await definition(materialized).fill("SELECT '物化视图样本'::text AS marker;");
    await sample(materialized);
    await expect(cell(materialized, '物化视图样本')).toBeVisible();
    expect((await viewNames()).some(name => name.includes('view_inspect_mv'))).toBe(false);
    await materialized.getByRole('button', { name: create.preview, exact: true }).click();
    await materialized.getByRole('button', { name: create.materializedApply, exact: true }).click();
    await expect(materialized).toBeHidden();
    const saved = await page.evaluate(target => window.dbark.invoke('postgres.structure.read', target),
      { connectionId, database, table: '"public"."view_inspect_mv"' });
    expect(saved).toMatchObject({ kind: 'm', materialized: { populated: false } });
    expect(await history()).toEqual(beforeHistory);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
