import { Client } from 'pg';
import { test, expect, desktop, page, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { gridRowJumpZh as jump } from '../../src/renderer/locales/gridRowJump.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresTableFindZh as find } from '../../src/renderer/locales/postgresTableFind.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_GRID_ROW_JUMP_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表和只读视图跳到本页行并保留活动列、勾选和草稿', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.jump_rows (id bigint PRIMARY KEY, note text);
      INSERT INTO public.jump_rows SELECT g, '记录 ' || g FROM generate_series(1,140) g;
      CREATE VIEW public.jump_view AS SELECT id, note FROM public.jump_rows ORDER BY id`);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '行号跳转专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
      port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 60, activeTabId: 'jump_rows',
        tabs: ['jump_rows', 'jump_view'].map(name => ({ id: name, title: name, kind: 'table' as const,
          connectionId, database, table: '"public"."' + name + '"' })) });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const input = tab.getByRole('textbox', { name: jump.row, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const go = async (row: string, expected: string) => {
      await expect(input).toBeFocused();
      await input.fill('61');
      await expect(button(jump.go)).toBeDisabled();
      await input.fill(row);
      await input.press('Enter');
      await expect(input).toHaveCount(0);
      await expect(cell(expected)).toBeFocused();
    };
    await expect(cell('记录 1')).toBeVisible();
    const firstChecked = cell('1').locator('..').getByRole('checkbox');
    await firstChecked.check();
    await cell('记录 1').click();
    await cell('记录 1').press('F2');
    const editor = page.getByRole('region', { name: table.cellEdit('note'), exact: true });
    const editorInput = editor.getByRole('textbox', { name: table.value, exact: true });
    await expect(editorInput).toBeFocused();
    await editorInput.press('Control+g');
    await expect(input).toHaveCount(0);
    await editorInput.fill('本地草稿');
    await editor.getByRole('button', { name: table.stage, exact: true }).click();
    await cell('本地草稿').click();
    await expect(cell('记录 60')).toHaveCount(0);
    const before = await tasks();
    await page.keyboard.press('Control+g');
    await go('60', '记录 60');
    await expect.poll(() => desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('原生跳行菜单不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    await go('1', '本地草稿');
    await expect(firstChecked).toBeChecked();
    expect(await tasks()).toEqual(before);
    expect((await observer.query('SELECT note FROM public.jump_rows WHERE id = 1')).rows).toEqual([{ note: '记录 1' }]);
    await button(table.discard).click();
    await expect(cell('记录 1')).toBeVisible();
    await button(find.title).click();
    const findPanel = tab.getByRole('region', { name: find.title, exact: true });
    await button(jump.open).click();
    await input.press('Escape');
    await expect(button(jump.open)).toBeFocused();
    await expect(findPanel).toBeVisible();
    await findPanel.getByRole('button', { name: find.close, exact: true }).click();
    await button(jump.open).click();
    await input.fill('60');
    await page.screenshot({ path: info.outputPath('PostgreSQL表页跳到行.png') });
    await button(table.next).click();
    await expect(cell('记录 61')).toBeVisible();
    await expect(input).toHaveCount(0);
    await cell('记录 61').click();
    await button(jump.open).click();
    await go('60', '记录 120');

    await page.locator('[data-workspace-tab-id="jump_view"]').getByRole('button', { name: 'jump_view', exact: true }).click();
    await expect(cell('记录 1')).toBeVisible();
    await expect(tab.locator('.tab-status')).toContainText(table.noWrite);
    await cell('记录 1').click();
    await button(jump.open).click();
    await go('50', '记录 50');
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
