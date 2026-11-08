import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { newTableColumnCopyZh as copy } from '../../src/renderer/locales/newTableColumnCopy.zh-CN';
import { postgresCreateTableZh as pg } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { sqliteTableCreateZh as sqlite } from '../../src/renderer/locales/sqliteTableCreate.zh-CN';
import { tableCreateZh as mysql } from '../../src/renderer/locales/tableCreate.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('复制新表字段保留字段配置及原主键，预览后实际创建', async ({}, info) => {
  const dialect = process.env.DBARK_COLUMN_COPY_DIALECT;
  test.skip(!dialect, '需要显式启用本轮隔离字段复制验收');
  const local = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const database = local ? 'main' : process.env.DBARK_COLUMN_COPY_DATABASE ?? '';
  const port = Number(process.env.DBARK_COLUMN_COPY_PORT), password = process.env.DBARK_COLUMN_COPY_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例临时 SQLite 或独占回环数据库');
  const file = join(await realpath(dataDir), 'new-table-column-copy.sqlite'), table = 'duplicate_field_subject';
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '',
    color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };

  try {
    if (local) {
      new DatabaseSync(file).close();
      await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          dialog.showOpenDialog = original;
          if (args[0] !== BrowserWindow.getAllWindows()[0] ||
              !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
            throw Error('只允许当前窗口选择本例 SQLite 文件');
          return { canceled: false, filePaths: [path] };
        }) as typeof original;
      }, file);
    }
    const connectionId = await page.evaluate(async profile => {
      const id = 'column-copy-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('缺少本例 SQLite 文件授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? {
        id, dialect: 'sqlite', name: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 },
      });
      return saved.id;
    }, profile);
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect!, exact: true }) });
    await node.getByRole('button', { name: dialect!, exact: true }).click();
    const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await clickSidebarAction(db, { name: zh.sidebar.text017, exact: true });
    const modal = page.getByRole('dialog', { name: local ? sqlite.title : postgres ? pg.title : formatText(zh.schema.text009, database), exact: true });
    const duplicate = (index: number) => modal.getByRole('button', { name: copy.label(index), exact: true }).click();
    const field = (index: number) => modal.getByRole('group', { name: pg.field(index), exact: true });
    const catalog = () => page.evaluate(async target => {
      const objects = await window.dbark.invoke('metadata.objects', { connectionId: target.connectionId, database: target.database });
      return objects.filter(object => object.kind === 'table').map(object => object.name);
    }, { connectionId, database });
    const before = await catalog();
    expect(before.some(name => name.includes(table))).toBe(false);

    if (local) {
      await modal.getByLabel(sqlite.name, { exact: true }).fill(table);
      await modal.getByRole('checkbox', { name: sqlite.autoIncrement, exact: true }).check();
      await duplicate(1);
      await expect(modal.getByLabel(sqlite.columnName(2), { exact: true })).toHaveValue('id_copy');
      await expect(modal.getByRole('checkbox', { name: sqlite.primaryColumn(2), exact: true })).not.toBeChecked();
      await modal.getByLabel(sqlite.defaultKind(2), { exact: true }).selectOption('integer');
      await modal.getByLabel(sqlite.defaultValue(2), { exact: true }).fill('9007199254740993');
      await duplicate(2);
      await expect(modal.getByLabel(sqlite.defaultValue(3), { exact: true })).toHaveValue('9007199254740993');
      await modal.getByRole('button', { name: sqlite.preview, exact: true }).click();
      await expect(modal.getByLabel(sqlite.confirmation, { exact: true })).toBeVisible();
      expect(await catalog()).toEqual(before);
      await modal.getByLabel(sqlite.confirmation, { exact: true }).fill('main.' + table);
      await modal.getByRole('button', { name: sqlite.apply, exact: true }).click();
      await expect.poll(async () => (await catalog()).includes(table)).toBe(true);
      const read = new DatabaseSync(file, { readOnly: true });
      try {
        expect(read.prepare('PRAGMA table_info(duplicate_field_subject)').all().map(row => [row.name, row.type, row.dflt_value, row.pk]))
          .toEqual([['id', 'INTEGER', null, 1], ['id_copy', 'INTEGER', '9007199254740993', 0], ['id_copy_copy', 'INTEGER', '9007199254740993', 0]]);
      } finally { read.close(); }
    } else if (postgres) {
      await modal.getByLabel(pg.schema, { exact: true }).selectOption('public');
      await modal.getByLabel(pg.table, { exact: true }).fill(table);
      await field(1).getByLabel(pg.name, { exact: true }).fill('id');
      await field(1).getByLabel(pg.type, { exact: true }).selectOption('bigint');
      await field(1).getByLabel(pg.identity, { exact: true }).selectOption('always');
      await field(1).getByRole('checkbox', { name: pg.primary, exact: true }).check();
      await field(1).getByRole('checkbox', { name: pg.unique, exact: true }).check();
      await field(1).getByLabel(pg.comment, { exact: true }).fill('原列说明');
      await duplicate(1);
      await expect(field(2).getByLabel(pg.name, { exact: true })).toHaveValue('id_copy');
      await expect(field(2).getByLabel(pg.identity, { exact: true })).toHaveValue('none');
      await expect(field(2).getByRole('checkbox', { name: pg.unique, exact: true })).not.toBeChecked();
      await modal.getByRole('button', { name: pg.preview, exact: true }).click();
      await expect(modal.getByRole('button', { name: pg.apply, exact: true })).toBeVisible();
      expect(await catalog()).toEqual(before);
      await modal.getByRole('button', { name: pg.apply, exact: true }).click();
      await expect(modal).toBeHidden();
      const result = await page.evaluate(target => window.dbark.invoke('postgres.structure.read', target),
        { connectionId, database, table: '"public"."' + table + '"' });
      expect(result.columns.map(column => [column.name, column.type, column.comment]))
        .toEqual([['id', 'bigint', '原列说明'], ['id_copy', 'bigint', '原列说明']]);
      expect(result.constraints.filter(value => value.kind === 'p').map(value => value.keyColumns)).toEqual([['id']]);
      expect(result.columns.map(column => column.identity)).toEqual(['a', '']);
    } else {
      await modal.getByLabel(zh.schema.text010, { exact: true }).fill(table);
      await modal.getByLabel(formatText(zh.schema.text024, 1), { exact: true }).fill('原列说明');
      await duplicate(1);
      await expect(modal.getByLabel(formatText(zh.schema.text018, 2), { exact: true })).toHaveValue('id_copy');
      await expect(modal.getByRole('checkbox', { name: formatText(zh.schema.text021, 2), exact: true })).not.toBeChecked();
      await modal.getByRole('button', { name: zh.schema.text049, exact: true }).click();
      const confirm = page.getByRole('dialog', { name: mysql.title, exact: true });
      await expect(confirm.locator('.monaco-editor .view-lines')).toContainText('id_copy');
      expect(await catalog()).toEqual(before);
      await confirm.getByLabel(mysql.confirmation, { exact: true }).fill(database + '.' + table);
      for (const label of [mysql.ackDdl, mysql.ackCreate]) await confirm.getByRole('checkbox', { name: label, exact: true }).check();
      await confirm.getByRole('button', { name: mysql.apply, exact: true }).click();
      await expect(confirm.getByRole('status')).toHaveText(mysql.succeeded);
      const result = await page.evaluate(target => window.dbark.invoke('metadata.table', target), { connectionId, database, table });
      expect(result.columns.map(column => [column.name, column.type.replace(/bigint\(20\)/i, 'bigint'), column.comment]))
        .toEqual([['id', 'bigint unsigned', '原列说明'], ['id_copy', 'bigint unsigned', '原列说明']]);
      expect(result.primaryKey).toEqual(['id']);
      expect(result.columns.filter(column => column.extra.includes('auto_increment')).map(column => column.name)).toEqual(['id']);
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
