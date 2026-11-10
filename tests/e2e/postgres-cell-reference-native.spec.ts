import { referenceCandidateSortZh as sortText } from '../../src/renderer/locales/referenceCandidateSort.zh-CN';
import { referenceCandidateColumnsZh as displayText } from '../../src/renderer/locales/referenceCandidateColumns.zh-CN';
import { Client } from 'pg';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import { postgresReferencePickerZh as text } from '../../src/renderer/locales/postgresReferencePicker.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { draftHistoryZh as historyText } from '../../src/renderer/locales/draftHistory.zh-CN';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.describe.configure({ timeout: 90000, retries: 0 });

const table = '"public"."child"';
test('PostgreSQL 从命中的单元格选择复合父键并保留该行已有草稿', async ({}, info) => {
  const database = process.env.DBARK_PG_CELL_REFERENCE_DATABASE ?? '', password = process.env.DBARK_PG_CELL_REFERENCE_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PG_CELL_REFERENCE_PORT);
  test.skip(!database, '仅使用本轮隔离 PostgreSQL 实库');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮专用 PostgreSQL 回环实库');
  const profile: PostgresConnectionProfile = {
    id: '', dialect: 'postgresql', name: '隔离 PostgreSQL', group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const reader = new Client({ host: profile.host, port, database, user: database, password, ssl: false, connectionTimeoutMillis: 1500 });
  try {
    await reader.connect();
    const read = async () => (await reader.query('SELECT id, a, b::text, note, hidden FROM public.child ORDER BY id')).rows;
    const baseline = [
      { id: 1, a: '甲组', b: '9007199254740993', note: '第一条', hidden: 1 },
      { id: 2, a: '乙组', b: '9007199254740995', note: '第二条', hidden: 1 },
    ];
    expect(await read()).toEqual(baseline);
    await page.evaluate(async ({ profile, database, table }) => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-cell-reference',
        tabs: [{ id: 'pg-cell-reference', kind: 'table', title: table, connectionId: connection.id, database, table }] });
    }, { profile, database, table });
    await page.reload();

    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const row2 = grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: '第二条', exact: true }) });
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const picker = page.getByRole('dialog', { name: text.title, exact: true });
    const constraint = picker.getByRole('combobox', { name: text.constraint, exact: true });
    const referenceMenu = page.getByRole('menuitem', { name: text.open, exact: true });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // 无父表读取权的外键没有入口，也不影响对普通格的右键操作。
    await row2.getByRole('gridcell', { name: '1', exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(referenceMenu).toHaveCount(0);
    await page.keyboard.press('Escape');

    await cell('9007199254740993').click();
    await page.keyboard.press(modifier + '+Enter');
    await expect(constraint.locator('option')).toHaveText(['fk_alternative · public.alternative', 'fk_pair · public.paired']);
    await constraint.selectOption({ label: 'fk_pair · public.paired' });
    await expect(picker.getByRole('cell', { name: '目标配对', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: text.close, exact: true }).click();

    await cell('第二条').click();
    await button(tableText.edit).click();
    const edit = page.getByRole('dialog', { name: tableText.edit, exact: true });
    await edit.getByLabel('note ' + tableText.valueMode, { exact: true }).selectOption('text');
    await edit.getByLabel('note ' + tableText.value, { exact: true }).fill('第二条草稿');
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    await expect(cell('第二条草稿')).toBeVisible();

    await cell('甲组').click();
    await cell('乙组').click({ button: 'right' });
    await expect(referenceMenu).toBeVisible();
    await page.screenshot({ path: info.outputPath('PostgreSQL外键单元格菜单.png') });
    await referenceMenu.click();
    await expect(constraint.locator('option')).toHaveText(['fk_pair · public.paired']);
    await expect(picker.getByText(text.cellScope('a'), { exact: true })).toBeVisible();
    const target = picker.getByRole('row').filter({ hasText: '目标配对' });
    const use = target.getByRole('button', { name: text.use, exact: true });
    await expect(use).toBeEnabled();
    const candidateTable = picker.getByRole('table'), sortBy = picker.getByRole('combobox', { name: sortText.column, exact: true });
    const direction = picker.getByRole('combobox', { name: sortText.direction, exact: true });
    const firstCandidate = candidateTable.getByRole('row').nth(1);
    await expect(candidateTable.getByRole('cell', { name: '9007199254741001', exact: true })).toHaveCount(0);
    await sortBy.selectOption('b');
    await direction.selectOption('DESC');
    await expect(firstCandidate.getByRole('cell', { name: '9007199254741001', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: text.next, exact: true }).click();
    await expect(firstCandidate.getByRole('cell', { name: '6', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: text.previous, exact: true }).click();
    await expect(firstCandidate.getByRole('cell', { name: '9007199254741001', exact: true })).toBeVisible();
    await picker.getByText(displayText.title, { exact: true }).click();
    await picker.getByRole('button', { name: displayText.keysOnly, exact: true }).click();
    await expect(picker.getByRole('columnheader', { name: 'label', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('columnheader', { name: 'b', exact: true })).toBeVisible();
    const searchBox = picker.getByRole('searchbox', { name: text.query, exact: true });
    await searchBox.fill('目标配对');
    await searchBox.press('Enter');
    await expect(picker.getByRole('cell', { name: '9007199254740997', exact: true })).toBeVisible();
    await expect(searchBox).toBeFocused();
    await expect(direction).toHaveValue('DESC');
    await expect(picker.getByRole('cell', { name: '9007199254740995', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('columnheader', { name: 'label', exact: true })).toHaveCount(0);
    await picker.getByText(displayText.title, { exact: true }).click();
    await picker.getByRole('checkbox', { name: displayText.show('label'), exact: true }).check();
    await expect(use).toBeEnabled();
    await page.screenshot({ path: info.outputPath('PostgreSQL外键候选.png') });
    await searchBox.fill('组');
    await searchBox.press('Enter');
    await expect(use).toBeEnabled();
    await expect(searchBox).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(use).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(candidateTable.getByRole('row').filter({ hasText: '起始二' }).getByRole('button', { name: text.use, exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(use).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(cell('第二条草稿').locator('..')).toContainText('目标组');
    await expect(cell('第二条草稿').locator('..')).toContainText('9007199254740997');
    await expect(cell('第一条').locator('..')).toContainText('9007199254740993');

    await button(historyText.undo).click();
    await expect(cell('乙组')).toBeVisible();
    await expect(cell('9007199254740995')).toBeVisible();
    await expect(cell('第二条草稿')).toBeVisible();
    await button(historyText.redo).click();
    await expect(cell('目标组')).toBeVisible();
    expect(await read()).toEqual(baseline);

    await button(tableText.preview).click();
    const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."child"');
    expect(await read()).toEqual(baseline);
    await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(read).toEqual([baseline[0], { ...baseline[1], a: '目标组', b: '9007199254740997', note: '第二条草稿' }]);
    await expect(tab.getByLabel(tableText.draft, { exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await reader.end();
  }
});
