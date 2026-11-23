import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page, dataDir, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { parseExplainPlan } from '../../src/shared/explain';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { capturePlanSnapshot, encodePlanSnapshot } from '../../src/shared/explainSnapshot';
import { explainSnapshotZh as text, planComparisonTitles } from '../../src/shared/explainSnapshot.zh-CN';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { explainZh } from '../../src/renderer/locales/explain.zh-CN';
import { queryAnalyzeZh } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
const dialect = process.env.DBARK_NETWORK_PLAN_NATIVE;
test.skip(dialect !== 'mysql' && dialect !== 'mariadb', '默认关闭，需显式指定本轮隔离 MySQL 或 MariaDB');

test('MySQL 系列估算、实测及离线快照可通过真实窗口对照基准', async ({}, info) => {
  const database = process.env.DBARK_NETWORK_PLAN_DATABASE ?? '', user = process.env.DBARK_NETWORK_PLAN_USER;
  const password = process.env.DBARK_NETWORK_PLAN_PASSWORD ?? '', port = Number(process.env.DBARK_NETWORK_PLAN_PORT);
  if ((dialect !== 'mysql' && dialect !== 'mariadb') || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_plan_[a-f0-9]{12}$/.test(database) || user !== database || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要独占数据库和 SSH 回环转发');
  const observer = await createConnection({ host: '127.0.0.1', port, database, user, password, connectTimeout: 4000 });
  try {
    const version = (await observer.query<RowDataPacket[]>('SELECT VERSION() AS version'))[0][0].version as string;
    expect(version).toMatch(dialect === 'mysql' ? /^8\.4\./ : /^11\.4\..*MariaDB/i);
    await observer.query('CREATE TABLE plan_subject (id INT PRIMARY KEY, label VARCHAR(50) NOT NULL)');
    await observer.query("INSERT INTO plan_subject VALUES (1, '基准行'), (2, '第二行')");
    const estimateFile = join(dataDir, '估算基准.dbark-plan.json'), actualFile = join(dataDir, '实测基准.dbark-plan.json');
    const currentFile = join(dataDir, '当前估算.dbark-plan.json');
    for (const [actual, file] of [[false, estimateFile], [true, actualFile]] as const) {
      const prefix = !actual ? 'EXPLAIN FORMAT=JSON' : dialect === 'mysql' ? 'EXPLAIN ANALYZE FORMAT=TREE' : 'ANALYZE FORMAT=JSON';
      const row = (await observer.query<RowDataPacket[]>(prefix + ' SELECT * FROM plan_subject'))[0][0];
      const original: unknown = Object.values(row)[0];
      const raw = Buffer.isBuffer(original) ? original.toString('utf8') : original;
      if (typeof raw !== 'string') throw Error('实际服务端没有返回原始计划文本');
      const snapshot = capturePlanSnapshot({ elapsedMs: 0, results: [{ columns: [{ key: 'plan', name: 'EXPLAIN', type: 'STRING' }],
        rows: [{ plan: raw }], statement: '', elapsedMs: 0, truncated: false }],
        ...(actual ? { analysis: parseQueryAnalyzePlan(raw, dialect, version, dialect === 'mysql' ? 'tree' : 'json') }
          : { explain: parseExplainPlan(raw, dialect, version) }),
      });
      await writeFile(file, encodePlanSnapshot(snapshot), { flag: 'wx', mode: 0o600 });
    }
    const profile: NetworkConnectionProfile = {
      id: '', name: '隔离计划对比', dialect, group: '', color: '#123456', host: '127.0.0.1', port, user,
      database, password, rememberPassword: false,
    };
    const id = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, profile);
    await page.evaluate(async ({ id, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'network-plan',
        tabs: [{ id: 'network-plan', title: '查询', kind: 'query', connectionId: id, database,
          sql: 'SELECT * FROM plan_subject WHERE id = 1', queryEditorHeight: 240 }] });
    }, { id, database });
    await page.reload();
    // 固定本轮准确的文件路径。文件 codec、查询菜单和 IPC 均走正式入口。
    await desktop.evaluate(({ BrowserWindow, dialog }, input) => {
      const window = BrowserWindow.getAllWindows()[0], originalSave = dialog.showSaveDialog, originalOpen = dialog.showOpenDialog;
      const state = globalThis as typeof globalThis & { restorePlanPicker?: () => { saves: number; opens: number } };
      let saves = 0, opens = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (args[0] !== window || (args[1] as Electron.SaveDialogOptions).title !== input.saveTitle || saves++) throw Error('非本例保存请求');
        return { canceled: false, filePath: input.currentFile };
      }) as typeof originalSave;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const path = input.openPaths[opens++];
        if (args[0] !== window || (args[1] as Electron.OpenDialogOptions).title !== input.openTitle || !path) throw Error('非本例打开请求');
        return { canceled: false, filePaths: [path] };
      }) as typeof originalOpen;
      state.restorePlanPicker = () => { dialog.showSaveDialog = originalSave; dialog.showOpenDialog = originalOpen; delete state.restorePlanPicker; return { opens, saves }; };
    }, { saveTitle: text.save, openTitle: text.choose, currentFile, openPaths: [estimateFile, actualFile, estimateFile, currentFile] });
    const receipts = () => page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
    const query = page.locator('.query-tab:visible');
    await expect(query).toBeVisible();
    await (await navigationMenuItem(query, { name: zh.query.text014, exact: true })).click();
    const estimated = query.getByRole('region', { name: explainZh.title, exact: true });
    const compare = page.getByRole('dialog', { name: planComparisonTitles[dialect], exact: true });
    const tablePath = dialect === 'mysql' ? '$/query_block/table' : '$/query_block/nested_loop/0/table';
    const compareButton = (scope: typeof estimated) => scope.getByRole('button', { name: text.compareBaseline, exact: true });
    await expect(compareButton(estimated)).toBeEnabled();
    const beforeEstimate = await receipts();
    await compareButton(estimated).click();
    await expect(compare).toContainText(basename(estimateFile));
    const diffSearch = compare.getByRole('searchbox', { name: text.compareFind, exact: true });
    await diffSearch.fill('ACCESS_TYPE');
    await expect(compare.getByRole('status', { name: text.compareFind, exact: true })).toHaveText(text.compareFindCount(1, 1));
    await expect(compare.getByRole('button', { pressed: true })).toContainText(tablePath);
    const access = compare.getByRole('row', { name: /^access_type / }).getByRole('cell');
    await expect(access.nth(0)).toHaveText('ALL');
    await expect(access.nth(1)).toHaveText('const');
    await compare.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    expect(await receipts()).toEqual(beforeEstimate);
    await estimated.getByRole('button', { name: text.save, exact: true }).click();
    await expect(estimated.getByText(text.saved(basename(currentFile)), { exact: true })).toBeVisible();

    await (await navigationMenuItem(query, { name: queryAnalyzeZh.open, exact: true })).click();
    const confirm = page.getByRole('dialog', { name: queryAnalyzeZh.title, exact: true });
    await confirm.getByRole('checkbox').check();
    await confirm.getByRole('button', { name: queryAnalyzeZh.confirm, exact: true }).click();
    const actualPlan = query.getByRole('region', { name: queryAnalyzeZh.view, exact: true });
    await expect(compareButton(actualPlan)).toBeEnabled();
    const beforeActual = await receipts();
    await compareButton(actualPlan).click();
    await expect(compare).toContainText(basename(actualFile));
    const actualField = dialect === 'mysql' ? 'actual.rows' : 'r_rows';
    await diffSearch.fill(actualField);
    const actualRow = compare.getByRole('row', { name: new RegExp('^' + actualField.replace('.', '\\.') + ' ') });
    await expect(actualRow).toHaveAttribute('data-plan-match', 'true');
    if (dialect === 'mysql') await expect(compare.getByRole('rowheader', { name: text.compareDescription, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${dialect}-实际计划对比.png`) });
    await compare.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    expect(await receipts()).toEqual(beforeActual);

    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.entry, exact: true })).click();
    const offline = page.getByRole('dialog', { name: text.title, exact: true });
    await offline.getByRole('button', { name: text.choose, exact: true }).click();
    await offline.getByRole('button', { name: text.compareChoose, exact: true }).click();
    await expect(offline.getByRole('region', { name: planComparisonTitles[dialect], exact: true })).toContainText(basename(currentFile));
    await offline.getByRole('button', { name: text.close, exact: true }).click();
    expect(await receipts()).toEqual(beforeActual);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restorePlanPicker: () => unknown }).restorePlanPicker())).toEqual({ opens: 4, saves: 1 });
    expect((await observer.query<RowDataPacket[]>('SELECT id,label FROM plan_subject ORDER BY id'))[0]).toEqual([{ id: 1, label: '基准行' }, { id: 2, label: '第二行' }]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { await observer.end(); }
});
