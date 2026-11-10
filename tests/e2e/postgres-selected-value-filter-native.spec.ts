import { Client } from 'pg';
import { test, expect, page, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';
import { tableSelectedFilterZh as selected } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
import { tableCellFilterZh as cellFilter } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { gridHeaderMenuZh as headerText } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_SELECTED_VALUE_FILTER_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表页按勾选原值包含与排除', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.selected_values (id bigint PRIMARY KEY, note text);
      INSERT INTO public.selected_values VALUES (9007199254740993, ''), (9007199254740994, NULL),
      (9007199254740995, 'NULL'), (9007199254740996, ''), (9007199254740997, '后页其他值')`);
    const read = () => observer.query('SELECT id::text, note FROM public.selected_values ORDER BY id');
    const original = (await read()).rows;
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '勾选值专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
      port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 3, activeTabId: 'selected_values',
        tabs: [{ id: 'selected_values', title: 'selected_values', kind: 'table', connectionId, database, table: '"public"."selected_values"' }] });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const id = (suffix: number) => '900719925474099' + suffix;
    const row = (suffix: number) => grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: id(suffix), exact: true }) });
    const toggle = (suffix: number) => row(suffix).getByRole('checkbox');
    const note = (suffix: number) => row(suffix).getByRole('gridcell').last();
    const open = tab.getByRole('button', { name: selected.entry, exact: true });
    const preview = tab.getByRole('group', { name: selected.title, exact: true });
    const apply = tab.getByRole('button', { name: table.applyAdvancedFilter, exact: true });
    const include = preview.getByRole('button', { name: table.valueOptions.add, exact: true });
    const expectRows = async (expected: number[]) => {
      await expect(grid.getByRole('gridcell', { name: /^900719925474099\d$/ })).toHaveText(expected.map(id));
    };
    await expectRows([3, 4, 5]);
    await expect(open).toBeDisabled();
    await toggle(3).check();
    await toggle(4).check();
    await note(3).click();
    await open.click();
    await expect(preview.getByRole('listitem')).toHaveText(['""', selected.null]);
    await expectRows([3, 4, 5]);
    await toggle(4).uncheck();
    await include.click();
    await expect(tab.getByRole('alert')).toContainText(selected.unavailable);
    await expectRows([3, 4, 5]);
    await toggle(4).check();
    await note(4).click();
    await open.click();
    await preview.screenshot({ path: info.outputPath('PostgreSQL表页勾选值预览.png') });
    await include.click();
    await expect(preview).toHaveCount(0);
    await expectRows([3, 4, 5]);
    await apply.click();
    await expectRows([3, 4, 6]);
    const clear = async () => (await navigationMenuItem(tab, { name: table.clearFilter, exact: true })).click();
    await clear();
    await expectRows([3, 4, 5]);
    await toggle(3).check();
    await note(3).click();
    await open.click();
    await expect(preview.getByRole('listitem')).toHaveText(['""']);
    await preview.getByRole('button', { name: table.valueOptions.exclude, exact: true }).click();
    await apply.click();
    await expectRows([4, 5, 7]);
    await clear();
    await expectRows([3, 4, 5]);
    await note(5).click({ button: 'right' });
    await page.getByRole('menu', { name: cellFilter.context, exact: true })
      .getByRole('menuitem', { name: cellFilter.equal, exact: true }).click();
    const advanced = tab.getByRole('region', { name: table.advancedFilter, exact: true });
    await expect(advanced.getByLabel(zh.table.text011, { exact: true })).toHaveValue('NULL');
    await advanced.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await apply.click();
    await expectRows([5]);
    await clear();
    await expectRows([3, 4, 5]);
    await grid.getByRole('columnheader', { name: 'note', exact: true }).click({ button: 'right' });
    await page.getByRole('menu', { name: headerText.menu, exact: true }).getByRole('menuitem', { name: headerText.columnValues, exact: true }).click();
    const values = page.getByRole('dialog', { name: table.valueOptions.open, exact: true });
    await expect(values.getByLabel(table.valueOptions.column, { exact: true })).toHaveValue('c1');
    await expect(values.getByRole('row').filter({ hasText: '"后页其他值"' })).toHaveCount(0);
    await values.getByRole('button', { name: table.valueOptions.read, exact: true }).click();
    await values.getByRole('row').filter({ hasText: '"后页其他值"' }).getByRole('checkbox').check();
    await values.getByRole('button', { name: table.valueOptions.add, exact: true }).click();
    await apply.click();
    await expectRows([7]);
    await clear();
    await expectRows([3, 4, 5]);
    await toggle(5).check();
    await note(3).click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(note(4)).toBeFocused();
    await note(4).evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: selected.rangeExclude, exact: true }).press('Enter');
    const rangePreview = tab.getByRole('group', { name: selected.rangeTitle, exact: true });
    await expect(rangePreview.getByRole('listitem')).toHaveText(['""', selected.null]);
    await expect(rangePreview.getByRole('button', { name: table.valueOptions.add, exact: true })).toHaveCount(0);
    await rangePreview.getByRole('button', { name: table.valueOptions.exclude, exact: true }).click();
    await expectRows([3, 4, 5]);
    await apply.click();
    await expectRows([5, 7]);
    expect((await read()).rows).toEqual(original);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
