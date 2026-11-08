import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.describe.configure({ timeout: 90_000, retries: 0 });

test('PostgreSQL CSV 整文件检查拦截尾部错误，保留映射并核对导入时的文件版本', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许本轮隔离回环库及源码窗口');
  const config = { host: '127.0.0.1', port, user, database, password };
  const observer = new Client({ ...config, connectionTimeoutMillis: 3000 });
  const { page, application } = ownedDesktopResources(info);
  let closed = false;
  await observer.connect();
  try {
    await observer.query(`CREATE SEQUENCE public.csv_preflight_calls;
      CREATE TABLE public.csv_preflight_target (
        id bigint PRIMARY KEY, note text, receipt bigint DEFAULT nextval('public.csv_preflight_calls')
      )`);
    const snapshot = async () => (await observer.query('SELECT id::text, note, receipt::text FROM public.csv_preflight_target ORDER BY id::bigint')).rows;
    const noWrites = async () => {
      expect(await snapshot()).toEqual([]);
      expect((await observer.query('SELECT is_called FROM public.csv_preflight_calls')).rows).toEqual([{ is_called: false }]);
    };
    await mkdir(info.outputDir, { recursive: true });
    const bad = info.outputPath('尾部多列.csv'), good = info.outputPath('完整源.csv');
    const body = '\uFEFF内容;编号\r\n"引号内\r\n换行";9223372036854775807\r\n;2\r\n"";3';
    await writeFile(bad, '内容;编号\r\n' + Array.from({ length: 6 }, (_, i) => '样本;' + (i + 1) + '\r\n').join('') + '尾部;7;多列\r\n');
    await writeFile(good, body);
    await application.evaluate(({ dialog, BrowserWindow }, files) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const next = files.shift(), options = args.at(-1) as Electron.OpenDialogOptions;
        if (!next || args[0] !== BrowserWindow.getAllWindows()[0] || options.title !== '选择 PostgreSQL CSV 文件' ||
            options.filters?.[0]?.extensions[0] !== 'csv') throw Error('只允许本例原生文件选择');
        return { canceled: false, filePaths: [next] };
      }) as typeof dialog.showOpenDialog;
    }, [bad, good, good]);
    await page.evaluate(async config => {
      const connection = await window.dbark.invoke('connections.save', { ...config,
        id: '', name: '本例 CSV 检查', dialect: 'postgresql', group: '', color: '#123456', rememberPassword: false,
      });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'csv_preflight_target', tabs: [{
        id: 'csv_preflight_target', title: 'CSV 检查', kind: 'table', connectionId: connection.id,
        database: config.database, table: '"public"."csv_preflight_target"',
      }] });
    }, config);
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    const note = modal.getByRole('combobox', { name: text.target(0), exact: true });
    const id = modal.getByRole('combobox', { name: text.target(1), exact: true });
    const open = async () => {
      await (await navigationMenuItem(tab, { name: text.open, exact: true })).click();
      await modal.getByRole('combobox', { name: text.delimiter, exact: true }).selectOption(';');
    };
    const map = async () => {
      await button(text.choose).click();
      await note.selectOption({ label: 'note' });
      await id.selectOption({ label: 'id' });
      await expect(button(text.confirm)).toBeEnabled();
    };
    const inspect = async () => {
      const mapping = [await note.inputValue(), await id.inputValue()];
      await button(text.check).click();
      await expect(modal.getByText(text.checked, { exact: true })).toBeVisible();
      await expect(modal).toContainText(text.records(3));
      await expect(note).toHaveValue(mapping[0]);
      await expect(id).toHaveValue(mapping[1]);
      await noWrites();
    };
    await expect(tab.getByRole('grid')).toBeVisible();
    await open(); await map();
    await expect(modal.getByRole('table', { name: text.sample }).getByRole('row')).toHaveCount(6);
    await button(text.check).click();
    await expect(modal.getByRole('alert')).toContainText('第 8 条记录有 3 列，预期 2 列');
    await expect(button(text.confirm)).toBeDisabled();
    await noWrites();
    await modal.screenshot({ path: info.outputPath('PostgreSQL CSV 尾部错误.png') });

    await map(); await inspect();
    await modal.screenshot({ path: info.outputPath('PostgreSQL CSV 检查通过.png') });
    await writeFile(good, body.replace('引号内', '已修改'));
    await button(text.confirm).click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('CSV 文件已变化');
    await noWrites();
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();
    await writeFile(good, body);
    await open(); await map(); await inspect();
    await button(text.confirm).click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('PostgreSQL 已提交导入，共 3 行');
    expect(await snapshot()).toEqual([
      { id: '2', note: null, receipt: '2' }, { id: '3', note: '', receipt: '3' },
      { id: '9223372036854775807', note: '引号内\r\n换行', receipt: '1' },
    ]);
    const process = application.process();
    await confirmOwnedDesktopExit(info);
    closed = true;
    expect(process.exitCode).toBe(0);
  } finally {
    if (!closed) retainOwnedDesktopResources(info);
    await observer.end();
  }
});
