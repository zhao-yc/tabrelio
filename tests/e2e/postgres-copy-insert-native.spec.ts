import { Client } from 'pg';
import { test, expect, page, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { copyInsertSqlZh as copy } from '../../src/shared/copyInsertSql.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_COPY_INSERT_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表页复制 INSERT SQL 并在隔离事务回放', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    const target = '"public"."copy.insert"';
    await observer.query('CREATE TABLE ' + target + ' (id bigint GENERATED ALWAYS AS IDENTITY (START 9007199254740993) PRIMARY KEY, ' +
      "note text, amount numeric(28,12), raw bytea, size int GENERATED ALWAYS AS (length(note)) STORED); " +
      'CREATE VIEW public.copy_insert_view AS SELECT id, note FROM ' + target);
    await observer.query('INSERT INTO ' + target + ' (note, amount, raw) VALUES ($1, $2, $3), ($4, NULL, $5), (NULL, NULL, NULL)',
      ["Unicode 中文🙂、引号'、反斜线\\与\n换行", '9007199254740993.123456789012', Buffer.from('00ff', 'hex'), '', Buffer.alloc(0)]);
    const read = async () => (await observer.query("SELECT id::text, note, amount::text, encode(raw, 'hex') AS raw, size FROM " + target + ' ORDER BY id')).rows;
    const originals = await read();
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: 'INSERT 复制专项', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database, target }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'copy_insert',
        tabs: [{ id: 'copy_insert', title: '复制 INSERT', kind: 'table', connectionId, database, table: target },
          { id: 'copy_insert_view', title: '只读视图', kind: 'table', connectionId, database, table: '"public"."copy_insert_view"' }] });
    }, { connectionId, database, target });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await expect(cell('9007199254740993')).toBeVisible();
    await page.evaluate(() => {
      // 只接管本测试页面的 copy 事件，原生系统剪贴板不会被覆盖。
      const transfers: DataTransfer[] = [];
      const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('拒绝本例外的命令');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        transfers.push(data);
        return true;
      } });
      Object.assign(globalThis, { pgGridCopies: { transfers, restore() {
        if (original) Object.defineProperty(document, 'execCommand', original);
        else Reflect.deleteProperty(document, 'execCommand');
      } } });
    });
    const captured = () => page.evaluate(() => (globalThis as typeof globalThis & { pgGridCopies: { transfers: DataTransfer[] } })
      .pgGridCopies.transfers.map(data => ({ text: data.getData('text/plain'), typed: data.getData('application/x-dbark-cells') })));
    const first = '9007199254740993', second = '9007199254740994';
    const checked = (id: string) => cell(id).locator('..').getByRole('checkbox');
    await expect(button(copy.current)).toBeDisabled();
    await expect(button(copy.selected)).toBeDisabled();
    const before = await tasks();
    await cell(first).click();
    await button(copy.current).click();
    const [current] = await captured();
    expect(current.text).toContain('INSERT INTO "public"."copy.insert" ("id", "note", "amount", "raw") OVERRIDING SYSTEM VALUE');
    expect(current.text).toContain(first);
    expect(current.text).not.toContain(second);
    expect(current.typed).toBe('');
    await checked(second).check();
    await checked(first).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL表页复制INSERT.png') });
    await button(copy.selected).click();
    const [, batch] = await captured();
    expect(batch.text.startsWith(current.text + '\n')).toBe(true);
    expect(batch.text).toContain(second);
    expect(batch.typed).toBe('');
    await expect(checked(first)).toBeChecked();
    await expect(checked(second)).toBeChecked();
    expect(await tasks()).toEqual(before);
    expect(await read()).toEqual(originals);

    // 独立连接在同一事务里以同名空表回放精确剪贴板文本，结束后撤销这次测试 DDL 和 INSERT。
    await observer.query('BEGIN');
    try {
      await observer.query('SET LOCAL standard_conforming_strings = off; ALTER TABLE ' + target + ' RENAME TO copy_insert_source; ' +
        'CREATE TABLE ' + target + ' (LIKE public.copy_insert_source INCLUDING ALL)');
      await observer.query(batch.text);
      expect(await read()).toEqual(originals.slice(0, 2));
    } finally { await observer.query('ROLLBACK'); }

    const noteCell = cell(originals[0].note);
    await noteCell.click();
    await noteCell.press('F2');
    const editor = page.getByRole('region', { name: table.cellEdit('note'), exact: true });
    await editor.getByLabel(table.valueMode, { exact: true }).selectOption('text');
    await editor.getByLabel(table.value, { exact: true }).fill('仅草稿');
    await editor.getByRole('button', { name: table.stage, exact: true }).click();
    await button(copy.selected).click();
    await expect(page.getByRole('alert').filter({ hasText: copy.draft })).toBeVisible();
    expect(await captured()).toHaveLength(2);
    expect(await read()).toEqual(originals);
    await button(table.discard).click();
    await button(table.next).click();
    await expect(cell('9007199254740995')).toBeVisible();
    await expect(button(copy.selected)).toBeDisabled();
    await expect(button(copy.current)).toBeDisabled();

    await page.locator('[data-workspace-tab-id="copy_insert_view"]').getByRole('button', { name: '只读视图', exact: true }).click();
    await expect(tab.locator('.tab-status')).toContainText(table.noWrite);
    await expect(button(copy.current)).toHaveCount(0);
    await expect(button(copy.selected)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => (globalThis as typeof globalThis & { pgGridCopies: { restore(): void } }).pgGridCopies.restore());
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
