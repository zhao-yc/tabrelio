import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { updateSqlCopyZh as text } from '../../src/renderer/locales/updateSqlCopy.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('表格复制 UPDATE SQL 并保留复合主键精度', async ({}, info) => {
  const dialect = process.env.DBARK_COPY_UPDATE_DIALECT;
  test.skip(!dialect, '需要显式启用复制 UPDATE SQL 专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_COPY_UPDATE_DATABASE ?? '';
  const port = Number(process.env.DBARK_COPY_UPDATE_PORT);
  const password = process.env.DBARK_COPY_UPDATE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_up_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'update_subject', filePath = join(await realpath(dataDir), 'copy-update.sqlite');
  const sqliteFixture = "CREATE TABLE update_subject (id INTEGER, scope TEXT, label TEXT, payload BLOB, nullable TEXT," +
    " derived INTEGER AS (length(label)) STORED, PRIMARY KEY(id,scope));" +
    "INSERT INTO update_subject(id,scope,label,payload,nullable) VALUES" +
    " (9007199254740993,'A','row A',X'00ff',NULL),(9007199254740993,'B','row B',X'01','keep'),(9007199254740994,'B','row C',X'','');" +
    'CREATE VIEW update_view AS SELECT * FROM update_subject;';
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      fixture.exec(sqliteFixture);
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof open;
    }, filePath);
    await page.evaluate(async ({ profile, table, database }) => {
      const id = 'update-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'update-table', tabs: [
        { id: 'update-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'update-view', kind: 'table' as const, title: 'update_view', connectionId: connection.id, database, table: 'update_view' }]),
      ] });
    }, { profile, table, database });
    await page.reload();
    await page.evaluate(() => {
      const packets: { text: string; formats: string[] }[] = [];
      // 只收集当前渲染器发出的真实 copy 事件，隔离系统剪贴板。
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制动作');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        packets.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { updateCopyPackets: packets });
    });
    const packets = () => page.evaluate(() => (globalThis as typeof globalThis & {
      updateCopyPackets: { text: string; formats: string[] }[];
    }).updateCopyPackets);
    const copy = async (scope: ReturnType<typeof page.locator>, count: number) => {
      await (await navigationMenuItem(scope, { name: text.action, exact: true })).click();
      const data = await packets();
      expect(data, (await scope.locator('.error-box').allTextContents()).join('\n')).toHaveLength(count);
      expect(data.at(-1)?.formats).toEqual(['text/plain']);
      return data.at(-1)!.text;
    };
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const cell = (label: string) => tableTab.getByRole('gridcell').filter({ hasText: new RegExp('^(TEXT · )?' + label + '$') });
    const rowA = cell('row A'), rowC = cell('row C');
    await expect(rowA).toBeVisible();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const historyBefore = await history();
    await rowA.click();
    const single = await copy(tableTab, 1);
    expect(single.match(/^WHERE /gm)).toHaveLength(1);
    expect(single).toContain('9007199254740993');
    await rowC.locator('..').getByRole('checkbox').check();
    await rowA.locator('..').getByRole('checkbox').check();
    const selected = await copy(tableTab, 2);
    expect(selected.match(/^WHERE /gm)).toHaveLength(2);
    expect(selected).toContain('9007199254740994');
    expect(selected).not.toMatch(/^SET .*derived/m);
    await page.screenshot({ path: info.outputPath('复制UPDATE语句.png') });
    await writeFile(info.outputPath('copied-update.sql'), selected, 'utf8');

    if (local) {
      await open('update-view');
      await expect(rowA).toBeVisible();
      await expect(tableTab.getByRole('button', { name: text.action, exact: true })).toHaveCount(0);
      const replay = new DatabaseSync(':memory:');
      try {
        replay.exec(sqliteFixture + "UPDATE update_subject SET label='before',payload=NULL,nullable=NULL;");
        replay.exec(selected);
        expect(replay.prepare('SELECT scope,label,hex(payload) AS bytes,nullable,derived FROM update_subject ORDER BY id,scope').all()).toEqual([
          { scope: 'A', label: 'row A', bytes: '00FF', nullable: null, derived: 5 },
          { scope: 'B', label: 'before', bytes: '', nullable: null, derived: 6 },
          { scope: 'B', label: 'row C', bytes: '', nullable: '', derived: 5 },
        ]);
      } finally { replay.close(); }
      expect(await readFile(filePath)).toEqual(baseline);
    }
    expect(await history()).toEqual(historyBefore);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
