import { Client } from 'pg';
import { expect, page, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { postgresPrimaryKeyCopyZh as text } from '../../src/renderer/locales/postgresPrimaryKeyCopy.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_COPY_PRIMARY_KEY_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 按复合原主键复制查询，精确匹配继承父表及分区', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  const target = '"public"."key.table"';
  const part = '"public"."key_partition"';
  try {
    await observer.connect();
    await observer.query('CREATE TABLE ' + target + ' ("i""d" bigint, scope text, raw bytea, note text, PRIMARY KEY(scope,raw,"i""d")); ' +
      'CREATE TABLE public.key_child () INHERITS (' + target + '); ' +
      'CREATE VIEW public.key_view AS SELECT * FROM ' + target + '; ' +
      'CREATE TABLE public.keyless (note text); INSERT INTO public.keyless VALUES (\'没有主键\'); ' +
      'CREATE TABLE ' + part + ' (id bigint PRIMARY KEY, note text) PARTITION BY RANGE(id); ' +
      'CREATE TABLE public.key_partition_low PARTITION OF ' + part + ' FOR VALUES FROM (0) TO (100); ' +
      'CREATE TABLE public.key_partition_high PARTITION OF ' + part + ' FOR VALUES FROM (100) TO (200); ' +
      'INSERT INTO ' + part + " VALUES (1, '低分区'), (101, '高分区')");
    const scope = "多字节🙂'\\";
    const first = '9007199254740993', second = '9007199254740994';
    const raw = Buffer.from('00ff', 'hex');
    for (const [id, key, bytes, note] of [
      [first, scope, raw, '目标甲'], [second, scope, raw, '交叉键甲'],
      [first, 'zz', Buffer.alloc(0), '交叉键乙'], [second, 'zz', Buffer.alloc(0), '目标乙'],
    ]) await observer.query('INSERT INTO ' + target + ' VALUES ($1,$2,$3,$4)', [id, key, bytes, note]);
    await observer.query('INSERT INTO public.key_child VALUES ($1,$2,$3,$4)', [first, scope, raw, '继承重号']);
    // 使用真实数据库执行原样复制文本，额外核对显式 E 字符串不受该会话设置影响。
    await observer.query('SET standard_conforming_strings = off');

    const connection = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '主键复制专项', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connection, database, target, part }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'original', tabs: [
        { id: 'original', title: '复合主键', table: target },
        { id: 'partition', title: '分区主键', table: part },
        { id: 'view', title: '只读视图', table: '"public"."key_view"' },
        { id: 'keyless', title: '无主键', table: '"public"."keyless"' },
      ].map(item => ({ ...item, database, kind: 'table' as const, connectionId: connection })) });
    }, { connection, database, target, part });
    await page.reload();
    await page.evaluate(() => {
      const captures: { text: string; formats: string[] }[] = [];
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        captures.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { postgresKeyCopies: captures });
    });
    const captured = () => page.evaluate(() => (globalThis as typeof globalThis & {
      postgresKeyCopies: { text: string; formats: string[] }[];
    }).postgresKeyCopies);
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const check = (name: string) => cell(name).locator('..').getByRole('checkbox');
    const button = tab.getByRole('button', { name: text.action, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const open = (id: string, title: string) =>
      page.locator('[data-workspace-tab-id="' + id + '"]').getByRole('button', { name: title, exact: true }).click();
    await expect(cell('目标甲')).toBeVisible();
    await expect(cell('继承重号')).toHaveCount(0);
    await expect(button).toBeDisabled();
    const before = await tasks();
    await cell('目标甲').click();
    await button.click();
    const [single] = await captured();
    expect(single.formats).toEqual(['text/plain']);
    expect(single.text).toContain('SELECT * FROM ONLY ' + target);
    expect((await observer.query(single.text)).rows.map(row => row.note)).toEqual(['目标甲']);

    await check('目标乙').check();
    await check('目标甲').check();
    await cell('交叉键乙').click();
    await page.screenshot({ path: info.outputPath('PostgreSQL原主键查询复制.png') });
    await button.click();
    const [, batch] = await captured();
    expect(batch.formats).toEqual(['text/plain']);
    expect(batch.text).toContain('"scope" = ');
    expect(batch.text).toContain(' AND "i""d" = ');
    expect((await observer.query(batch.text)).rows.map(row => row.note).sort()).toEqual(['目标乙', '目标甲']);
    expect(await tasks()).toEqual(before);

    // 草稿只修改显示值，复制仍从同一原页主键读取。
    await check('目标乙').uncheck();
    await check('目标甲').uncheck();
    await cell('目标甲').click();
    await cell('目标甲').press('F2');
    const editor = page.getByRole('region', { name: table.cellEdit('note'), exact: true });
    await editor.getByLabel(table.valueMode, { exact: true }).selectOption('text');
    await editor.getByLabel(table.value, { exact: true }).fill('本地草稿');
    await editor.getByRole('button', { name: table.stage, exact: true }).click();
    await cell('本地草稿').click();
    await button.click();
    expect((await captured()).at(-1)).toEqual(single);
    await tab.getByRole('button', { name: table.discard, exact: true }).click();

    await open('partition', '分区主键');
    await check('低分区').check();
    await check('高分区').check();
    await button.click();
    const partition = (await captured()).at(-1)!;
    expect(partition.text).toContain('SELECT * FROM ' + part);
    expect((await observer.query(partition.text)).rows.map(row => row.note).sort()).toEqual(['低分区', '高分区']);
    await open('view', '只读视图');
    await expect(cell('继承重号')).toBeVisible();
    await expect(button).toHaveCount(0);
    await open('keyless', '无主键');
    await expect(cell('没有主键')).toBeVisible();
    await expect(button).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
