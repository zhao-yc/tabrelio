import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { recordTemporalZh as text } from '../../src/renderer/locales/recordTemporal.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { postgresTableZh as pgText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { sqliteTableEditZh as sqliteText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { formatText } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('日期时间控件保留微秒、原偏移和有符号时长，集中提交后回读', async ({}, info) => {
  test.setTimeout(75_000);
  const dialect = process.env.DBARK_TEMPORAL_DIALECT;
  test.skip(!dialect, '需要显式启用独占日期时间实库');
  const local = dialect === 'sqlite', postgres = dialect === 'postgresql', networkDuration = !local && !postgres;
  const database = local ? 'main' : process.env.DBARK_TEMPORAL_DATABASE ?? '';
  const port = Number(process.env.DBARK_TEMPORAL_PORT), password = process.env.DBARK_TEMPORAL_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
    !/^tabrelio_cn_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)) {
    throw Error('仅允许本例 SQLite 文件或独占回环实库');
  }
  const table = 'temporal_subject', file = join(await realpath(dataDir), 'record-temporal.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec("CREATE TABLE temporal_subject (id INTEGER PRIMARY KEY, due DATE, moment DATETIME, elapsed TIME, epoch DATE);" +
        "INSERT INTO temporal_subject VALUES (1,'2024-02-29','2024-02-29T10:20:30.123456+05:45','10:20:30.654321',1709164800);");
    } finally { fixture.close(); }
  }
  const sqliteValues = () => {
    const observer = new DatabaseSync(file, { readOnly: true });
    try { return observer.prepare('SELECT due,moment,elapsed,epoch,typeof(due) AS due_kind,typeof(epoch) AS epoch_kind FROM temporal_subject').get(); }
    finally { observer.close(); }
  };
  const baseline = local ? sqliteValues() : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite')) throw Error('越过本例文件授权范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async ({ profile, database, table }) => {
      const id = 'record-temporal-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? {
        id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 },
      });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'temporal-table', tabs: [
        { connectionId: connection.id, database, id: 'temporal-table', kind: 'table', title: table, table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
      ] });
    }, { profile, database, table });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const cell = async (key: string) => {
      const header = tab.getByRole('columnheader').filter({ hasText: new RegExp('^' + key, 'i') });
      await expect(header).toBeVisible();
      const index = await header.getAttribute('aria-colindex');
      return tab.locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`);
    };
    const editor = (key: string) => postgres ? page.getByRole('region', { name: pgText.cellEdit(key), exact: true })
      : page.getByRole('dialog', { name: local ? sqliteText.editCell : formatText(recordText.cellTitle, key), exact: true });
    const stage = async (key: string) => {
      await editor(key).getByRole('button', { name: postgres ? pgText.stage : local ? sqliteText.saveInput : recordText.stageCell, exact: true }).click();
      await expect(editor(key)).toHaveCount(0);
    };
    const open = async (key: string) => { await (await cell(key)).dblclick(); await expect(editor(key)).toBeVisible(); return editor(key); };
    const due = await open('due');
    await expect(due.getByLabel(text.date, { exact: true })).toHaveValue('2024-02-29');
    await due.getByLabel(text.date, { exact: true }).fill('2028-02-29');
    await expect(due.getByRole('textbox').first()).toHaveValue('2028-02-29');
    await stage('due');
    const moment = await open('moment'), momentRaw = moment.getByRole('textbox').first();
    const original = await momentRaw.inputValue();
    expect(original).toContain('.123456');
    const nextMoment = original.replace(/^2024-02-29/, '2028-02-29');
    expect(nextMoment).not.toBe(original);
    await moment.getByLabel(text.date, { exact: true }).fill('2028-02-29');
    await expect(momentRaw).toHaveValue(nextMoment);
    await page.screenshot({ path: info.outputPath('日期保留微秒.png') });
    await moment.getByRole('textbox', { name: text.fraction, exact: true }).fill('000009');
    const editedMoment = nextMoment.replace('.123456', '.000009');
    await expect(momentRaw).toHaveValue(editedMoment);
    await stage('moment');

    const elapsed = await open('elapsed'), elapsedRaw = elapsed.getByRole('textbox').first();
    const originalElapsed = await elapsedRaw.inputValue();
    const nextElapsed = networkDuration ? '-121:20:30.654321' : originalElapsed.replace(/^10:20:30/, '02:03:04');
    expect(nextElapsed).not.toBe(originalElapsed);
    if (networkDuration) {
      await expect(elapsed.getByRole('checkbox', { name: text.negative, exact: true })).toBeChecked();
      await elapsed.getByRole('spinbutton', { name: text.hours, exact: true }).fill('121');
    } else await elapsed.getByLabel(text.clock, { exact: true }).fill('02:03:04');
    await expect(elapsedRaw).toHaveValue(nextElapsed);
    await page.screenshot({ path: info.outputPath('时间保留精度.png') });
    await stage('elapsed');

    if (local) {
      const epoch = await open('epoch');
      await expect(epoch.getByLabel(text.date, { exact: true })).toHaveCount(0);
      await epoch.getByRole('button', { name: sqliteText.cancelInput, exact: true }).click();
      expect(sqliteValues()).toEqual(baseline);
    }
    await (await navigationMenuItem(tab, { name: postgres ? pgText.preview : local ? sqliteText.preview : '预览并提交', exact: true })).click();
    const preview = page.getByRole('dialog', { name: postgres ? pgText.preview : local ? sqliteText.previewTitle : '确认数据修改', exact: true });
    await expect(preview).toBeVisible();
    if (local) {
      expect(sqliteValues()).toEqual(baseline);
      await preview.getByRole('checkbox', { name: sqliteText.confirmation, exact: true }).check();
    }
    await preview.getByRole('button', { name: postgres ? pgText.apply : local ? sqliteText.submit : '确认提交', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(await cell('due')).toContainText('2028-02-29');
    if (local) await expect.poll(sqliteValues).toEqual({ due: '2028-02-29', moment: editedMoment, elapsed: nextElapsed,
      epoch: 1709164800, due_kind: 'text', epoch_kind: 'integer' });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
