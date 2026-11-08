import { txtImportZh } from '../../src/shared/txtImport';
import { parse as parseTxt } from 'csv-parse/sync';
import { test, expect, desktop, page } from './desktop-fixture';
import { isolatedDatabase } from './live-helpers';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tableFilteredExportZh as text } from '../../src/renderer/locales/tableFilteredExport.zh-CN';
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';
import { tableValueOptionsZh as valuesText } from '../../src/renderer/locales/tableValueOptions.zh-CN';
import { fullQueryExportProfilesZh as profile } from '../../src/renderer/locales/fullQueryExportProfiles.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_TABLE_HTML_EXPORT_NATIVE !== '1', '仅在隔离 MySQL 或 MariaDB 实库运行');

test('表页和视图 HTML 导出应用筛选、隐藏排序列和有序字段投影', async ({}, info) => {
  const port = Number(process.env.DBARK_TEST_PORT);
  const dialect = process.env.DBARK_SEARCH_EDIT_DIALECT;
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_TEST_HOST !== '127.0.0.1' ||
    (dialect !== 'mysql' && dialect !== 'mariadb') ||
    !Number.isInteger(port) || port <= 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(process.env.DBARK_TEST_PASSWORD ?? '') ||
    !/^tabrelio-search-[a-f0-9]{12}$/.test(process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? ''))
    throw Error('需要本轮回环隔离库');

  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    const table = `\`${database}\`.html_subject`;
    await observer.query(`CREATE TABLE ${table}(id BIGINT UNSIGNED PRIMARY KEY, bucket VARCHAR(20), note TEXT, payload VARBINARY(20))`);
    const data = Array.from({length: 120}, (_, i) => [
      i + 1, i % 3 === 0 ? '匹配' : '排除', i === 0 ? '<img src=x onerror=alert(1)> & 中文' : i === 3 ? null : i === 6 ? '' : '记录 ' + i,
      Buffer.from([i, 0, 255]),
    ] as const);
    await observer.query(`INSERT INTO ${table} VALUES ?`, [data]);
    await observer.query(`CREATE VIEW \`${database}\`.html_view AS SELECT id, bucket, note, payload FROM ${table}`);
    await observer.query(`CREATE VIEW \`${database}\`.note_only AS SELECT id, note FROM ${table}`);
    await mkdir(info.outputDir, {recursive: true});
    const paths = ['html_subject.html', 'html_subject.xml', 'html_subject.txt', 'html_view.html', 'html_view.xml', 'html_view.txt'].map(name => info.outputPath(name));
    for (const path of paths) await writeFile(path, '原文件');
    await desktop.evaluate(({dialog, BrowserWindow}, targets) => {
      const original = dialog.showSaveDialog;
      let index = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const window = BrowserWindow.getAllWindows()[0];
        const options = args[1] as Electron.SaveDialogOptions;
        if (args[0] !== window || !targets[index] || options.filters?.[0]?.extensions[0] !== targets[index].split('.').at(-1)) throw Error('本例文件选择越界');
        return {canceled: false, filePath: targets[index++]};
      }) as typeof original;
      Object.assign(globalThis, { restoreTableHtmlPicker: () => { dialog.showSaveDialog = original; return index; } });
    }, paths);
    const node = page.locator('.connection-node').filter({has: page.getByRole('button', {name: connectionName, exact: true})});
    const databaseRow = node.locator('.database-row').getByRole('button', {name: database, exact: true});
    if (!await node.locator('.object-row').getByRole('button', {name: 'html_subject', exact: true}).isVisible()) await databaseRow.click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const baseline = await history();
    const modal = page.getByRole('dialog', {name: text.title, exact: true});
    const chooseProfile = async () => {
      await modal.getByText(profile.title, { exact: true }).click();
      await modal.getByRole('combobox', { name: profile.select, exact: true }).selectOption('交付字段');
      await modal.getByRole('button', { name: profile.apply, exact: true }).click();
    };
    for (const [index, name] of ['html_subject', 'html_view'].entries()) {
      await node.locator('.object-row .tree-label').getByText(name, {exact: true}).click();
      const tab = page.locator('.table-tab:visible');
      const grid = tab.getByRole('grid');
      await expect(grid).toBeVisible();
      await tab.getByRole('combobox', {name: zh.table.text021, exact: true}).selectOption('50');
      await tab.getByRole('button', {name: sortText.entry, exact: true}).click();
      const sorting = tab.getByRole('region', {name: sortText.title, exact: true});
      await sorting.getByRole('button', {name: sortText.add, exact: true}).click();
      await sorting.getByRole('combobox', {name: sortText.field(1), exact: true}).selectOption('id');
      await sorting.getByRole('combobox', {name: sortText.direction(1), exact: true}).selectOption('DESC');
      await sorting.getByRole('button', {name: sortText.apply, exact: true}).click();
      await expect(grid.getByText('记录 119', {exact: true})).toBeVisible();
      await (await navigationMenuItem(tab, {name: valuesText.open, exact: true})).click();
      const candidates = page.getByRole('dialog', {name: valuesText.title, exact: true});
      await candidates.getByRole('combobox', {name: valuesText.column, exact: true}).selectOption('bucket');
      await candidates.getByRole('button', {name: valuesText.read, exact: true}).click();
      await candidates.getByRole('checkbox', {name: '"匹配"', exact: true}).check();
      await candidates.getByRole('button', {name: valuesText.apply, exact: true}).click();
      await expect(candidates).toBeHidden();
      await expect(grid.getByText('记录 119', {exact: true})).toHaveCount(0);
      await expect(grid.getByText('记录 117', {exact: true})).toBeVisible();
      await (await navigationMenuItem(tab, {name: text.entry, exact: true})).click();
      if (index === 0) {
        await modal.getByRole('combobox', { name: text.format, exact: true }).selectOption('html');
        for (const field of ['id', 'bucket']) await modal.getByRole('checkbox', {name: text.fieldLabel(field), exact: true}).uncheck();
        await modal.getByRole('button', {name: text.fieldUp('payload'), exact: true}).click();
        await modal.getByText(profile.title, { exact: true }).click();
        await modal.getByLabel(profile.name, { exact: true }).fill('交付字段');
        await modal.getByRole('button', { name: profile.add, exact: true }).click();
        await expect(modal.getByText(profile.saved, { exact: true })).toBeVisible();
      } else {
        await chooseProfile();
        await expect(modal.getByText(profile.applied, { exact: true })).toBeVisible();
        await expect(modal.getByRole('list', { name: text.fieldOrder, exact: true }).locator('li > span')).toHaveText(['payload', 'note']);
        await modal.screenshot({path: info.outputPath(dialect + ' 表导出方案.png')});
      }
      await expect(modal.getByRole('combobox', { name: text.format, exact: true })).toHaveValue('html');
      await expect(modal.getByRole('button', { name: text.start, exact: true })).toBeDisabled();
      await expect(modal.getByLabel(text.encoding, {exact: true})).toHaveValue('utf8');
      await expect(modal.getByLabel(text.encoding, {exact: true})).toBeDisabled();
      await modal.getByRole('button', {name: text.choose, exact: true}).click();
      await modal.getByRole('button', {name: text.start, exact: true}).click();
      await expect(modal.getByText(text.completed(40), {exact: true})).toBeVisible();
      const actual = await page.evaluate(markup => {
        const doc = new DOMParser().parseFromString(markup, 'text/html');
        return { title: doc.title, headers: [...doc.querySelectorAll('th')].map(cell => cell.textContent),
          rows: [...doc.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)),
          active: doc.querySelectorAll('script,img,iframe,[onerror]').length };
      }, await readFile(paths[index * 3], 'utf8'));
      expect(actual).toEqual({ title: '表数据', headers: ['payload', 'note'],
        rows: data.filter(row => row[1] === '匹配').reverse().map(row => ['base64:' + row[3].toString('base64'), row[2] === null ? 'NULL' : row[2] || '空字符串']), active: 0 });
      if (index === 1) await modal.screenshot({path: info.outputPath('视图HTML导出.png')});
      await modal.getByRole('button', {name: text.done, exact: true}).click();
      await expect(modal).toBeHidden();
      await (await navigationMenuItem(tab, {name: text.entry, exact: true})).click();
      await modal.getByLabel(text.format, {exact: true}).selectOption('xml');
      await expect(modal.getByLabel(text.encoding, {exact: true})).toBeDisabled();
      for (const field of ['id', 'bucket']) await modal.getByRole('checkbox', {name: text.fieldLabel(field), exact: true}).uncheck();
      await modal.getByRole('button', {name: text.fieldUp('payload'), exact: true}).click();
      await modal.getByRole('button', {name: text.choose, exact: true}).click();
      await modal.getByRole('button', {name: text.start, exact: true}).click();
      await expect(modal.getByText(text.completed(40), {exact: true})).toBeVisible();
      const xml = await page.evaluate(markup => {
        const doc = new DOMParser().parseFromString(markup, 'application/xml');
        return {scope: doc.documentElement.getAttribute('scope'), headers: [...doc.querySelectorAll('column')].map(column => column.textContent),
          rows: [...doc.querySelectorAll('record')].map(row => [...row.children].map(cell => [cell.textContent, cell.getAttribute('kind')]))};
      }, await readFile(paths[index * 3 + 1], 'utf8'));
      expect(xml).toEqual({scope: 'table', headers: ['payload', 'note'], rows: data.filter(row => row[1] === '匹配').reverse().map(row =>
        [[row[3].toString('base64'), 'binary'], [row[2] ?? '', row[2] === null ? 'null' : 'text']])});
      await modal.getByRole('button', {name: text.done, exact: true}).click();
      await expect(modal).toBeHidden();
      await (await navigationMenuItem(tab, {name: text.entry, exact: true})).click();
      await modal.getByLabel(text.format, {exact: true}).selectOption('txt');
      await modal.getByLabel(txtImportZh.delimiter, {exact: true}).selectOption('|');
      await modal.getByLabel(txtImportZh.record, {exact: true}).selectOption('lf');
      for (const field of ['id', 'bucket']) await modal.getByRole('checkbox', {name: text.fieldLabel(field), exact: true}).uncheck();
      await modal.getByRole('button', {name: text.fieldUp('payload'), exact: true}).click();
      await modal.getByRole('button', {name: text.choose, exact: true}).click();
      await modal.getByRole('button', {name: text.start, exact: true}).click();
      await expect(modal.getByText(text.completed(40), {exact: true})).toBeVisible();
      expect(parseTxt(await readFile(paths[index * 3 + 2]), {delimiter: '|', record_delimiter: '\n'})).toEqual([
        ['payload', 'note'], ...data.filter(row => row[1] === '匹配').reverse().map(row => ['base64:' + row[3].toString('base64'), row[2] ?? '\\N']),
      ]);
      if (index === 1) await modal.screenshot({path: info.outputPath('视图TXT导出.png')});
      await modal.getByRole('button', {name: text.done, exact: true}).click();
      await expect(modal).toBeHidden();
    }
    await test.step('缺字段的视图拒绝应用方案且不改当前导出配置', async () => {
      const noteView = node.locator('.object-row .tree-label').getByText('note_only', {exact: true});
      await expect(noteView).toBeVisible();
      await noteView.click({ timeout: 5000 });
      const tab = page.locator('.table-tab:visible'), grid = tab.getByRole('grid');
      await expect(grid.getByRole('columnheader').filter({ hasText: /^note/ })).toBeVisible();
      await expect(grid.getByRole('columnheader').filter({ hasText: /^payload/ })).toHaveCount(0);
      await (await navigationMenuItem(tab, { name: text.entry, exact: true })).click({ timeout: 5000 });
      await expect(modal.getByText(profile.title, { exact: true })).toBeVisible();
      await chooseProfile();
      await expect(modal.getByRole('alert')).toContainText(profile.unavailableFields);
      await expect(modal.getByRole('combobox', { name: text.format, exact: true })).toHaveValue('csv');
      await expect(modal.getByRole('button', { name: text.start, exact: true })).toBeDisabled();
      await modal.getByRole('button', { name: text.close, exact: true }).click({ timeout: 5000 });
    });
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restoreTableHtmlPicker(): number}).restoreTableHtmlPicker())).toBe(6);
    expect(await history()).toEqual(baseline);
    expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    const [rows] = await observer.query<import('mysql2').RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
    expect(Number(rows[0].count)).toBe(120);
  }, info, { captureFailureScreenshot: false, dialect });
});
