import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Client, types } from 'pg';
import { test, expect, desktop, page, dataDir, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { capturePlanSnapshot, encodePlanSnapshot } from '../../src/shared/explainSnapshot';
import { explainSnapshotZh as snapshotText } from '../../src/shared/explainSnapshot.zh-CN';
import { parsePostgresAnalyze, parsePostgresExplain } from '../../src/shared/postgresExplain';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { explainZh } from '../../src/renderer/locales/explain.zh-CN';
import { queryAnalyzeZh } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_EXPLAIN_LAYOUT_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 最小窗口可读，当前估算和实测计划直接对照基准', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  // 基准保持服务器 JSON 文本，Node.js 不应把 0.00 改写为 0。
  observer.setTypeParser(types.builtins.JSON, value => value);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.explain_layout (id int PRIMARY KEY, note text);
      INSERT INTO public.explain_layout VALUES (1, '原值'), (2, '第二行')`);
    const version = (await observer.query('SHOW server_version')).rows[0].server_version as string;
    const estimatedPath = join(dataDir, '估算.dbark-plan.json'), actualPath = join(dataDir, '实测.dbark-plan.json');
    for (const [actual, path] of [[false, estimatedPath], [true, actualPath]] as const) {
      const options = actual ? 'ANALYZE TRUE, VERBOSE TRUE, BUFFERS TRUE' : 'ANALYZE FALSE, VERBOSE TRUE';
      const raw: unknown = (await observer.query(`EXPLAIN (${options}, FORMAT JSON) SELECT * FROM public.explain_layout`)).rows[0]['QUERY PLAN'];
      if (typeof raw !== 'string') throw Error('隔离数据库未返回原始 JSON 文本');
      const snapshot = capturePlanSnapshot({ elapsedMs: 0, results: [{ columns: [{ key: 'plan', name: 'QUERY PLAN', type: 'JSON' }],
        rows: [{ plan: raw }], statement: '', elapsedMs: 0, truncated: false }],
        ...(actual ? { analysis: parsePostgresAnalyze(raw, version, false) } : { explain: parsePostgresExplain(raw, version, 'json', false) }),
      });
      await writeFile(path, encodePlanSnapshot(snapshot), { flag: 'wx', mode: 0o600 });
    }
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '执行计划布局专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
      port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-explain-layout',
        tabs: [{ id: 'pg-explain-layout', title: '计划布局', kind: 'query', connectionId, database,
          sql: 'SELECT * FROM public.explain_layout LIMIT 1', queryEditorHeight: 300, queryResultPlacement: 'below' }] });
    }, { connectionId, database });
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isMaximized()) window.unmaximize();
      window.setSize(1024, 680);
    });
    await page.reload();
    const query = page.locator('.postgres-query:visible');
    const before = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await query.getByRole('button', { name: postgresZh.explain, exact: true }).click();
    const plan = query.getByRole('region', { name: explainZh.title, exact: true });
    const nodes = plan.getByRole('treeitem');
    await expect(nodes).toHaveCount(2);
    await expect(nodes.first()).toContainText('Limit');
    await nodes.last().click();
    const details = plan.getByLabel(explainZh.details, { exact: true });
    const cost = details.getByText('Total Cost', { exact: true });
    await expect(cost).toHaveCount(1);
    const geometry = await page.evaluate(() => {
      const selectors = ['.postgres-query', '.query-editor-region', '.result-body', '.explain-view', '.explain-toolbar',
        '.explain-search', '.explain-view > .usage-help', '.explain-view > .explain-hint', '.explain-content',
        '.explain-tree-pane', '.explain-tree', '.explain-node', '.explain-detail'];
      return { width: innerWidth, height: innerHeight, regions: Object.fromEntries(selectors.map(selector => {
        const element = document.querySelector(selector) as HTMLElement | null;
        const bounds = element?.getBoundingClientRect();
        return [selector, bounds && { top: bounds.top, bottom: bounds.bottom, height: bounds.height, width: bounds.width,
          scroll: element?.scrollTop, scrollHeight: element?.scrollHeight }];
      })) };
    });
    await writeFile(info.outputPath('执行计划布局.json'), JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: info.outputPath('PostgreSQL最小窗口估算计划.png') });
    await expect(nodes.first()).toBeInViewport({ ratio: 0.8 });
    await expect(nodes.last()).toBeInViewport({ ratio: 0.8 });
    await expect(cost).toBeInViewport({ ratio: 0.8 });
    expect(geometry.regions['.query-editor-region']?.height).toBeGreaterThanOrEqual(130);
    const saved = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(saved.tabs.find(tab => tab.id === 'pg-explain-layout')?.queryEditorHeight).toBe(300);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(before);

    // 替换当前窗口三次准确的本地文件选择路径，读文件与对比均经过产品入口。
    await desktop.evaluate(({ BrowserWindow, dialog }, input) => {
      const window = BrowserWindow.getAllWindows()[0], original = dialog.showOpenDialog;
      const state = globalThis as typeof globalThis & { finishPlanPicker?: () => number };
      let opened = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[1] as Electron.OpenDialogOptions;
        const path = input.paths[opened];
        if (!window || args[0] !== window || options.title !== input.title || !options.filters?.[0]?.extensions.includes('json') || !path)
          throw Error('非本例基准文件选择请求');
        opened++;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
      state.finishPlanPicker = () => { dialog.showOpenDialog = original; delete state.finishPlanPicker; return opened; };
    }, { paths: [estimatedPath, estimatedPath, actualPath], title: snapshotText.choose });
    const receipts = () => page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
    const estimateReceipt = await receipts();
    const comparison = page.getByRole('dialog', { name: snapshotText.compareTitle, exact: true });
    await plan.getByRole('button', { name: snapshotText.compareBaseline, exact: true }).click();
    await expect(comparison).toContainText(basename(estimatedPath));
    const findChange = comparison.getByRole('searchbox', { name: snapshotText.compareFind, exact: true });
    await findChange.fill('NODE TYPE');
    await expect(comparison.getByRole('status', { name: snapshotText.compareFind, exact: true })).toHaveText(snapshotText.compareFindCount(1, 2));
    const estimatedDiff = comparison.getByRole('row', { name: /^Node Type / }).getByRole('cell');
    await expect(estimatedDiff.nth(0)).toHaveText('Seq Scan');
    await expect(estimatedDiff.nth(1)).toHaveText('Limit');
    await page.screenshot({ path: info.outputPath('PostgreSQL当前估算计划对照基准.png') });
    await comparison.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    await expect(cost).toBeInViewport({ ratio: 0.8 });
    expect(await receipts()).toEqual(estimateReceipt);

    await query.getByRole('button', { name: queryAnalyzeZh.open, exact: true }).click();
    const confirmAnalyze = page.getByRole('dialog', { name: queryAnalyzeZh.title, exact: true });
    await confirmAnalyze.getByRole('checkbox').check();
    await confirmAnalyze.getByRole('button', { name: queryAnalyzeZh.confirm, exact: true }).click();
    const actualPlan = query.getByRole('region', { name: queryAnalyzeZh.view, exact: true });
    await expect(actualPlan.getByRole('treeitem').first()).toContainText('Limit');
    await expect(actualPlan.getByRole('button', { name: snapshotText.compareBaseline, exact: true })).toBeEnabled();
    const actualReceipt = await receipts();
    await actualPlan.getByRole('button', { name: snapshotText.compareBaseline, exact: true }).click();
    await expect(actualPlan.getByRole('alert')).toHaveText(snapshotText.compareUnsupported);
    await expect(comparison).toHaveCount(0);
    await actualPlan.getByRole('button', { name: snapshotText.compareBaseline, exact: true }).click();
    await expect(comparison).toContainText(basename(actualPath));
    await expect(comparison.getByRole('columnheader', { name: snapshotText.compareCurrent, exact: true })).toBeVisible();
    await findChange.fill('Actual Rows');
    await expect(comparison.getByRole('row', { name: /^Actual Rows / })).toHaveAttribute('data-plan-match', 'true');
    await page.screenshot({ path: info.outputPath('PostgreSQL当前实测计划对照基准.png') });
    await comparison.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    expect(await receipts()).toEqual(actualReceipt);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { finishPlanPicker: () => number }).finishPlanPicker())).toBe(3);
    expect((await observer.query('SELECT id, note FROM public.explain_layout ORDER BY id')).rows)
      .toEqual([{ id: 1, note: '原值' }, { id: 2, note: '第二行' }]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
