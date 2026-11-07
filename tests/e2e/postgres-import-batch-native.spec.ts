import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import iconv from 'iconv-lite';
import { importRecordRangeZh } from '../../src/shared/importRecordRange';
import { txtImportZh } from '../../src/shared/txtImport';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { fileImportConflictZh as conflict } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { test, expect, desktop, page } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(110_000);

test('PostgreSQL 多文件导入共用映射和事务，原生 CSV 保留 NULL 与空字符串', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query('CREATE TABLE public.batch_import_target (id bigint PRIMARY KEY, note text)');
    const snapshot = async () => (await observer.query('SELECT id::text, note FROM public.batch_import_target ORDER BY id::bigint')).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL 批量导入', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'batch_import_target', tabs: [
        { id: 'batch_import_target', title: 'batch_import_target', kind: 'table', connectionId, database, table: '"public"."batch_import_target"' },
      ] });
    }, { connectionId: profile, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await expect(tab.getByRole('grid')).toBeVisible();
    await mkdir(info.outputDir, { recursive: true });
    const native = [info.outputPath('批次甲.csv'), info.outputPath('批次乙.csv')];
    const incompatible = info.outputPath('字段不符.csv'), duplicate = info.outputPath('跨文件重复键.csv');
    const body = '说明\r\nnote,id\r\n"",2\r\n汇总';
    await writeFile(native[0], '说明\r\nid,note\r\n1,\r\n汇总');
    await writeFile(native[1], body);
    await writeFile(incompatible, '说明\r\nid,other\r\n2,不同字段\r\n汇总');
    await writeFile(duplicate, '说明\r\nid,note\r\n1,重复\r\n汇总');
    const options = [
      { format: 'csv', mode: 'tabrelio', bodies: ['id,note\n3,\\N', 'note,id\n多编码🚢,4'], notes: [null, '多编码🚢'] },
      { format: 'txt', bodies: ['id\tnote\n5\t分隔甲', 'note\tid\n分隔乙\t6'], notes: ['分隔甲', '分隔乙'] },
      { format: 'json', bodies: ['[{"id":7,"note":"精确甲"}]', '[{"note":"精确乙","id":9223372036854775807}]'], notes: ['精确甲', '精确乙'] },
      { format: 'xml', bodies: ['<rows><RECORD id="8" note="记录甲"/></rows>', '<rows><RECORD note="记录乙" id="9"/></rows>'], notes: ['记录甲', '记录乙'] },
    ] as const;
    const groups = [[native[0], incompatible], native, native, [native[0], duplicate]];
    for (const item of options) {
      const files = item.bodies.map((_body, index) => info.outputPath('附加' + index + '.' + item.format));
      for (const [index, path] of files.entries())
        await writeFile(path, item.format === 'csv' ? iconv.encode(item.bodies[index], 'gb18030') : item.bodies[index]);
      groups.push(files);
    }
    await desktop.evaluate(({ dialog, BrowserWindow }, groups) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const paths = groups[count++], options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !options.properties?.includes('multiSelections') ||
            !paths?.every(path => path.endsWith('.' + options.filters?.[0]?.extensions[0]))) throw Error('仅允许本例原生多选');
        return { canceled: false, filePaths: paths };
      }) as typeof original;
      Object.assign(globalThis, { restorePgBatchPicker: () => { dialog.showOpenDialog = original; return count; } });
    }, groups);
    const open = async (format = 'csv') => {
      await (await navigationMenuItem(tab, { name: text.open, exact: true })).click();
      await modal.getByLabel(text.format, { exact: true }).selectOption(format);
    };
    const choose = () => modal.getByRole('button', { name: text.chooseBatch, exact: true }).click();
    const confirm = modal.getByRole('button', { name: text.confirm, exact: true });
    const batchFiles = modal.getByRole('list', { name: text.batchFiles, exact: true });
    const ranges = async () => {
      await modal.getByLabel(importRecordRangeZh.headerRow, { exact: true }).fill('2');
      await modal.getByLabel(importRecordRangeZh.lastDataRow, { exact: true }).fill('3');
    };
    await open(); await ranges(); await choose();
    await expect(modal).toContainText('第 2 个文件未通过扫描');
    await expect(confirm).toBeDisabled();
    await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await expect(modal).toContainText(text.records(2));
    await writeFile(native[1], body.replace('汇总', '改动'));
    await confirm.click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('整批已回滚');
    await expect(tab).toContainText('第 2 个文件导入失败');
    expect(await snapshot()).toEqual([]);
    await writeFile(native[1], body);
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();

    await open(); await ranges(); await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await modal.screenshot({ path: info.outputPath('PostgreSQL 多文件导入确认.png') });
    await confirm.click();
    await expect(tab).toContainText('PostgreSQL 已提交导入 2 个文件，共 2 行');
    expect(await snapshot()).toEqual([{ id: '1', note: null }, { id: '2', note: '' }]);

    await open(); await ranges(); await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await modal.getByLabel(conflict.mode, { exact: true }).selectOption('upsert');
    await modal.getByLabel(conflict.key, { exact: true }).selectOption({ label: 'batch_import_target_pkey (id)' });
    await modal.getByRole('button', { name: text.confirmConflict, exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('整批已回滚');
    expect(await snapshot()).toEqual([{ id: '1', note: null }, { id: '2', note: '' }]);
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();

    const ids = [['3', '4'], ['5', '6'], ['7', '9223372036854775807'], ['8', '9']];
    for (const [index, item] of options.entries()) {
      await open(item.format);
      if (item.format === 'csv') {
        await modal.getByLabel(text.csvProtocol, { exact: true }).selectOption('tabrelio');
        await modal.getByLabel(text.encoding, { exact: true }).selectOption('gb18030');
      }
      if (item.format === 'txt') await modal.getByRole('checkbox', { name: txtImportZh.hasHeader, exact: true }).check();
      await choose();
      await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
      await confirm.click();
      await expect(modal).toBeHidden();
      await expect(tab).toContainText('PostgreSQL 已提交导入 2 个文件，共 2 行');
      expect((await snapshot()).filter(row => ids[index].includes(row.id))).toEqual(ids[index].map((id, at) => ({ id, note: item.notes[at] })));
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restorePgBatchPicker(): number }).restorePgBatchPicker())).toBe(groups.length);
  } finally { await observer.end(); }
});
