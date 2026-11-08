import { Client } from 'pg';
import type { PostgresRelationMaintenanceAction } from '../../src/shared/postgresRelationMaintenance';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { postgresRelationMaintenanceZh as text } from '../../src/renderer/locales/postgresRelationMaintenance.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
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

async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password }) => (await window.dbark.invoke('connections.save', {
    id: '', name: 'PostgreSQL 日常维护测试', group: '', color: '#123456', dialect: 'postgresql',
    host, port, user, database, password, rememberPassword: false,
  })).id, config);
}

test('PostgreSQL 原生关系维护分析、VACUUM 与重建索引保留行数据', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."维护 表"';
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE ${table}(id int PRIMARY KEY, note text) WITH (autovacuum_enabled=false);
      CREATE INDEX maintenance_note_idx ON ${table}(note);
      INSERT INTO ${table} SELECT n, '旧行-' || n FROM pg_catalog.generate_series(1,50) n;
      DELETE FROM ${table} WHERE id<=5; UPDATE ${table} SET note='新行-'||id`);
    const stats = async () => (await observer.query(`
      SELECT vacuum_count::int AS vacuum, analyze_count::int AS analyze FROM pg_catalog.pg_stat_user_tables
      WHERE relid=pg_catalog.to_regclass($1)
    `, [table])).rows[0];
    const indexes = async () => (await observer.query(`
      SELECT indexrelid::text AS oid, pg_catalog.pg_relation_filenode(indexrelid)::text AS file, indisvalid AS valid
      FROM pg_catalog.pg_index WHERE indrelid=pg_catalog.to_regclass($1) ORDER BY indexrelid
    `, [table])).rows;
    const rows = async () => (await observer.query('SELECT id,note FROM ' + table + ' ORDER BY id')).rows;
    const originalRows = await rows(), originalIndexes = await indexes(), originalStats = await stats();
    const connectionId = await saveConnection(config);
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-maintenance-table', tabs: [
        { id: 'pg-maintenance-table', title: '表维护原表', kind: 'table', connectionId, database, table },
      ] });
    }, { connectionId, database: config.database, table });
    await page.reload();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    await page.getByRole('dialog', { name: structure.title, exact: true }).getByRole('button', { name: text.title, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    const operation = dialog.getByRole('combobox', { name: text.operation, exact: true });
    const prepare = async (action: PostgresRelationMaintenanceAction, sql: string) => {
      await operation.selectOption(action);
      await button(text.preview).click();
      await expect(dialog.getByLabel(text.sql, { exact: true })).toContainText(sql);
    };
    const apply = async () => {
      await button(text.apply).click();
      await expect(button(text.preview)).toBeEnabled();
      await expect(dialog.getByRole('alert')).toHaveCount(0);
    };
    await prepare('analyze', 'ANALYZE ONLY ' + table);
    expect(await stats()).toEqual(originalStats);
    await apply();
    await expect.poll(stats).toEqual({ ...originalStats, analyze: originalStats.analyze + 1 });

    await prepare('vacuum', 'VACUUM (TRUNCATE OFF) ONLY ' + table);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 普通清理预览.png') });
    await apply();
    await expect.poll(stats).toEqual({ vacuum: originalStats.vacuum + 1, analyze: originalStats.analyze + 1 });
    await prepare('vacuumAnalyze', 'VACUUM (ANALYZE, TRUNCATE OFF) ONLY ' + table);
    await apply();
    await expect.poll(stats).toEqual({ vacuum: originalStats.vacuum + 2, analyze: originalStats.analyze + 2 });

    await prepare('reindex', 'REINDEX TABLE ' + table);
    await expect(dialog.getByRole('rowheader', { name: 'maintenance_note_idx', exact: true })).toBeVisible();
    expect(await indexes()).toEqual(originalIndexes);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 重建索引预览.png') });
    await apply();
    const after = await indexes();
    expect(after.map(index => index.oid)).toEqual(originalIndexes.map(index => index.oid));
    expect(after.every((index, i) => index.valid && index.file !== originalIndexes[i].file)).toBe(true);
    expect(await rows()).toEqual(originalRows);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP TABLE ' + table);
  } finally { await observer.end(); }
});

test('PostgreSQL 限权物化视图维护与事务外同名替换保护', async () => {
  const config = isolatedConnection(), observer = new Client(config), user = config.user + '_limited';
  await observer.connect();
  try {
    await observer.query(`CREATE MATERIALIZED VIEW public.maintenance_mv AS SELECT 7 AS id;
      CREATE INDEX maintenance_mv_idx ON public.maintenance_mv (id);
      CREATE TABLE public.maintenance_replaced(id int);
      GRANT SELECT ON public.maintenance_mv, public.maintenance_replaced TO ${postgresIdentifier(user)}`);
    const connectionId = await saveConnection({ ...config, user });
    const input = (table: string) => ({ connectionId, database: config.database, table });
    const mv = input('"public"."maintenance_mv"'), stale = input('"public"."maintenance_replaced"');
    const read = (target: typeof mv) => page.evaluate(input => window.dbark.invoke('postgres.relationMaintenance.read', input), target);
    const preview = async (target: typeof mv, action: PostgresRelationMaintenanceAction) =>
      page.evaluate(input => window.dbark.invoke('postgres.relationMaintenance.preview', input), { ...target, action, stamp: (await read(target)).stamp });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.relationMaintenance.apply', input),
      { connectionId, database: config.database, token, confirmed: true as const });
    expect(Object.values((await read(mv)).actions).every(value => !value)).toBe(true);
    await expect(preview(mv, 'analyze')).rejects.toThrow('维护权限');
    await observer.query(`GRANT MAINTAIN ON public.maintenance_mv, public.maintenance_replaced TO ${postgresIdentifier(user)}`);
    expect(Object.values((await read(mv)).actions).every(Boolean)).toBe(true);
    for (const action of ['analyze', 'reindex', 'vacuum'] as const) {
      const reply = await apply((await preview(mv, action)).token);
      expect(reply, JSON.stringify(reply)).toMatchObject({ outcome: 'committed' });
    }
    expect((await observer.query('SELECT id FROM public.maintenance_mv')).rows).toEqual([{ id: 7 }]);

    const guarded = (await preview(stale, 'vacuum')).token;
    await observer.query('BEGIN; LOCK TABLE ONLY public.maintenance_replaced IN SHARE UPDATE EXCLUSIVE MODE');
    const inflight = apply(guarded).then(reply => ({ reply }), error => ({ error }));
    try {
      await expect.poll(async () => (await observer.query(`
        SELECT bool_or(mode='AccessShareLock' AND granted) AS pinned,
          bool_or(mode='ShareUpdateExclusiveLock' AND NOT granted) AS waiting
        FROM pg_catalog.pg_locks WHERE relation='public.maintenance_replaced'::regclass AND pid<>pg_backend_pid()
      `)).rows[0], { timeout: 3000 }).toEqual({ pinned: true, waiting: true });
    } finally { await observer.query('COMMIT'); }
    expect(await inflight).toMatchObject({ reply: { outcome: 'committed' } });
    await expect.poll(async () => (await observer.query(`SELECT vacuum_count::int AS count
      FROM pg_catalog.pg_stat_user_tables WHERE relid='public.maintenance_replaced'::regclass`)).rows[0].count).toBe(1);

    const { token } = await preview(stale, 'vacuum');
    await observer.query(`ALTER TABLE public.maintenance_replaced RENAME TO maintenance_original;
      CREATE TABLE public.maintenance_replaced(id int);
      GRANT SELECT, MAINTAIN ON public.maintenance_replaced TO ${postgresIdentifier(user)}`);
    expect(await apply(token)).toMatchObject({ outcome: 'notSent' });
    await expect(apply(token)).rejects.toThrow('预览已失效');
    expect((await observer.query(`SELECT sum(vacuum_count)::int AS count FROM pg_catalog.pg_stat_user_tables
      WHERE relname IN ('maintenance_original','maintenance_replaced')`)).rows).toEqual([{ count: 1 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP MATERIALIZED VIEW public.maintenance_mv; DROP TABLE public.maintenance_original, public.maintenance_replaced');
  } finally { await observer.end(); }
});
