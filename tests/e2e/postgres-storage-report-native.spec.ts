import { Client } from 'pg';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { postgresStorageZh as text } from '../../src/renderer/locales/postgresStorage.zh-CN';
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

async function saveConnection(config: ReturnType<typeof isolatedConnection>, name: string) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name });
}

test('PostgreSQL 原生空间分析核对汇总、分页、分区标签及索引明细', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), schema = '空间."统计区';
  const prefix = postgresIdentifier(schema) + '.', connectionName = 'PostgreSQL 空间分析测试';
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA ${postgresIdentifier(schema)};
      CREATE TABLE ${prefix}report_big(id int PRIMARY KEY, note text);
      CREATE INDEX report_note_idx ON ${prefix}report_big((length(note)));
      INSERT INTO ${prefix}report_big SELECT i, repeat(md5(i::text), 200) FROM pg_catalog.generate_series(1,1200) i;
      CREATE TABLE ${prefix}report_root(id int) PARTITION BY RANGE(id);
      CREATE TABLE ${prefix}report_leaf PARTITION OF ${prefix}report_root FOR VALUES FROM (1) TO (100);
      INSERT INTO ${prefix}report_root VALUES(12);
      CREATE MATERIALIZED VIEW ${prefix}report_mv AS SELECT 1 AS id`);
    await observer.query(Array.from({ length: 50 }, (_, i) => 'CREATE TABLE ' + prefix + 'report_' + String(i).padStart(2, '0') +
      '(id int)').join(';'));
    await observer.query('ANALYZE ' + prefix + 'report_big');
    await observer.query('SELECT pg_catalog.pg_stat_force_next_flush()');
    await expect.poll(async () => (await observer.query(`
      SELECT pg_catalog.pg_stat_get_live_tuples($1::regclass)::text AS live
    `, [prefix + 'report_big'])).rows[0].live).toBe('1200');
    const connectionId = await saveConnection(config, connectionName);
    const target = { connectionId, database: config.database, schema, query: '', sort: 'name' as const, direction: 'asc' as const, page: 1 };
    const report = await page.evaluate(input => window.dbark.invoke('postgres.storage.read', input), target);
    const actual = (await observer.query(`
      SELECT count(*)::int AS count, sum(pg_catalog.pg_table_size(c.oid))::text AS data,
        sum(pg_catalog.pg_indexes_size(c.oid))::text AS indexes, sum(pg_catalog.pg_total_relation_size(c.oid))::text AS total
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname::text=$1 AND c.relkind IN ('r','m')
    `, [schema])).rows[0];
    expect(report.summary).toEqual({ ...actual, count: 53 });
    expect(report.bySchema).toEqual([{ ...actual, schema }]);
    expect(report.rows).toHaveLength(50);
    expect(report.rows[0].name).toBe('report_00');

    await page.reload();
    await page.locator('.connection-row').filter({ hasText: connectionName }).locator('.tree-label').click();
    await clickSidebarAction(page.locator('.database-row').filter({ hasText: config.database }), { name: text.title, exact: true });
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    await dialog.getByRole('combobox', { name: text.schema, exact: true }).selectOption(schema);
    await dialog.getByRole('combobox', { name: text.sort, exact: true }).selectOption('name');
    await dialog.getByRole('combobox', { name: text.direction, exact: true }).selectOption('asc');
    await button(text.apply).click();
    await expect(dialog.getByText(text.page(1, 2), { exact: true })).toBeVisible();
    await expect(dialog.getByRole('rowheader', { name: prefix + '"report_00"', exact: true })).toBeVisible();
    await button(text.next).click();
    await expect(dialog.getByText(text.page(2, 2), { exact: true })).toBeVisible();
    const leaf = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: prefix + '"report_leaf"', exact: true }) });
    await expect(leaf.getByRole('cell', { name: prefix + '"report_root"', exact: true })).toBeVisible();
    await expect(dialog.getByRole('rowheader', { name: prefix + '"report_mv"', exact: true })).toBeVisible();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 空间报告.png') });

    await dialog.getByLabel(text.query, { exact: true }).fill('report_big');
    await button(text.apply).click();
    await expect(dialog.getByText(text.page(1, 1), { exact: true })).toBeVisible();
    await button(text.detail + ' ' + prefix + '"report_big"').click();
    const detail = dialog.getByRole('region', { name: text.details, exact: true });
    await expect(detail.getByRole('rowheader', { name: 'report_note_idx', exact: true })).toBeVisible();
    const expected = (await observer.query(`SELECT pg_catalog.pg_table_size($1::regclass)::text AS bytes`, [prefix + 'report_note_idx'])).rows[0].bytes;
    await expect(detail.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'report_note_idx', exact: true }) }))
      .toContainText(expected + ' B');
    await expect(detail.getByRole('row').filter({ has: page.getByRole('rowheader', { name: text.live, exact: true }) }))
      .toContainText('1200');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 索引空间明细.png') });
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP SCHEMA ' + postgresIdentifier(schema) + ' CASCADE');
  } finally { await observer.end(); }
});

test('PostgreSQL 空间目录限制可见关系并拒绝同名替换后的明细', async () => {
  const config = isolatedConnection(), observer = new Client(config), user = config.user + '_limited';
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA storage_visible;
      CREATE TABLE storage_visible.hidden(id int);
      CREATE TABLE storage_visible.visible(id int);
      CREATE TABLE storage_visible.parent(id int) PARTITION BY RANGE (id);
      CREATE TABLE storage_visible.leaf PARTITION OF storage_visible.parent FOR VALUES FROM (1) TO (10);
      GRANT USAGE ON SCHEMA storage_visible TO ${postgresIdentifier(user)};
      GRANT SELECT ON storage_visible.visible, storage_visible.leaf TO ${postgresIdentifier(user)}`);
    const connectionId = await saveConnection({ ...config, user }, 'PostgreSQL 空间限权测试');
    const target = { connectionId, database: config.database, schema: 'storage_visible', query: '', sort: 'name' as const, direction: 'asc' as const, page: 1 };
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.storage.read', input), target);
    const original = await read();
    expect(original.summary.count).toBe(2);
    expect(original.rows.map(({ name, parent }) => ({ name, parent }))).toEqual([{ name: 'leaf', parent: null }, { name: 'visible', parent: null }]);
    const identity = original.rows[1].identity;
    const detail = () => page.evaluate(input => window.dbark.invoke('postgres.storage.detail', input),
      { connectionId, database: config.database, table: '"storage_visible"."visible"', identity });
    expect((await detail()).row.identity).toBe(identity);
    await observer.query(`ALTER TABLE storage_visible.visible RENAME TO original;
      CREATE TABLE storage_visible.visible(id int); GRANT SELECT ON storage_visible.visible TO ${postgresIdentifier(user)}`);
    await expect(detail()).rejects.toThrow('原关系已变化');
    expect((await read()).rows.find(row => row.name === 'visible')?.identity).not.toBe(identity);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP SCHEMA storage_visible CASCADE');
  } finally { await observer.end(); }
});
