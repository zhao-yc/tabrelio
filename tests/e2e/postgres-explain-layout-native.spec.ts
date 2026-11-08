import { writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { test, expect, desktop, page, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { explainZh } from '../../src/renderer/locales/explain.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_EXPLAIN_LAYOUT_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 最小窗口同时展示估算树根节点和选中节点成本', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.explain_layout (id int PRIMARY KEY, note text);
      INSERT INTO public.explain_layout VALUES (1, '原值'), (2, '第二行')`);
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
    expect((await observer.query('SELECT id, note FROM public.explain_layout ORDER BY id')).rows)
      .toEqual([{ id: 1, note: '原值' }, { id: 2, note: '第二行' }]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
