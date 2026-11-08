import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Client } from 'pg';
import { postgresArchiveZh as archiveText } from '../../src/renderer/locales/postgresArchive.zh-CN';
import { postgresDatabaseBackupZh as text } from '../../src/renderer/locales/postgresDatabaseBackup.zh-CN';
import { postgresSqlFileZh as restore } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { postgresBackupRelationName } from '../../src/shared/postgresDatabaseBackup';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { navigationMenuItem } from './navigation-menu';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';

test.skip(process.env.DBARK_POSTGRES_DATABASE_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 原生对象备份');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('跨 Schema 精确备份表、视图与序列，并拒绝文件范围变更和同名替换', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, target = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  const pgDump = process.env.DBARK_POSTGRES_DUMP_TOOL ?? '', pgRestore = process.env.DBARK_POSTGRES_RESTORE_TOOL ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || target !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    !isAbsolute(pgDump) || !/[/\\]pg_dump(?:\.exe)?$/.test(pgDump) || !isAbsolute(pgRestore) || !/[/\\]pg_restore(?:\.exe)?$/.test(pgRestore) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 和选定的原生备份工具');

  const config = { host: '127.0.0.1', port, user, password }, dataDatabase = user + '_object_data';
  const connect = (name: string) => new Client({ ...config, database: name });
  const source = connect(database), archived = connect(target), dataOnly = connect(dataDatabase);
  const { page, application } = ownedDesktopResources(info);
  const relation = { schema: '对象.甲', name: '字.*"段' }, view = { schema: '对象乙', name: '选中视图' };
  const sequence = { schema: view.schema, name: '精确序列' }, wildcard = { schema: relation.schema, name: '字.xyz"段' };
  const duplicate = { schema: view.schema, name: relation.name };
  const tableSql = postgresBackupRelationName(relation), viewSql = postgresBackupRelationName(view), seqSql = postgresBackupRelationName(sequence);
  const missing = [wildcard, duplicate].map(postgresBackupRelationName);
  const scopes = [relation.schema, view.schema].map(name => 'CREATE SCHEMA ' + postgresIdentifier(name)).join('; ');
  const structure = 'CREATE TABLE ' + tableSql + '(id int PRIMARY KEY, note text, raw bytea); CREATE SEQUENCE ' + seqSql;
  const custom = info.outputPath('指定对象.dump'), data = info.outputPath('指定对象仅数据.sql');
  const protectedPath = info.outputPath('保持原备份.sql'), sentinel = '已存在的备份\n';
  let desktopClosed = false;
  try {
    await source.connect(); await archived.connect();
    await source.query('CREATE DATABASE ' + postgresIdentifier(dataDatabase) + ' TEMPLATE template0');
    await dataOnly.connect();
    await source.query(scopes + '; ' + structure + `;
      INSERT INTO ${tableSql} VALUES (1,'对象数据',decode('00ff80','hex')), (2,NULL,NULL);
      CREATE VIEW ${viewSql} AS SELECT id,note FROM ${tableSql};
      CREATE TABLE ${missing[0]}(id int); CREATE TABLE ${missing[1]}(id int);`);
    await source.query('SELECT pg_catalog.setval($1::regclass, $2)', [seqSql, '9007199254740997']);
    await archived.query(scopes);
    await dataOnly.query(scopes + '; ' + structure);
    await writeFile(protectedPath, sentinel);

    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        const paths: Record<string, string> = input.open;
        const chosen = paths[title ?? ''];
        if (!chosen) throw Error('出现非本例的文件选择');
        return { canceled: false, filePaths: [chosen] };
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        if (title !== input.title || !input.paths.length) throw Error('出现非本例的保存选择');
        return { canceled: false, filePath: input.paths.shift()! };
      }) as typeof dialog.showSaveDialog;
    }, { title: text.title, paths: [custom, data, protectedPath], open: {
      [text.tool]: pgDump, [archiveText.chooseTool]: pgRestore, [archiveText.chooseSource]: custom, [restore.title]: data,
    } });
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      ...config, database, id: '', name: '原生对象备份', group: '', color: '#123456', dialect: 'postgresql' as const, rememberPassword: false,
    });
    await page.reload();
    const menu = async (name: string) => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true })).click();
    await menu(text.title);
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    await modal.getByLabel(text.database, { exact: true }).selectOption(database);
    await modal.getByLabel(text.selection, { exact: true }).selectOption('relations');
    const filter = modal.getByLabel(text.relationPicker.search, { exact: true });
    const select = async (name: string, kind: string) => {
      await filter.fill(name);
      await modal.getByRole('checkbox', { name: name + ' · ' + kind, exact: true }).check();
    };
    await select(tableSql, text.relationKinds.r);
    await select(viewSql, text.relationKinds.v);
    await select(seqSql, text.relationKinds.S);
    await expect(modal.getByText(text.relationPicker.count(3), { exact: true })).toBeVisible();
    await filter.fill('对象');
    await modal.getByLabel(text.format, { exact: true }).selectOption('custom');
    await button(text.tool).click();
    const backup = async () => {
      await button(text.choose).click(); await button(text.start).click();
      await expect(modal.getByRole('status')).toContainText('pg_dump 18.6', { timeout: 30000 });
    };
    await backup();
    expect((await readFile(custom)).subarray(0, 5).toString('ascii')).toBe('PGDMP');
    await modal.screenshot({ path: info.outputPath('PostgreSQL 指定对象备份.png') });
    await modal.getByLabel(text.content, { exact: true }).selectOption('data');
    await expect(modal.getByText(text.relationPicker.count(2), { exact: true })).toBeVisible();
    await expect(modal.getByRole('checkbox', { name: viewSql + ' · ' + text.relationKinds.v, exact: true })).toHaveCount(0);
    await modal.getByLabel(text.format, { exact: true }).selectOption('sql');
    await backup();
    const sql = await readFile(data, 'utf8');
    expect(sql).toContain('COPY ' + tableSql);
    expect(sql).toContain('9007199254740997');
    expect(sql).not.toMatch(/CREATE (TABLE|VIEW)|xyz/);
    await button(text.close).click();

    await menu(archiveText.title);
    const archive = page.getByRole('dialog', { name: archiveText.title, exact: true });
    for (const name of [archiveText.chooseSource, archiveText.chooseTool, archiveText.restore])
      await archive.getByRole('button', { name, exact: true }).click();
    const archiveRestore = page.getByRole('dialog', { name: restore.archiveTitle, exact: true });
    await archiveRestore.getByRole('checkbox', { name: restore.createMode, exact: true }).uncheck();
    await archiveRestore.getByLabel(restore.database, { exact: true }).selectOption(target);
    await archiveRestore.getByRole('button', { name: restore.archiveExecute, exact: true }).click();
    await expect(archiveRestore.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
    await archiveRestore.screenshot({ path: info.outputPath('PostgreSQL 指定对象恢复.png') });
    await archiveRestore.getByRole('button', { name: restore.close, exact: true }).click();
    await archive.getByRole('button', { name: archiveText.close, exact: true }).click();

    await menu(restore.title);
    const dialog = page.getByRole('dialog', { name: restore.title, exact: true });
    await dialog.getByLabel(restore.database, { exact: true }).selectOption(dataDatabase);
    await dialog.getByRole('button', { name: restore.choose, exact: true }).click();
    await dialog.getByRole('button', { name: restore.execute, exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
    for (const db of [archived, dataOnly]) {
      expect((await db.query("SELECT id,note,encode(raw,'hex') AS raw FROM " + tableSql + ' ORDER BY id')).rows)
        .toEqual([{ id: 1, note: '对象数据', raw: '00ff80' }, { id: 2, note: null, raw: null }]);
      expect((await db.query('SELECT last_value::text AS value FROM ' + seqSql)).rows).toEqual([{ value: '9007199254740997' }]);
      expect((await db.query('SELECT to_regclass($1) AS wildcard, to_regclass($2) AS duplicate', missing)).rows)
        .toEqual([{ wildcard: null, duplicate: null }]);
    }
    expect((await archived.query('SELECT count(*)::int AS count FROM ' + viewSql)).rows).toEqual([{ count: 2 }]);

    const scope = { connectionId, database };
    const catalog = await page.evaluate(input => window.dbark.invoke('postgres.backup.nativeCatalogue', input), scope);
    const selected = catalog.find(item => item.schema === relation.schema && item.name === relation.name)!;
    const tool = await page.evaluate(() => window.dbark.invoke('postgres.backup.chooseDumpTool', {}));
    const choice = { ...scope, relations: [{ ...relation, stamp: selected.stamp }], portable: true, format: 'sql' as const, toolToken: tool!.token };
    const file = await page.evaluate(input => window.dbark.invoke('postgres.backup.chooseDatabaseFile', input), choice);
    const run = (name: string, taskId: string) => page.evaluate(input => window.dbark.invoke('postgres.backup.database', input), {
      ...choice, relations: [{ ...choice.relations[0], name }], fileToken: file!.token, taskId,
    });
    await expect(run(wildcard.name, 'object-file-mismatch')).rejects.toThrow('请重新选择');
    await source.query('ALTER TABLE ' + tableSql + ' RENAME TO old_payload; CREATE TABLE ' + tableSql + '(id int)');
    await expect(run(relation.name, 'object-identity-mismatch')).rejects.toThrow('身份或读取权限已变化');
    expect(await readFile(protectedPath, 'utf8')).toBe(sentinel);
    const nativeProcess = application.process();
    await confirmOwnedDesktopExit(info);
    desktopClosed = true;
    expect(nativeProcess.exitCode).toBe(0);
  } finally {
    if (!desktopClosed) retainOwnedDesktopResources(info);
    await Promise.all([source.end(), archived.end(), dataOnly.end()]);
  }
});
