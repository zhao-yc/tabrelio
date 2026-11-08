import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { saveViewSql } from './view-sql-file-save';
import { clickSidebarAction } from './sidebar-menu';
import { viewOutputColumnsZh as columnsText } from '../../src/renderer/locales/viewOutputColumns.zh-CN';
import { mysqlViewAttributesZh as properties } from '../../src/renderer/locales/mysqlViewAttributes.zh-CN';
import { mysqlViewCopyZh as copyText } from '../../src/renderer/locales/mysqlViewCopy.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import { viewSqlFileZh as text } from '../../src/renderer/locales/viewSqlFile.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

const dialect = process.env.DBARK_MYSQL_VIEW_FILE_DIALECT;
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!dialect, '需显式启用 MySQL 或 MariaDB 视图文件专项');

test('载入、预览并保存视图定义，原连接身份和视图属性得到保留', async ({}, info) => {
  const database = process.env.DBARK_MYSQL_VIEW_FILE_DATABASE ?? '', password = process.env.DBARK_MYSQL_VIEW_FILE_PASSWORD ?? '';
  const port = Number(process.env.DBARK_MYSQL_VIEW_FILE_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码和隔离回环数据库');
  const root = await realpath(dataDir), valid = join(root, 'view-definition.sql'), invalid = join(root, 'view-batch.sql');
  const saved = join(root, 'view-saved.sql'), edited = join(root, 'view-edited.sql');
  const old = '旧` 视图', fresh = '新` 视图', renamed = '新` 视图改名';
  const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
  const target = (name: string) => quote(database) + '.' + quote(name);
  const profile: NetworkConnectionProfile = { id: '', dialect, name: dialect, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };
  const query = 'SELECT id, marker FROM ' + target('view_source') + ' WHERE id = 2 -- 文件尾注释';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(query + '\n;', 'utf16le')]);
  const observer = await mysql.createConnection({ host: profile.host, port, database, user: database, password });

  const row = (name: string) => page.locator('.object-row').filter({ hasText: name });
  const showCreate = async (name: string) => {
    const [rows] = await observer.query<RowDataPacket[]>('SHOW CREATE VIEW ' + target(name));
    return rows[0]['Create View'] as string;
  };
  const values = async (name: string) => {
    const [rows] = await observer.query<RowDataPacket[][]>({ sql: 'SELECT * FROM ' + target(name), rowsAsArray: true });
    return rows;
  };
  const columnNames = async (name: string) => {
    const [rows] = await observer.query<RowDataPacket[]>('SHOW COLUMNS FROM ' + target(name));
    return rows.map(column => column.Field);
  };
  async function load(modal: Locator, filePath: string, replace?: boolean) {
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sql')) throw Error('只允许本例一次 SQL 文件选择');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, filePath);
    const button = modal.getByRole('button', { name: text.open, exact: true });
    await button.click();
    await expect(button).toBeEnabled();
    if (replace !== undefined) await modal.getByRole('button', { name: replace ? text.confirmReplace : text.keep, exact: true }).click();
  }
  async function apply(modal: Locator, collision = false) {
    // 只应答这一次旧 DDL 确认，连接、任务和写入仍走真实应用。
    await page.evaluate(expected => {
      const original = window.confirm;
      window.confirm = message => {
        window.confirm = original;
        if (message !== expected) throw Error('只允许本例原结构确认');
        return true;
      };
    }, zh.schema.text054);
    await modal.getByRole('button', { name: zh.common.executeSql, exact: true }).click();
    if (collision) await expect(modal.getByRole('alert')).toContainText(/already exists/i);
    else await expect(modal).toBeHidden();
  }

  try {
    await writeFile(valid, bytes);
    await writeFile(invalid, 'SELECT 1; DROP VIEW ' + target(old) + ';');
    await observer.query('CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ' + target(old) +
      ' AS SELECT id, marker FROM ' + target('view_source') + ' WHERE id=1 WITH LOCAL CHECK OPTION');
    const original = await showCreate(old);
    const attributes = 'ALGORITHM=MERGE DEFINER=' + quote(database) + '@`%` SQL SECURITY INVOKER';
    expect(original).toContain(attributes);
    expect(original).toMatch(/WITH LOCAL CHECK OPTION/i);
    expect(await values(old)).toEqual([[1, '原值']]);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, profile);
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect, exact: true }) });
    const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    async function expandDatabase() {
      const connection = node.getByRole('button', { name: dialect, exact: true });
      const database = db.locator('.tree-label');
      if (await connection.getAttribute('aria-expanded') !== 'true') await connection.click();
      if (await database.getAttribute('aria-expanded') !== 'true') await database.click();
    }
    await expandDatabase();

    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const beforeHistory = await history();
    const catalog = () => page.evaluate(target => window.dbark.invoke('metadata.objects', target), { connectionId, database });
    const editor = (modal: Locator) => modal.locator('.monaco-editor .view-lines');
    // Monaco 把换行后的视图行追加到 DOM 末尾，按屏幕位置还原长 DDL。
    const editorText = (modal: Locator) => editor(modal).locator('.view-line').evaluateAll(lines =>
      (lines as HTMLElement[]).sort((left, right) => left.offsetTop - right.offsetTop)
        .map(line => line.textContent?.replaceAll('\u00a0', ' ')).join(''));

    const property = (modal: Locator, label: string) => modal.getByRole('combobox', { name: label, exact: true });
    const section = (modal: Locator) => modal.getByRole('region', { name: inspect.region });
    const columns = (modal: Locator) => modal.getByRole('group', { name: columnsText.title, exact: true });
    const columnInput = (modal: Locator, position: number) =>
      columns(modal).getByRole('textbox', { name: columnsText.column(position), exact: true });
    const columnButton = (modal: Locator, name: string) => columns(modal).getByRole('button', { name, exact: true });
    const seedColumns = async (modal: Locator) => {
      await section(modal).getByRole('button', { name: inspect.rows, exact: true }).click();
      await columnButton(modal, columnsText.fromPreview).click();
      await expect(columnInput(modal, 1)).toHaveValue('id');
      await expect(columnInput(modal, 2)).toHaveValue('marker');
    };

    const preview = async (modal: Locator, marker: string) => {
      const panel = section(modal);
      await panel.getByRole('button', { name: inspect.rows, exact: true }).click();
      await expect(panel.getByText(marker, { exact: true })).toBeVisible();
      await expect(panel.getByText(inspect.count(1))).toBeVisible();
      await panel.getByRole('button', { name: inspect.explain, exact: true }).click();
      await expect(panel.getByText(/view_source/).first()).toBeVisible();
    };
    const inspectRows = (sql: string) => page.evaluate(target => window.dbark.invoke('mysql.view.inspectQuery', target),
      { connectionId, database, name: fresh, mode: 'rows' as const, sql: 'CREATE VIEW ' + target(fresh) + ' ' + sql });
    const [sample] = (await inspectRows(
      "(original_database, ordered_id, same_id, precise) AS WITH RECURSIVE n AS (SELECT 1 AS id UNION ALL SELECT id+1 FROM n WHERE id<120) " +
      "SELECT DATABASE(), CAST(id AS UNSIGNED), CAST(id AS UNSIGNED), CAST(9223372036854775807 AS SIGNED) FROM n ORDER BY id DESC"
    )).results;
    expect(sample.columns.map(column => column.name)).toEqual(['original_database', 'ordered_id', 'same_id', 'precise']);
    expect(sample.rows).toHaveLength(100);
    expect(sample.rows[0]).toEqual({ c0: database, c1: '120', c2: '120', c3: '9223372036854775807' });
    expect(sample.rows[99].c1).toBe('21');
    expect(sample.truncated).toBe(true);
    const [oversized] = (await inspectRows("AS SELECT REPEAT('x', 600000) AS marker")).results;
    expect(oversized).toMatchObject({ rows: [], truncated: true });
    await expect(inspectRows("AS SELECT marker INTO DUMPFILE 'forbidden' FROM view_source")).rejects.toThrow(/INTO/);
    await expect(inspectRows("AS SELECT marker FROM view_source FOR UPDATE")).rejects.toThrow(/read.only|denied/i);


    await clickSidebarAction(db, { name: zh.sidebar.text019, exact: true });
    const create = page.getByRole('dialog', { name: zh.schema.text058, exact: true });
    await expect(create.getByRole('button', { name: text.open, exact: true })).toBeDisabled();
    const viewName = create.getByLabel(zh.schema.text059, { exact: true });
    await expect(property(create, properties.security)).toBeDisabled();
    await viewName.fill(fresh);
    await expect(property(create, properties.algorithm)).toHaveValue('UNDEFINED');
    await property(create, properties.security).selectOption('INVOKER');
    await property(create, properties.algorithm).selectOption('MERGE');
    await load(create, invalid);
    await expect(create.getByText(/SQL 文件须包含一条/)).toBeVisible();
    await load(create, valid, true);
    await expect(editor(create)).toContainText('文件尾注释');
    await expect(property(create, properties.algorithm)).toHaveValue('MERGE');
    await expect(property(create, properties.security)).toHaveValue('INVOKER');
    await property(create, properties.check).selectOption('CASCADED');
    await saveViewSql(create, null);
    await expect(create.getByText(/已保存视图定义到/)).toHaveCount(0);
    await writeFile(saved, '待覆盖的旧文件');
    await saveViewSql(create, saved);
    expect(await readFile(saved, 'utf8')).toBe(query + '\n;');
    await seedColumns(create);
    await columnButton(create, columnsText.add).click();
    await columnInput(create, 3).fill('多余列');
    await columnButton(create, columnsText.apply).click();
    await expect(columns(create).getByText(columnsText.countMismatch(2))).toBeVisible();
    await columns(create).getByRole('button', { name: columnsText.remove(3), exact: true }).click();
    await columnInput(create, 1).fill('Same');
    await columnInput(create, 2).fill('same');
    await columnButton(create, columnsText.apply).click();
    await expect(columns(create).getByText(/输出列名重复/)).toBeVisible();
    await columnInput(create, 1).fill('记录`编号');
    await columnInput(create, 2).fill('内容,别名');
    await columnButton(create, columnsText.apply).click();
    await expect(columnButton(create, columnsText.fromPreview)).toBeDisabled();
    await expect.poll(() => editorText(create)).toContain('(`记录``编号`, `内容,别名`)');
    await columnButton(create, columnsText.clear).click();
    await columnButton(create, columnsText.apply).click();
    await expect.poll(() => editorText(create)).not.toContain('(`记录``编号`, `内容,别名`)');
    await seedColumns(create);
    await columnInput(create, 1).fill('记录`编号');
    await columnInput(create, 2).fill('内容,别名');
    await columnButton(create, columnsText.apply).click();
    await preview(create, '新值');
    expect((await catalog()).some(item => item.name === fresh)).toBe(false);
    await viewName.fill(old);
    await expect(section(create).getByText(/view_source/)).toHaveCount(0);
    await apply(create, true);
    expect(await showCreate(old)).toBe(original);
    await viewName.fill(renamed);
    await expect(editor(create)).toContainText('CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ' + target(renamed));
    await expect(editor(create)).toContainText('文件尾注释');
    expect((await catalog()).some(item => item.name === fresh || item.name === renamed)).toBe(false);
    await apply(create);
    expect(await values(renamed)).toEqual([[2, '新值']]);
    expect(await columnNames(renamed)).toEqual(['记录`编号', '内容,别名']);
    const newDefinition = await showCreate(renamed);
    expect(newDefinition).toContain(attributes);
    expect(newDefinition).toMatch(/WITH CASCADED CHECK OPTION/i);

    await expandDatabase();
    await clickSidebarAction(row(old), { name: formatText(zh.sidebar.text022, old), exact: true });
    const edit = page.getByRole('dialog', { name: formatText(zh.schema.text057, '视图', old), exact: true });
    await expect(editor(edit)).toContainText(attributes);
    await expect(property(edit, properties.algorithm)).toHaveValue('MERGE');
    await expect(property(edit, properties.security)).toHaveValue('INVOKER');
    await expect(property(edit, properties.check)).toHaveValue('LOCAL');
    await preview(edit, '原值');
    await load(edit, valid, false);
    await expect(editor(edit)).not.toContainText('文件尾注释');
    await load(edit, saved, true);
    await expect(editor(edit)).toContainText(attributes);
    await expect(editor(edit)).toContainText('文件尾注释');
    await expect(editor(edit)).toContainText(/WITH\s+LOCAL\s+CHECK\s+OPTION/i);
    await saveViewSql(edit, edited);
    expect(await readFile(edited, 'utf8')).toBe(query + '\n;');
    await seedColumns(edit);
    await columnInput(edit, 2).fill('更新后的内容');
    await columnButton(edit, columnsText.apply).click();
    await preview(edit, '新值');
    const draft = await editorText(edit);
    const copied = '副本`视图';
    const copy = page.getByRole('dialog', { name: copyText.title, exact: true });
    const beginCopy = () => edit.getByRole('button', { name: copyText.open, exact: true }).click();
    const copyName = copy.getByLabel(copyText.name, { exact: true });
    const previewCopy = copy.getByRole('button', { name: copyText.preview, exact: true });
    const confirmCopy = copy.getByRole('button', { name: copyText.apply, exact: true });
    const copySql = copy.getByRole('region', { name: copyText.preview, exact: true });
    await beginCopy();
    await expect(previewCopy).toBeDisabled();
    await copyName.fill(old);
    await expect(previewCopy).toBeDisabled();
    await copyName.fill(copied);
    await previewCopy.dblclick();
    await expect(confirmCopy).toBeEnabled();
    expect((await catalog()).some(item => item.name === copied)).toBe(false);
    await copy.getByRole('button', { name: copyText.back, exact: true }).click();
    await expect.poll(() => editorText(edit)).toBe(draft);
    await beginCopy();
    await copyName.fill(renamed);
    await previewCopy.click();
    await confirmCopy.click();
    await expect(copy.getByRole('alert')).toContainText(/already exists/i);
    await expect(confirmCopy).toBeDisabled();
    expect(await showCreate(renamed)).toBe(newDefinition);
    await copyName.fill(copied);
    await previewCopy.click();
    await expect.poll(() => editorText(copySql)).toContain('CREATE ' + attributes + ' VIEW ' + target(copied));
    await expect(editor(copySql)).toContainText('文件尾注释');
    await copyName.fill(copied + '待修改');
    await expect(confirmCopy).toBeDisabled();
    await copyName.fill(copied);
    await previewCopy.click();
    await confirmCopy.click();
    await expect(copy).toBeHidden();
    await expect.poll(() => editorText(edit)).toBe(draft);
    expect(await showCreate(copied)).toContain(attributes);
    expect(await showCreate(copied)).toMatch(/WITH LOCAL CHECK OPTION/i);
    expect(await values(copied)).toEqual([[2, '新值']]);
    expect(await columnNames(copied)).toEqual(['id', '更新后的内容']);
    expect(await showCreate(old)).toBe(original);
    await property(edit, properties.check).selectOption('NONE');
    await property(edit, properties.algorithm).selectOption('TEMPTABLE');
    await property(edit, properties.security).selectOption('DEFINER');
    await expect(editor(edit)).toContainText('ALGORITHM=TEMPTABLE');
    await expect(editor(edit)).toContainText('DEFINER=' + quote(database) + '@`%` SQL SECURITY DEFINER');
    await expect(editor(edit)).not.toContainText(/WITH\s+LOCAL\s+CHECK\s+OPTION/i);
    await preview(edit, '新值');
    expect(await showCreate(old)).toBe(original);
    expect(await columnNames(old)).toEqual(['id', 'marker']);
    await apply(edit);
    const updated = await showCreate(old);
    expect(updated).toContain('ALGORITHM=TEMPTABLE DEFINER=' + quote(database) + '@`%` SQL SECURITY DEFINER');
    expect(updated).not.toMatch(/WITH (?:LOCAL|CASCADED) CHECK OPTION/i);
    expect(await values(old)).toEqual([[2, '新值']]);
    expect(await columnNames(old)).toEqual(['id', '更新后的内容']);
    expect(await history()).toEqual(beforeHistory);
    expect(await readFile(valid)).toEqual(bytes);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer.end();
  }
});
