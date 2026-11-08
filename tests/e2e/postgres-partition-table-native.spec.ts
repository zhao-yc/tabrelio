import { Client } from 'pg';
import type { PostgresCreateTableInput } from '../../src/shared/postgresCreateTable';
import { postgresCreateTableZh as text } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { clickSidebarAction } from './sidebar-menu';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(60_000);

function isolatedConnection() {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  return { host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 };
}

const connectionName = 'PostgreSQL 分区建表测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 界面创建 RANGE 父表和初始分区并验证边界路由', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), partition = text.partition;
  await observer.connect();
  try {
    await saveConnection(config);
    await page.reload();
    await page.locator('.connection-row').filter({ hasText: connectionName }).locator('.tree-label').click();
    await clickSidebarAction(page.locator('.database-row').filter({ hasText: config.database }), { name: zh.sidebar.text017, exact: true });
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    await dialog.getByLabel(text.schema, { exact: true }).selectOption('public');
    await dialog.getByLabel(text.table, { exact: true }).fill('分区"父表');
    const field = dialog.getByRole('group', { name: text.field(1), exact: true });
    await field.getByLabel(text.name, { exact: true }).fill('业务日期');
    await field.getByLabel(text.type, { exact: true }).selectOption('date');
    await field.getByRole('checkbox', { name: text.primary, exact: true }).check();
    await dialog.getByLabel(partition.strategy, { exact: true }).selectOption('range');
    await dialog.getByRole('group', { name: partition.keys, exact: true }).getByRole('checkbox', { name: '业务日期', exact: true }).check();
    const add = () => dialog.getByRole('button', { name: partition.add, exact: true }).click();
    await add();
    const range = dialog.getByRole('group', { name: partition.child(1), exact: true });
    await range.getByLabel(partition.name, { exact: true }).fill('十一月');
    await range.getByLabel('业务日期' + partition.from, { exact: true }).fill('2026-11-01');
    await range.getByLabel('业务日期' + partition.to, { exact: true }).fill('2026-12-01');
    await add();
    const fallback = dialog.getByRole('group', { name: partition.child(2), exact: true });
    await fallback.getByLabel(partition.name, { exact: true }).fill('其他月份');
    await fallback.getByRole('checkbox', { name: partition.default, exact: true }).check();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 分区建表设计.png') });
    await dialog.getByRole('button', { name: text.preview, exact: true }).click();
    const sql = dialog.locator('.pg-create-sql');
    await expect(sql).toContainText('PARTITION BY RANGE ("业务日期")');
    await expect(sql).toContainText('PARTITION OF "public"."分区""父表" FOR VALUES FROM');
    await expect(sql).toContainText('PARTITION OF "public"."分区""父表" DEFAULT');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 分区建表预览.png') });
    const parent = '"public"."分区""父表"';
    const state = async () => (await observer.query('SELECT pg_catalog.to_regclass($1)::text AS parent', [parent])).rows[0].parent;
    expect(await state()).toBeNull();
    await dialog.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await state()).not.toBeNull();
    const routed = await observer.query(`
      INSERT INTO ${parent} AS routed VALUES ('2026-10-31'), ('2026-11-01'), ('2026-11-30'), ('2026-12-01')
      RETURNING "业务日期"::text AS day,
        (SELECT relname::text FROM pg_catalog.pg_class WHERE oid = routed.tableoid) AS child
    `);
    expect(routed.rows).toEqual([
      { day: '2026-10-31', child: '其他月份' }, { day: '2026-11-01', child: '十一月' },
      { day: '2026-11-30', child: '十一月' }, { day: '2026-12-01', child: '其他月份' },
    ]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    // 两个用例与同批回归共用隔离库，只清理本例父表及其原生附属分区。
    await observer.query('DROP TABLE ' + parent);
    expect(await state()).toBeNull();
    expect((await observer.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('十一月','其他月份')`)).rows).toEqual([{ count: 0 }]);
  } finally { await observer.end(); }
});

test('PostgreSQL LIST 和 HASH 分区实际路由，范围冲突时整批回滚', async () => {
  const config = isolatedConnection(), observer = new Client(config);
  await observer.connect();
  try {
    const target = { connectionId: await saveConnection(config), database: config.database };
    const column: PostgresCreateTableInput['columns'][number] = { name: 'k', type: 'text', primary: false, unique: false, nullable: true,
      identity: 'none', default: { mode: 'none' }, comment: '' };
    const draft = { ...target, schema: 'public', comment: '', columns: [column] };
    const run = async (input: PostgresCreateTableInput) => {
      const preview = await page.evaluate(draft => window.dbark.invoke('postgres.createTable.preview', draft), input);
      return page.evaluate(draft => window.dbark.invoke('postgres.createTable.apply', draft), { ...target, token: preview.token });
    };
    const value = "值'\\; --";
    expect(await run({ ...draft, table: 'part_list', partition: { strategy: 'list', keys: ['k'],
      children: [{ kind: 'list', name: 'part_list_keys', values: [value, null, ''] }, { kind: 'default', name: 'part_list_other' }] } }))
      .toMatchObject({ outcome: 'committed' });
    const list = await observer.query(`
      INSERT INTO public.part_list VALUES ($1), (NULL), (''), ('其他')
      RETURNING k, (SELECT relname::text FROM pg_catalog.pg_class WHERE oid = part_list.tableoid) AS child
    `, [value]);
    expect(list.rows).toEqual([
      { k: value, child: 'part_list_keys' }, { k: null, child: 'part_list_keys' },
      { k: '', child: 'part_list_keys' }, { k: '其他', child: 'part_list_other' },
    ]);
    expect(await run({ ...draft, table: 'part_hash', columns: [{ ...column, type: 'integer' }, { ...column, name: 'tag' }],
      partition: { strategy: 'hash', keys: ['tag', 'k'], children: [
        { kind: 'hash', name: 'part_hash_0', modulus: 2, remainder: 0 },
        { kind: 'hash', name: 'part_hash_1', modulus: 2, remainder: 1 },
      ] } })).toMatchObject({ outcome: 'committed' });
    expect((await observer.query(`SELECT pg_catalog.pg_get_partkeydef('public.part_hash'::regclass) AS key`)).rows)
      .toEqual([{ key: 'HASH (tag, k)' }]);
    await observer.query("INSERT INTO public.part_hash SELECT n, 'row-' || n FROM pg_catalog.generate_series(1,100) n");
    const hash = (await observer.query('SELECT tableoid::regclass::text AS child, count(*)::int AS count FROM public.part_hash GROUP BY tableoid ORDER BY child')).rows;
    expect(hash.map(row => row.child)).toEqual(['part_hash_0', 'part_hash_1']);
    expect(hash.reduce((sum, row) => sum + row.count, 0)).toBe(100);
    const bound = (value: string) => [{ kind: 'value' as const, value }];
    expect(await run({ ...draft, table: 'part_overlap', columns: [{ ...column, type: 'integer' }],
      partition: { strategy: 'range', keys: ['k'], children: [
        { kind: 'range', name: 'part_overlap_a', from: bound('1'), to: bound('10') },
        { kind: 'range', name: 'part_overlap_b', from: bound('9'), to: bound('20') },
      ] } })).toMatchObject({ outcome: 'rolledBack', message: expect.stringMatching(/overlap/i) });
    expect((await observer.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('part_overlap','part_overlap_a','part_overlap_b')`)).rows)
      .toEqual([{ count: 0 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP TABLE public.part_list, public.part_hash');
    expect((await observer.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN
        ('part_list','part_list_keys','part_list_other','part_hash','part_hash_0','part_hash_1')`)).rows).toEqual([{ count: 0 }]);
  } finally { await observer.end(); }
});
