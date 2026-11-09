import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { queryResultFindZh } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { pasteGridRangeClipboard } from './grid-cell-range-clipboard';
import { encodeClipboard } from '../../src/renderer/gridClipboard';
import { mysqlQueryBatchEditZh as text } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { gridRangeFillZh as rangeFill } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSelectedFilterZh } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { tableSelectedFilterZh } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
import { tableCellFilterZh } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { tableFindFilterZh } from '../../src/renderer/locales/tableFindFilter.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询矩形粘贴与填充保持精确值和整批事务`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'batch_' + nonce, table = database + '.subject', host = '127.0.0.1', user = 'batch_writer';
  const writerPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
      `CREATE TABLE ${table} (tenant VARCHAR(10), id BIGINT, note VARCHAR(40), qty BIGINT CHECK (qty>=0), guard VARCHAR(30), rank_value BIGINT UNSIGNED,
        PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `INSERT INTO ${table} VALUES ('A',9007199254740992,'原记录甲',1,'未投影甲',11),('A',9007199254740993,'原记录乙',2,'未投影乙',12),
        ('A',9007199254740994,'非选区',3,'未投影丙',13)`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${writerPassword}'`,
      `GRANT SELECT, UPDATE (note,qty,rank_value) ON ${table} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT s.tenant AS 区, s.id AS 编号, s.note AS 同名, s.qty AS 同名, s.rank_value AS 序列 FROM ${table} s ORDER BY s.id DESC;`;
    await page.evaluate(async ({ host, port, user, writerPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: writerPassword, database, dialect,
        name: '查询矩形专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'query-batch',
        tabs: [{ id: 'query-batch', kind: 'query', title: '选区编辑查询', connectionId: connection.id, database, sql },
          { id: 'table-batch', kind: 'table', title: '选区筛选表', connectionId: connection.id, database, table: 'subject' }] });
    }, { host, port, user, writerPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const paste = page.getByRole('dialog', { name: text.paste, exact: true }), fill = page.getByRole('dialog', { name: text.fill, exact: true });
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    const execute = async (visible: string) => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect(cell(visible).first()).toBeVisible();
      if (!await sort.getByLabel(queryResultSortZh.ascending).isVisible()) await sort.click();
      await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    };
    const select = async (name: string, width: number) => {
      await cell(name).first().click();
      await page.keyboard.press('Shift+ArrowDown');
      if (width > 1) await page.keyboard.press('Shift+ArrowRight');
    };
    const review = async (dialog: typeof paste) => {
      await expect(dialog.getByRole('table')).toBeVisible();
      await expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
    };
    const submit = async (dialog: typeof paste) => {
      await dialog.getByRole('checkbox', { name: text.confirm, exact: true }).check();
      await dialog.getByRole('button', { name: text.apply, exact: true }).click();
    };
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note,qty,guard,rank_value FROM ${table} ORDER BY id`))[0];
    await execute('原记录甲');
    const before = await read();
    await select('原记录甲', 2);
    const clipboard = encodeClipboard([['粘贴甲', '9223372036854775807'], [null, '9007199254740993']]);
    await pasteGridRangeClipboard(page, clipboard);
    await review(paste);
    await expect(paste.getByRole('table').getByRole('row')).toHaveCount(5);
    await expect(paste.getByRole('table')).toContainText('9223372036854775807');
    await expect(paste.getByRole('table')).toContainText('原记录乙');
    expect(await read()).toEqual(before);
    await info.attach(`${dialect}查询矩形粘贴预览`, { body: await page.screenshot(), contentType: 'image/png' });
    await submit(paste);
    await expect(paste).toBeHidden();
    const pasted = await read();
    expect(pasted).toEqual([
      { ...before[0], note: '粘贴甲', qty: '9223372036854775807' },
      { ...before[1], note: null, qty: '9007199254740993' },
      before[2],
    ]);

    await execute('粘贴甲');
    await select('粘贴甲', 1);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
    await review(fill);
    await expect(fill.getByRole('table')).toContainText('粘贴甲');
    expect(await read()).toEqual(pasted);
    await submit(fill);
    await expect(fill).toBeHidden();
    const filled = [{ ...pasted[0] }, { ...pasted[1], note: '粘贴甲' }, pasted[2]];
    expect(await read()).toEqual(filled);

    await execute('粘贴甲');
    await select('粘贴甲', 2);
    await pasteGridRangeClipboard(page, '不得写入甲\t4\n不得写入乙\t-1');
    await review(paste);
    await submit(paste);
    await expect(paste.getByRole('alert')).toContainText('已确认目标表事务回滚');
    expect(await read()).toEqual(filled);
    await paste.getByRole('button', { name: text.cancel, exact: true }).click();

    await select('粘贴甲', 2);
    await pasteGridRangeClipboard(page, '不得写入');
    await review(paste);
    await observer.query(`UPDATE ${table} SET guard='外部修改' WHERE id=9007199254740993`);
    await submit(paste);
    await expect(paste.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([filled[0], { ...filled[1], guard: '外部修改' }, filled[2]]);
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items.filter(item => item.outcome === 'committed').map(item => item.committedReportedRows).sort()).toEqual([1, 2]);
    expect(items.find(item => item.outcome === 'rolled-back')).toMatchObject({ evidence: { dmlAcknowledged: 1, rollbackAcknowledged: true } });
    expect(items.find(item => item.outcome === 'not-sent')).toMatchObject({ evidence: { dmlMayHaveBeenSent: false, rollbackAcknowledged: true } });
    await paste.getByRole('button', { name: text.cancel, exact: true }).click();
    await execute('粘贴甲');
    const beforeSequence = await read();
    await select('11', 1);
    await query.getByRole('button', { name: rangeFill.open, exact: true }).click();
    const form = query.getByRole('region', { name: rangeFill.open, exact: true });
    await form.getByRole('combobox', { name: rangeFill.kind, exact: true }).selectOption('sequence');
    await form.getByRole('textbox', { name: rangeFill.sequenceStart, exact: true }).fill('18446744073709551615');
    await form.getByRole('textbox', { name: rangeFill.sequenceStep, exact: true }).fill('-2');
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
    await review(fill);
    await expect(fill.getByRole('table')).toContainText('18446744073709551615');
    expect(await read()).toEqual(beforeSequence);
    await submit(fill);
    await expect(fill).toBeHidden();
    expect(await read()).toEqual([
      { ...beforeSequence[0], rank_value: '18446744073709551615' },
      { ...beforeSequence[1], rank_value: '18446744073709551613' },
      beforeSequence[2],
    ]);
    await observer.query(`UPDATE ${table} SET note = CASE id
      WHEN 9007199254740992 THEN NULL WHEN 9007199254740993 THEN 'NULL' ELSE '' END`);
    await execute('18446744073709551615');
    const beforeNullFill = await read();
    const noteColumn = await grid.getByRole('columnheader').filter({ hasText: /^同名/ }).first().getAttribute('aria-colindex');
    await cell('9007199254740992').locator('..').locator('[role="gridcell"][aria-colindex="' + noteColumn + '"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await query.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('补齐');
    await form.getByRole('checkbox', { name: rangeFill.onlyNull, exact: true }).check();
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
    await review(fill);
    await expect(fill.getByRole('table').getByRole('row')).toHaveCount(2);
    expect(await read()).toEqual(beforeNullFill);
    await submit(fill);
    await expect(fill).toBeHidden();
    expect(await read()).toEqual([{ ...beforeNullFill[0], note: '补齐' }, ...beforeNullFill.slice(1)]);
    await execute('补齐');
    await select('18446744073709551615', 1);
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: queryResultSelectedFilterZh.range, exact: true }).click();
    const filter = query.getByRole('region', { name: queryResultFilterZh.title, exact: true });
    await expect(filter.getByLabel(queryResultFilterZh.operator + ' 1', { exact: true })).toHaveValue('in');
    await expect(cell('13')).toBeVisible();
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell('18446744073709551615')).toBeVisible();
    await expect(cell('18446744073709551613')).toBeVisible();
    await expect(cell('13')).toHaveCount(0);
    await (await navigationMenuItem(query, { name: queryResultFilterZh.clear, exact: true })).click();
    await expect(cell('13')).toBeVisible();
    await select('18446744073709551615', 1);
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: queryResultSelectedFilterZh.rangeExclude, exact: true }).press('Enter');
    await expect(filter.getByLabel(queryResultFilterZh.operator + ' 1', { exact: true })).toHaveValue('notIn');
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell('18446744073709551615')).toHaveCount(0);
    await expect(cell('18446744073709551613')).toHaveCount(0);
    await expect(cell('13')).toBeVisible();
    await (await navigationMenuItem(query, { name: queryResultFilterZh.clear, exact: true })).click();
    await cell('18446744073709551613').click({ button: 'right' });
    await page.getByRole('menuitem', { name: queryResultFilterZh.cellBounds.gt, exact: true }).press('Enter');
    await expect(filter.getByLabel(queryResultFilterZh.input + ' 1', { exact: true })).toHaveValue('18446744073709551613');
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell('18446744073709551615')).toBeVisible();
    await expect(cell('18446744073709551613')).toHaveCount(0);
    await expect(cell('13')).toHaveCount(0);
    await observer.query(`UPDATE ${table} SET note=NULL WHERE id=9007199254740992`);
    await observer.query(`UPDATE ${table} SET guard=CASE id WHEN 9007199254740992 THEN 'A%_'
      WHEN 9007199254740993 THEN '前A%_后' ELSE 'a%_' END`);
    await page.locator('[data-workspace-tab-id="table-batch"]').getByRole('button', { name: '选区筛选表', exact: true }).click();
    const tableTab = page.locator('.table-tab:visible'), tableGrid = tableTab.getByRole('grid');
    const tableCell = (value: string) => tableGrid.getByRole('gridcell', { name: value, exact: true });
    await expect(tableCell('9007199254740992')).toBeVisible();
    await tableTab.locator('[data-table-refresh]').click();
    await tableCell('A%_').click({ button: 'right' });
    await page.getByRole('menuitem', { name: tableCellFilterZh.contains, exact: true }).press('Enter');
    await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue('CONTAINS');
    await expect(tableTab.getByLabel(zh.table.text011, { exact: true })).toHaveValue('A%_');
    await expect(tableCell('a%_')).toBeVisible();
    await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(tableCell('a%_')).toHaveCount(0);
    await expect(tableCell('前A%_后')).toBeVisible();
    await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
    await expect(tableCell('a%_')).toBeVisible();
    await observer.query(`UPDATE ${table} SET guard=CASE id WHEN 9007199254740992 THEN 'A%_🚢'
      WHEN 9007199254740993 THEN '前A%_🚢' ELSE 'A%_🚢后' END`);
    await tableTab.locator('[data-table-refresh]').click();
    const guardValues = ['A%_🚢', '前A%_🚢', 'A%_🚢后'];
    for (const [label, operator, matching] of [
      [tableCellFilterZh.startsWith, 'STARTS WITH', [0, 2]],
      [tableCellFilterZh.endsWith, 'ENDS WITH', [0, 1]],
      [tableCellFilterZh.notStartsWith, 'NOT STARTS WITH', [1]],
      [tableCellFilterZh.notEndsWith, 'NOT ENDS WITH', [2]],
    ] as const) {
      await tableCell('A%_🚢').click({ button: 'right' });
      await page.getByRole('menuitem', { name: label, exact: true }).press('Enter');
      await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue(operator);
      await expect(tableTab.getByLabel(zh.table.text011, { exact: true })).toHaveValue('A%_🚢');
      await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
      const selected: readonly number[] = matching;
      for (const [index, value] of guardValues.entries()) await expect(tableCell(value)).toHaveCount(selected.includes(index) ? 1 : 0);
      await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
      await expect(tableCell('A%_🚢')).toBeVisible();
    }
    const findButton = () => navigationMenuItem(tableTab, { name: tableGridZh.find, exact: true });
    await (await findButton()).click();
    const tableFind = tableTab.getByRole('region', { name: tableGridZh.find, exact: true });
    await tableFind.getByRole('combobox', { name: tableGridZh.column, exact: true }).selectOption('guard');
    await tableFind.getByLabel(tableGridZh.query, { exact: true }).fill('A%_🚢');
    await tableFind.getByRole('checkbox', { name: tableGridZh.case, exact: true }).check();
    await tableFind.getByRole('checkbox', { name: tableGridZh.whole, exact: true }).check();
    await tableFind.getByRole('button', { name: tableFindFilterZh.action, exact: true }).click();
    await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue('TEXT EQUALS');
    await expect(tableTab.getByLabel(zh.table.text011, { exact: true })).toHaveValue('A%_🚢');
    await expect(tableCell('前A%_🚢')).toBeVisible();
    await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(tableCell('前A%_🚢')).toHaveCount(0);
    await expect(tableCell('A%_🚢后')).toHaveCount(0);
    await expect(tableCell('A%_🚢')).toBeVisible();
    await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
    await expect(tableCell('前A%_🚢')).toBeVisible();
    if (await tableFind.isVisible()) await (await findButton()).click();
    await tableCell('18446744073709551613').click({ button: 'right' });
    await page.getByRole('menuitem', { name: queryResultFilterZh.cellBounds.gt, exact: true }).press('Enter');
    await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue('>');
    await expect(tableTab.getByLabel(zh.table.text011, { exact: true })).toHaveValue('18446744073709551613');
    await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(tableCell('18446744073709551615')).toBeVisible();
    await expect(tableCell('18446744073709551613')).toHaveCount(0);
    await expect(tableCell('13')).toHaveCount(0);
    await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
    await expect(tableCell('18446744073709551613')).toBeVisible();
    for (const [label, operator, included, excluded] of [
      [tableSelectedFilterZh.rangeBetween, 'BETWEEN', '18446744073709551613', '13'],
      [tableSelectedFilterZh.rangeNotBetween, 'NOT BETWEEN', '13', '18446744073709551613'],
    ] as const) {
      await tableCell('18446744073709551615').click();
      await page.keyboard.press('Shift+ArrowDown');
      await expect(tableCell('18446744073709551613')).toBeFocused();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue(operator);
      await expect(tableTab.getByLabel(zh.table.filterRangeStart, { exact: true })).toHaveValue('18446744073709551613');
      await expect(tableTab.getByLabel(zh.table.filterRangeEnd, { exact: true })).toHaveValue('18446744073709551615');
      await expect(tableCell('13')).toBeVisible();
      await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
      await expect(tableCell(included)).toBeVisible();
      await expect(tableCell(excluded)).toHaveCount(0);
      await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
      await expect(tableCell('13')).toBeVisible();
      await expect(tableCell('18446744073709551615')).toBeVisible();
    }
    const check = (id: string) => tableCell(id).locator('..').getByRole('checkbox');
    await check('9007199254740992').check();
    await check('9007199254740994').check();
    await tableCell('18446744073709551613').click();
    await (await navigationMenuItem(tableTab, { name: tableSelectedFilterZh.checkedNotBetween, exact: true })).click();
    await expect(tableTab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue('NOT BETWEEN');
    await expect(tableTab.getByLabel(zh.table.filterRangeStart, { exact: true })).toHaveValue('13');
    await expect(tableTab.getByLabel(zh.table.filterRangeEnd, { exact: true })).toHaveValue('18446744073709551615');
    await expect(tableCell('18446744073709551613')).toBeVisible();
    await tableTab.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(tableCell('18446744073709551613')).toHaveCount(0);
    await expect(tableCell('18446744073709551615')).toHaveCount(0);
    await expect(tableCell('13')).toHaveCount(0);
    await tableTab.getByRole('button', { name: formatText(zh.table.filterRemoveCondition, 1), exact: true }).click();
    await expect(tableCell('13')).toBeVisible();
    const column = await tableGrid.getByRole('columnheader').filter({ hasText: /^note/ }).getAttribute('aria-colindex');
    const note = (id: string) => tableCell(id).locator('..').locator('[role="gridcell"][aria-colindex="' + column + '"]');
    await expect(note('9007199254740993')).toHaveText('NULL');
    await note('9007199254740992').click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(note('9007199254740993')).toBeFocused();
    await note('9007199254740993').evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: tableSelectedFilterZh.rangeExclude, exact: true }).press('Enter');
    const preview = tableTab.getByRole('region', { name: tableSelectedFilterZh.rangeTitle, exact: true });
    await expect(preview.getByRole('listitem')).toHaveText(['"NULL"']);
    await expect(preview.getByLabel(tableSelectedFilterZh.nullValue, { exact: true })).toBeVisible();
    await expect(tableCell('9007199254740992')).toBeVisible();
    await preview.getByRole('button', { name: tableSelectedFilterZh.rangeApply, exact: true }).click();
    await expect(tableCell('9007199254740992')).toHaveCount(0);
    await expect(tableCell('9007199254740993')).toHaveCount(0);
    await expect(tableCell('9007199254740994')).toBeVisible();
    await tableTab.getByRole('button', { name: zh.common.clearAll, exact: true }).click();
    await check('9007199254740994').check();
    await (await navigationMenuItem(tableTab, { name: tableGridZh.find, exact: true })).click();
    const find = tableTab.getByRole('region', { name: tableGridZh.find, exact: true });
    await find.getByLabel(tableGridZh.query, { exact: true }).fill('9007199254740993');
    await find.getByRole('button', { name: queryResultFindZh.checkRows, exact: true }).click();
    await expect(check('9007199254740992')).not.toBeChecked();
    await expect(check('9007199254740993')).toBeChecked();
    await expect(check('9007199254740994')).toBeChecked();
    await find.getByRole('button', { name: queryResultFindZh.uncheckRows, exact: true }).click();
    await expect(check('9007199254740993')).not.toBeChecked();
    await expect(check('9007199254740994')).toBeChecked();
    await expect(note('9007199254740994')).toHaveText('');
    await check('9007199254740994').uncheck();
    await check('9007199254740993').check();
    const kind = find.getByRole('combobox').filter({
      has: page.getByRole('option', { name: queryResultFindZh.modes.empty, exact: true }),
    });
    await kind.selectOption('empty');
    await expect(find.getByLabel(tableGridZh.query, { exact: true })).toBeDisabled();
    await find.getByRole('button', { name: queryResultFindZh.checkRows, exact: true }).click();
    await expect(check('9007199254740992')).not.toBeChecked();
    await expect(check('9007199254740993')).toBeChecked();
    await expect(check('9007199254740994')).toBeChecked();
    await find.getByRole('button', { name: queryResultFindZh.uncheckRows, exact: true }).click();
    await expect(check('9007199254740993')).toBeChecked();
    await expect(check('9007199254740994')).not.toBeChecked();
    await find.getByLabel(tableGridZh.replacement, { exact: true }).fill('空值补齐');
    await find.getByRole('button', { name: tableGridZh.preview, exact: true }).click();
    const replaceReview = page.getByRole('dialog', { name: tableGridZh.replaceTitle, exact: true });
    await expect(replaceReview).toContainText(formatText(tableGridZh.count, 1, 1));
    await expect(replaceReview).toContainText('空值补齐');
    await expect(note('9007199254740994')).toHaveText('');
    await replaceReview.getByRole('button', { name: tableGridZh.apply, exact: true }).click();
    await expect(note('9007199254740994')).toHaveText('空值补齐');
    await expect(note('9007199254740993')).toHaveText('NULL');
    expect((await read()).find(row => row.id === '9007199254740994')?.note).toBe('');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
