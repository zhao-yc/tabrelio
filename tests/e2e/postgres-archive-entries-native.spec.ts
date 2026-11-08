import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { postgresArchiveZh as text } from '../../src/renderer/locales/postgresArchive.zh-CN';
import { postgresSqlFileZh as restore } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';

test.skip(process.env.DBARK_POSTGRES_DATABASE_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 原生归档');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('按归档条目导出与恢复，保留原顺序并在缺少依赖时整体回滚', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, target = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  const pgDump = process.env.DBARK_POSTGRES_DUMP_TOOL ?? '', pgRestore = process.env.DBARK_POSTGRES_RESTORE_TOOL ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || target !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    !isAbsolute(pgDump) || !/[/\\]pg_dump(?:\.exe)?$/.test(pgDump) || !isAbsolute(pgRestore) || !/[/\\]pg_restore(?:\.exe)?$/.test(pgRestore) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 及选定的原生归档工具');

  const config = { host: '127.0.0.1', port, user, password };
  const source = new Client({ ...config, database }), restored = new Client({ ...config, database: target });
  const { page, application } = ownedDesktopResources(info);
  const file = info.outputPath('按条目恢复来源.dump'), sql = info.outputPath('按条目导出.sql');
  let desktopClosed = false;
  try {
    await source.connect(); await restored.connect();
    await source.query(`CREATE SCHEMA entry_scope;
      CREATE TABLE entry_scope.kept(id int PRIMARY KEY, note text, raw bytea);
      INSERT INTO entry_scope.kept VALUES (1,'合成条目',decode('00ff80','hex')), (2,NULL,NULL);
      CREATE TABLE entry_scope.omitted(id int); INSERT INTO entry_scope.omitted VALUES (77);
      ${Array.from({ length: 43 }, (_, index) => 'CREATE TABLE entry_scope.extra_' + index + '(id int);').join('')}`);
    await promisify(execFile)(pgDump, ['--no-password', '--format=custom', '--schema=entry_scope', '--file=' + file, '--dbname=' + database],
      { env: { PGHOST: config.host, PGPORT: String(port), PGUSER: user, PGPASSWORD: password, PGSSLMODE: 'disable' }, timeout: 30000 });
    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        if (title === input.toolTitle) return { canceled: false, filePaths: [input.pgRestore] };
        if (title === input.sourceTitle) return { canceled: false, filePaths: [input.file] };
        throw Error('出现非本例的文件选择');
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        if (title === input.saveTitle) return { canceled: false, filePath: input.sql };
        throw Error('出现非本例的保存选择');
      }) as typeof dialog.showSaveDialog;
    }, { file, sql, pgRestore, toolTitle: text.chooseTool, sourceTitle: text.chooseSource, saveTitle: text.export });
    await page.evaluate(profile => window.dbark.invoke('connections.save', profile), {
      ...config, database, id: '', name: '按归档条目恢复', group: '', color: '#123456', dialect: 'postgresql' as const, rememberPassword: false,
    });
    await page.reload();

    const unauthorized = () => page.evaluate(async () => {
      const file = await window.dbark.invoke('postgres.archive.choose', { kind: 'source' });
      const tool = await window.dbark.invoke('postgres.archive.choose', { kind: 'tool' });
      return window.dbark.invoke('postgres.archive.exportSql', { operationId: crypto.randomUUID(), sourceToken: file!.token,
        toolToken: tool!.token, entryIds: [1], content: 'all', portable: false });
    });
    await expect(unauthorized()).rejects.toThrow('请选择当前归档目录中的条目');

    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true })).click();
    const archive = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => archive.getByRole('button', { name, exact: true });
    await button(text.chooseSource).click();
    await button(text.chooseTool).click();
    await button(text.list).click();
    await archive.getByRole('checkbox', { name: text.selectEntries, exact: true }).check();
    await expect(button(text.export)).toBeDisabled();
    await button(text.nextPage).click();
    await expect(archive.getByText(/第 2 \/ /)).toBeVisible();
    const filter = archive.getByLabel(text.entryFilter, { exact: true });
    const pick = async (phrase: string) => {
      await filter.fill(phrase);
      const item = archive.getByRole('checkbox', { name: new RegExp(phrase) });
      await item.check();
      return item;
    };
    // 逆序勾选。原生目录顺序必须仍然先建 schema 和表，再装载行与约束。
    await pick('CONSTRAINT entry_scope kept kept_pkey');
    await pick('TABLE DATA entry_scope kept');
    await pick('TABLE entry_scope kept');
    await pick('SCHEMA - entry_scope');
    const omitted = await pick('TABLE DATA entry_scope omitted');
    await expect(archive.getByText(text.entryCount(5, 1), { exact: true })).toBeVisible();
    const recover = async (count: number, outcome: string, screenshot?: string) => {
      await button(text.restore).click();
      const dialog = page.getByRole('dialog', { name: restore.archiveTitle, exact: true });
      await expect(dialog.getByText(text.selectedEntries(count), { exact: false })).toBeVisible();
      await dialog.getByRole('checkbox', { name: restore.createMode, exact: true }).uncheck();
      await dialog.getByLabel(restore.database, { exact: true }).selectOption(target);
      await dialog.getByRole('button', { name: restore.archiveExecute, exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText(outcome, { timeout: 30000 });
      if (screenshot) await dialog.screenshot({ path: info.outputPath(screenshot) });
      await dialog.getByRole('button', { name: restore.close, exact: true }).click();
    };
    await recover(5, restore.outcome['rolled-back']);
    expect((await restored.query("SELECT to_regnamespace('entry_scope') AS schema")).rows).toEqual([{ schema: null }]);
    await omitted.uncheck();
    await filter.fill('entry_scope kept');
    await archive.screenshot({ path: info.outputPath('PostgreSQL 归档条目勾选.png') });
    await button(text.export).click();
    await expect(archive.getByRole('status')).toContainText('已导出');
    const script = await readFile(sql, 'utf8');
    expect(script).toContain('CREATE TABLE entry_scope.kept');
    expect(script).toContain('COPY entry_scope.kept');
    expect(script).toContain('ADD CONSTRAINT kept_pkey');
    expect(script).not.toMatch(/entry_scope\.(omitted|extra_)/);

    await recover(4, restore.outcome.committed, 'PostgreSQL 归档条目恢复.png');
    expect((await restored.query("SELECT id,note,encode(raw,'hex') AS raw FROM entry_scope.kept ORDER BY id")).rows)
      .toEqual([{ id: 1, note: '合成条目', raw: '00ff80' }, { id: 2, note: null, raw: null }]);
    expect((await restored.query("SELECT tablename FROM pg_tables WHERE schemaname='entry_scope'")).rows).toEqual([{ tablename: 'kept' }]);
    expect((await restored.query("SELECT conname FROM pg_constraint WHERE conrelid='entry_scope.kept'::regclass AND contype='p'")).rows)
      .toEqual([{ conname: 'kept_pkey' }]);
    const nativeProcess = application.process();
    await confirmOwnedDesktopExit(info);
    desktopClosed = true;
    expect(nativeProcess.exitCode).toBe(0);
  } finally {
    if (!desktopClosed) retainOwnedDesktopResources(info);
    await Promise.all([source.end(), restored.end()]);
  }
});
