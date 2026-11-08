import { Client } from 'pg';
import { test, expect, page, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { tableHeaderCopyZh as copy } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';
import { decodeClipboard, parseTabularText } from '../../src/renderer/gridClipboard';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_GRID_COPY_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表和视图按当前页复制，保留草稿与类型化数据', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.copy_rows (id bigint PRIMARY KEY, note text DEFAULT '默认', raw bytea);
      INSERT INTO public.copy_rows SELECT 9007199254740992 + g, '记录 ' || g, decode('00ff','hex') FROM generate_series(1,75) g;
      CREATE VIEW public.copy_view AS SELECT note, id FROM public.copy_rows ORDER BY id`);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '表格复制专项', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 60, activeTabId: 'copy_rows',
        tabs: ['copy_rows', 'copy_view'].map(name => ({ id: name, title: name, kind: 'table' as const,
          connectionId, database, table: '"public"."' + name + '"' })) });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await expect(cell('记录 1')).toBeVisible();
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
    const stageNote = async (from: string, mode: 'text' | 'null' | 'default', value = '') => {
      await cell(from).click();
      await cell(from).press('F2');
      const editor = page.getByRole('region', { name: table.cellEdit('note'), exact: true });
      await editor.getByLabel(table.valueMode, { exact: true }).selectOption(mode);
      if (mode === 'text') await editor.getByRole('textbox', { name: table.value, exact: true }).fill(value);
      await editor.getByRole('button', { name: table.stage, exact: true }).click();
    };
    await expect(button(copy.column)).toBeDisabled();
    const before = await tasks();
    await cell('记录 1').click();
    await expect(cell('记录 60')).toHaveCount(0);
    await button(copy.column).click();
    const [column] = await captured();
    expect(decodeClipboard(column.typed, column.text)).toEqual(Array.from({ length: 60 }, (_, index) => ['记录 ' + (index + 1)]));
    await stageNote('记录 1', 'text', '草稿\t含分隔符');
    await stageNote('记录 2', 'null');
    for (const id of ['9007199254740994', '9007199254740993']) await cell(id).locator('..').getByRole('checkbox').check();
    await page.screenshot({ path: info.outputPath('PostgreSQL表页复制.png') });
    await button(copy.action).click();
    const [, headers] = await captured();
    expect(parseTabularText(headers.text)).toEqual([
      ['id', 'note', 'raw'], ['9007199254740993', '草稿\t含分隔符', '0x00ff'], ['9007199254740994', 'NULL', '0x00ff'],
    ]);
    const binary = { type: 'binary', base64: 'AP8=' };
    expect(decodeClipboard(headers.typed, headers.text)).toEqual([
      ['9007199254740993', '草稿\t含分隔符', binary], ['9007199254740994', null, binary],
    ]);
    await stageNote('NULL', 'default');
    await button(copy.action).click();
    await expect(page.getByRole('alert').filter({ hasText: table.gridDraftDefaultCopy })).toBeVisible();
    expect(await captured()).toHaveLength(2);
    expect(await tasks()).toEqual(before);
    expect((await observer.query('SELECT note FROM public.copy_rows ORDER BY id LIMIT 2')).rows)
      .toEqual([{ note: '记录 1' }, { note: '记录 2' }]);
    await button(table.discard).click();
    await page.locator('[data-workspace-tab-id="copy_view"]').getByRole('button', { name: 'copy_view', exact: true }).click();
    await expect(tab.locator('.tab-status')).toContainText(table.noWrite);
    await cell('记录 1').click();
    await button(copy.action).click();
    const view = (await captured()).at(-1)!;
    expect(view.text).toBe('note\n记录 1');
    expect(decodeClipboard(view.typed, view.text)).toEqual([['记录 1']]);
    await page.evaluate(() => (globalThis as typeof globalThis & { pgGridCopies: { restore(): void } }).pgGridCopies.restore());
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
