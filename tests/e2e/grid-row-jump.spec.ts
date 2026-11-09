import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { gridRangeFillZh as rangeFill } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { LocalStore } from '../../src/main/storage';
import { gridRowJumpZh as text } from '../../src/renderer/locales/gridRowJump.zh-CN';
import { gridRowSelectionZh as selectionText } from '../../src/renderer/locales/gridRowSelection.zh-CN';
import { gridColumnWidthBatchZh as batchText } from '../../src/renderer/locales/gridColumnWidthBatch.zh-CN';
import { gridRowHeightZh as heightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { sqliteTableLayoutZh as layoutText } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { tableHeaderCopyZh } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { queryResultCopyZh } from '../../src/renderer/locales/queryResultCopy.zh-CN';
import { queryResultFindZh as resultFind } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryLayoutZh } from '../../src/renderer/locales/queryLayout.zh-CN';
import { queryResultKeywordZh as keywordText } from '../../src/renderer/locales/queryResultKeyword.zh-CN';
import { queryResultSortZh as resultSort } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSelectedFilterZh as selectedFilterText } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { queryResultHistoryZh as resultHistoryText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { tableSelectedFilterZh as tableSelectedFilterText } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
import { resultArchiveZh as archiveText } from '../../src/renderer/locales/resultArchive.zh-CN';
import { sqliteResultOriginsZh as originsText } from '../../src/renderer/locales/sqliteResultOrigins.zh-CN';
import { sqliteTableEditZh as sqliteEditText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { postgresTableFindZh as replaceText } from '../../src/renderer/locales/postgresTableFind.zh-CN';
import { postgresTableZh as replaceTableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { queryRowSqlZh as rowSqlText } from '../../src/renderer/locales/queryRowSql.zh-CN';
import { sqliteRelationZh as relationText } from '../../src/renderer/locales/sqliteRelation.zh-CN';
import { sqliteReferenceZh as parentText } from '../../src/renderer/locales/sqliteReference.zh-CN';
import { sqliteIncomingZh as childText } from '../../src/renderer/locales/sqliteIncoming.zh-CN';
import { sqliteRelatedTableZh as relatedText } from '../../src/renderer/locales/sqliteRelatedTable.zh-CN';
import { decodeQueryCsvZip } from '../helpers/queryCsvZip';
import { statementNavigationZh as navigationText } from '../../src/renderer/locales/statementNavigation.zh-CN';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';
import { savedQueryOrganizationZh as groupText } from '../../src/renderer/locales/savedQueryOrganization.zh-CN';
import { sqliteTableFindZh as sqliteFind } from '../../src/renderer/locales/sqliteTableFind.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { tableCellFilterZh } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { tableFindFilterZh } from '../../src/renderer/locales/tableFindFilter.zh-CN';
import { tableCheckedExportZh as collectText } from '../../src/renderer/locales/tableCheckedExport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { gridCellCenter, pasteGridRangeClipboard, readGridMenuClipboard, readGridRangeClipboard } from './grid-cell-range-clipboard';
import { gridRangeCopyZh as rangeCopy } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { gridRangeExportZh as rangeExport } from '../../src/renderer/locales/gridRangeExport.zh-CN';
import { resultSqlZh as sqlText } from '../../src/shared/resultSql.zh-CN';
import { gridQuickValueZh as cellCopy } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { gridRangePasteZh as selectionPaste } from '../../src/renderer/locales/gridRangePaste.zh-CN';
import { sqliteTableRangePasteZh as sqlitePaste } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';
import { answerDialogs, clickNativeFind, dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** 使用独立应用配置和合成 SQLite 数据，查询与浏览均走正式引擎。 */
async function seed(sql = 'SELECT id, name FROM subject ORDER BY id DESC;', fixtureSql = '', additionalQuery?: string, readOnly = false) {
  await quitDesktop();
  const id = 'row-jump-offline', databasePath = join(dataDir, 'grid-row-jump.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY, name TEXT);
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<180)
      INSERT INTO subject SELECT i, '记录 ' || i FROM seq;
      CREATE VIEW subject_view AS SELECT id,name FROM subject ORDER BY id;`);
    if (fixtureSql) database.exec(fixtureSql);
  } finally { database.close(); }
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    store.saveConnection({ id, dialect: 'sqlite', name: '行号定位测试', group: '', color: '#123456', sqlite: { filePath: realpathSync(databasePath), readOnly, busyTimeoutMs: 1000 } });
    store.saveSettings({ ...store.settings(), pageSize: 100, activeTabId: 'q-jump', tabs: [
      { id: 'q-jump', kind: 'query', title: '查询定位', connectionId: id, sql },
      ...(additionalQuery ? [{ id: 'q-copy-source', kind: 'query' as const, title: '复制来源', connectionId: id, sql: additionalQuery }] : []),
      { id: 't-jump', kind: 'table', title: '表格定位', connectionId: id, database: 'main', table: 'subject' },
      { id: 'v-jump', kind: 'table', title: '视图定位', connectionId: id, database: 'main', table: 'subject_view' },
    ] });
  } finally { store.close(); }
  await launchDesktop();
}

/** 在虚拟行尚未渲染时输入行号，并确认焦点落到真实数据格。 */
async function jump(pane: Locator, row: string, expected: string, open: () => Promise<void>) {
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toHaveCount(0);
  await open();
  const input = pane.getByRole('textbox', { name: text.row, exact: true });
  await expect(input).toBeFocused();
  await input.fill('0');
  await expect(pane.getByRole('button', { name: text.go, exact: true })).toBeDisabled();
  await input.fill(row);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toBeFocused();
}

/** 从 Electron 正式菜单触发当前文档命令，保留窗口现有焦点。 */
async function nativeGoto() {
  await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line')?.enabled)).toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line'), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('跳转菜单不可用');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  });
}

test('查询结果和 SQLite 可编辑表、只读视图可全选和定位未渲染行且无额外数据任务', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), table = page.locator('.sqlite-table-tab:visible');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const selectAllKey = process.platform === 'darwin' ? 'Meta+Shift+Space' : 'Control+Shift+Space';
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('gridcell', { name: '180', exact: true })).toBeVisible();
  const open = query.getByRole('button', { name: text.open, exact: true });
  await expect(open).toBeEnabled();
  const before = await tasks();
  const firstResult = query.getByRole('gridcell', { name: '180', exact: true });
  await firstResult.click();
  await page.keyboard.press(selectAllKey);
  await expect(firstResult).toBeFocused();
  await expect(firstResult.locator('..').getByRole('checkbox')).toBeChecked();
  await jump(query, '120', '61', () => page.keyboard.press('Control+g'));
  await expect(query.getByRole('gridcell', { name: '61', exact: true }).locator('..').getByRole('checkbox')).toBeChecked();
  await query.getByRole('button', { name: selectionText.clear, exact: true }).click();
  expect(await tasks()).toEqual(before);
  await open.click();
  await query.getByRole('textbox', { name: text.row, exact: true }).press('Escape');
  await expect(open).toBeFocused();
  await query.locator('.monaco-editor').getByRole('textbox').focus();
  await nativeGoto();
  const editorGoto = page.locator('.quick-input-widget:visible input');
  await expect(editorGoto).toBeFocused();
  await expect(query.getByRole('textbox', { name: text.row, exact: true })).toHaveCount(0);
  await editorGoto.press('Escape');

  for (const [tab, title, readOnly] of [['t-jump', '表格定位', 'false'], ['v-jump', '视图定位', 'true']] as const) {
    await page.locator(`[data-workspace-tab-id="${tab}"]`).getByRole('button', { name: title, exact: true }).click();
    await expect(table).toHaveAttribute('data-readonly', readOnly);
    const value = (row: string) => readOnly === 'false' ? 'INTEGER · ' + row : row;
    await expect(table.getByRole('gridcell', { name: value('1'), exact: true })).toBeVisible();
    await expect(table.getByRole('button', { name: text.open, exact: true })).toBeEnabled();
    const originalTasks = await tasks();
    await table.getByRole('gridcell', { name: value('1'), exact: true }).click();
    if (readOnly === 'true') {
      await table.getByRole('button', { name: selectionText.all, exact: true }).click();
      await table.getByRole('gridcell', { name: value('1'), exact: true }).focus();
    } else {
      await page.keyboard.press(selectAllKey);
    }
    await jump(table, '80', value('80'), readOnly === 'false' ? nativeGoto : () => page.keyboard.press('Control+g'));
    const row = table.getByRole('gridcell', { name: value('80'), exact: true }).locator('..').getByRole('checkbox');
    const clear = table.getByRole('button', { name: selectionText.clear, exact: true });
    await expect(row).toBeChecked();
    await clear.click();
    await expect(row).not.toBeChecked();
    await expect(clear).toBeDisabled();
    if (readOnly === 'true') {
      await table.getByRole('button', { name: selectionText.invert, exact: true }).click();
      await expect(row).toBeChecked();
      await clear.click();
      await expect(row).not.toBeChecked();
      await expect(clear).toBeDisabled();
    }
    expect(await tasks()).toEqual(originalTasks);
  }
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询显示原生结果列来源并打开原表', async ({}, info) => {
  await seed('SELECT id AS 重名, name AS 重名, id + 1 AS id FROM subject_view ORDER BY id LIMIT 2;');
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('gridcell', { name: '记录 1', exact: true })).toBeVisible();
  const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute'));
  await expect.poll(async () => (await executions()).map(task => task.status)).toEqual(['completed']);
  const before = await executions();
  await (await navigationMenuItem(query, { name: originsText.open, exact: true })).click();
  const dialog = page.getByRole('dialog', { name: originsText.title, exact: true });
  const rows = dialog.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByRole('cell')).toHaveText(['1', 'main', 'subject', 'id', originsText.openTable]);
  await expect(rows.nth(1).getByRole('cell')).toHaveText(['2', 'main', 'subject', 'name', originsText.openTable]);
  await expect(rows.nth(2).getByRole('cell')).toHaveText(['3', '—', '—', '—', '']);
  await info.attach('SQLite查询结果列来源', { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: originsText.tableLabel('subject', 2), exact: true }).click();
  await expect(page.locator('.sqlite-table-tab:visible').getByRole('grid')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-workspace-tab-id="q-jump"]').getByRole('button', { name: '查询定位', exact: true }).click();
  await expect(query.getByRole('gridcell', { name: '记录 1', exact: true })).toBeVisible();
  expect(await executions()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询原表 SQL 保留存储类型并在只读连接打开草稿', async ({}, info) => {
  const sql = `SELECT p.id AS 编号,p.tenant,p.note AS 正文,p.note AS 重复,p.raw,p.amount,p.auto_text
    FROM "records?" p WHERE p.id<9007199254740994 ORDER BY p.id DESC;`;
  const noKey = 'SELECT note AS 无键正文 FROM no_key;';
  await seed(sql, `CREATE TABLE "records?" (tenant TEXT COLLATE NOCASE, id INTEGER, note TEXT, raw, amount,
    auto_text TEXT GENERATED ALWAYS AS (note||'派生') STORED, PRIMARY KEY(tenant,id)) WITHOUT ROWID;
    INSERT INTO "records?"(tenant,id,note,raw,amount) VALUES
      ('A',9007199254740992,'旧''值'||char(0)||'尾',X'00FF',1.0),
      ('A',9007199254740993,'第二行',NULL,9e999),('A',9007199254740994,'范围外','原文本',7);
    CREATE TABLE no_key(note TEXT, omitted TEXT DEFAULT '默认');
    INSERT INTO no_key(note) VALUES ('无主键');`, noKey, true);
  const query = page.locator('.query-tab:visible'), dialog = page.getByRole('dialog', { name: rowSqlText.title, exact: true });
  const grid = query.locator('.query-result-grid').getByRole('grid'), pre = dialog.locator('pre');
  const execute = async () => {
    await query.locator('.query-execute-split > button.primary').click();
    await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
  };
  const open = async () => (await navigationMenuItem(query, { name: rowSqlText.open, exact: true })).click();
  const make = async (kind: string, prefix: string) => {
    await dialog.getByLabel(rowSqlText.kind, { exact: true }).selectOption(kind);
    await dialog.getByRole('button', { name: rowSqlText.prepare, exact: true }).click();
    await expect(pre).toContainText(prefix);
    return (await pre.textContent())!;
  };
  const disk = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  const read = () => {
    const statement = disk.prepare('SELECT tenant,id,typeof(raw) AS raw_type,hex(raw) AS raw_hex,typeof(amount) AS amount_type,amount,hex(note) AS note_hex FROM "records?" ORDER BY id');
    statement.setReadBigInts(true);
    return statement.all();
  };
  try {
    const original = read();
    await execute();
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(resultSort.ascending)).toBeVisible();
    for (const id of ['9007199254740993', '9007199254740992'])
      await grid.getByRole('gridcell', { name: id, exact: true }).locator('..').getByRole('checkbox').check();
    await open();
    await expect(dialog).toContainText(rowSqlText.scope(2));
    const select = await make('select', 'SELECT * FROM "main"."records?"');
    const insert = await make('insert', 'INSERT INTO "main"."records?"');
    const update = await make('update', 'UPDATE "main"."records?"');
    const remove = await make('delete', 'DELETE FROM "main"."records?"');
    await expect(dialog.getByText('"main"."records?"', { exact: true })).toBeVisible();
    expect(insert).toContain('("tenant", "id", "note", "raw", "amount")');
    expect(insert).toContain('char(0)');
    expect(insert).toContain("X'00ff'");
    expect(insert).toContain('1.0');
    expect(insert).toContain('9e999');
    expect(update).not.toMatch(/SET "id"|auto_text|重复/);
    expect(read()).toEqual(original);
    const clipboard = await readGridMenuClipboard(page, dialog.getByRole('button', { name: rowSqlText.copy, exact: true }));
    expect(clipboard.text).toBe(remove);
    await info.attach('SQLite查询结果原表SQL', { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: rowSqlText.draft, exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).tabs
      .filter(tab => tab.title.endsWith('DELETE 草稿')).map(tab => ({ sql: tab.sql, database: tab.database })))).toEqual([{ sql: remove, database: 'main' }]);
    expect(read()).toEqual(original);

    disk.exec('BEGIN');
    try {
      const statement = disk.prepare(select);
      statement.setReadBigInts(true);
      expect(statement.all().map(row => row.id).sort()).toEqual([9007199254740992n, 9007199254740993n]);
      disk.exec(`UPDATE "records?" SET note='待恢复',raw=0,amount=0 WHERE id<9007199254740994;`);
      disk.exec(update);
      expect(read()).toEqual(original);
      disk.exec(remove);
      expect(read()).toEqual([original[2]]);
      disk.exec(insert);
      expect(read()).toEqual(original);
    } finally { disk.exec('ROLLBACK'); }

    await page.locator('[data-workspace-tab-id="q-copy-source"]').getByRole('button', { name: '复制来源', exact: true }).click();
    await execute();
    await grid.getByRole('gridcell', { name: '无主键', exact: true }).click();
    await open();
    await expect(dialog.locator('option')).toHaveText([rowSqlText.insert]);
    expect(await make('insert', 'INSERT INTO "main"."no_key"')).toBe(`INSERT INTO "main"."no_key" ("note") VALUES ('无主键');`);
    await dialog.getByRole('button', { name: rowSqlText.close, exact: true }).click();

    const executionId = randomUUID(), session = await page.evaluate(async ({ sql, executionId }) => {
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId: 'row-jump-offline', database: 'main' });
      await window.dbark.invoke('query.execute', { sessionId, sql, taskId: executionId, maxRows: 10 });
      return sessionId;
    }, { sql, executionId });
    try {
      disk.exec('CREATE TABLE changed_directory(id INTEGER)');
      const stale = await page.evaluate(async ({ sessionId, executionId, taskId }) => {
        try {
          await window.dbark.invoke('sqlite.queryRowSql', { connectionId: 'row-jump-offline', sessionId, executionId, taskId, kind: 'select', rowIndices: [0] });
          return '';
        } catch (error) { return String(error); }
      }, { sessionId: session, executionId, taskId: randomUUID() });
      expect(stale).toContain('文件或表结构已变化');
    } finally { await page.evaluate(sessionId => window.dbark.invoke('sessions.close', { sessionId }), session); }
    expect(read()).toEqual(original);
    expect(pageErrors).toEqual([]);
  } finally { disk.close(); }
});

test('SQLite 查询从排序后的结果编辑正确原行并拒绝陈旧行', async ({}, info) => {
  await seed('SELECT id AS 编号, name AS 名称 FROM subject ORDER BY id DESC LIMIT 3;');
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const edit = async (name: string) => {
    await grid.getByRole('gridcell', { name, exact: true }).click();
    await (await navigationMenuItem(query, { name: originsText.editRecord, exact: true })).click();
  };
  const disk = (sql: string) => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };
  await execute();
  await expect(grid.getByRole('gridcell', { name: '记录 180', exact: true })).toBeVisible();
  const header = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await expect(grid.getByRole('gridcell').filter({ hasText: /^记录 / })).toHaveText(['记录 178', '记录 179', '记录 180']);
  await edit('记录 178');
  const form = page.getByRole('dialog', { name: '编辑 SQLite 当前行', exact: true });
  const field = form.getByLabel('SQLite 字段 name 值', { exact: true });
  await expect(field).toHaveValue('记录 178');
  await field.fill('从查询改写');
  await form.getByRole('button', { name: '保存 SQLite 本地草稿', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toBeVisible();
  expect(disk('SELECT name FROM subject WHERE id=178')).toEqual([{ name: '记录 178' }]);
  await info.attach('SQLite查询原记录编辑预览', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(disk('SELECT name FROM subject WHERE id IN (178, 179, 180) ORDER BY id')).toEqual([
    { name: '从查询改写' }, { name: '记录 179' }, { name: '记录 180' },
  ]);
  await execute();
  await expect(grid.getByRole('gridcell', { name: '从查询改写', exact: true })).toBeVisible();
  disk("UPDATE subject SET name='独立连接改写' WHERE id=179 RETURNING name");
  await edit('记录 179');
  const rejected = page.getByRole('dialog', { name: originsText.editRecord, exact: true });
  await expect(rejected.getByText(/SQLite 查询结果无法核验为当前原记录/)).toBeVisible();
  await expect(form).toHaveCount(0);
  await rejected.getByRole('button', { name: originsText.editBack, exact: true }).click();
  expect(disk('SELECT name FROM subject WHERE id=179')).toEqual([{ name: '独立连接改写' }]);
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(2);
  expect(tasks.filter(task => task.kind === 'sqlite.tableEdit.apply')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('SQLite 只读查询结果可沿复合外键浏览父子记录并打开独立关联页', async ({}, info) => {
  await seed('SELECT tenant AS 区, id AS 编号, note AS 名称 FROM fk_subject ORDER BY id DESC;', `
    CREATE TABLE fk_parent (tenant TEXT COLLATE NOCASE, id INTEGER, note TEXT, PRIMARY KEY (tenant, id)) WITHOUT ROWID;
    CREATE TABLE fk_subject (tenant TEXT COLLATE NOCASE, id INTEGER, parent_id INTEGER, note TEXT,
      PRIMARY KEY (tenant, id), FOREIGN KEY (tenant, parent_id) REFERENCES fk_parent (tenant, id)) WITHOUT ROWID;
    CREATE TABLE fk_leaf (id INTEGER PRIMARY KEY, tenant TEXT, subject_id INTEGER, note TEXT,
      FOREIGN KEY (tenant, subject_id) REFERENCES fk_subject (tenant, id));
    INSERT INTO fk_parent VALUES ('Alpha', 9007199254740993, '准确父甲'), ('Beta', 9007199254740993, '无关父乙');
    INSERT INTO fk_subject VALUES ('alpha', 2, 9007199254740993, '所选甲'), ('beta', 3, 9007199254740993, '所选乙');
    INSERT INTO fk_leaf VALUES (1, 'ALPHA', 2, '子记录甲'), (2, 'BETA', 3, '无关子乙');
  `, undefined, true);
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const row = grid.getByRole('gridcell', { name: '所选甲', exact: true });
  const dialog = page.getByRole('dialog', { name: relationText.title, exact: true });
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const browse = async () => {
    await row.click();
    await (await navigationMenuItem(query, { name: relationText.entry, exact: true })).click();
  };
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  await query.locator('.query-execute-split > button.primary').click();
  const header = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await expect(row.locator('..')).toHaveAttribute('aria-rowindex', '2');
  await browse();
  await button(parentText.catalog).click();
  await button(parentText.read).click();
  const results = dialog.getByRole('grid');
  await expect(results).toContainText('准确父甲');
  await expect(results).not.toContainText('无关父乙');
  await expect(results).toContainText('9007199254740993');
  await info.attach('SQLite查询结果外键关联', { body: await page.screenshot(), contentType: 'image/png' });
  await button(relationText.children).click();
  await button(childText.catalog).click();
  await button(childText.read).click();
  await expect(results).toContainText('子记录甲');
  await expect(results).not.toContainText('无关子乙');
  await button(relatedText.open).click();
  const related = page.locator('.sqlite-table-tab:visible').getByRole('grid');
  await expect(related).toContainText('子记录甲');
  await expect(related).not.toContainText('无关子乙');
  await page.locator('[data-workspace-tab-id="q-jump"]').getByRole('button', { name: '查询定位', exact: true }).click();
  const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  try { db.exec("UPDATE fk_subject SET note='并发改写' WHERE id=2"); } finally { db.close(); }
  await browse();
  await expect(dialog.getByRole('alert')).toContainText('SQLite 查询结果无法核验为当前原记录');
  await button(relationText.close).click();
  await expect(dialog).toBeHidden();
  const recorded = await tasks();
  expect(recorded.filter(task => task.kind === 'query.execute')).toHaveLength(1);
  expect(recorded.filter(task => task.kind.startsWith('sqlite.tableEdit.'))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询网格原位编辑重名列并保留精确字段与确认', async ({}, info) => {
  await seed('SELECT id AS 同名, name AS 同名 FROM subject ORDER BY id DESC LIMIT 3;');
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(grid.getByRole('gridcell', { name: '记录 178', exact: true })).toBeVisible();
  const header = grid.getByRole('columnheader').filter({ hasText: /^同名/ }).first();
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await expect(grid.getByRole('gridcell').filter({ hasText: /^记录 / })).toHaveText(['记录 178', '记录 179', '记录 180']);
  const target = grid.getByRole('gridcell', { name: '记录 178', exact: true });
  const form = page.getByRole('region', { name: originsText.inlineLabel('同名'), exact: true });
  const field = form.getByLabel('SQLite 字段 name 值', { exact: true });
  await target.click();
  await target.press('F2');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('记录 178');
  await field.fill('取消后不写入');
  await field.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(target).toBeFocused();
  await target.press('A');
  await expect(field).toHaveValue('A');
  await field.press('Escape');
  await expect(target).toBeFocused();

  await target.dblclick();
  await expect(field).toBeFocused();
  const anchor = await query.locator('[role="gridcell"]').filter({ hasText: /^记录 178$/ }).boundingBox();
  const position = await form.boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  if (!anchor || !position) throw Error('原格或行内输入框没有可见坐标');
  await info.attach('SQLite查询网格锚点', { body: JSON.stringify({ anchor, position, viewport }), contentType: 'application/json' });
  expect(Math.abs(Math.max(8, Math.min(anchor.x, viewport.width - position.width - 8)) - position.x), '行内输入框横向锚点').toBeLessThanOrEqual(2);
  expect(Math.abs(Math.max(8, Math.min(anchor.y, viewport.height - position.height - 8)) - position.y), '行内输入框纵向锚点').toBeLessThanOrEqual(2);
  await field.fill('网格内更新');
  await info.attach('SQLite查询网格原位编辑', { body: await page.screenshot(), contentType: 'image/png' });
  await field.press('Enter');
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toContainText('SET "name"=');
  await expect(preview.getByRole('button', { name: '提交 SQLite 修改', exact: true })).toBeDisabled();
  const disk = () => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT id,name FROM subject WHERE id BETWEEN 178 AND 180 ORDER BY id').all(); } finally { db.close(); }
  };
  expect(disk()[0]).toEqual({ id: 178, name: '记录 178' });
  await preview.getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click();
  await expect(field).toHaveValue('网格内更新');
  await field.press('Enter');
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(disk()).toEqual([{ id: 178, name: '网格内更新' }, { id: 179, name: '记录 179' }, { id: 180, name: '记录 180' }]);
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await expect(grid.getByRole('gridcell').filter({ hasText: /^记录 / })).toHaveText(['记录 178', '记录 179', '记录 180']);
  await expect(target).toBeFocused();
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(1);
  expect(tasks.filter(task => task.kind === 'sqlite.tableEdit.apply')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询计算列只读且原字段按精确主键提交', async ({}, info) => {
  const sql = `SELECT (p.id) AS 计算键,p.*,upper(p.note)||'-计算' AS note,CAST(p.id AS TEXT) AS 字串
    FROM compute_subject p ORDER BY p.id DESC;`;
  const noKey = 'SELECT (p.id) AS 计算键,p.note FROM compute_subject p WHERE p.id=9007199254740993;';
  await seed(sql, `CREATE TABLE compute_subject(id INTEGER PRIMARY KEY, note TEXT, guard TEXT);
    INSERT INTO compute_subject VALUES (9007199254740992,'原值甲','甲保护'),(9007199254740993,'原值乙','乙保护');`, noKey);
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const cell = (value: string) => grid.getByRole('gridcell', { name: value, exact: true });
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const inline = (name: string) => page.getByRole('region', { name: originsText.inlineLabel(name), exact: true });
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const read = () => {
    const disk = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
    try { return disk.prepare('SELECT CAST(id AS TEXT) AS id,note,guard FROM compute_subject ORDER BY id').all(); }
    finally { disk.close(); }
  };
  const original = read();
  await execute();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  await (await navigationMenuItem(query, { name: originsText.open, exact: true })).click();
  const origins = page.getByRole('dialog', { name: originsText.title, exact: true });
  await expect(origins.locator('tbody tr').first().getByRole('cell')).toHaveText(['1', '—', '—', '—', '']);
  await origins.getByRole('button', { name: zh.common.close, exact: true }).click();
  const computedKey = cell('9007199254740993').and(grid.locator('[role=gridcell][aria-colindex="2"]'));
  await computedKey.click();
  await computedKey.press('F2');
  await expect(inline('计算键')).toHaveCount(0);
  const computed = cell('原值甲-计算');
  await computed.click();
  await computed.press('F2');
  await expect(inline('note')).toHaveCount(0);
  await pasteGridRangeClipboard(page, '不能写入计算列');
  await expect(query.getByRole('alert')).toContainText(originsText.computedReadOnly);
  expect(read()).toEqual(original);

  const note = cell('原值甲');
  await note.click();
  await note.press('F2');
  const input = inline('note').getByLabel('SQLite 字段 note 值', { exact: true });
  await expect(input).toHaveValue('原值甲');
  await input.fill('提交到原字段');
  await input.press('Enter');
  const sqlPreview = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
  await expect(sqlPreview).toContainText('SET "note"=');
  expect(read()).toEqual(original);
  await info.attach('SQLite计算列查询编辑原字段', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(read()).toEqual([{ ...original[0], note: '提交到原字段' }, original[1]]);

  await page.locator('[data-workspace-tab-id="q-copy-source"]').getByRole('button', { name: '复制来源', exact: true }).click();
  await execute();
  await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
  await cell('原值乙').click();
  await expect(await navigationMenuItem(query, { name: originsText.editRecord, exact: true })).toHaveCount(0);
  await (await navigationMenuItem(query, { name: rowSqlText.open, exact: true })).click();
  const draft = page.getByRole('dialog', { name: rowSqlText.title, exact: true });
  await expect(draft.locator('option')).toHaveText([rowSqlText.insert]);
  await draft.getByRole('button', { name: rowSqlText.prepare, exact: true }).click();
  await expect(draft.locator('pre')).toHaveText('INSERT INTO "main"."compute_subject" ("note") VALUES (\'原值乙\');');
  await draft.getByRole('button', { name: rowSqlText.close, exact: true }).click();
  expect(pageErrors).toEqual([]);
});

test('SQLite JOIN 查询仅提交唯一主表原行', async ({}, info) => {
  const projection = 's.note AS 同名,upper(p.note)||\'-计算\' AS 同名,p.tenant AS 区,p.id AS 编号,p.note AS 同名';
  const select = `SELECT ${projection} FROM join_subject p`;
  await seed(select + ' LEFT JOIN join_side s ON (s.id=p.side_id) ORDER BY p.id DESC;',
    `CREATE TABLE join_subject(tenant TEXT, id INTEGER, side_id INTEGER, note TEXT, guard TEXT, PRIMARY KEY(tenant,id)) WITHOUT ROWID;
     CREATE TABLE join_side(id INTEGER PRIMARY KEY, owner INTEGER, note TEXT);
     INSERT INTO join_subject VALUES ('区',9007199254740992,1,'主表甲','甲保护'),('区',9007199254740993,2,'主表乙','乙保护');
     INSERT INTO join_side VALUES (1,1,'连接甲'),(3,1,'连接丙');`,
    select + ' INNER JOIN join_side s ON s.owner=p.side_id;');
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const cell = (value: string) => grid.getByRole('gridcell', { name: value, exact: true });
  const inline = page.getByRole('region', { name: originsText.inlineLabel('同名'), exact: true });
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const execute = async () => {
    await query.locator('.query-execute-split > button.primary').click();
    await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
  };
  const disk = (sql: string) => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };
  const rows = () => disk('SELECT CAST(id AS TEXT) AS id,note,guard FROM join_subject ORDER BY id');
  const links = () => disk('SELECT id,note FROM join_side ORDER BY id');
  const original = rows(), originalLinks = links();
  await execute();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
  await sort.click();
  await expect(sort.getByLabel(resultSort.ascending)).toBeVisible();
  await cell('连接甲').click();
  await cell('连接甲').press('F2');
  await expect(inline).toHaveCount(0);
  await pasteGridRangeClipboard(page, '不能改连接表');
  await expect(query.getByRole('alert')).toContainText(originsText.joinReadOnly);
  await cell('主表甲-计算').click();
  await cell('主表甲-计算').press('F2');
  await expect(inline).toHaveCount(0);
  await pasteGridRangeClipboard(page, '不能改计算列');
  await expect(query.getByRole('alert')).toContainText(originsText.computedReadOnly);
  expect(rows()).toEqual(original);

  await cell('主表乙').click();
  await expect(await navigationMenuItem(query, { name: originsText.editJoin, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await cell('主表甲').click();
  await page.keyboard.press('Shift+ArrowDown');
  await pasteGridRangeClipboard(page, '更新甲\n更新乙');
  const review = page.getByRole('dialog', { name: sqlitePaste.title, exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await review.getByRole('button', { name: sqlitePaste.stage, exact: true }).click();
  await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toContainText('9007199254740992');
  expect(rows()).toEqual(original);
  await info.attach('SQLite连接查询编辑主表', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(rows()).toEqual([{ ...original[0], note: '更新甲' }, { ...original[1], note: '更新乙' }]);
  expect(links()).toEqual(originalLinks);

  await execute();
  await cell('更新甲').click();
  await (await navigationMenuItem(query, { name: rowSqlText.open, exact: true })).click();
  const draft = page.getByRole('dialog', { name: rowSqlText.title, exact: true });
  await draft.getByLabel(rowSqlText.kind, { exact: true }).selectOption('update');
  await draft.getByRole('button', { name: rowSqlText.prepare, exact: true }).click();
  await expect(draft.locator('pre')).toContainText('UPDATE "main"."join_subject" SET "note" = \'更新甲\'');
  await expect(draft.locator('pre')).not.toContainText('join_side');
  await draft.getByRole('button', { name: rowSqlText.close, exact: true }).click();

  await page.locator('[data-workspace-tab-id="q-copy-source"]').getByRole('button', { name: '复制来源', exact: true }).click();
  await execute();
  await expect(cell('更新甲')).toHaveCount(2);
  await expect(await navigationMenuItem(query, { name: originsText.editJoin, exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询从空结果向无主键来源表新增，保留默认值与精确整数', async ({}, info) => {
  await seed('SELECT t.note AS 名称 FROM insert_source t WHERE t.qty=0;',
    `CREATE TABLE insert_source(rowid TEXT, _rowid_ TEXT, oid TEXT, note TEXT DEFAULT '原表默认值',
      qty INTEGER DEFAULT 7, derived TEXT GENERATED ALWAYS AS (note || ':' || qty) STORED);
     INSERT INTO insert_source(note,qty) VALUES ('已有记录',5);`,
    'SELECT note FROM insert_view;');
  const observer = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  try {
    observer.exec('CREATE VIEW insert_view AS SELECT note FROM insert_source');
    const query = page.locator('.query-tab:visible'), form = page.getByRole('dialog', { name: sqliteEditText.add, exact: true });
    const preview = page.getByRole('dialog', { name: sqliteEditText.previewTitle, exact: true });
    const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
    const open = () => navigationMenuItem(query, { name: originsText.insertOpen, exact: true });
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const save = () => form.getByRole('button', { name: sqliteEditText.saveInput, exact: true }).click();
    const apply = preview.getByRole('button', { name: sqliteEditText.submit, exact: true });
    const rows = () => observer.prepare('SELECT note,CAST(qty AS TEXT) AS qty,derived FROM insert_source ORDER BY qty').all();
    const original = rows();
    await execute();
    await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
    await expect(query.locator('.query-result-grid').getByRole('gridcell')).toHaveCount(0);
    await (await open()).click();
    await expect(form.getByRole('checkbox', { name: sqliteEditText.include('derived'), exact: true })).toBeDisabled();
    await save();
    await expect(sql).toHaveText('INSERT INTO "main"."insert_source" DEFAULT VALUES');
    await expect(apply).toBeDisabled();
    expect(rows()).toEqual(original);
    await preview.getByRole('button', { name: sqliteEditText.closePreview, exact: true }).click();
    await form.getByRole('checkbox', { name: sqliteEditText.include('qty'), exact: true }).check();
    await form.getByRole('combobox', { name: sqliteEditText.type('qty'), exact: true }).selectOption('integer');
    await form.getByRole('textbox', { name: sqliteEditText.value('qty'), exact: true }).fill('9007199254740993');
    await save();
    await expect(sql).toHaveText('INSERT INTO "main"."insert_source" ("qty") VALUES (9007199254740993)');
    expect(rows()).toEqual(original);
    await info.attach('SQLite查询空结果新增记录', { body: await page.screenshot(), contentType: 'image/png' });
    await preview.getByRole('checkbox', { name: sqliteEditText.confirmation, exact: true }).check();
    await apply.click();
    await expect(preview).toBeHidden();
    expect(rows()).toEqual([...original, { note: '原表默认值', qty: '9007199254740993', derived: '原表默认值:9007199254740993' }]);
    await expect(await open()).toHaveCount(0);

    await page.locator('[data-workspace-tab-id="q-copy-source"]').getByRole('button', { name: '复制来源', exact: true }).click();
    await execute();
    await expect(query.getByRole('gridcell', { name: '已有记录', exact: true })).toBeVisible();
    await expect(await open()).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally { observer.close(); }
});

test('SQLite 查询新增拒绝结构漂移，原执行新增能力只能暂存一条', async ({}) => {
  await seed('SELECT note FROM insert_guard;', 'CREATE TABLE insert_guard(note TEXT DEFAULT \'初始值\');');
  const observer = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  try {
    const query = page.locator('.query-tab:visible');
    const form = page.getByRole('dialog', { name: sqliteEditText.add, exact: true });
    const preview = page.getByRole('dialog', { name: sqliteEditText.previewTitle, exact: true });
    const readFailure = page.getByRole('dialog', { name: originsText.insertOpen, exact: true });
    const action = () => navigationMenuItem(query, { name: originsText.insertOpen, exact: true });
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    await execute();
    await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
    observer.exec('ALTER TABLE insert_guard ADD COLUMN changed TEXT');
    await (await action()).click();
    await expect(readFailure.getByRole('alert')).toContainText('无法核验');
    await readFailure.getByRole('button', { name: originsText.editBack, exact: true }).click();
    await expect(readFailure).toBeHidden();

    const restrictions = await page.evaluate(async () => {
      const connectionId = 'row-jump-offline', table = 'insert_guard';
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database: 'main' });
      try {
        const execution = crypto.randomUUID();
        await window.dbark.invoke('query.execute', { sessionId, sql: 'SELECT note FROM insert_guard', taskId: execution, maxRows: 10 });
        const page = await window.dbark.invoke('sqlite.tablePage', { connectionId, database: 'main', table, taskId: crypto.randomUUID(),
          editing: true, offset: 0, limit: 1, mode: 'and', filters: [], sort: [], queryRecord: { sessionId, taskId: execution, operation: 'insert' } });
        if (page.edit?.kind !== 'editable') throw Error('未取得查询新增快照');
        const { snapshotId, locator } = page.edit;
        const rejected: string[] = [];
        try {
          const insert = { kind: 'insert' as const, values: [] };
          for (const changes of [[{ kind: 'delete' as const, row: 0 }], [insert, insert]]) {
            try { await window.dbark.invoke('sqlite.tableEdit.preview', { snapshotId, taskId: crypto.randomUUID(), changes }); }
            catch (error) { rejected.push(String(error)); }
          }
        } finally { await window.dbark.invoke('sqlite.tableEdit.release', { snapshotId }); }
        return { rows: page.result.rows.length, locator: !!locator, rejected };
      } finally { await window.dbark.invoke('sessions.close', { sessionId }); }
    });
    expect(restrictions).toEqual({ rows: 0, locator: false, rejected: [expect.stringContaining('只允许新增一条'), expect.stringContaining('只允许新增一条')] });

    await execute();
    await expect(query.locator('.tab-status').getByText(/^本次总耗时/)).toBeVisible();
    await (await action()).click();
    await form.getByRole('button', { name: sqliteEditText.saveInput, exact: true }).click();
    await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toContainText('DEFAULT VALUES');
    observer.exec('ALTER TABLE insert_guard ADD COLUMN later TEXT');
    await preview.getByRole('checkbox', { name: sqliteEditText.confirmation, exact: true }).check();
    await preview.getByRole('button', { name: sqliteEditText.submit, exact: true }).click();
    await expect(preview.getByRole('alert')).toContainText('SQLite表结构已变化');
    expect(observer.prepare('SELECT * FROM insert_guard').all()).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally { observer.close(); }
});

test('SQLite 查询替换快捷键按当前焦点路由并保留原预览', async ({}, info) => {
  await seed('SELECT id,name FROM subject WHERE id IN (1,2) ORDER BY id;', '', 'SELECT id,name FROM subject_view WHERE id=1;');
  const query = page.locator('.query-tab:visible');
  const editor = query.locator('.monaco-editor');
  const editorReplace = editor.locator('.find-widget .replace-part textarea');
  const panel = query.getByRole('region', { name: replaceText.title, exact: true });
  const search = panel.getByLabel(replaceText.query, { exact: true });
  const replacement = panel.getByLabel(replaceText.replacement, { exact: true });
  const review = panel.getByRole('region', { name: replaceText.review, exact: true });
  const cell = query.getByRole('gridcell', { name: '记录 1', exact: true });
  const shortcut = process.platform === 'darwin' ? 'Alt+Meta+f' : 'Control+h';
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const menuReplace = async () => {
    await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('replace')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('replace'), [window] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !window) throw Error('没有可用的原生替换菜单');
      item.click(item, window, {} as Electron.KeyboardEvent);
    });
  };

  await execute();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  await cell.click();
  await page.keyboard.press(shortcut);
  await expect(replacement).toBeFocused();
  await expect(editorReplace).toBeHidden();
  await search.fill('记录');
  await replacement.fill('预览替换');
  await cell.click();
  await menuReplace();
  await expect(replacement).toBeFocused();
  await expect(search).toHaveValue('记录');
  await expect(replacement).toHaveValue('预览替换');
  await panel.getByRole('button', { name: replaceText.all, exact: true }).click();
  await expect(review).toContainText(replaceText.reviewCount(2, 2));
  await cell.click();
  await page.keyboard.press(shortcut);
  await expect(review).toBeVisible();
  await info.attach('SQLite结果替换快捷键', { body: await page.screenshot(), contentType: 'image/png' });
  await panel.getByRole('button', { name: replaceText.close, exact: true }).click();

  await editor.locator('.view-lines').click();
  await menuReplace();
  await expect(editorReplace).toBeVisible();
  await expect(panel).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('[data-workspace-tab-id="q-copy-source"]').getByRole('button', { name: '复制来源', exact: true }).click();
  await execute();
  await cell.click();
  const receipt = await page.evaluateHandle(() => {
    const state = { seen: false, release: () => {} };
    state.release = window.dbark.onCommand(command => { if (command.id === 'replace') state.seen = true; });
    return state;
  });
  try {
    await menuReplace();
    await expect.poll(() => receipt.evaluate(state => state.seen)).toBe(true);
    await expect(cell).toBeFocused();
    await expect(editorReplace).toBeHidden();
    await expect(panel).toBeHidden();
  } finally {
    await receipt.evaluate(state => state.release());
    await receipt.dispose();
  }
  expect(pageErrors).toEqual([]);
});

test('SQLite JOIN 查询替换原生文本，去重投影并回滚并发冲突', async ({}, info) => {
  await seed(`SELECT p.id AS 编号,p.note AS 正文,p.note AS 重复,p.mixed AS 混合,p.derived AS 生成,
       upper(p.note) AS 计算,l.note AS 连接
     FROM replace_subject p LEFT JOIN replace_side l ON l.id=p.id WHERE p.id<3 ORDER BY p.id DESC;`,
    `CREATE TABLE replace_subject(id INTEGER PRIMARY KEY,note TEXT,mixed,guard TEXT,
       derived TEXT GENERATED ALWAYS AS (note || '生成') STORED);
     INSERT INTO replace_subject VALUES(1,'旧12',12,'甲隐藏'),(2,'旧12','12','乙隐藏'),(3,'旧12','12','范围外');
     CREATE TABLE replace_side(id INTEGER PRIMARY KEY,note TEXT);
     INSERT INTO replace_side VALUES(1,'旧12');`);
  const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  try {
    const query = page.locator('.query-tab:visible'), panel = query.getByRole('region', { name: replaceText.title, exact: true });
    const review = panel.getByRole('region', { name: replaceText.review, exact: true });
    const preview = page.getByRole('dialog', { name: originsText.replaceTitle, exact: true });
    const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
    const apply = preview.getByRole('button', { name: originsText.replaceApply, exact: true });
    const all = panel.getByRole('button', { name: replaceText.all, exact: true });
    const one = panel.getByRole('button', { name: replaceText.one, exact: true });
    const column = panel.getByLabel(replaceText.column, { exact: true });
    const execute = async () => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
      const sort = query.getByRole('columnheader').filter({ hasText: /^编号/ });
      if (!await sort.getByLabel(resultSort.ascending).isVisible()) await sort.click();
      await expect(sort.getByLabel(resultSort.ascending)).toBeVisible();
    };
    const open = async (pattern: string, replacement: string) => {
      await (await navigationMenuItem(query, { name: originsText.replaceOpen, exact: true })).click();
      await expect(panel).toBeVisible();
      await panel.getByRole('checkbox', { name: replaceText.regex, exact: true }).check();
      await panel.getByRole('checkbox', { name: replaceText.captures, exact: true }).check();
      await panel.getByLabel(replaceText.query, { exact: true }).fill(pattern);
      await panel.getByLabel(replaceText.replacement, { exact: true }).fill(replacement);
    };
    const stage = () => review.getByRole('button', { name: replaceTableText.stage, exact: true }).click();
    const submit = async () => {
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: originsText.replaceConfirm, exact: true }).check();
      await apply.click();
    };
    const rows = () => db.prepare('SELECT id,note,mixed,typeof(mixed) AS type,guard,derived FROM replace_subject ORDER BY id').all();
    const links = () => db.prepare('SELECT * FROM replace_side').all();
    const before = rows(), beforeLinks = links();
    await execute();
    await open('(旧)?(12)', '$2新');
    for (const label of ['连接', '计算', '生成']) {
      await column.selectOption({ label });
      await expect(panel.getByRole('status')).toContainText(/共 [12] 处/);
      await expect(all).toBeDisabled();
      await expect(one).toBeDisabled();
    }
    await column.selectOption({ label: '混合' });
    await expect(panel.getByRole('status')).toContainText('共 2 处');
    await expect(one).toBeDisabled();
    await all.click();
    await expect(review).toContainText(replaceText.reviewCount(1, 1));
    await review.getByRole('button', { name: replaceText.cancel, exact: true }).click();
    await column.selectOption('');
    await panel.getByLabel(tableFindFilterZh.edge, { exact: true }).selectOption('end');
    const selectedOnly = panel.getByRole('checkbox', { name: replaceText.checkedOnly, exact: true });
    await selectedOnly.check();
    await expect(panel.getByRole('status')).toHaveText(replaceText.checkedEmpty);
    await expect(all).toBeDisabled();
    const second = query.getByRole('gridcell', { name: '2', exact: true }).locator('..').getByRole('checkbox');
    await second.check();
    await expect(panel.getByText(replaceText.checkedScope(1), { exact: true })).toBeVisible();
    await all.click();
    await expect(review).toContainText(replaceText.reviewCount(2, 1));
    await expect(review).toContainText(replaceText.location(1, '正文'));
    expect(rows()).toEqual(before);
    await info.attach('SQLite查询勾选行替换预览', { body: await page.screenshot(), contentType: 'image/png' });
    await second.uncheck();
    await expect(review).toBeHidden();
    await expect(panel.getByRole('status')).toHaveText(replaceText.checkedEmpty);
    await expect(all).toBeDisabled();
    await selectedOnly.uncheck();
    await all.click();
    await expect(review).toContainText(replaceText.reviewCount(3, 2));
    expect(rows()).toEqual(before);
    await info.attach('SQLite查询结尾替换预览', { body: await page.screenshot(), contentType: 'image/png' });
    await stage();
    await expect(sql).toContainText('UPDATE "main"."replace_subject"');
    await expect(preview.getByText(originsText.replaceRows([0, 1]), { exact: true })).toBeVisible();
    const statements = await sql.textContent();
    expect(statements?.match(/UPDATE /g)).toHaveLength(2);
    expect(statements?.match(/"mixed"=/g)).toHaveLength(1);
    expect(statements).not.toContain('replace_side');
    expect(rows()).toEqual(before);
    await info.attach('SQLite查询结果文本替换', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    const updated = [{ ...before[0], note: '12新', derived: '12新生成' },
      { ...before[1], note: '12新', mixed: '12新', derived: '12新生成' }, before[2]];
    expect(rows()).toEqual(updated);
    expect(links()).toEqual(beforeLinks);

    await execute();
    await open('新', '变');
    await panel.getByRole('checkbox', { name: replaceText.regex, exact: true }).uncheck();
    await panel.getByLabel(tableFindFilterZh.edge, { exact: true }).selectOption('end');
    await all.click();
    await stage();
    await expect(sql).toContainText('12变');
    db.exec("UPDATE replace_subject SET guard='外部变更' WHERE id=2");
    await submit();
    await expect(preview.getByRole('alert')).toContainText('SQLite原记录已被其他操作修改');
    expect(rows()).toEqual([updated[0], { ...updated[1], guard: '外部变更' }, updated[2]]);
    expect(links()).toEqual(beforeLinks);
    expect(pageErrors).toEqual([]);
  } finally { db.close(); }
});

test('SQLite 查询复制勾选记录可逐条修订并在唯一约束失败时整批回滚', async ({}, info) => {
  await seed('SELECT p.id AS 编号,p.slug AS 名称 FROM copy_subject p ORDER BY p.id DESC;',
    `CREATE TABLE copy_subject(id INTEGER PRIMARY KEY,slug TEXT UNIQUE, qty INTEGER, raw BLOB, guard TEXT,
       derived TEXT GENERATED ALWAYS AS (slug || ':' || qty) STORED);
     INSERT INTO copy_subject VALUES(1,'甲',9007199254740993,x'00ff','甲隐藏'),(2,'乙',7,NULL,'乙隐藏');
     CREATE TABLE copy_audit(slug TEXT);
     CREATE TRIGGER log_copy AFTER INSERT ON copy_subject BEGIN INSERT INTO copy_audit VALUES(new.slug); END;`);
  const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
  try {
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const form = page.getByRole('dialog', { name: sqliteEditText.duplicateTitle, exact: true });
    const preview = page.getByRole('dialog', { name: originsText.duplicateTitle, exact: true });
    const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
    const action = () => navigationMenuItem(query, { name: originsText.duplicateChecked, exact: true });
    const save = () => form.getByRole('button', { name: sqliteEditText.duplicateSave, exact: true }).click();
    const setSlug = (value: string) => form.getByRole('textbox', { name: sqliteEditText.value('slug'), exact: true }).fill(value);
    const rows = () => db.prepare('SELECT id,slug,CAST(qty AS TEXT) AS qty,hex(raw) AS raw,guard,derived FROM copy_subject ORDER BY id').all();
    const audit = () => db.prepare('SELECT slug FROM copy_audit ORDER BY rowid').all();
    const submit = async () => {
      const apply = preview.getByRole('button', { name: originsText.duplicateApply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: originsText.duplicateConfirm, exact: true }).check();
      await apply.click();
    };
    const before = rows();
    await query.locator('.query-execute-split > button.primary').click();
    await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
    await expect(await action()).toBeDisabled();
    await page.keyboard.press('Escape');
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(resultSort.ascending)).toBeVisible();
    for (const name of ['乙', '甲'])
      await grid.getByRole('gridcell', { name, exact: true }).locator('..').getByRole('checkbox').check();
    await (await action()).click();
    await expect(form.getByText(originsText.duplicatePosition(1, 1, 2), { exact: true })).toBeVisible();
    await expect(form.getByRole('checkbox', { name: sqliteEditText.include('id'), exact: true })).not.toBeChecked();
    await expect(form.getByRole('checkbox', { name: sqliteEditText.include('derived'), exact: true })).toBeDisabled();
    await setSlug('甲副本');
    await form.getByRole('button', { name: sqliteEditText.saveNextRecord, exact: true }).click();
    await expect(form.getByText(originsText.duplicatePosition(2, 2, 2), { exact: true })).toBeVisible();
    await save();
    await expect(sql).toContainText('9007199254740993');
    await expect(sql).toContainText("'甲隐藏'");
    await expect(sql).toContainText("'乙隐藏'");
    await expect(sql).not.toContainText('"id"');
    await expect(sql).not.toContainText('"derived"');
    expect(rows()).toEqual(before);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('整批回滚');
    expect(rows()).toEqual(before);
    expect(audit()).toEqual([]);

    await preview.getByRole('button', { name: originsText.duplicateBack, exact: true }).click();
    await setSlug('乙副本');
    await save();
    await expect(sql).toContainText("'甲副本'");
    await expect(sql).toContainText("'乙副本'");
    await expect(preview.getByText(originsText.duplicateRows([1, 2]), { exact: true })).toBeVisible();
    await info.attach('SQLite查询记录副本预览', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    expect(rows()).toEqual([...before,
      { ...before[0], id: 3, slug: '甲副本', derived: '甲副本:9007199254740993' },
      { ...before[1], id: 4, slug: '乙副本', derived: '乙副本:7' }]);
    expect(audit()).toEqual([{ slug: '甲副本' }, { slug: '乙副本' }]);
    expect(pageErrors).toEqual([]);
  } finally { db.close(); }
});

test('SQLite JOIN 查询复制勾选主表记录时复核未投影字段', async ({}) => {
  await seed('SELECT l.note AS 连接,p.id AS 编号,p.note AS 名称 FROM copy_main p LEFT JOIN copy_side l ON l.id=p.id;',
    `CREATE TABLE copy_main(id INTEGER PRIMARY KEY,note TEXT, guard TEXT);
     CREATE TABLE copy_side(id INTEGER PRIMARY KEY,note TEXT);
     INSERT INTO copy_main VALUES(1,'原记录','隐藏原值');
     INSERT INTO copy_side VALUES(1,'连接表原值');`);
  const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
  try {
    const query = page.locator('.query-tab:visible');
    const form = page.getByRole('dialog', { name: sqliteEditText.duplicateTitle, exact: true });
    const preview = page.getByRole('dialog', { name: originsText.duplicateTitle, exact: true });
    const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const stage = async (guard: string) => {
      await query.getByRole('gridcell', { name: '原记录', exact: true }).locator('..').getByRole('checkbox').check();
      await (await navigationMenuItem(query, { name: originsText.duplicateCheckedJoin, exact: true })).click();
      await form.getByRole('button', { name: sqliteEditText.duplicateSave, exact: true }).click();
      await expect(sql).toContainText('INSERT INTO "main"."copy_main"');
      await expect(sql).toContainText(guard);
      await expect(sql).not.toContainText('copy_side');
    };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: originsText.duplicateConfirm, exact: true }).check();
      await preview.getByRole('button', { name: originsText.duplicateApply, exact: true }).click();
    };
    await execute();
    await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
    await stage('隐藏原值');
    db.exec("UPDATE copy_main SET guard='外部变更' WHERE id=1");
    await submit();
    await expect(preview.getByRole('alert')).toContainText('SQLite原记录已被其他操作修改');
    expect(db.prepare('SELECT * FROM copy_main').all()).toEqual([{ id: 1, note: '原记录', guard: '外部变更' }]);
    await preview.getByRole('button', { name: originsText.duplicateBack, exact: true }).click();
    await answerDialogs([0]);
    const [confirmation] = await Promise.all([page.waitForEvent('dialog'),
      form.getByRole('button', { name: sqliteEditText.duplicateCancel, exact: true }).click()]);
    expect(confirmation.message()).toBe(originsText.duplicateDiscard);
    await expect(form).toBeHidden();
    await execute();
    await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
    await stage('外部变更');
    await submit();
    await expect(preview).toBeHidden();
    expect(db.prepare('SELECT * FROM copy_main ORDER BY id').all()).toEqual([
      { id: 1, note: '原记录', guard: '外部变更' }, { id: 2, note: '原记录', guard: '外部变更' },
    ]);
    expect(db.prepare('SELECT * FROM copy_side').all()).toEqual([{ id: 1, note: '连接表原值' }]);
    expect(pageErrors).toEqual([]);
  } finally { db.close(); }
});

test('SQLite 查询删除勾选记录按显示顺序核验并提交', async ({}, info) => {
  const ids = ['9007199254740992', '9007199254740993', '9007199254740994', '9007199254740995'];
  await seed('SELECT p.tenant AS 区,p.id AS 编号,p.note AS 名称 FROM delete_subject p ORDER BY p.id DESC;',
    `CREATE TABLE delete_subject(tenant TEXT,id INTEGER,note TEXT,PRIMARY KEY(tenant,id)) WITHOUT ROWID;
     INSERT INTO delete_subject VALUES ('区',${ids[0]},'甲'),('区',${ids[1]},'乙'),('区',${ids[2]},'丙'),('区',${ids[3]},'丁');`);
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const preview = page.getByRole('dialog', { name: originsText.deleteTitle, exact: true });
  const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
  const submit = preview.getByRole('button', { name: originsText.deleteApply, exact: true });
  const action = () => navigationMenuItem(query, { name: originsText.deleteChecked, exact: true });
  const rows = () => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT CAST(id AS TEXT) AS id FROM delete_subject ORDER BY id').all().map(row => row.id); }
    finally { db.close(); }
  };
  const open = async () => {
    for (const id of [ids[2], ids[0]]) {
      await grid.getByRole('gridcell', { name: id, exact: true }).locator('..').getByRole('checkbox').check();
    }
    await (await action()).click();
    await expect(sql).toContainText('DELETE FROM "main"."delete_subject"');
    await expect(preview.getByText(originsText.deleteRows([1, 3]), { exact: true })).toBeVisible();
    await expect(sql).toContainText(ids[0]);
    await expect(sql).toContainText(ids[2]);
    await expect(sql).not.toContainText(ids[1]);
    await expect(sql).not.toContainText(ids[3]);
    await expect(submit).toBeDisabled();
    expect(rows()).toEqual(ids);
  };
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
  await sort.click();
  await expect(sort.getByLabel(resultSort.ascending)).toBeVisible();
  await expect(await action()).toBeDisabled();
  await page.keyboard.press('Escape');
  await open();
  await preview.getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(rows()).toEqual(ids);
  await open();
  await info.attach('SQLite删除查询勾选记录', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: originsText.deleteConfirm, exact: true }).check();
  await submit.click();
  await expect(preview).toBeHidden();
  expect(rows()).toEqual([ids[1], ids[3]]);
  expect(pageErrors).toEqual([]);
});

test('SQLite JOIN 查询删除勾选主表记录在冲突或外键失败时整批回滚', async ({}) => {
  await seed('SELECT l.note AS 连接注,p.id AS 编号,p.note AS 名称 FROM delete_join p LEFT JOIN delete_side l ON l.id=p.link_id ORDER BY p.id;',
    `CREATE TABLE delete_join(id INTEGER PRIMARY KEY,link_id INTEGER,note TEXT,guard TEXT);
     CREATE TABLE delete_side(id INTEGER PRIMARY KEY,note TEXT);
     CREATE TABLE restrict_child(parent INTEGER REFERENCES delete_join(id) ON DELETE RESTRICT);
     CREATE TABLE delete_audit(id INTEGER);
     CREATE TRIGGER log_delete AFTER DELETE ON delete_join BEGIN INSERT INTO delete_audit VALUES (old.id); END;
     INSERT INTO delete_join VALUES (1,1,'甲','保护甲'),(2,2,'乙','保护乙');
     INSERT INTO delete_side VALUES (1,'连接甲');
     INSERT INTO restrict_child VALUES (2);`);
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const preview = page.getByRole('dialog', { name: originsText.deleteTitle, exact: true });
  const sql = preview.getByLabel('SQLite 修改 SQL 预览', { exact: true });
  const disk = (statement: string) => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
    try { return db.prepare(statement).all(); } finally { db.close(); }
  };
  const original = disk('SELECT * FROM delete_join ORDER BY id');
  const links = disk('SELECT * FROM delete_side');
  const open = async (ids: readonly string[]) => {
    for (const id of ids) {
      await grid.getByRole('gridcell', { name: id, exact: true }).locator('..').getByRole('checkbox').check();
    }
    await (await navigationMenuItem(query, { name: originsText.deleteCheckedJoin, exact: true })).click();
    await expect(sql).toContainText('DELETE FROM "main"."delete_join"');
    await expect(sql).not.toContainText('delete_side');
  };
  const submit = async () => {
    await preview.getByRole('checkbox', { name: originsText.deleteConfirm, exact: true }).check();
    await preview.getByRole('button', { name: originsText.deleteApply, exact: true }).click();
  };
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const close = () => preview.getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click();
  await execute();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  await open(['1', '2']);
  await submit();
  await expect(preview.getByRole('alert')).toContainText('SQLite修改已确认整批回滚');
  expect(disk('SELECT * FROM delete_join ORDER BY id')).toEqual(original);
  expect(disk('SELECT * FROM delete_audit')).toEqual([]);
  expect(disk('SELECT parent FROM restrict_child')).toEqual([{ parent: 2 }]);
  await close();
  await expect(preview).toBeHidden();

  await open(['1', '2']);
  disk("UPDATE delete_join SET guard='外部修改' WHERE id=2");
  await submit();
  await expect(preview.getByRole('alert')).toContainText('SQLite原记录已被其他操作修改');
  expect(disk('SELECT * FROM delete_join ORDER BY id')).toEqual([original[0], { ...original[1], guard: '外部修改' }]);
  expect(disk('SELECT * FROM delete_audit')).toEqual([]);
  await close();
  await expect(preview).toBeHidden();

  // 保留触发器和连接表，仅移除外键引用，刷新原行后重跑同一批删除。
  disk('DELETE FROM restrict_child WHERE parent=2');
  await execute();
  await expect(query.getByText(originsText.inlineHint, { exact: true })).toBeVisible();
  await open(['1', '2']);
  await submit();
  await expect(preview).toBeHidden();
  expect(disk('SELECT * FROM delete_join')).toEqual([]);
  expect(disk('SELECT id FROM delete_audit ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]);
  expect(disk('SELECT * FROM delete_side')).toEqual(links);
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  expect(tasks.filter(task => task.kind === 'sqlite.tableEdit.apply').map(task => task.sqliteWrite?.phase).sort())
    .toEqual(['committed', 'rolled-back', 'rolled-back']);
  expect(pageErrors).toEqual([]);
});

test('SQLite 仅填充原生 NULL，表页一步撤销且查询预览保留空串和文本 NULL', async ({}, info) => {
  await seed('SELECT id, name, mirror FROM subject WHERE id <= 3 ORDER BY id;',
    "ALTER TABLE subject ADD mirror TEXT; UPDATE subject SET name=NULL, mirror='保留' WHERE id=1;" +
    "UPDATE subject SET name='NULL' WHERE id=2; UPDATE subject SET name='', mirror='' WHERE id=3;");
  const database = join(dataDir, 'grid-row-jump.sqlite');
  const read = () => {
    const db = new DatabaseSync(database, { readOnly: true });
    try { return db.prepare('SELECT name, mirror FROM subject WHERE id <= 3 ORDER BY id').all(); }
    finally { db.close(); }
  };
  const select = async (owner: Locator, rowIndex = 2, count = 3) => {
    const grid = owner.getByRole('grid');
    const col = await grid.getByRole('columnheader').filter({ hasText: /^name/ }).getAttribute('aria-colindex');
    await grid.locator('[role="row"][aria-rowindex="' + rowIndex + '"] [role="gridcell"][aria-colindex="' + col + '"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    for (let index = 1; index < count; index++) await page.keyboard.press('Shift+ArrowDown');
  };
  const fill = async (owner: Locator) => {
    await owner.getByRole('button', { name: rangeFill.open, exact: true }).click();
    const form = owner.getByRole('region', { name: rangeFill.open, exact: true });
    await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('补齐');
    await form.getByRole('checkbox', { name: rangeFill.onlyNull, exact: true }).check();
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
    return form;
  };
  const original = read();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await select(table);
  await fill(table);
  await select(table);
  const typed = async () => JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
  const string = (value: string) => ({ kind: 'text', value });
  expect(await typed()).toEqual([
    [string('补齐'), string('保留')], [string('NULL'), string('补齐')], [string(''), string('')],
  ]);
  expect(read()).toEqual(original);
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  await undo.click();
  await select(table);
  expect(await typed()).toEqual([
    [{ kind: 'null' }, string('保留')], [string('NULL'), { kind: 'null' }], [string(''), string('')],
  ]);
  await select(table, 4, 1);
  await expect((await fill(table)).getByRole('alert')).toHaveText(rangeFill.noNull);
  await expect(undo).toBeDisabled();

  await page.locator('[data-workspace-tab-id="q-jump"]').getByRole('button', { name: '查询定位', exact: true }).click();
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  await select(query);
  await fill(query);
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const sql = await preview.getByLabel('SQLite 修改 SQL 预览', { exact: true }).textContent();
  expect(sql?.match(/UPDATE /g)).toHaveLength(2);
  expect(sql).toContain('SET "name"=');
  expect(sql).toContain('SET "mirror"=');
  expect(read()).toEqual(original);
  await info.attach('SQLite查询仅填充SQLNULL预览', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(read()).toEqual([
    { name: '补齐', mirror: '保留' }, { name: 'NULL', mirror: '补齐' }, { name: '', mirror: '' },
  ]);
  expect(pageErrors).toEqual([]);
});

test('SQLite 整数序列检查溢出、一步撤销并按查询显示顺序提交', async ({}, info) => {
  await seed('SELECT id, qty FROM subject ORDER BY id DESC LIMIT 3;',
    'ALTER TABLE subject ADD qty INTEGER; UPDATE subject SET qty = 1000 + id;');
  const database = join(dataDir, 'grid-row-jump.sqlite');
  const read = (minimum: number, maximum: number) => {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      return db.prepare('SELECT id, CAST(qty AS TEXT) AS qty, typeof(qty) AS type FROM subject WHERE id BETWEEN ? AND ? ORDER BY id')
        .all(minimum, maximum);
    } finally { db.close(); }
  };
  const sequence = async (owner: Locator, first: Locator) => {
    await first.click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await owner.getByRole('button', { name: rangeFill.open, exact: true }).click();
    const form = owner.getByRole('region', { name: rangeFill.open, exact: true });
    await form.getByRole('combobox', { name: rangeFill.kind, exact: true }).selectOption('sequence');
    return form;
  };
  const enter = async (form: Locator, start: string, step: string) => {
    await form.getByRole('textbox', { name: rangeFill.sequenceStart, exact: true }).fill(start);
    await form.getByRole('textbox', { name: rangeFill.sequenceStep, exact: true }).fill(step);
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  };
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const original = read(1, 3), tableForm = await sequence(table, table.getByRole('gridcell', { name: 'INTEGER · 1001', exact: true }));
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  await enter(tableForm, '9223372036854775807', '1');
  await expect(tableForm.getByRole('alert')).toHaveText(rangeFill.sequenceOverflow);
  await expect(undo).toBeDisabled();
  expect(read(1, 3)).toEqual(original);
  await enter(tableForm, '9223372036854775807', '-2');
  await expect(table.getByRole('gridcell', { name: 'INTEGER · 9223372036854775803', exact: true })).toBeVisible();
  expect(read(1, 3)).toEqual(original);
  await undo.click();
  await expect(table.getByRole('gridcell', { name: 'INTEGER · 1003', exact: true })).toBeVisible();

  await page.locator('[data-workspace-tab-id="q-jump"]').getByRole('button', { name: '查询定位', exact: true }).click();
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const previous = read(178, 180), queryForm = await sequence(query, query.getByRole('gridcell', { name: '1180', exact: true }));
  await enter(queryForm, '-9223372036854775808', '3');
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toContainText('-9223372036854775808');
  expect(read(178, 180)).toEqual(previous);
  await info.attach('SQLite查询整数序列预览', { body: await page.screenshot(), contentType: 'image/png' });
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(read(178, 180)).toEqual([
    { id: 178, qty: '-9223372036854775802', type: 'integer' },
    { id: 179, qty: '-9223372036854775805', type: 'integer' },
    { id: 180, qty: '-9223372036854775808', type: 'integer' },
  ]);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询矩形填充使用显示顺序并在行冲突时整批回滚', async ({}, info) => {
  await seed('SELECT id AS 同名, name AS 同名 FROM subject ORDER BY id DESC LIMIT 3;');
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const header = grid.getByRole('columnheader').filter({ hasText: /^同名/ }).first();
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const disk = (sql: string) => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'));
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };
  const values = () => disk('SELECT name FROM subject WHERE id BETWEEN 177 AND 180 ORDER BY id').map(row => row.name);
  const fill = async (target: Locator, useShortcut = false) => {
    await target.click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    if (useShortcut) {
      await target.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: rangeFill.down, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
    } else {
      await query.getByRole('button', { name: rangeFill.open, exact: true }).click();
      const form = query.getByRole('region', { name: rangeFill.open, exact: true });
      await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('整批不可落盘');
      await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
    }
    await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toBeVisible();
  };
  const submit = async () => {
    await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
    await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  };
  await execute();
  await expect(grid.getByRole('gridcell', { name: '记录 178', exact: true })).toBeVisible();
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await fill(grid.getByRole('gridcell', { name: '记录 178', exact: true }), true);
  const sql = await preview.getByLabel('SQLite 修改 SQL 预览', { exact: true }).textContent();
  expect(sql?.match(/UPDATE /g)).toHaveLength(2);
  expect(sql).toContain('SET "name"=');
  expect(values()).toEqual(['记录 177', '记录 178', '记录 179', '记录 180']);
  await info.attach('SQLite查询矩形填充预览', { body: await page.screenshot(), contentType: 'image/png' });
  await submit();
  await expect(preview).toHaveCount(0);
  expect(values()).toEqual(['记录 177', '记录 178', '记录 178', '记录 178']);

  await execute();
  await expect(grid.getByRole('gridcell', { name: '记录 178', exact: true })).toHaveCount(3);
  await fill(grid.getByRole('gridcell', { name: '记录 178', exact: true }).first());
  expect(disk("UPDATE subject SET name='并发改写' WHERE id=179 RETURNING name")).toEqual([{ name: '并发改写' }]);
  await submit();
  await expect(preview.getByRole('alert')).toContainText(/冲突|回滚|变化/);
  expect(values()).toEqual(['记录 177', '记录 178', '并发改写', '记录 178']);
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(2);
  expect(tasks.filter(task => task.kind === 'sqlite.tablePage' && task.status === 'completed')).toHaveLength(2);
  const applies = tasks.filter(task => task.kind === 'sqlite.tableEdit.apply');
  expect(applies).toHaveLength(2);
  expect(applies.map(task => task.sqliteWrite?.phase).sort()).toEqual(['committed', 'rolled-back']);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询矩形粘贴保留原生类型并按排序后的选区提交', async ({}, info) => {
  await seed('SELECT id AS 同名, name AS 同名, qty AS 同名 FROM subject ORDER BY id DESC LIMIT 3;',
    'ALTER TABLE subject ADD qty INTEGER DEFAULT 0');
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  const input = page.getByRole('dialog', { name: sqlitePaste.title, exact: true });
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const execute = () => query.locator('.query-execute-split > button.primary').click();
  const disk = () => {
    const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT id,name,CAST(qty AS TEXT) AS qty,typeof(qty) AS kind FROM subject WHERE id BETWEEN 178 AND 180 ORDER BY id').all(); }
    finally { db.close(); }
  };
  async function applyPaste() {
    await input.getByRole('button', { name: sqlitePaste.stage, exact: true }).click();
    await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toBeVisible();
    expect(disk()[2]).toMatchObject({ id: 180, name: '记录 180', qty: '0' });
    await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
    await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
    await expect(preview).toHaveCount(0);
  }
  await execute();
  const header = grid.getByRole('columnheader').filter({ hasText: /^同名/ }).first();
  const first = grid.getByRole('gridcell', { name: '记录 178', exact: true });
  await expect(first).toBeVisible();
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  const before = disk();
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await pasteGridRangeClipboard(page, '错误\t尺寸');
  await expect(page.getByText(selectionPaste.shape(2, 2), { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(disk()).toEqual(before);
  await pasteGridRangeClipboard(page, {
    text: '\t9223372036854775807\nNULL\t-9223372036854775808',
    sqlite: JSON.stringify({ version: 1, rows: [
      [{ kind: 'text', value: '' }, { kind: 'integer', value: '9223372036854775807' }],
      [{ kind: 'null' }, { kind: 'integer', value: '-9223372036854775808' }],
    ] }),
  });
  await input.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  const table = input.getByRole('table', { name: sqlitePaste.previewRows, exact: true });
  await expect(table.getByRole('columnheader', { name: 'qty', exact: true })).toBeVisible();
  await expect(table).toContainText('9223372036854775807');
  await expect(input.getByText(originsText.pastePosition(1, 2, 2, 3), { exact: true })).toHaveCount(2);
  await expect(table).toContainText(sqlitePaste.kindLabels.null);
  await info.attach('SQLite查询矩形粘贴预览', { body: await page.screenshot(), contentType: 'image/png' });
  expect(disk()).toEqual(before);
  await applyPaste();
  expect(disk()).toEqual([
    { id: 178, name: '', qty: '9223372036854775807', kind: 'integer' },
    { id: 179, name: null, qty: '-9223372036854775808', kind: 'integer' },
    before[2],
  ]);
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();

  await execute();
  await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
    .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(2);
  await grid.getByRole('gridcell', { name: '记录 180', exact: true }).click();
  await pasteGridRangeClipboard(page, '单格锚点\n第二行');
  await input.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await expect(table).toContainText('第二行');
  await applyPaste();
  expect(disk().map(row => row.name)).toEqual(['', '第二行', '单格锚点']);
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(2);
  expect(tasks.filter(task => task.kind === 'sqlite.tablePage' && task.status === 'completed')).toHaveLength(2);
  expect(tasks.filter(task => task.kind === 'sqlite.tableEdit.apply').map(task => task.sqliteWrite?.phase)).toEqual(['committed', 'committed']);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询复制与粘贴跨标签保留原生类型和精确值', async ({}, info) => {
  await seed('SELECT id, qty, name, payload FROM subject WHERE id BETWEEN 178 AND 179 ORDER BY id;',
    'ALTER TABLE subject ADD qty INTEGER DEFAULT 0; ALTER TABLE subject ADD payload BLOB;',
    `SELECT 2 AS seq, -9223372036854775808 AS 同名, NULL AS 同名, X'' AS 同名
    UNION ALL SELECT 1, 9223372036854775807, '0007', X'00ff';`);
  const query = page.locator('.query-tab:visible');
  const grid = query.locator('.query-result-grid').getByRole('grid');
  const run = () => query.locator('.query-execute-split > button.primary').click();
  const activate = (id: string, title: string) => page.locator(`[data-workspace-tab-id="${id}"]`)
    .getByRole('button', { name: title, exact: true }).click();

  await activate('q-copy-source', '复制来源');
  await run();
  const header = grid.getByRole('columnheader').filter({ hasText: /^seq/ });
  const first = grid.getByRole('gridcell', { name: '9223372036854775807', exact: true });
  await expect(first).toBeVisible();
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await first.click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(query.locator('.grid-cell-in-range')).toHaveCount(6);
  const packet = await readGridRangeClipboard(page);
  const matrix = [
    [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '0007' }, { kind: 'blob', value: '00ff' }],
    [{ kind: 'integer', value: '-9223372036854775808' }, { kind: 'null' }, { kind: 'blob', value: '' }],
  ];
  expect(JSON.parse(packet.sqlite)).toEqual({ version: 1, rows: matrix });
  expect(JSON.parse(packet.typed).rows[0][0]).toBe('9223372036854775807');
  expect(packet.text).toContain('0007');
  await first.click({ button: 'right' });
  const menuPacket = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.withHeaders, exact: true }));
  expect(JSON.parse(menuPacket.sqlite)).toEqual({ version: 1, rows: matrix });
  expect(menuPacket.text).toMatch(/^同名\t同名\t同名\r?\n/);

  await activate('q-jump', '查询定位');
  await run();
  await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
    .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(2);
  const target = grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: '178', exact: true }) });
  await target.getByRole('gridcell', { name: '0', exact: true }).click();
  await pasteGridRangeClipboard(page, menuPacket);
  const input = page.getByRole('dialog', { name: sqlitePaste.title, exact: true });
  await input.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  const oldNew = input.getByRole('table', { name: sqlitePaste.previewRows, exact: true });
  await expect(oldNew).toContainText('9223372036854775807');
  await expect(oldNew).toContainText('0007');
  await expect(oldNew).toContainText('00ff');
  await info.attach('SQLite查询复制粘贴类型对照', { body: await page.screenshot(), contentType: 'image/png' });
  await input.getByRole('button', { name: sqlitePaste.stage, exact: true }).click();
  const preview = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  await expect(preview.getByLabel('SQLite 修改 SQL 预览', { exact: true })).toBeVisible();
  await preview.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
  await preview.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
  await expect(preview).toHaveCount(0);
  const db = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
  try {
    expect(db.prepare('SELECT id,CAST(qty AS TEXT) AS qty,name,hex(payload) AS payload,typeof(payload) AS kind FROM subject WHERE id BETWEEN 178 AND 179 ORDER BY id').all()).toEqual([
      { id: 178, qty: '9223372036854775807', name: '0007', payload: '00FF', kind: 'blob' },
      { id: 179, qty: '-9223372036854775808', name: null, payload: '', kind: 'blob' },
    ]);
  } finally { db.close(); }
  expect(pageErrors).toEqual([]);
});

test('批量导出已返回结果写入 ZIP 和 XLSX 且不会重跑 SQL', async ({}, info) => {
  await seed(`/* NAME: 精确原值 */ SELECT 9223372036854775807 AS v, X'00ff' AS v;
    /* NAME: 不导出 */ SELECT '跳过';
    /* NAME: 空结果 */ SELECT name FROM subject WHERE id = 0;`);
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('button', { name: '结果 3 · 空结果', exact: true })).toBeVisible();
  const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute'));
  await expect.poll(async () => (await executions()).map(task => task.status)).toEqual(['completed']);
  const before = await executions();
  await (await navigationMenuItem(query, { name: archiveText.open, exact: true })).click();
  const modal = page.getByRole('dialog', { name: archiveText.title, exact: true });
  await modal.getByRole('checkbox', { name: /结果 2 · 不导出/ }).uncheck();
  await info.attach('SQLite批量导出已返回结果', { body: await page.screenshot(), contentType: 'image/png' });
  const output = join(dataDir, '多结果.zip');
  async function chooseDestination(path: string, format: 'zip' | 'xlsx') {
    await desktop.evaluate(({ dialog, BrowserWindow }, { path, format }) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes(format))
          throw Error('仅允许本例对应格式的保存选择');
        return { canceled: false, filePath: path };
      }) as typeof original;
    }, { path, format });
  }
  await chooseDestination(output, 'zip');
  await modal.getByRole('button', { name: archiveText.start, exact: true }).click();
  await expect(modal.getByRole('status')).toHaveText(archiveText.done(2, 1));
  const files = decodeQueryCsvZip(readFileSync(output));
  expect([...files.keys()]).toEqual(['results/rows-001.csv', 'results/rows-002.csv', 'manifest.json']);
  expect(files.get('results/rows-001.csv')!.toString()).toBe('v,v [2]\r\n9223372036854775807,base64:AP8=\r\n');
  expect(files.get('results/rows-002.csv')!.toString()).toBe('name\r\n');
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  expect(manifest).toMatchObject({ scope: 'returned', results: [
    { sourceOrdinal: 1, label: '精确原值', rowsWritten: 1, truncated: false },
    { sourceOrdinal: 3, label: '空结果', rowsWritten: 0, truncated: false },
  ] });
  await modal.getByLabel(archiveText.format, { exact: true }).selectOption('xlsx');
  await expect(modal.getByLabel(archiveText.encoding, { exact: true })).toHaveCount(0);
  await expect(modal.getByRole('checkbox', { name: /结果 2 · 不导出/ })).not.toBeChecked();
  await info.attach('SQLite批量导出结果工作簿', { body: await page.screenshot(), contentType: 'image/png' });
  const xlsx = join(dataDir, '多结果.xlsx');
  await chooseDestination(xlsx, 'xlsx');
  await modal.getByRole('button', { name: archiveText.startExcel, exact: true }).click();
  await expect(modal.getByRole('status')).toHaveText(archiveText.done(2, 1));
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(xlsx);
  expect(book.worksheets.map(sheet => sheet.name)).toEqual(['结果清单', '精确原值', '空结果']);
  expect(book.worksheets[0].getCell('A3').text).toBe('3');
  expect(book.worksheets[1].getCell('A2').text).toBe('9223372036854775807');
  expect(book.worksheets[1].getCell('A2').type).toBe(ExcelJS.ValueType.RichText);
  expect(book.worksheets[1].getCell('B2').text).toBe('\\B:AP8=');
  expect(book.worksheets[2].rowCount).toBe(1);
  expect(book.worksheets[2].getCell('A1').text).toBe('name');
  expect(await executions()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

/** 使用应用允许的最小原生尺寸复现工具条折行。 */
async function compactSqliteWindow(): Promise<void> {
  const bounds = await desktop.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1) throw Error('SQLite 测试需要唯一原生窗口');
    windows[0].setBounds({ width: 1024, height: 680 });
    return windows[0].getBounds();
  });
  expect(bounds).toMatchObject({ width: 1024, height: 680 });
}

test('SQLite 表和视图从单列选区包含或排除原值，按明确应用读取服务器页', async ({}, info) => {
  await seed(undefined, "UPDATE subject SET name = NULL WHERE id=1; UPDATE subject SET name='' WHERE id IN (2,4,120);" +
    "UPDATE subject SET name='NULL' WHERE id=3;");
  await compactSqliteWindow();
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'sqlite.tablePage').map(task => task.id));
  for (const [tab, title, typed] of [['t-jump', '表格定位', true], ['v-jump', '视图定位', false]] as const) {
    await page.locator('[data-workspace-tab-id="' + tab + '"]').getByRole('button', { name: title, exact: true }).click();
    const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
    const id = (value: number) => grid.getByRole('gridcell', { name: (typed ? 'INTEGER · ' : '') + value, exact: true });
    const note = (value: number) => id(value).locator('..').getByRole('gridcell').last();
    await expect(id(1)).toBeVisible();
    if (!typed) {
      await (await navigationMenuItem(table.locator('.toolbar'), { name: layoutText.entry, exact: true })).click();
      const layout = page.getByRole('dialog', { name: layoutText.title, exact: true });
      await layout.getByRole('combobox', { name: heightText.label, exact: true }).selectOption('56');
      await layout.getByRole('button', { name: tableGridZh.save, exact: true }).click();
      await layout.locator('footer').getByRole('button', { name: zh.common.close, exact: true }).click();
      await expect(layout).toHaveCount(0);
      await expect(grid).toHaveClass(/grid-row-height-56/);
    }
    await id(3).locator('..').getByRole('checkbox').check();
    const before = await tasks();
    await note(1).click();
    await page.keyboard.press('Shift+ArrowDown');
    await note(1).click({ button: 'right' });
    await page.getByRole('menuitem', {
      name: typed ? tableSelectedFilterText.rangeEntry : tableSelectedFilterText.rangeExclude, exact: true,
    }).click();
    const apply = table.getByRole('button', { name: browseText.apply, exact: true });
    await expect(apply).toBeEnabled();
    await expect(id(3)).toBeVisible();
    expect(await tasks()).toEqual(before);
    if (typed) await info.attach('SQLite表页选区值筛选草稿', { body: await page.screenshot(), contentType: 'image/png' });
    await apply.click();
    if (typed) {
      await expect(id(120)).toBeVisible();
      await expect(id(3)).toHaveCount(0);
      for (const included of [1, 2, 4]) await expect(id(included)).toBeVisible();
    } else {
      await expect(id(3)).toBeVisible();
      await expect(id(5)).toBeVisible();
      for (const excluded of [1, 2, 4]) await expect(id(excluded)).toHaveCount(0);
      await expect.poll(() => grid.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(164);
      await note(5).scrollIntoViewIfNeeded();
      await expect.poll(() => grid.locator('.rdg-row').evaluateAll(rows => rows.slice(0, 2).map(row => {
        const cell = Array.from(row.querySelectorAll('[role="gridcell"]')).at(-1)!;
        const { left, top, width, height } = cell.getBoundingClientRect();
        return cell.contains(document.elementFromPoint(left + width / 2, top + height / 2));
      }))).toEqual([true, true]);
      await note(3).click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: tableCellFilterZh.endsWith, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await info.attach('SQLite最小窗口只读视图大行高', { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(await tasks()).toHaveLength(before.length + 1);
  }
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页文本快捷筛选命中其它页并保留字面语义', async ({}, info) => {
  await seed(undefined, "UPDATE subject SET name='A%_' WHERE id=1; UPDATE subject SET name='前A%_' WHERE id=120; UPDATE subject SET name='a%_' WHERE id=2; UPDATE subject SET name='A%_后' WHERE id=3;");
  await compactSqliteWindow();
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'sqlite.tablePage').map(task => task.id));
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + value, exact: true });
  const note = id(1).locator('..').getByRole('gridcell').last();
  await expect(id(1)).toBeVisible();
  const before = await tasks();
  await note.click({ button: 'right' });
  await page.getByRole('menuitem', { name: tableCellFilterZh.contains, exact: true }).click();
  await expect(table.getByLabel(browseText.filterOperator(1), { exact: true })).toHaveValue('contains');
  await expect(table.getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('A%_');
  expect(await tasks()).toEqual(before);
  await info.attach('SQLite表页文本快捷筛选草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await table.getByRole('button', { name: browseText.apply, exact: true }).click();
  await expect(id(120)).toBeVisible();
  await expect(id(1)).toBeVisible();
  await expect(id(2)).toHaveCount(0);
  expect(await tasks()).toHaveLength(before.length + 1);
  await expect(id(3)).toBeVisible();
  // 已有筛选保持展开，按钮换行时数据格仍须有真实的点击区域。
  await expect(table.getByLabel(browseText.filterOperator(1), { exact: true })).toHaveValue('contains');
  await expect.poll(() => grid.evaluate(element => element.clientHeight), { timeout: 3000 }).toBeGreaterThanOrEqual(112);
  await note.scrollIntoViewIfNeeded();
  await info.attach('SQLite最小窗口展开筛选后原格可点击', { body: await page.screenshot(), contentType: 'image/png' });
  await note.click({ button: 'right' });
  await page.getByRole('menuitem', { name: tableCellFilterZh.endsWith, exact: true }).click();
  const suffixOperator = table.getByLabel(browseText.filterOperator(2), { exact: true });
  await expect(suffixOperator).toHaveValue('endsWith');
  await expect(table.getByLabel(browseText.filterValue(2), { exact: true })).toHaveValue('A%_');
  expect(await tasks()).toHaveLength(before.length + 1);
  await suffixOperator.scrollIntoViewIfNeeded();
  await info.attach('SQLite表页字面后缀筛选', { body: await page.screenshot(), contentType: 'image/png' });
  await table.getByRole('button', { name: browseText.apply, exact: true }).click();
  await expect(id(120)).toBeVisible();
  await expect(id(3)).toHaveCount(0);
  expect(await tasks()).toHaveLength(before.length + 2);
  expect(pageErrors).toEqual([]);
});

test('SQLite 从只读视图单列查找带入全表筛选，命中原先未加载的行', async ({}, info) => {
  await seed(undefined, "UPDATE subject SET name='z%_🚢' WHERE id=1; UPDATE subject SET name='前Z%_🚢' WHERE id=118; UPDATE subject SET name='Z%_🚢 ' WHERE id=119; UPDATE subject SET name='Z%_🚢' WHERE id=120;");
  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: String(value), exact: true });
  const reads = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'sqlite.tablePage').map(task => task.id));
  await expect(id(1)).toBeVisible();
  const before = await reads();
  await (await navigationMenuItem(table, { name: sqliteFind.entry, exact: true })).click();
  const find = table.getByRole('region', { name: sqliteFind.title, exact: true });
  const stage = find.getByRole('button', { name: tableFindFilterZh.action, exact: true });
  await find.getByLabel(sqliteFind.query, { exact: true }).fill('Z%_🚢');
  await expect(stage).toBeDisabled();
  await find.getByLabel(sqliteFind.column, { exact: true }).selectOption('1');
  await find.getByRole('checkbox', { name: sqliteFind.sensitive, exact: true }).check();
  await find.getByRole('checkbox', { name: sqliteFind.whole, exact: true }).check();
  await find.getByRole('combobox', { name: tableFindFilterZh.edge, exact: true }).selectOption('end');
  await expect(find.getByRole('checkbox', { name: sqliteFind.whole, exact: true })).not.toBeChecked();
  await stage.click();
  const operator = table.getByLabel(browseText.filterOperator(1), { exact: true });
  await expect(operator).toHaveValue('endsWith');
  await expect(table.getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('Z%_🚢');
  expect(await reads()).toEqual(before);
  await operator.scrollIntoViewIfNeeded();
  await info.attach('SQLite结尾查找转全表筛选', { body: await page.screenshot(), contentType: 'image/png' });
  await table.getByRole('button', { name: browseText.apply, exact: true }).click();
  await expect(id(120)).toBeVisible();
  await expect(id(118)).toBeVisible();
  await expect(id(1)).toHaveCount(0);
  await expect(id(119)).toHaveCount(0);
  expect(await reads()).toHaveLength(before.length + 1);
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页快捷数值边界匹配跨页原生整数', async ({}, info) => {
  await seed(undefined, `ALTER TABLE subject ADD COLUMN metric;
    UPDATE subject SET metric=CASE id WHEN 1 THEN 9007199254740992 WHEN 2 THEN 9007199254740993
      WHEN 3 THEN '9007199254740993' WHEN 4 THEN 9007199254740994.0 WHEN 120 THEN 9007199254740994 END;`);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + value, exact: true });
  const metric = (value: number) => id(value).locator('..').getByRole('gridcell').last();
  await expect(id(1)).toBeVisible();
  await metric(3).click({ button: 'right' });
  const action = page.getByRole('menuitem', { name: filterText.cellBounds.gte, exact: true });
  await expect(page.getByRole('menuitem', { name: tableCellFilterZh.contains, exact: true })).toBeVisible();
  await expect(action).toHaveCount(0);
  await page.keyboard.press('Escape');
  await metric(2).click({ button: 'right' });
  await action.click();
  await expect(table.getByLabel(browseText.filterOperator(1), { exact: true })).toHaveValue('gte');
  await expect(table.getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('9007199254740993');
  await expect(id(1)).toBeVisible();
  await table.getByLabel(browseText.filterValue(1), { exact: true }).scrollIntoViewIfNeeded();
  await info.attach('SQLite表页快捷数值边界', { body: await page.screenshot(), contentType: 'image/png' });
  await table.getByRole('button', { name: browseText.apply, exact: true }).click();
  await expect(id(120)).toBeVisible();
  await expect(id(2)).toBeVisible();
  for (const absent of [1, 3, 4]) await expect(id(absent)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('SQLite 只读表和视图可查找原值并勾选本页匹配行', async ({}, info) => {
  await seed(undefined, `ALTER TABLE subject ADD COLUMN raw;
    UPDATE subject SET name='命中标记' WHERE id IN (1,90,120);
    UPDATE subject SET name='NULL',raw=X'00FF' WHERE id=2;
    UPDATE subject SET name=NULL WHERE id=3;
    UPDATE subject SET name='' WHERE id=4;
    UPDATE subject SET name=' ',raw=X'' WHERE id=5;
    DROP VIEW subject_view;
    CREATE VIEW subject_view AS SELECT id,name,raw FROM subject ORDER BY id;`, undefined, true);
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
    .filter(task => task.kind === 'sqlite.tablePage').map(task => task.id));
  for (const [tab, title] of [['t-jump', '表格定位'], ['v-jump', '视图定位']] as const) {
    await page.locator('[data-workspace-tab-id="' + tab + '"]').getByRole('button', { name: title, exact: true }).click();
    const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
    const id = (value: number) => grid.getByRole('gridcell', { name: String(value), exact: true });
    const row = (value: number) => id(value).locator('..');
    const check = (value: number) => row(value).getByRole('checkbox');
    await expect(table).toHaveAttribute('data-readonly', 'true');
    await check(2).check();
    const before = await tasks();
    if (tab === 't-jump') await (await navigationMenuItem(table, { name: sqliteFind.entry, exact: true })).click();
    else { await id(1).click(); await page.keyboard.press('Control+f'); }
    const panel = table.getByRole('region', { name: sqliteFind.title, exact: true });
    const input = panel.getByRole('textbox', { name: sqliteFind.query, exact: true });
    const status = panel.getByRole('status'), next = panel.getByRole('button', { name: sqliteFind.next, exact: true });
    const field = panel.getByRole('combobox', { name: sqliteFind.column, exact: true });
    await expect(input).toBeFocused();
    await expect(panel.getByRole('button', { name: sqliteFind.replaceMode, exact: true })).toHaveCount(0);
    await field.selectOption({ label: 'raw' });
    await input.fill('00ff');
    await expect(status).toHaveText(sqliteFind.count(1, 1, -1));
    await field.selectOption({ label: 'name' });
    await panel.getByRole('combobox', { name: sqliteFind.kind, exact: true }).selectOption('null');
    await expect(status).toHaveText(sqliteFind.count(1, 1, -1));
    await next.click();
    const nameColumn = await grid.getByRole('columnheader', { name: 'name', exact: true }).getAttribute('aria-colindex');
    await expect(row(3).locator('[role="gridcell"][aria-colindex="' + nameColumn + '"]')).toBeFocused();
    await field.selectOption('');
    await panel.getByRole('combobox', { name: sqliteFind.kind, exact: true }).selectOption('empty');
    await expect(status).toHaveText(sqliteFind.count(1, 1, -1));
    await expect(input).toBeDisabled();
    await panel.getByRole('button', { name: resultFind.checkRows, exact: true }).click();
    await expect(check(4)).toBeChecked();
    for (const value of [3, 5]) await expect(check(value)).not.toBeChecked();
    if (tab === 'v-jump') await info.attach('SQLite空字符串查找', { body: await page.screenshot(), contentType: 'image/png' });
    await panel.getByRole('button', { name: resultFind.uncheckRows, exact: true }).click();
    await expect(check(4)).not.toBeChecked();
    await panel.getByRole('combobox', { name: sqliteFind.kind, exact: true }).selectOption('text');
    await input.fill('命中标记');
    await expect(status).toHaveText(sqliteFind.count(2, 2, -1));
    await panel.getByRole('checkbox', { name: resultFind.highlightAll, exact: true }).check();
    const mark = (value: number) => row(value).getByRole('gridcell', { name: '命中标记', exact: true });
    await expect(mark(1)).toHaveClass(/pg-find-match/);
    await panel.getByRole('button', { name: resultFind.checkRows, exact: true }).click();
    await expect(check(1)).toBeChecked();
    await expect(check(2)).toBeChecked();
    await input.press('F3');
    await expect(input).toBeFocused();
    await expect(mark(1)).toHaveClass(/query-result-find-hit/);
    if (tab === 'v-jump') await info.attach('SQLite只读视图查找', { body: await page.screenshot(), contentType: 'image/png' });
    await next.click();
    await expect(mark(90)).toBeFocused();
    await expect(check(90)).toBeChecked();
    await panel.getByRole('button', { name: resultFind.uncheckRows, exact: true }).click();
    await expect(check(90)).not.toBeChecked();
    await mark(90).focus();
    await page.keyboard.press('Shift+F3');
    await expect(mark(1)).toBeFocused();
    await expect(check(1)).not.toBeChecked();
    await expect(check(2)).toBeChecked();
    await panel.getByRole('checkbox', { name: replaceText.checkedOnly, exact: true }).check();
    await expect(status).toHaveText(sqliteFind.count(0, 0, -1));
    await check(1).check();
    await expect(status).toHaveText(sqliteFind.count(1, 1, -1));
    await check(1).uncheck();
    await check(2).uncheck();
    await expect(status).toHaveText(replaceText.checkedEmpty);
    await expect(next).toBeDisabled();
    expect(await tasks()).toEqual(before);
    await table.getByRole('button', { name: browseText.next, exact: true }).click();
    await expect(id(101)).toBeVisible();
    await expect(panel).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页查找批量勾选命中且保留其它行', async ({}, info) => {
  await seed(undefined, "UPDATE subject SET name='批量标记批量标记' WHERE id IN (1,3,120); UPDATE subject SET name='' WHERE id=4;");
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + value, exact: true });
  const check = (value: number) => id(value).locator('..').getByRole('checkbox');
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
    .filter(task => task.kind === 'sqlite.tablePage').map(task => task.id));
  await check(2).check();
  const before = await tasks();
  await (await navigationMenuItem(table, { name: sqliteFind.entry, exact: true })).click();
  const panel = table.getByRole('region', { name: sqliteFind.title, exact: true });
  const input = panel.getByRole('textbox', { name: sqliteFind.query, exact: true });
  const select = panel.getByRole('button', { name: resultFind.checkRows, exact: true });
  const deselect = panel.getByRole('button', { name: resultFind.uncheckRows, exact: true });
  await expect(select).toBeDisabled();
  await input.fill('批量标记');
  await expect(panel.getByRole('status')).toHaveText(sqliteFind.count(2, 4, -1));
  await select.click();
  for (const row of [1, 2, 3]) await expect(check(row)).toBeChecked();
  await expect(check(4)).not.toBeChecked();
  await expect(id(120)).toHaveCount(0);
  await info.attach('SQLite查找勾选匹配行', { body: await page.screenshot(), contentType: 'image/png' });
  await deselect.click();
  for (const row of [1, 3]) await expect(check(row)).not.toBeChecked();
  await expect(check(2)).toBeChecked();
  await panel.getByRole('checkbox', { name: sqliteFind.regex, exact: true }).check();
  await panel.getByRole('combobox', { name: sqliteFind.kind, exact: true }).selectOption('empty');
  await expect(panel.getByRole('status')).toHaveText(sqliteFind.count(1, 1, -1));
  await select.click();
  await expect(check(4)).toBeChecked();
  await expect(check(2)).toBeChecked();
  await panel.getByRole('button', { name: sqliteFind.replaceMode, exact: true }).click();
  await panel.getByRole('textbox', { name: sqliteFind.replacement, exact: true }).fill('空值补齐');
  await panel.getByRole('button', { name: sqliteFind.replaceAll, exact: true }).click();
  const review = page.getByRole('dialog', { name: sqliteFind.previewTitle, exact: true });
  await expect(review).toContainText(sqliteFind.previewCount(1, 1));
  await expect(review).toContainText('空值补齐');
  const filled = grid.getByRole('gridcell', { name: 'TEXT · 空值补齐', exact: true });
  await expect(filled).toHaveCount(0);
  await info.attach('SQLite空字符串替换预览', { body: await page.screenshot(), contentType: 'image/png' });
  await review.getByRole('button', { name: sqliteFind.cancelPreview, exact: true }).click();
  await expect(filled).toHaveCount(0);
  await panel.getByRole('button', { name: sqliteFind.replaceAll, exact: true }).click();
  await review.getByRole('button', { name: sqliteFind.stage, exact: true }).click();
  await expect(filled).toBeVisible();
  const observer = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
  try { expect(observer.prepare('SELECT name FROM subject WHERE id=4').get()?.name).toBe(''); }
  finally { observer.close(); }
  await table.getByRole('button', { name: sqliteEditText.undo, exact: true }).click();
  await expect(filled).toHaveCount(0);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页仅替换勾选行并通过原草稿入口提交', async ({}, info) => {
  await seed(undefined, "UPDATE subject SET name='原标记' WHERE id IN (1,3,120);");
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const row = (id: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + id, exact: true }).locator('..');
  const check = row(3).getByRole('checkbox');
  await expect(check).toBeVisible();
  await (await navigationMenuItem(table, { name: sqliteFind.entry, exact: true })).click();
  const panel = table.getByRole('region', { name: sqliteFind.title, exact: true });
  await panel.getByRole('button', { name: sqliteFind.replaceMode, exact: true }).click();
  const status = panel.getByRole('status');
  const all = panel.getByRole('button', { name: sqliteFind.replaceAll, exact: true });
  const review = page.getByRole('dialog', { name: sqliteFind.previewTitle, exact: true });
  await panel.getByRole('combobox', { name: sqliteFind.column, exact: true }).selectOption({ label: 'name' });
  await panel.getByRole('textbox', { name: sqliteFind.query, exact: true }).fill('原标记');
  await expect(status).toHaveText(sqliteFind.count(2, 2, -1));
  await panel.getByRole('checkbox', { name: replaceText.checkedOnly, exact: true }).check();
  await expect(status).toHaveText(replaceText.checkedEmpty);
  await expect(all).toBeDisabled();
  await check.check();
  await expect(status).toHaveText(sqliteFind.count(1, 1, -1));
  await panel.getByRole('textbox', { name: sqliteFind.replacement, exact: true }).fill('勾选替换');
  await all.click();
  await expect(review.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  await expect(review).toContainText(sqliteFind.previewCount(1, 1));
  await info.attach('SQLite表页勾选行替换预览', { body: await page.screenshot(), contentType: 'image/png' });
  await review.getByRole('button', { name: sqliteFind.cancelPreview, exact: true }).click();
  await check.uncheck();
  await expect(status).toHaveText(replaceText.checkedEmpty);
  await expect(all).toBeDisabled();
  await check.check();
  await all.click();
  await review.getByRole('button', { name: sqliteFind.stage, exact: true }).click();
  await expect(row(3).getByRole('gridcell', { name: 'TEXT · 勾选替换', exact: true })).toBeVisible();
  await expect(row(1).getByRole('gridcell', { name: 'TEXT · 原标记', exact: true })).toBeVisible();
  const observer = new DatabaseSync(join(dataDir, 'grid-row-jump.sqlite'), { readOnly: true });
  try {
    const names = () => observer.prepare('SELECT name FROM subject WHERE id IN (1,3,120) ORDER BY id').all().map(row => row.name);
    expect(names()).toEqual(['原标记', '原标记', '原标记']);
    await panel.getByRole('button', { name: sqliteFind.close, exact: true }).click();
    await (await navigationMenuItem(table, { name: sqliteEditText.preview, exact: true })).click();
    const commit = page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
    await expect(commit.getByRole('button', { name: '提交 SQLite 修改', exact: true })).toBeDisabled();
    await commit.getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check();
    await commit.getByRole('button', { name: '提交 SQLite 修改', exact: true }).click();
    await expect(commit).toHaveCount(0);
    expect(names()).toEqual(['原标记', '勾选替换', '原标记']);
  } finally { observer.close(); }
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页勾选非相邻记录生成同类型区间草稿', async ({}, info) => {
  await seed(undefined, `ALTER TABLE subject ADD COLUMN metric;
    UPDATE subject SET metric=CASE id WHEN 1 THEN 9007199254740994 WHEN 2 THEN '9007199254740993'
      WHEN 3 THEN 9007199254740992 WHEN 4 THEN 9007199254740991 WHEN 120 THEN 9007199254740993 END;`);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + value, exact: true });
  const check = (value: number) => id(value).locator('..').getByRole('checkbox');
  const metric = (value: number) => id(value).locator('..').getByRole('gridcell').last();
  const action = { name: tableSelectedFilterText.checkedBetween, exact: true };
  await check(1).check();
  await check(2).check();
  await metric(4).click();
  await (await navigationMenuItem(table, action)).click();
  await expect(table.getByRole('alert')).toContainText(tableSelectedFilterText.checkedBoundsUnavailable);
  await check(2).uncheck();
  await check(3).check();
  await metric(4).click();
  await (await navigationMenuItem(table, action)).click();
  await expect(table.getByLabel(browseText.filterOperator(1), { exact: true })).toHaveValue('between');
  await expect(table.getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('9007199254740992');
  const upper = table.getByLabel(browseText.filterSecondValue(1), { exact: true });
  await expect(upper).toHaveValue('9007199254740994');
  await expect(id(4)).toBeVisible();
  await upper.scrollIntoViewIfNeeded();
  await info.attach('SQLite表页勾选区间草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await table.getByRole('button', { name: browseText.apply, exact: true }).click();
  for (const included of [1, 3, 120]) await expect(id(included)).toBeVisible();
  for (const absent of [2, 4, 5]) await expect(id(absent)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('SQLite 表页双端区间匹配跨页原值并忽略其它存储类型', async ({}, info) => {
  await seed(undefined, `ALTER TABLE subject ADD COLUMN metric;
    UPDATE subject SET metric=CASE id WHEN 1 THEN 9007199254740994 WHEN 2 THEN 9007199254740992
      WHEN 3 THEN '9007199254740993' WHEN 4 THEN 9007199254740993.0 WHEN 5 THEN 9007199254740991
      WHEN 120 THEN 9007199254740993 END;`);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
  const id = (value: number) => grid.getByRole('gridcell', { name: 'INTEGER · ' + value, exact: true });
  const metric = (value: number) => id(value).locator('..').getByRole('gridcell').last();
  const choose = async (row: number) => {
    await metric(row).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+F10');
  };
  const item = (name: string) => page.getByRole('menuitem', { name, exact: true });
  await choose(2);
  await expect(item(tableSelectedFilterText.rangeEntry)).toBeVisible();
  await expect(item(tableSelectedFilterText.rangeBetween)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await choose(1);
  await item(tableSelectedFilterText.rangeNotBetween).click();
  const operator = table.getByLabel(browseText.filterOperator(1), { exact: true });
  await expect(operator).toHaveValue('notBetween');
  await expect(table.getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('9007199254740992');
  await expect(table.getByLabel(browseText.filterSecondValue(1), { exact: true })).toHaveValue('9007199254740994');
  await expect(id(1)).toBeVisible();
  await table.getByLabel(browseText.filterSecondValue(1), { exact: true }).scrollIntoViewIfNeeded();
  await info.attach('SQLite表页双端区间草稿', { body: await page.screenshot(), contentType: 'image/png' });
  const apply = table.getByRole('button', { name: browseText.apply, exact: true });
  await apply.click();
  await expect(id(5)).toBeVisible();
  for (const absent of [1, 2, 3, 4, 6, 120]) await expect(id(absent)).toHaveCount(0);
  await operator.selectOption('between');
  await apply.click();
  for (const included of [1, 2, 120]) await expect(id(included)).toBeVisible();
  for (const absent of [3, 4, 5, 6]) await expect(id(absent)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('SQLite 单列选区原值筛选区分 NULL 和空串，独立于勾选并保留排序', async ({}, info) => {
  await seed(`SELECT id, '相邻列' AS v, CASE id WHEN 1 THEN NULL WHEN 2 THEN '' WHEN 3 THEN 'NULL'
    WHEN 4 THEN 2 ELSE '' END AS v FROM subject WHERE id <= 5 ORDER BY id;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByText(filterText.counts(5, 5), { exact: true })).toBeVisible();
  const id = grid.getByRole('columnheader', { name: /^id\b/ });
  await id.click();
  await id.click();
  await expect(id.getByLabel(resultSort.descending)).toBeVisible();
  const idColumn = await id.getAttribute('aria-colindex');
  const ids = grid.locator('[role="gridcell"][aria-colindex="' + idColumn + '"]');
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  const rows = (name: string) => ids.filter({ hasText: new RegExp('^' + name + '$') }).locator('..');
  await rows('3').getByRole('checkbox').check();
  const valueColumn = await grid.getByRole('columnheader', { name: /^v\b/ }).nth(1).getAttribute('aria-colindex');
  const start = rows('2').locator('[role="gridcell"][aria-colindex="' + valueColumn + '"]');
  const action = page.getByRole('menuitem', { name: selectedFilterText.range, exact: true });
  const exclude = page.getByRole('menuitem', { name: selectedFilterText.rangeExclude, exact: true });
  await start.click();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(action).toHaveCount(0);
  await expect(exclude).toHaveCount(0);
  await page.keyboard.press('Escape');
  await start.click();
  await page.keyboard.press('Shift+ArrowDown');
  await start.click({ button: 'right' });
  await expect(action).toBeVisible();
  const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute').map(task => task.id));
  const before = await executions();
  await action.click();
  const filtering = query.getByRole('region', { name: filterText.title, exact: true });
  await expect(filtering.getByLabel(filterText.column + ' 1', { exact: true })).toHaveValue('c2');
  await expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text');
  await expect(filtering.getByLabel(filterText.operator + ' 2', { exact: true })).toHaveValue('null');
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await info.attach('SQLite查询选区值筛选草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['5', '2', '1']);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await start.click();
  await page.keyboard.press('Shift+ArrowDown');
  await start.click({ button: 'right' });
  await exclude.click();
  await expect(filtering.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('notIn');
  await expect(filtering.getByLabel(filterText.operator + ' 2', { exact: true })).toHaveValue('notType');
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await info.attach('SQLite查询排除选区值草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['4', '3']);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  const mixed = rows('5').locator('[role="gridcell"][aria-colindex="' + valueColumn + '"]');
  await mixed.click();
  await page.keyboard.press('Shift+ArrowDown');
  await mixed.click({ button: 'right' });
  await exclude.click();
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['3', '1']);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await rows('3').getByRole('checkbox').check();
  await start.click();
  await (await navigationMenuItem(query, { name: selectedFilterText.exclude, exact: true })).click();
  await expect(filtering.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('notIn');
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['5', '4', '2', '1']);
  expect(await executions()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查询结果数据质量和多个分布值可进入同一结果的筛选草稿', async ({}, info) => {
  await seed(`SELECT id, CASE id WHEN 1 THEN NULL WHEN 2 THEN '' WHEN 3 THEN '2'
    WHEN 4 THEN 2 WHEN 5 THEN 2.0 ELSE X'' END AS quality_value
    FROM subject WHERE id <= 6 ORDER BY id;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByText(filterText.counts(6, 6), { exact: true })).toBeVisible();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  const dialog = page.getByRole('dialog', { name: statisticsText.title, exact: true });
  const filtering = query.getByRole('region', { name: filterText.title, exact: true });
  const openStatistics = () => query.getByRole('button', { name: statisticsText.open, exact: true }).click();
  const idPosition = await grid.getByRole('columnheader', { name: /^id\b/ }).getAttribute('aria-colindex');
  expect(idPosition).not.toBeNull();
  const ids = () => grid.locator(`[role="gridcell"][aria-colindex="${idPosition}"]`);
  await openStatistics();
  await dialog.getByRole('button', { name: statisticsText.overview, exact: true }).click();
  const empty = statisticsText.qualityFilterColumn(statisticsText.qualityFilter.empty, 'quality_value · c1');
  await dialog.getByRole('button', { name: empty, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(filtering.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('empty');
  await expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text');
  await expect(query.getByText(filterText.counts(6, 6), { exact: true })).toBeVisible();
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids()).toHaveText(['2']);
  await (await navigationMenuItem(query, { name: filterText.clear, exact: true })).click();
  await expect(query.getByText(filterText.counts(6, 6), { exact: true })).toBeVisible();

  await openStatistics();
  await dialog.getByLabel(statisticsText.column, { exact: true }).selectOption('c1');
  await dialog.getByRole('button', { name: statisticsText.frequency, exact: true }).click();
  const addChecked = dialog.getByRole('button', { name: statisticsText.frequencyFilterChecked, exact: true });
  await expect(addChecked).toBeDisabled();
  await dialog.getByRole('checkbox', { name: statisticsText.frequencyCheck('2', statisticsText.frequencyKinds.number), exact: true }).check();
  await dialog.getByRole('checkbox', { name: statisticsText.frequencyCheck('NULL'), exact: true }).check();
  await info.attach('SQLite查询结果勾选分布值', { body: await page.screenshot(), contentType: 'image/png' });
  await addChecked.click();
  await expect(dialog).toHaveCount(0);
  await expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('integer');
  await expect(filtering.getByLabel(filterText.sqliteType(2), { exact: true })).toHaveValue('real');
  await expect(filtering.getByLabel(filterText.operator + ' 3', { exact: true })).toHaveValue('null');
  await expect(query.getByText(filterText.counts(6, 6), { exact: true })).toBeVisible();
  await filtering.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids()).toHaveText(['1', '4', '5']);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查询结果列数据质量保留 SQLite 原类型并区分当前勾选范围', async ({}, info) => {
  await seed(`SELECT id, CASE id
    WHEN 1 THEN '' WHEN 2 THEN '' WHEN 3 THEN X'' WHEN 4 THEN NULL
    WHEN 5 THEN 2 WHEN 6 THEN 2.0 ELSE '2' END AS quality_value
    FROM subject WHERE id <= 7 ORDER BY id;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(grid.getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
  const idColumn = await grid.getByRole('columnheader', { name: /^id\b/ }).getAttribute('aria-colindex');
  expect(idColumn).not.toBeNull();
  const idCell = (id: number) => page.getByRole('gridcell', { name: String(id), exact: true })
    .and(page.locator(`[aria-colindex="${idColumn}"]`));
  for (const id of [1, 3, 4]) {
    const row = grid.getByRole('row').filter({ has: idCell(id) });
    await row.getByRole('checkbox').check();
  }
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: statisticsText.open, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: statisticsText.title, exact: true });
  const quality = dialog.getByRole('region', { name: statisticsText.quality, exact: true });
  const metric = (label: string) => quality.getByLabel(label, { exact: true });
  const scope = dialog.getByRole('combobox', { name: statisticsText.scope, exact: true });
  await expect(scope).toHaveValue('selected');
  await dialog.getByRole('combobox', { name: statisticsText.column, exact: true }).selectOption('c1');
  await expect(metric(statisticsText.nullShare)).toHaveText('33.33%');
  await expect(metric(statisticsText.emptyText)).toHaveText('1');
  await expect(metric(statisticsText.singletonRows)).toHaveText('2');
  await expect(metric(statisticsText.repeatedRows)).toHaveText('0');
  await scope.selectOption('all');
  await expect(metric(statisticsText.nullShare)).toHaveText('14.29%');
  await expect(metric(statisticsText.emptyTextShare)).toHaveText('28.57%');
  await expect(metric(statisticsText.singletonRows)).toHaveText('2');
  await expect(metric(statisticsText.repeatedRows)).toHaveText('4');
  await info.attach('SQLite列统计数据质量', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询文本快捷筛选按字面匹配且不扫描其它存储类型', async ({}, info) => {
  await seed(`SELECT id, CASE id WHEN 1 THEN '%_' || char(10) WHEN 2 THEN 'A%_' || char(10) || 'B'
    WHEN 3 THEN '%_' || char(10) || 'B' WHEN 4 THEN 'A%_' || char(10)
    WHEN 5 THEN NULL WHEN 6 THEN 42 ELSE '%_' END AS v FROM subject WHERE id <= 7 ORDER BY id;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  await query.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
  await page.getByRole('menuitem', { name: queryLayoutZh.results, exact: true }).click();
  const ids = grid.locator('[role="gridcell"][aria-colindex="2"]');
  const original = ['1', '2', '3', '4', '5', '6', '7'];
  await expect(ids).toHaveText(original);
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute').map(task => task.id));
  const before = await tasks();
  const menu = page.getByRole('menu');
  const action = (operator: keyof typeof filterText.cellText) => menu.getByRole('menuitem', { name: filterText.cellText[operator], exact: true });
  await grid.getByRole('gridcell', { name: '42', exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: filterText.cellEquals, exact: true })).toBeVisible();
  for (const operator of Object.keys(filterText.cellText) as (keyof typeof filterText.cellText)[]) await expect(action(operator)).toHaveCount(0);
  await page.keyboard.press('Escape');
  const textCell = ids.filter({ hasText: /^1$/ }).locator('..').getByRole('gridcell').last();
  const panel = query.getByRole('region', { name: filterText.title, exact: true });
  for (const [operator, expected] of [
    ['contains', ['1', '2', '3', '4']], ['notContains', ['7']],
    ['startsWith', ['1', '3']], ['notStartsWith', ['2', '4', '7']],
    ['endsWith', ['1', '4']], ['notEndsWith', ['2', '3', '7']],
  ] as const) {
    if (operator === 'startsWith') {
      await textCell.click();
      await page.keyboard.press('Shift+F10');
    } else await textCell.click({ button: 'right' });
    await action(operator).click();
    await expect(panel.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue(operator);
    await expect(panel.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text');
    await expect(panel.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue('%_\n');
    // 草稿占用的高度会改变渲染行数，ARIA 总行数包含表头和完整数据范围。
    await expect(grid).toHaveAttribute('aria-rowcount', String(original.length + 1));
    if (operator === 'endsWith') await info.attach('SQLite查询结尾筛选草稿', { body: await page.screenshot(), contentType: 'image/png' });
    await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
    await expect(ids).toHaveText(expected);
    await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
    await expect(ids).toHaveText(original);
  }
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询数值格生成精确边界且保留存储类型', async ({}, info) => {
  await seed(`SELECT id, CASE id WHEN 1 THEN 9007199254740992 WHEN 2 THEN 9007199254740993
    WHEN 3 THEN 9007199254740994 WHEN 4 THEN '9007199254740993' WHEN 5 THEN 9007199254740994.0
    ELSE NULL END AS v FROM subject WHERE id <= 6 ORDER BY id;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const ids = grid.locator('[role="gridcell"][aria-colindex="2"]');
  const value = (id: number) => ids.filter({ hasText: new RegExp('^' + id + '$') }).locator('..').getByRole('gridcell').last();
  await expect(ids).toHaveText(['1', '2', '3', '4', '5', '6']);
  const action = page.getByRole('menuitem', { name: filterText.cellBounds.gte, exact: true });
  await value(4).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: filterText.cellText.contains, exact: true })).toBeVisible();
  await expect(action).toHaveCount(0);
  await page.keyboard.press('Escape');
  await value(2).click();
  await page.keyboard.press('Shift+F10');
  await action.click();
  const panel = query.getByRole('region', { name: filterText.title, exact: true });
  await expect(panel.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('gte');
  await expect(panel.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('integer');
  await expect(panel.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue('9007199254740993');
  await expect(ids).toHaveText(['1', '2', '3', '4', '5', '6']);
  await info.attach('SQLite查询数值快捷边界', { body: await page.screenshot(), contentType: 'image/png' });
  await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['2', '3']);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['1', '2', '3', '4', '5', '6']);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询两格和勾选原值生成双端区间', async ({}, info) => {
  await seed(`SELECT id, CASE id WHEN 1 THEN 9007199254740992 WHEN 2 THEN 9007199254740993
    WHEN 3 THEN 9007199254740994 WHEN 4 THEN '9007199254740993' ELSE 9007199254740994.0 END AS v
    FROM subject WHERE id <= 5 ORDER BY id DESC;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const ids = grid.locator('[role="gridcell"][aria-colindex="2"]');
  const row = (id: number) => ids.filter({ hasText: new RegExp('^' + id + '$') }).locator('..');
  const value = (id: number) => row(id).getByRole('gridcell').last();
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await row(3).getByRole('checkbox').check();
  await row(1).getByRole('checkbox').check();
  await value(2).click();
  await query.getByRole('button', { name: selectedFilterText.checkedBetween, exact: true }).click();
  const panel = query.getByRole('region', { name: filterText.title, exact: true });
  await expect(panel.getByLabel(filterText.lower + ' 1', { exact: true })).toHaveValue('9007199254740992');
  await expect(panel.getByLabel(filterText.upper + ' 1', { exact: true })).toHaveValue('9007199254740994');
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await info.attach('SQLite查询双端区间草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['3', '2', '1']);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['5', '4', '3', '2', '1']);
  await value(3).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: selectedFilterText.rangeNotBetween, exact: true }).click();
  await expect(panel.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('notBetween');
  await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['1']);
  expect(pageErrors).toEqual([]);
});

test('查询结果只显示匹配行可保留排序和筛选并恢复原范围', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const header = grid.getByRole('columnheader').filter({ hasText: /^id/i });
  await header.click();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  const keyword = query.getByRole('searchbox', { name: keywordText.input, exact: true });
  await keyword.fill('记录 1');
  await keyword.press('Enter');
  const keywordStatus = query.getByRole('search', { name: keywordText.input }).getByRole('status');
  await expect(keywordStatus).toHaveText(keywordText.counts(92, 180));
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const before = await history();
  async function showMatches(pattern: string, count: number) {
    await query.getByRole('button', { name: resultFind.open, exact: true }).click();
    await query.getByRole('combobox', { name: resultFind.mode, exact: true }).selectOption({ label: resultFind.modes.regex });
    await query.getByRole('textbox', { name: resultFind.input, exact: true }).fill(pattern);
    await expect(query.locator('.query-result-find-status').getByRole('status')).toHaveText(count ? resultFind.count(count, -1) : resultFind.noMatch);
    await query.getByRole('button', { name: resultFind.showMatchingRows, exact: true }).click();
    await expect(query.getByText(resultFind.matchViewCount(count, 92), { exact: true })).toBeVisible();
  }
  await showMatches('^记录 (?:1|180)$', 2);
  await expect(grid.getByRole('gridcell').filter({ hasText: /^记录 / })).toHaveText(['记录 1', '记录 180']);
  await expect(keywordStatus).toHaveText(keywordText.counts(92, 180));
  await (await navigationMenuItem(query, { name: zh.resultExport.title, exact: true })).click();
  const dialog = page.getByRole('dialog', { name: zh.resultExport.title, exact: true });
  await expect(dialog.getByText('已返回 2 行', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: zh.common.close, exact: true }).click();
  const clear = query.getByRole('button', { name: resultFind.clearMatchView, exact: true });
  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(grid.getByRole('gridcell', { name: '记录 10', exact: true })).toBeVisible();
  await expect(header.getByLabel(resultSort.ascending)).toBeVisible();
  await showMatches('^不存在$', 0);
  await expect(grid.getByRole('gridcell')).toHaveCount(0);
  await query.getByRole('button', { name: keywordText.clear, exact: true }).click();
  await expect(clear).toHaveCount(0);
  await expect(grid.getByRole('gridcell', { name: '记录 2', exact: true })).toBeVisible();
  expect(await history()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 只读查询结果按焦点接收查找菜单并保留查找条件', async ({}, info) => {
  await seed('SELECT id,name FROM subject_view WHERE id < 3;', '', undefined, true);
  const query = page.locator('.query-tab:visible');
  const editor = query.locator('.monaco-editor');
  const editorFind = editor.locator('.find-widget');
  const cell = query.getByRole('gridcell', { name: '记录 1', exact: true });
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const mode = query.getByRole('combobox', { name: resultFind.mode, exact: true });
  const columns = query.getByRole('combobox', { name: resultFind.columns, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  const shortcut = process.platform === 'darwin' ? 'Meta+f' : 'Control+f';

  await query.locator('.query-execute-split > button.primary').click();
  await cell.click();
  await clickNativeFind();
  await expect(input).toBeFocused();
  await expect(editorFind).toBeHidden();
  await columns.selectOption({ label: resultFind.columnOption('name', 2) });
  await input.fill('记录');
  await expect(status).toHaveText(resultFind.count(2, -1));
  await input.press('Enter');
  await expect(status).toHaveText(resultFind.count(2, 0));
  await cell.click();
  await page.keyboard.press(shortcut);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('记录');
  await expect(status).toHaveText(resultFind.count(2, 0));
  await expect(query.locator('.query-result-find-hit')).toHaveCount(1);
  await info.attach('SQLite结果查找菜单', { body: await page.screenshot(), contentType: 'image/png' });
  await mode.selectOption({ label: resultFind.modes.null });
  await cell.click();
  await clickNativeFind();
  await expect(mode).toBeFocused();
  await expect(mode).toHaveValue('null');
  await expect(columns.locator('option:checked')).toHaveText(resultFind.columnOption('name', 2));
  await expect(input).toBeDisabled();

  await query.getByRole('button', { name: resultFind.close, exact: true }).click();
  await query.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
  await page.getByRole('menuitem', { name: queryLayoutZh.results, exact: true }).click();
  await expect(editor).toBeHidden();
  await cell.click();
  await clickNativeFind();
  await expect(input).toBeFocused();
  await query.getByRole('button', { name: resultFind.close, exact: true }).click();
  await query.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
  await page.getByRole('menuitem', { name: queryLayoutZh.below, exact: true }).click();
  await editor.locator('.view-lines').click();
  await clickNativeFind();
  await expect(editorFind).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('查询结果查找可勾选匹配行并供复制和导出使用', async () => {
  await seed('SELECT id, name, name AS 对照 FROM subject ORDER BY id DESC;');
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const row = (id: number) => query.getByRole('gridcell', { name: String(id), exact: true }).locator('..').getByRole('checkbox');
  await row(179).check();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  const check = query.getByRole('button', { name: resultFind.checkRows, exact: true });
  const uncheck = query.getByRole('button', { name: resultFind.uncheckRows, exact: true });
  const copiedText = async () => (await readGridMenuClipboard(page, query.getByRole('button', { name: queryResultCopyZh.action, exact: true }))).text.replaceAll('\r\n', '\n');
  await expect(check).toBeDisabled();
  await query.getByRole('combobox', { name: resultFind.mode, exact: true }).selectOption({ label: resultFind.modes.regex });
  await input.fill('^记录 (?:180|1)$');
  await expect(status).toHaveText(resultFind.count(4, -1));
  await check.click();
  await expect(row(180)).toBeChecked();
  await expect(row(179)).toBeChecked();
  await expect(await copiedText()).toBe('id\tname\t对照\n180\t记录 180\t记录 180\n179\t记录 179\t记录 179\n1\t记录 1\t记录 1');
  await input.press('Shift+F3');
  await expect(row(1)).toBeChecked();
  await uncheck.click();
  await expect(row(1)).not.toBeChecked();
  await expect(await copiedText()).toBe('id\tname\t对照\n179\t记录 179\t记录 179');
  await check.click();
  await (await navigationMenuItem(query, { name: zh.resultExport.selectedTitle, exact: true })).click();
  const dialog = page.getByRole('dialog', { name: zh.resultExport.selectedTitle, exact: true });
  await expect(dialog.getByText('仅导出已返回结果中勾选的 3 行', { exact: true })).toBeVisible();
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查询结果正则在线程查找、超时清除命中并可重新搜索', async () => {
  await seed("SELECT id, CASE id WHEN 180 THEN 'aaaa' WHEN 178 THEN replace(hex(zeroblob(20000)), '0', 'a') || '!' ELSE name END AS 内容 FROM subject ORDER BY id DESC;");
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('gridcell', { name: 'aaaa', exact: true })).toBeVisible();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  await query.getByRole('combobox', { name: resultFind.columns, exact: true }).selectOption({ label: resultFind.columnOption('内容', 2) });
  await query.getByRole('combobox', { name: resultFind.mode, exact: true }).selectOption({ label: resultFind.modes.regex });
  await input.fill('^记录 (?:179|1)$');
  await expect(status).toHaveText(resultFind.count(2, -1));
  await query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true }).check();
  await input.press('Shift+F3');
  await expect(query.getByRole('gridcell', { name: '记录 1', exact: true })).toHaveClass(/query-result-find-hit/);
  await input.fill('[');
  await expect(status).toHaveText(resultFind.regexErrors['regex-invalid']);
  await expect(query.locator('.query-result-find-hit, .query-result-find-match')).toHaveCount(0);
  await input.fill('^(a+)+\\1$');
  await expect(status).toHaveText(resultFind.regexErrors['regex-timeout']);
  await expect(query.locator('.query-result-find-hit, .query-result-find-match')).toHaveCount(0);
  await input.fill('^记录 179$');
  await expect(status).toHaveText(resultFind.count(1, -1));
  await input.press('Enter');
  await expect(query.getByRole('gridcell', { name: '记录 179', exact: true })).toHaveClass(/query-result-find-hit/);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查询结果按原类型查找可区分 SQL NULL、空字符串和整格文字', async () => {
  await seed("SELECT id, CASE id WHEN 180 THEN NULL WHEN 179 THEN 'NULL' WHEN 178 THEN '' ELSE 'nullable' END AS 内容, NULL AS 对照 FROM subject WHERE id >= 177 ORDER BY id DESC;");
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const selected = query.getByRole('gridcell', { name: '180', exact: true }).locator('..').getByRole('checkbox');
  await selected.check();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const columns = query.getByRole('combobox', { name: resultFind.columns, exact: true });
  const mode = query.getByRole('combobox', { name: resultFind.mode, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  await columns.selectOption({ label: resultFind.columnOption('内容', 2) });
  await input.fill('NULL');
  await expect(status).toHaveText(resultFind.count(3, -1));
  const highlight = query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true });
  const nullable = query.getByRole('gridcell', { name: 'nullable', exact: true });
  await highlight.check();
  await expect(nullable).toHaveClass(/query-result-find-match/);

  for (const [kind, row] of [['whole', 1], ['endsWith', 1], ['null', 0], ['empty', 2]] as const) {
    await mode.selectOption({ label: resultFind.modes[kind] });
    await expect(status).toHaveText(resultFind.count(1, -1));
    await expect(nullable).not.toHaveClass(/query-result-find-match/);
    await query.getByRole('button', { name: resultFind.next, exact: true }).click();
    await expect(query.getByText(resultFind.location(row, 1), { exact: true })).toBeVisible();
    await expect(query.locator('.query-result-find-hit')).toHaveCount(1);
  }
  await expect(input).toBeDisabled();
  await mode.selectOption({ label: resultFind.modes.contains });
  await expect(input).toHaveValue('NULL');
  await expect(input).toBeEnabled();
  await expect(status).toHaveText(resultFind.count(3, -1));
  await expect(selected).toBeChecked();
  await mode.selectOption({ label: resultFind.modes.startsWith });
  await expect(status).toHaveText(resultFind.count(2, -1));
  await query.getByRole('checkbox', { name: resultFind.sensitive, exact: true }).check();
  await expect(status).toHaveText(resultFind.count(1, -1));
  await query.getByRole('button', { name: resultFind.showMatchingRows, exact: true }).click();
  await expect(query.getByText(resultFind.matchViewCount(1, 4), { exact: true })).toBeVisible();
  await expect(query.getByRole('gridcell', { name: '179', exact: true })).toBeVisible();
  await expect(query.getByRole('gridcell', { name: '180', exact: true })).toHaveCount(0);
  await query.getByRole('button', { name: resultFind.clearMatchView, exact: true }).click();
  await expect(query.getByRole('gridcell', { name: '180', exact: true })).toBeVisible();
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询把单列查找带入本地筛选并保留已有条件', async ({}, info) => {
  await seed(`SELECT id, CASE id WHEN 1 THEN '%_前' WHEN 2 THEN '中%_前' WHEN 3 THEN '%_后' ELSE NULL END AS 文本,
    CASE WHEN id=4 THEN NULL ELSE '%_' END AS 文本 FROM subject WHERE id <= 4 ORDER BY id DESC;`);
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const ids = grid.locator('[role="gridcell"][aria-colindex="2"]');
  await expect(ids).toHaveText(['4', '3', '2', '1']);
  const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute').map(task => task.id));
  const before = await tasks();
  const panel = query.getByRole('region', { name: filterText.title, exact: true });
  const column = query.getByRole('combobox', { name: resultFind.columns, exact: true });
  const mode = query.getByRole('combobox', { name: resultFind.mode, exact: true });
  const stage = query.getByRole('button', { name: resultFind.stageFilter, exact: true });
  const open = () => query.getByRole('button', { name: resultFind.open, exact: true }).click();
  await open();
  await expect(stage).toBeDisabled();
  await column.selectOption({ label: resultFind.columnOption('文本', 2) });
  await mode.selectOption('startsWith');
  await query.getByRole('textbox', { name: resultFind.input, exact: true }).fill('%_');
  await expect(stage).toBeDisabled();
  await query.getByRole('checkbox', { name: resultFind.sensitive, exact: true }).check();
  await stage.click();
  await expect(panel.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('startsWith');
  await expect(panel.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text');
  await expect(panel.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue('%_');
  await expect(grid).toHaveAttribute('aria-rowcount', '5');
  await info.attach('SQLite结果查找转筛选草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveText(['3', '1']);
  await open();
  await column.selectOption({ label: resultFind.columnOption('文本', 3) });
  const secondKey = (await column.inputValue()).slice('column:'.length);
  await mode.selectOption('null');
  await stage.click();
  await expect(panel.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('startsWith');
  await expect(panel.getByLabel(filterText.operator + ' 2', { exact: true })).toHaveValue('null');
  await expect(panel.getByLabel(filterText.column + ' 2', { exact: true })).toHaveValue(secondKey);
  await expect(grid).toHaveAttribute('aria-rowcount', '3');
  await panel.getByRole('button', { name: filterText.apply, exact: true }).click();
  await expect(ids).toHaveCount(0);
  await (await navigationMenuItem(query, { name: resultHistoryText.undo, exact: true })).click();
  await expect(ids).toHaveText(['3', '1']);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查询结果按列查找可区分同名列，切换范围立即清除旧定位', async () => {
  await seed("SELECT id, name AS 同名, CASE WHEN id = 1 THEN '记录 对照' ELSE '无' END AS 同名 FROM subject ORDER BY id DESC;");
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '记录 180', exact: true });
  const firstRow = first.locator('..').getByRole('checkbox');
  await firstRow.check();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const columns = query.getByRole('combobox', { name: resultFind.columns, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  await input.fill('记录');
  await expect(status).toHaveText(resultFind.count(181, -1));
  await query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true }).check();
  await expect(first).toHaveClass(/query-result-find-match/);
  await columns.selectOption({ label: resultFind.columnOption('同名', 3) });
  await expect(input).toHaveValue('记录');
  await expect(status).toHaveText(resultFind.count(1, -1));
  await expect(first).not.toHaveClass(/query-result-find-match/);
  await input.press('Enter');
  const last = query.getByRole('gridcell', { name: '记录 对照', exact: true });
  await expect(last).toBeInViewport();
  await expect(last).toHaveClass(/query-result-find-hit/);
  await expect(query.getByText(resultFind.location(179, 2), { exact: true })).toBeVisible();

  await columns.selectOption({ label: resultFind.columnOption('同名', 2) });
  await expect(status).toHaveText(resultFind.count(180, -1));
  await expect(last).not.toHaveClass(/query-result-find-match|query-result-find-hit/);
  await input.press('Enter');
  await expect(first).toBeInViewport();
  await expect(first).toHaveClass(/query-result-find-hit/);
  await expect(firstRow).toBeChecked();
  await columns.selectOption({ label: resultFind.allColumns });
  await expect(status).toHaveText(resultFind.count(181, -1));
  await expect(first).toHaveClass(/query-result-find-match/);
  await expect(first).not.toHaveClass(/query-result-find-hit/);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查找可标记全部命中并跨屏循环定位，保留勾选且不执行数据任务', async () => {
  await seed();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const firstResult = query.getByRole('gridcell', { name: '记录 180', exact: true });
  const resultCheck = firstResult.locator('..').getByRole('checkbox');
  await resultCheck.check();
  const beforeQuery = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const resultStatus = query.locator('.query-result-find-status').getByRole('status');
  await input.fill('记录');
  await expect(resultStatus).toHaveText(resultFind.count(180, -1));
  await expect(firstResult).not.toHaveClass(/query-result-find-match/);
  const highlight = query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true });
  await highlight.check();
  await expect(firstResult).toHaveClass(/query-result-find-match/);
  await input.press('Shift+F3');
  await expect(input).toBeFocused();
  await expect(resultStatus).toHaveText(resultFind.count(180, 179));
  const lastResult = query.getByRole('gridcell', { name: '记录 1', exact: true });
  await expect(lastResult).toBeInViewport();
  await expect(lastResult).toHaveClass(/query-result-find-hit/);
  await expect(query.getByRole('gridcell', { name: '记录 2', exact: true })).toHaveClass(/query-result-find-match/);
  await lastResult.click();
  await page.keyboard.press('F3');
  await expect(resultStatus).toHaveText(resultFind.count(180, 0));
  // 虚拟网格会保留一个屏外的活动格，实际可见性以视口为准。
  await expect(lastResult).not.toBeInViewport();
  await expect(query.getByRole('grid')).toBeFocused();
  await page.keyboard.press('F3');
  await expect(resultStatus).toHaveText(resultFind.count(180, 1));
  const secondResult = query.getByRole('gridcell', { name: '记录 179', exact: true });
  await expect(secondResult).toHaveClass(/query-result-find-hit/);
  await highlight.uncheck();
  await expect(firstResult).not.toHaveClass(/query-result-find-match/);
  await expect(secondResult).toHaveClass(/query-result-find-hit/);
  await highlight.check();
  await input.fill('无此结果');
  await expect(resultStatus).toHaveText(resultFind.noMatch);
  await expect(query.locator('.query-result-find-match, .query-result-find-hit')).toHaveCount(0);
  await expect(resultCheck).toBeChecked();
  expect(await tasks()).toEqual(beforeQuery);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  await expect(first).toBeVisible();
  const beforeTable = await tasks();
  await first.click();
  await page.keyboard.press('Control+f');
  const findPanel = table.getByRole('region', { name: sqliteFind.title, exact: true });
  const tableInput = findPanel.getByRole('textbox', { name: sqliteFind.query, exact: true });
  const tableStatus = findPanel.getByRole('status');
  await tableInput.fill('记录');
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, -1));
  const tableHighlight = findPanel.getByRole('checkbox', { name: resultFind.highlightAll, exact: true });
  await expect(first).not.toHaveClass(/query-result-find-match/);
  await tableHighlight.check();
  await expect(first).toHaveClass(/query-result-find-match/);
  await tableInput.press('F3');
  await expect(tableInput).toBeFocused();
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, 0));
  await first.click();
  await page.keyboard.press('Shift+F3');
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, 99));
  const last = table.getByRole('gridcell', { name: 'TEXT · 记录 100', exact: true });
  await expect(last).toBeFocused();
  await expect(last.locator('.sqlite-find-hit')).toBeVisible();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 99', exact: true })).toHaveClass(/query-result-find-match/);
  await page.keyboard.press('F3');
  await expect(first).toBeFocused();
  await tableHighlight.uncheck();
  await expect(table.locator('.query-result-find-match')).toHaveCount(0);
  await expect(first.locator('.sqlite-find-hit')).toBeVisible();
  await tableHighlight.check();
  await findPanel.getByRole('button', { name: sqliteFind.close, exact: true }).click();
  await expect(table.locator('.query-result-find-match, .sqlite-find-hit')).toHaveCount(0);
  expect(await tasks()).toEqual(beforeTable);
  expect(pageErrors).toEqual([]);
});

test('查询结果和 SQLite 表页可选择并复制矩形区域，保留勾选和原类型', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const firstResult = query.getByRole('gridcell', { name: '180', exact: true });
  await query.locator('.query-execute-split > button.primary').click();
  const checked = firstResult.locator('..').getByRole('checkbox');
  await checked.check();
  const beforeQuery = await tasks();
  await firstResult.click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(query.getByRole('gridcell', { name: '记录 179', exact: true })).toBeFocused();
  await expect(query.locator('.grid-cell-in-range')).toHaveCount(4);
  let payload = await readGridRangeClipboard(page);
  expect(payload.text).toBe('180\t记录 180\n179\t记录 179');
  expect(JSON.parse(payload.typed).rows).toEqual([['180', '记录 180'], ['179', '记录 179']]);

  await page.keyboard.press('Escape');
  await expect(query.locator('.grid-cell-in-range')).toHaveCount(0);
  expect((await readGridRangeClipboard(page)).text).toBe('180\t记录 180');
  await firstResult.click();
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  const last = query.getByRole('gridcell', { name: '记录 1', exact: true });
  await last.click({ modifiers: ['Shift'] });
  await expect(last).toBeFocused();
  payload = await readGridRangeClipboard(page);
  expect(JSON.parse(payload.typed).rows).toEqual(Array.from({ length: 180 }, (_, index) => [String(180 - index), '记录 ' + (180 - index)]));
  expect(await tasks()).toEqual(beforeQuery);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const destination = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  await expect(destination).toBeFocused();
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(4);
  payload = await readGridRangeClipboard(page);
  expect(payload.text).toBe('1\t记录 1\n2\t记录 2');
  expect(JSON.parse(payload.sqlite)).toMatchObject({ columns: ['id', 'name'], rows: [
    [{ kind: 'integer', value: '1' }, { kind: 'text', value: '记录 1' }],
    [{ kind: 'integer', value: '2' }, { kind: 'text', value: '记录 2' }],
  ] });
  await destination.click();
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(0);
  expect((await readGridRangeClipboard(page)).text).toBe('记录 2');
  const start = await gridCellCenter(table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }));
  const end = await gridCellCenter(destination);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(4);
  await page.mouse.up();
  await expect(destination).toBeFocused();
  expect((await readGridRangeClipboard(page)).sqlite).toBe(payload.sqlite);
  expect(pageErrors).toEqual([]);
});

test('查询和 SQLite 可从选区内打开复制菜单，表头只进入文本并恢复端点焦点', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '180', exact: true });
  const end = query.getByRole('gridcell', { name: '记录 179', exact: true });
  const menu = page.getByRole('menu');
  const copy = (label: string) => readGridMenuClipboard(page, menu.getByRole('menuitem', { name: label, exact: true }));
  await first.click();
  await end.click({ modifiers: ['Shift'] });
  await first.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: cellCopy.copyCell, exact: true })).toBeVisible();
  const queryCopy = await copy(rangeCopy.withHeaders);
  expect(queryCopy.text).toBe('id\tname\n180\t记录 180\n179\t记录 179');
  expect(JSON.parse(queryCopy.typed).rows).toEqual([['180', '记录 180'], ['179', '记录 179']]);
  await expect(end).toBeFocused();
  await first.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop += 96; });
  await expect(menu).toHaveCount(0);
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop = 0; });
  await query.getByRole('gridcell', { name: '178', exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: rangeCopy.copy, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const sqliteEnd = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await sqliteEnd.click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+F10');
  const withHeaders = await copy(rangeCopy.withHeaders);
  expect(withHeaders.text).toBe('id\tname\n1\t记录 1\n2\t记录 2');
  expect(JSON.parse(withHeaders.sqlite)).toMatchObject({ columns: ['id', 'name'], rows: [
    [{ kind: 'integer', value: '1' }, { kind: 'text', value: '记录 1' }],
    [{ kind: 'integer', value: '2' }, { kind: 'text', value: '记录 2' }],
  ] });
  await expect(sqliteEnd).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const plain = await copy(rangeCopy.copy);
  expect(plain).toEqual({ ...withHeaders, text: '1\t记录 1\n2\t记录 2' });
  expect(pageErrors).toEqual([]);
});

test('SQLite 查询选中同名列或整行，复制虚拟结果并保留勾选', async ({}, info) => {
  await seed('SELECT id AS 同名, name AS 同名 FROM subject ORDER BY id DESC;');
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const action = (name: string) => page.getByRole('menuitem', { name, exact: true });
  await query.locator('.query-execute-split > button.primary').click();
  const first = grid.getByRole('gridcell', { name: '记录 180', exact: true });
  const second = grid.getByRole('gridcell', { name: '记录 179', exact: true });
  await expect(first).toBeVisible();
  const checked = second.locator('..').getByRole('checkbox');
  await checked.check();
  await expect(grid.getByRole('gridcell', { name: '记录 1', exact: true })).toHaveCount(0);
  const before = await tasks();
  await first.click();
  const header = grid.getByRole('columnheader').filter({ hasText: /^同名/ }).nth(1);
  await header.focus();
  await page.keyboard.press('Shift+F10');
  await action(rangeCopy.selectColumn).press('Enter');
  await expect(first).toBeFocused();
  const column = JSON.parse((await readGridRangeClipboard(page)).sqlite);
  expect(column.rows).toEqual(Array.from({ length: 180 }, (_, i) => [{ kind: 'text', value: '记录 ' + (180 - i) }]));
  await expect(checked).toBeChecked();
  await info.attach('SQLite查询同名列选区', { body: await page.screenshot(), contentType: 'image/png' });

  await second.click({ button: 'right' });
  await action(rangeCopy.selectRow).click();
  await expect(grid.getByRole('gridcell', { name: '179', exact: true })).toBeFocused();
  expect(JSON.parse((await readGridRangeClipboard(page)).sqlite).rows).toEqual([
    [{ kind: 'integer', value: '179' }, { kind: 'text', value: '记录 179' }],
  ]);
  await expect(checked).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(grid.locator('.grid-cell-in-range')).toHaveCount(0);
  expect((await tasks()).map(task => task.id)).toEqual(before.map(task => task.id));
  expect(pageErrors).toEqual([]);
});

test('SQLite 表和视图整列选择限当前页，换页清除旧矩形', async () => {
  await seed();
  for (const [tab, title, typed] of [['t-jump', '表格定位', true], ['v-jump', '视图定位', false]] as const) {
    await page.locator('[data-workspace-tab-id="' + tab + '"]').getByRole('button', { name: title, exact: true }).click();
    const table = page.locator('.sqlite-table-tab:visible'), grid = table.getByRole('grid');
    const header = grid.getByRole('columnheader').filter({ hasText: /^name/ });
    const name = (n: number) => grid.getByRole('gridcell', { name: (typed ? 'TEXT · ' : '') + '记录 ' + n, exact: true });
    const selectColumn = async () => {
      await header.click({ button: 'right' });
      await page.getByRole('menuitem', { name: rangeCopy.selectColumn, exact: true }).click();
    };
    await expect(name(1)).toBeVisible();
    await selectColumn();
    await expect(name(1)).toBeFocused();
    expect(JSON.parse((await readGridRangeClipboard(page)).sqlite).rows).toEqual(
      Array.from({ length: 100 }, (_, i) => [{ kind: 'text', value: '记录 ' + (i + 1) }]),
    );
    await table.getByRole('button', { name: browseText.next, exact: true }).click();
    await expect(name(101)).toBeVisible();
    await expect(grid.locator('.grid-cell-in-range')).toHaveCount(0);
    await selectColumn();
    await expect(name(101)).toBeFocused();
    expect(JSON.parse((await readGridRangeClipboard(page)).sqlite).rows).toEqual(
      Array.from({ length: 80 }, (_, i) => [{ kind: 'text', value: '记录 ' + (i + 101) }]),
    );
  }
  expect(pageErrors).toEqual([]);
});

test('语句目录分别打开查询按原序建立独立标签，超限整批拒绝', async () => {
  const statements = Array.from({ length: 21 }, (_, index) => `SELECT '语句 ${index}; 🚢';`);
  await seed(statements.join('\n'));
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const split = panel.getByRole('button', { name: navigationText.openSeparately, exact: true });
  const master = panel.getByRole('checkbox', { name: navigationText.checkMatches, exact: true });
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(21));
  await expect(split).toBeDisabled();
  const before = await settings();
  await master.check();
  await split.click();
  await expect(query.getByText(queryDuplicateZh.batchTooLarge(20), { exact: true })).toBeVisible();
  expect((await settings()).tabs).toEqual(before.tabs);
  await master.uncheck();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await panel.getByRole('checkbox', { name: navigationText.check(20), exact: true }).check();
  await panel.getByRole('textbox', { name: navigationText.search, exact: true }).fill('语句 0;');
  await panel.getByRole('checkbox', { name: navigationText.check(0), exact: true }).check();
  await split.click();
  const titles = [1, 2].map(index => '查询定位' + queryDuplicateZh.splitSuffix(index));
  await expect(page.locator('[data-workspace-tab-id]').getByRole('button', { name: titles[0], exact: true })).toBeVisible();
  await expect.poll(async () => (await settings()).tabs.length).toBe(before.tabs.length + 2);
  const after = await settings(), drafts = after.tabs.slice(-2);
  expect(after.tabs.slice(0, -2)).toEqual(before.tabs);
  expect(after.activeTabId).toBe(drafts[0].id);
  expect(new Set(drafts.map(tab => tab.id)).size).toBe(2);
  for (const [index, body] of [statements[0], statements[20]].entries()) {
    expect(drafts[index]).toMatchObject({ kind: 'query', title: titles[index], connectionId: 'row-jump-offline', sql: body,
      databaseContext: { state: 'known', database: 'main' } });
    expect(drafts[index].sourceBinding).toBeUndefined();
    expect(drafts[index].fileSourceBinding).toBeUndefined();
  }
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('语句目录跨页勾选全部搜索结果，只取消命中并按原序入库', async () => {
  const statements = Array.from({ length: 16 }, (_, index) =>
    `SELECT '${index === 1 || index === 13 ? '搜索之外' : '批量命中'} ${index}';`);
  await seed(statements.join('\n'));
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const search = panel.getByRole('textbox', { name: navigationText.search, exact: true });
  const master = panel.getByRole('checkbox', { name: navigationText.checkMatches, exact: true });
  const rowCheck = (index: number) => panel.getByRole('checkbox', { name: navigationText.check(index), exact: true });
  const checked = (count: number) => panel.getByText(navigationText.checked(count), { exact: true });
  const outside = panel.getByText(navigationText.checkedOutsideSearch(1), { exact: true });
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(16));
  await rowCheck(1).check();
  await rowCheck(2).check();
  await search.fill('批量命中');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(14));
  await expect(outside).toBeVisible();
  await expect(master).toHaveAttribute('aria-checked', 'mixed');
  await expect(master).toHaveJSProperty('indeterminate', true);
  await master.press('Space');
  await expect(master).toBeChecked();
  await expect(checked(15)).toBeVisible();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await expect(rowCheck(15)).toBeChecked();
  await rowCheck(15).uncheck();
  await expect(master).toHaveAttribute('aria-checked', 'mixed');
  await master.check();
  await expect(rowCheck(15)).toBeChecked();

  const library = panel.getByRole('button', { name: navigationText.library, exact: true });
  const name = panel.getByRole('textbox', { name: navigationText.libraryName, exact: true });
  await library.click();
  await name.fill('过期选择');
  await master.uncheck();
  await expect(name).toHaveCount(0);
  await expect(checked(1)).toBeVisible();
  await expect(outside).toBeVisible();
  await expect(rowCheck(15)).not.toBeChecked();
  await search.fill('无匹配语句');
  await expect(master).toBeDisabled();
  await expect(checked(1)).toBeVisible();

  await search.fill('批量命中');
  await master.check();
  await library.click();
  await name.fill('跨页勾选');
  await panel.getByRole('button', { name: navigationText.librarySave, exact: true }).click();
  await expect(page.getByText(navigationText.librarySaved('跨页勾选'), { exact: true })).toBeVisible();
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ name: '跨页勾选', connectionId: 'row-jump-offline' });
  expect(records[0].sql.replaceAll('\r\n', '\n')).toBe(statements.filter((_, index) => index !== 13).join('\n'));
  await panel.getByRole('button', { name: navigationText.refresh, exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(16));
  await expect(checked(0)).toBeVisible();
  await expect(master).not.toBeChecked();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('语句目录按原序保存三种编码，取消、失效和 SQLite 源文件目标均不写入', async () => {
  const first = "SELECT '语句甲;原文';", third = "SELECT '语句丙';";
  await seed(first + "\nSELECT '排除';\n" + third);
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const save = panel.getByRole('button', { name: navigationText.saveChecked, exact: true });
  const encoding = panel.getByRole('combobox', { name: navigationText.scriptEncoding, exact: true });
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await expect(save).toBeDisabled();
  await panel.getByRole('checkbox', { name: navigationText.check(2), exact: true }).check();
  await panel.getByRole('checkbox', { name: navigationText.check(0), exact: true }).check();
  const library = panel.getByRole('button', { name: navigationText.library, exact: true });
  const name = panel.getByRole('textbox', { name: navigationText.libraryName, exact: true });
  const saveQuery = panel.getByRole('button', { name: navigationText.librarySave, exact: true });
  const settingsBefore = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await library.click();
  await expect(name).toBeFocused();
  await name.fill('  ');
  await expect(saveQuery).toBeDisabled();
  await panel.getByRole('button', { name: navigationText.libraryCancel, exact: true }).click();
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]);
  await page.evaluate(async () => {
    const snapshot = await window.dbark.invoke('queries.organizationGet', {});
    await window.dbark.invoke('queries.organizationApply', { expectedRevision: snapshot.revision, operation: { kind: 'create', name: '语句片段', parentId: null } });
  });
  await library.click();
  await name.fill('  常用语句  ');
  await panel.getByRole('button', { name: groupText.chooseSaveGroup, exact: true }).click();
  await panel.getByRole('combobox', { name: groupText.saveGroup, exact: true }).selectOption({ label: '语句片段' });
  await name.press('Enter');
  await expect(page.getByText(navigationText.librarySaved('常用语句'), { exact: true })).toBeVisible();
  await expect(name).toHaveCount(0);
  const savedQueries = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(savedQueries).toHaveLength(1);
  expect(savedQueries[0]).toMatchObject({ name: '常用语句', connectionId: 'row-jump-offline', databaseContext: { state: 'known', database: 'main' } });
  expect(savedQueries[0].sql.replaceAll('\r\n', '\n')).toBe(first + '\n' + third);
  expect(await page.evaluate(() => window.dbark.invoke('queries.organizationGet', {}))).toMatchObject({ groups: [{ name: '语句片段', count: 1 }], unfiledCount: 0 });
  expect(await page.evaluate(() => window.dbark.invoke('settings.get', {}))).toMatchObject({ tabs: settingsBefore.tabs, activeTabId: 'q-jump' });
  async function choose(path?: string, delayed = false) {
    // 只替换系统路径选择，保留文件令牌、编码及原子写入的正式 IPC。
    await desktop.evaluate(({ dialog, BrowserWindow }, input) => {
      const original = dialog.showSaveDialog;
      const scope = globalThis as typeof globalThis & { __releaseStatementSave?: () => void };
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || options.defaultPath !== input.name ||
            !options.filters?.[0]?.extensions.includes('sql')) throw Error('只允许本例勾选语句保存');
        if (input.delayed) await new Promise<void>(resolve => { scope.__releaseStatementSave = resolve; });
        return input.path ? { canceled: false, filePath: input.path } : { canceled: true, filePath: '' };
      }) as typeof original;
    }, { path, delayed, name: navigationText.scriptFile });
  }
  const expected = first + '\n' + third;
  for (const kind of ['utf8', 'utf16le', 'gb18030'] as const) {
    const name = kind + '.sql', output = join(dataDir, name);
    await encoding.selectOption(kind);
    await choose(output);
    await save.click();
    await expect(page.getByText(navigationText.saved(name), { exact: true })).toBeVisible();
    const bytes = readFileSync(output);
    if (kind === 'utf16le') expect([...bytes.subarray(0, 2)]).toEqual([255, 254]);
    const decoded = new TextDecoder(kind === 'utf8' ? 'utf-8' : kind === 'utf16le' ? 'utf-16le' : 'gb18030', { fatal: true }).decode(bytes);
    expect(decoded.replaceAll('\r\n', '\n')).toBe(expected);
  }
  await choose();
  await save.click();
  await expect(save).toBeEnabled();

  await choose(database);
  await save.click();
  await expect(page.getByText('导出目标属于已保存的SQLite数据库或日志文件，请选择其他文件', { exact: true })).toBeVisible();
  expect(readFileSync(database)).toEqual(before);

  const stale = join(dataDir, '过期.sql');
  await choose(stale, true);
  await save.click();
  await expect.poll(() => desktop.evaluate(() => !!(globalThis as typeof globalThis & { __releaseStatementSave?: () => void }).__releaseStatementSave)).toBe(true);
  await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: navigationText.refresh, exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await desktop.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __releaseStatementSave?: () => void };
    scope.__releaseStatementSave?.();
    delete scope.__releaseStatementSave;
  });
  await expect(page.getByText(navigationText.reasons.stale, { exact: true })).toBeVisible();
  expect(existsSync(stale)).toBe(false);
  expect(readFileSync(database)).toEqual(before);
  await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: navigationZh.savedQueries, exact: true })).click();
  const savedLibrary = page.getByRole('dialog', { name: zh.activity.text003, exact: true });
  await expect(savedLibrary.getByText('常用语句', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('矩形选区导出仅写所选列和行，SQLite 文件保持不变', async () => {
  await seed();
  const menu = page.getByRole('menuitem', { name: rangeExport.action, exact: true });
  const modal = page.getByRole('dialog', { name: rangeExport.action, exact: true });
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  async function exportJson(name: string) {
    await expect(modal.getByText(rangeExport.summary(2, 1), { exact: true })).toBeVisible();
    const format = modal.getByLabel(zh.resultExport.format, { exact: true });
    await expect(format.locator('option[value="sql"]')).toHaveText(sqlText.sqliteFormat);
    await format.selectOption('json');
    const output = join(dataDir, name);
    // 只固定本次保存位置，文件写入继续使用正式导出 IPC。
    await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
          throw Error('仅允许本例 JSON 保存选择');
        return { canceled: false, filePath: output };
      }) as typeof original;
    }, output);
    await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
    await modal.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
    await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
    return JSON.parse(readFileSync(output, 'utf8'));
  }

  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const queryStart = query.getByRole('gridcell', { name: '记录 180', exact: true });
  await queryStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  const beforeQuery = await tasks();
  await queryStart.click({ button: 'right' });
  await menu.click();
  await expect(modal).toBeVisible();
  expect(await tasks()).toEqual(beforeQuery);
  expect(await exportJson('矩形查询.json')).toEqual([{ name: '记录 180' }, { name: '记录 179' }]);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const tableStart = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  await tableStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
  const fill = table.getByRole('region', { name: rangeFill.open, exact: true });
  await fill.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('待提交');
  await fill.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  const draftStart = table.getByRole('gridcell', { name: 'TEXT · 待提交', exact: true }).first();
  await draftStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await draftStart.click({ button: 'right' });
  const draftJson = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.json, exact: true }));
  expect(JSON.parse(draftJson.text)).toEqual([{ name: '待提交' }, { name: '待提交' }]);
  expect(draftJson.typed).toBe('');
  expect(draftJson.sqlite).toBe('');
  await draftStart.click({ button: 'right' });
  await menu.click();
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('sql');
  await modal.getByLabel(sqlText.sqliteDatabase, { exact: true }).fill('main');
  await modal.getByLabel(sqlText.table, { exact: true }).fill('copied');
  await modal.getByLabel(sqlText.column(1), { exact: true }).fill('name');
  await modal.getByRole('button', { name: sqlText.clipboardPreview, exact: true }).click();
  const script = modal.locator('pre').filter({ hasText: '待提交' });
  await expect(script).toBeVisible();
  const copied = await readGridMenuClipboard(page, modal.getByRole('button', { name: sqlText.clipboardCopy, exact: true }));
  expect(copied.text).toBe(await script.textContent());
  expect(copied.text.match(/VALUES \('待提交'\)/g)).toHaveLength(2);
  expect(await exportJson('矩形草稿.json')).toEqual([{ name: '待提交' }, { name: '待提交' }]);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 矩形 INSERT 文件在独立数据库保留原生类型和精度', async () => {
  await seed(`SELECT '排除甲' AS hidden_first, 9223372036854775807 AS n, '000123' AS t,
    1.5 AS r, X'00FF' AS b, NULL AS z, '排除乙' AS hidden_last
    UNION ALL SELECT '排除丙', -9223372036854775808, '000456', 2.5, X'AB', NULL, '排除丁'
    UNION ALL SELECT '范围外', 3, '不要导出', 4.5, X'01', NULL, '范围外';`);
  const source = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(source);
  const menu = page.getByRole('menuitem', { name: rangeExport.action, exact: true });
  const modal = page.getByRole('dialog', { name: rangeExport.action, exact: true });
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '9223372036854775807', exact: true });
  await first.click();
  for (let column = 0; column < 4; column++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await first.click({ button: 'right' });
  const csv = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.csv, exact: true }));
  expect(csv).toEqual({
    text: 'n,t,r,b,z\r\n9223372036854775807,000123,1.5,base64:AP8=,\\N\r\n-9223372036854775808,000456,2.5,base64:qw==,\\N\r\n',
    typed: '', sqlite: '',
  });
  await page.keyboard.press('Shift+F10');
  const json = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.json, exact: true }));
  expect(JSON.parse(json.text)).toEqual([
    { n: '9223372036854775807', t: '000123', r: '1.5', b: { type: 'binary', base64: 'AP8=' }, z: null },
    { n: '-9223372036854775808', t: '000456', r: '2.5', b: { type: 'binary', base64: 'qw==' }, z: null },
  ]);
  expect(json.typed).toBe('');
  await first.click({ button: 'right' });
  await menu.click();
  await expect(modal.getByText(rangeExport.summary(2, 5), { exact: true })).toBeVisible();
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('sql');
  await modal.getByLabel(sqlText.sqliteDatabase, { exact: true }).fill('main');
  await modal.getByLabel(sqlText.table, { exact: true }).fill('copied');
  for (const [index, name] of ['n', 't', 'r', 'b', 'z'].entries())
    await modal.getByLabel(sqlText.column(index + 1), { exact: true }).fill(name);
  await modal.getByRole('button', { name: sqlText.preview, exact: true }).click();
  await expect(modal.getByText(sqlText.previewScope(2, 2), { exact: true })).toBeVisible();
  const output = join(dataDir, '矩形.sql');
  // 仅替换一次系统保存位置，保留 Main 的预览、文件授权和原子写入。
  await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('sql'))
        throw Error('仅允许本例 SQL 保存选择');
      return { canceled: false, filePath: output };
    }) as typeof original;
  }, output);
  await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
  const start = modal.getByRole('button', { name: zh.resultExport.start, exact: true });
  await expect(start).toBeDisabled();
  await modal.getByLabel(sqlText.confirmation, { exact: true }).fill('main.copied');
  await modal.getByRole('checkbox', { name: sqlText.acknowledge, exact: true }).check();
  await start.click();
  await modal.getByRole('button', { name: zh.common.done, exact: true }).click();

  const replay = new DatabaseSync(':memory:');
  try {
    replay.exec('CREATE TABLE copied(n,t,r,b,z);');
    replay.exec(readFileSync(output, 'utf8'));
    const rows = replay.prepare(`SELECT typeof(n) AS nt, CAST(n AS TEXT) AS n, typeof(t) AS tt, t,
      typeof(r) AS rt, r, typeof(b) AS bt, hex(b) AS b, typeof(z) AS z FROM copied ORDER BY rowid;`).all();
    expect(rows).toEqual([
      { nt: 'integer', n: '9223372036854775807', tt: 'text', t: '000123', rt: 'real', r: 1.5, bt: 'blob', b: '00FF', z: 'null' },
      { nt: 'integer', n: '-9223372036854775808', tt: 'text', t: '000456', rt: 'real', r: 2.5, bt: 'blob', b: 'AB', z: 'null' },
    ]);
  } finally { replay.close(); }

  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const view = page.locator('.sqlite-table-tab:visible');
  const viewStart = view.getByRole('gridcell', { name: '记录 1', exact: true });
  await viewStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await viewStart.click({ button: 'right' });
  await menu.click();
  await expect(modal.getByLabel(zh.resultExport.format, { exact: true }).locator('option[value="sql"]')).toHaveText(sqlText.sqliteFormat);
  expect(readFileSync(source)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 矩形可填充同值并一次撤销，包含定位键时拒绝整块填充', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const form = table.getByRole('region', { name: rangeFill.open, exact: true });
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  const stage = async () => {
    await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('统一草稿');
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  };
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await stage();
  await expect(form.getByRole('alert')).toContainText(rangeFill.target);
  await expect(first).toBeVisible();
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await stage();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 统一草稿', exact: true })).toHaveCount(2);
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 3', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 可用 Backspace 和菜单将选区设为 NULL，定位键使整块拒绝', async () => {
  await seed();
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const id = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true });
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  await id.click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(table.getByRole('alert')).toContainText(rangeFill.target);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(undo).toBeDisabled();

  const clear = page.getByRole('menuitem', { name: rangeFill.clear, exact: true });
  for (const command of ['key', 'menu']) {
    await first.click();
    await page.keyboard.press('Shift+ArrowDown');
    if (command === 'key') await page.keyboard.press('Backspace');
    else {
      await first.click({ button: 'right' });
      await clear.click();
    }
    await expect(first).toHaveCount(0);
    await expect(second).toHaveCount(0);
    await id.click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const rows = JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
    expect(rows).toEqual([[{ kind: 'integer', value: '1' }, { kind: 'null' }], [{ kind: 'integer', value: '2' }, { kind: 'null' }]]);
    await undo.click();
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
  }

  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const viewStart = table.getByRole('gridcell', { name: '记录 1', exact: true });
  await viewStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await viewStart.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: rangeCopy.copy, exact: true })).toBeVisible();
  await expect(clear).toHaveCount(0);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 横向填充逐行保留原值，亲和性不兼容时整块拒绝', async ({}, info) => {
  await seed(undefined, 'ALTER TABLE subject ADD COLUMN mirror TEXT;' +
    'ALTER TABLE subject ADD COLUMN numeric_target INTEGER;' +
    "UPDATE subject SET name='000123', mirror='甲', numeric_target=1 WHERE id=1;" +
    "UPDATE subject SET name=NULL, mirror='乙', numeric_target=2 WHERE id=2;");
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).first().locator('..');
  const header = table.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: /^name$/ }) });
  const column = await header.getAttribute('aria-colindex');
  expect(column).toMatch(/^\d+$/);
  const form = table.getByRole('region', { name: rangeFill.open, exact: true });
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  async function select(wide = false) {
    await first.locator('[role="gridcell"][aria-colindex="' + column + '"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    if (wide) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(table.locator('.grid-cell-in-range')).toHaveCount(wide ? 6 : 4);
    return JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
  }
  async function stage(direction: 'left' | 'right') {
    await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('combobox', { name: rangeFill.kind, exact: true }).selectOption(direction);
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  }
  const original = await select();
  expect(original).toEqual([
    [{ kind: 'text', value: '000123' }, { kind: 'text', value: '甲' }],
    [{ kind: 'null' }, { kind: 'text', value: '乙' }],
  ]);
  for (const [direction, index] of [['right', 0], ['left', 1]] as const) {
    await first.locator('[role="gridcell"][aria-colindex="' + column + '"]').click({ button: 'right' });
    const action = page.getByRole('menuitem', { name: rangeFill[direction], exact: true });
    await expect(action).toBeVisible();
    if (direction === 'right') {
      await info.attach('SQLite四向填充选区菜单', { body: await page.screenshot(), contentType: 'image/png' });
    }
    await action.click();
    expect(await select()).toEqual(original.map((row: unknown[]) => [row[index], row[index]]));
    await undo.click();
    expect(await select()).toEqual(original);
  }
  const wide = await select(true);
  await stage('right');
  await expect(form.getByRole('alert')).toContainText(rangeFill.incompatible('numeric_target'));
  await expect(undo).toBeDisabled();
  expect(await select(true)).toEqual(wide);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 向下和向上填充保留整数、文本、字节与 NULL，可整步撤销', async () => {
  await seed(undefined, 'ALTER TABLE subject ADD COLUMN exact_value INTEGER;' +
    'ALTER TABLE subject ADD COLUMN payload BLOB;' +
    "UPDATE subject SET name='000123', exact_value=9223372036854775807, payload=X'00FF' WHERE id=1;" +
    "UPDATE subject SET name=NULL, exact_value=-9223372036854775808, payload=X'AB' WHERE id=3;");
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).locator('..');
  const header = table.getByRole('columnheader').filter({
    has: page.locator('.grid-header-detail-name').filter({ hasText: /^name$/ }),
  });
  const column = await header.getAttribute('aria-colindex');
  expect(column).toMatch(/^\d+$/);
  const start = first.locator('[role="gridcell"][aria-colindex="' + column + '"]');
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  const shortcut = process.platform === 'darwin' ? 'Meta+d' : 'Control+d';
  async function select() {
    await start.click();
    for (const key of ['Right', 'Right', 'Down', 'Down']) await page.keyboard.press('Shift+Arrow' + key);
    await expect(table.locator('.grid-cell-in-range')).toHaveCount(9);
  }
  const read = async () => JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
  await start.click();
  await page.keyboard.press(shortcut);
  await expect(undo).toBeDisabled();
  await page.keyboard.press('Shift+ArrowDown');
  await start.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: rangeFill.down, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: rangeFill.right, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await select();
  const original = await read();
  expect(original[0]).toEqual([{ kind: 'text', value: '000123' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }]);
  expect(original[2]).toEqual([{ kind: 'null' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'blob', value: 'ab' }]);
  for (const [direction, index] of [['down', 0], ['up', 2]] as const) {
    if (direction === 'down') {
      await page.keyboard.press(shortcut);
    } else {
      await start.click({ button: 'right' });
      await page.getByRole('menuitem', { name: rangeFill.up, exact: true }).click();
    }
    await select();
    expect(await read()).toEqual(Array(3).fill(original[index]));
    await undo.click();
    await select();
    expect(await read()).toEqual(original);
  }
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 粘贴按矩形左上角预览并暂存，单值可铺满且尺寸不符时拒绝', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(second).toBeFocused();
  await pasteGridRangeClipboard(page, '一\t二');
  const modal = page.getByRole('dialog', { name: sqlitePaste.title, exact: true });
  await expect(modal.getByText(selectionPaste.target(2, 1), { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText(selectionPaste.shape(2, 1));
  await modal.getByRole('textbox', { name: sqlitePaste.source, exact: true }).fill('铺满');
  await modal.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await expect(modal.getByText(sqlitePaste.changedCounts(2, 1, 2), { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: sqlitePaste.stage, exact: true }).click();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 铺满', exact: true })).toHaveCount(2);
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 3', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('拖选靠近底边会继续滚动，松开后可复制滚过的完整矩形', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '180', exact: true });
  await expect(first).toBeVisible();
  const start = await gridCellCenter(first);
  const { x } = await gridCellCenter(query.getByRole('gridcell', { name: '记录 180', exact: true }));
  const y = await grid.evaluate(element => element.getBoundingClientRect().top + element.clientTop + element.clientHeight - 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(x, y, { steps: 10 });
    await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBeGreaterThan(650);
  } finally { await page.mouse.up(); }
  const payload = await readGridRangeClipboard(page);
  const rows = JSON.parse(payload.typed).rows;
  expect(rows.length).toBeGreaterThan(20);
  expect(rows).toEqual(Array.from({ length: rows.length }, (_, index) => [String(180 - index), '记录 ' + (180 - index)]));
  const settled = await grid.evaluate(element => element.scrollTop);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await grid.evaluate(element => element.scrollTop)).toBe(settled);
  expect(pageErrors).toEqual([]);
});

test('拖选靠近右边缘会横向滚动并复制屏外列', async () => {
  await seed('SELECT ' + Array.from({ length: 24 }, (_, index) => 'id AS col_' + index).join(', ') + ' FROM subject ORDER BY id DESC;');
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const first = grid.locator('[aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]');
  await expect(first).toBeVisible();
  const start = await gridCellCenter(first);
  const x = await grid.evaluate(element => element.getBoundingClientRect().left + element.clientLeft + element.clientWidth - 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(x, start.y, { steps: 10 });
    await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(400);
  } finally { await page.mouse.up(); }
  const rows = JSON.parse((await readGridRangeClipboard(page)).typed).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].length).toBeGreaterThan(6);
  expect(rows[0]).toEqual(Array(rows[0].length).fill('180'));
  expect(pageErrors).toEqual([]);
});

test('SQLite 统一可见列宽保留隐藏列与冻结，并通过原保存流程写入布局', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await expect(table.getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
  await (await navigationMenuItem(table.locator('.toolbar'), { name: layoutText.entry, exact: true })).click();
  const modal = page.getByRole('dialog', { name: layoutText.title, exact: true });
  const idWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' id', exact: true });
  const nameWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' name', exact: true });
  await nameWidth.fill('210');
  await modal.getByRole('checkbox', { name: tableGridZh.visible + ' name', exact: true }).uncheck();
  await modal.getByRole('button', { name: tableGridZh.freezeThrough('id'), exact: true }).click();
  await modal.getByRole('combobox', { name: heightText.label, exact: true }).selectOption('24');
  await modal.getByRole('textbox', { name: batchText.width, exact: true }).fill('240');
  await modal.getByRole('button', { name: batchText.apply, exact: true }).click();
  await expect(idWidth).toHaveValue('240');
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: batchText.fit, exact: true }).click();
  const fitted = Number(await idWidth.inputValue());
  expect(fitted).toBeGreaterThanOrEqual(64);
  expect(fitted).toBeLessThan(240);
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: tableGridZh.save, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('sqlite.tableLayout.get', { connectionId: 'row-jump-offline', database: 'main', table: 'subject_view' }))).preferences).toEqual({
    version: 1, frozenThrough: 'id', rowHeight: 24, columns: [
      { name: 'id', hidden: false, width: fitted },
      { name: 'name', hidden: true, width: 210 },
    ],
  });
  await expect.poll(() => table.locator('.results-grid .rdg-row').first().evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(24);
  expect(pageErrors).toEqual([]);
});

/** 保留真实按钮与复制事件，仅在独立窗口将系统写入换成内存 DataTransfer。 */
async function installClipboardPort() {
  await page.evaluate(() => {
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const transfers: DataTransfer[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
      if (command !== 'copy') throw Error('拒绝本例外的命令');
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      transfers.push(data);
      return true;
    } });
    Object.assign(globalThis, { __headerCopyTest: { transfers, restore() {
      if (previous) Object.defineProperty(document, 'execCommand', previous);
      else Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(globalThis, '__headerCopyTest');
    } } });
  });
  return () => page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { restore(): void } }).__headerCopyTest.restore());
}

test('查询结果可复制尚未渲染的列值，倒序勾选仍沿显示顺序且没有额外数据任务', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  const copyColumn = query.getByRole('button', { name: queryResultCopyZh.column, exact: true });
  const cell = (value: number) => query.getByRole('gridcell', { name: String(value), exact: true });
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  await query.locator('.query-execute-split > button.primary').click();
  await expect(cell(180)).toBeVisible();
  await expect(cell(1)).toHaveCount(0);
  const before = await tasks();
  const restore = await installClipboardPort();
  try {
    await expect(copyColumn).toBeDisabled();
    await cell(180).click();
    await copyColumn.click();
    for (const id of [178, 180]) await cell(id).locator('..').getByRole('checkbox').check();
    await cell(180).click();
    await copyColumn.click();
    await query.getByRole('button', { name: selectionText.invert, exact: true }).click();
    await expect(cell(180).locator('..').getByRole('checkbox')).not.toBeChecked();
    await expect(cell(179).locator('..').getByRole('checkbox')).toBeChecked();
    await copyColumn.click();
    const clear = query.getByRole('button', { name: selectionText.clear, exact: true });
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(cell(179).locator('..').getByRole('checkbox')).not.toBeChecked();
    const result = await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { transfers: DataTransfer[] } }).__headerCopyTest.transfers.map(data => ({
      text: data.getData('text/plain'), rows: JSON.parse(data.getData('application/x-dbark-cells')).rows,
      native: JSON.parse(data.getData('application/x-dbark-sqlite-cells')).rows,
    })));
    const values = Array.from({ length: 180 }, (_, index) => String(180 - index));
    const inverted = values.filter(value => value !== '180' && value !== '178');
    const integerRows = (items: string[]) => items.map(value => [{ kind: 'integer', value }]);
    expect(result).toEqual([
      { text: values.join('\n'), rows: values.map(value => [value]), native: integerRows(values) },
      { text: '180\n178', rows: [['180'], ['178']], native: integerRows(['180', '178']) },
      { text: inverted.join('\n'), rows: inverted.map(value => [value]), native: integerRows(inverted) },
    ]);
    expect(await tasks()).toEqual(before);
    expect(pageErrors).toEqual([]);
  } finally { await restore(); }
});

test('SQLite 可编辑网格支持含列名及当前列复制，内部 MIME 保持原数据行', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const pane = page.locator('.sqlite-table-tab:visible');
  const copy = pane.getByRole('button', { name: tableHeaderCopyZh.action, exact: true });
  const copyColumn = pane.getByRole('button', { name: tableHeaderCopyZh.column, exact: true });
  const idCell = (id: number) => pane.getByRole('gridcell', { name: `INTEGER · ${id}`, exact: true });
  await expect(pane).toHaveAttribute('data-readonly', 'false');
  await expect(idCell(1)).toBeVisible();
  const restore = await installClipboardPort();
  try {
    await expect(copyColumn).toBeDisabled();
    await idCell(1).click();
    await copy.click();
    await copyColumn.click();
    for (const id of [2, 1]) {
      await idCell(id).locator('..').getByRole('checkbox', { name: '勾选 SQLite 记录', exact: true }).check();
    }
    await copy.click();
    await idCell(1).click();
    await copyColumn.click();
    await expect(idCell(100)).toHaveCount(0);
    await pane.getByRole('button', { name: selectionText.invert, exact: true }).click();
    await expect(idCell(1).locator('..').getByRole('checkbox')).not.toBeChecked();
    await expect(idCell(3).locator('..').getByRole('checkbox')).toBeChecked();
    await copyColumn.click();
    const clear = pane.getByRole('button', { name: selectionText.clear, exact: true });
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(idCell(3).locator('..').getByRole('checkbox')).not.toBeChecked();
    const result = await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { transfers: DataTransfer[] } }).__headerCopyTest.transfers.map(data => ({
      text: data.getData('text/plain'), typed: JSON.parse(data.getData('application/x-dbark-cells')), sqlite: JSON.parse(data.getData('application/x-dbark-sqlite-cells')),
    })));
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ text: 'id\n1', typed: { rows: [['1']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }]] } });
    expect(result[1]).toMatchObject({ text: Array.from({ length: 100 }, (_, index) => index + 1).join('\n'), sqlite: { columns: ['id'] } });
    expect(result[1].sqlite.rows).toEqual(Array.from({ length: 100 }, (_, index) => [{ kind: 'integer', value: String(index + 1) }]));
    expect(result[2]).toMatchObject({ text: 'id\tname\n1\t记录 1\n2\t记录 2', typed: { rows: [['1', '记录 1'], ['2', '记录 2']] }, sqlite: { columns: ['id', 'name'] } });
    expect(result[2].sqlite.rows).toHaveLength(2);
    expect(result[3]).toMatchObject({ text: '1\n2', typed: { rows: [['1'], ['2']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }], [{ kind: 'integer', value: '2' }]] } });
    const inverted = Array.from({ length: 98 }, (_, index) => String(index + 3));
    expect(result[4]).toMatchObject({ text: inverted.join('\n'), sqlite: { columns: ['id'], rows: inverted.map(value => [{ kind: 'integer', value }]) } });
    expect(pageErrors).toEqual([]);
  } finally {
    await restore();
  }
});

test('SQLite 跨页收集可替换单页并导出真实文件，刷新清除原收集', async ({}, info) => {
  await seed();
  const openTab = (id: string, name: string) => page.locator(`[data-workspace-tab-id="${id}"]`).getByRole('button', { name, exact: true }).click();
  const pane = page.locator('.sqlite-table-tab:visible'), group = pane.getByRole('group', { name: collectText.region, exact: true });
  const button = (name: string) => group.getByRole('button', { name, exact: true });
  const rowCheck = (name: string) => pane.getByRole('gridcell', { name, exact: true }).locator('..').getByRole('checkbox');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const dbPath = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(dbPath);

  await openTab('t-jump', '表格定位');
  await rowCheck('INTEGER · 1').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));

  await openTab('v-jump', '视图定位');
  await expect(button(collectText.export)).toBeDisabled();
  await pane.getByRole('button', { name: selectionText.all, exact: true }).click();
  await expect(rowCheck('1')).toBeChecked();
  await pane.getByRole('button', { name: browseText.next, exact: true }).click();
  await expect(rowCheck('101')).not.toBeChecked();
  await rowCheck('101').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));
  await pane.getByRole('button', { name: browseText.first, exact: true }).click();
  await rowCheck('1').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(2, 2));
  await rowCheck('1').uncheck();
  await rowCheck('2').check();
  await button(collectText.replace).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(2, 2));
  await page.screenshot({ path: info.outputPath('SQLite跨页勾选导出.png') });

  const beforeDialog = await tasks();
  const output = join(dataDir, '跨页勾选.json');
  // 仅替换本例保存位置选择，原授权、后台写入和磁盘结果仍走正式路径。
  await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
        throw Error('仅允许本例 JSON 保存选择');
      return { canceled: false, filePath: output };
    }) as typeof original;
  }, output);
  await button(collectText.export).click();
  const modal = page.getByRole('dialog', { name: collectText.export, exact: true });
  await expect(modal.getByText(collectText.exportRows(2), { exact: true })).toBeVisible();
  await expect(modal.getByRole('gridcell', { name: '记录 1', exact: true })).toHaveCount(0);
  await expect(modal.getByRole('gridcell', { name: '记录 2', exact: true })).toBeVisible();
  await expect(modal.getByRole('gridcell', { name: '记录 101', exact: true })).toBeVisible();
  expect(await tasks()).toEqual(beforeDialog);
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
  await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
  await modal.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
  await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([{ id: '2', name: '记录 2' }, { id: '101', name: '记录 101' }]);
  expect(readFileSync(dbPath)).toEqual(before);

  await rowCheck('2').uncheck();
  await button(collectText.replace).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));
  await (await navigationMenuItem(pane.locator('.toolbar'), { name: browseText.refresh, exact: true })).click();
  await expect(rowCheck('1')).toBeVisible();
  await expect(button(collectText.export)).toBeDisabled();
  await expect(group.getByRole('status')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
