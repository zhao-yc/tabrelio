import { dataCompareMappingZh as mapping } from '../../src/renderer/locales/dataCompareMapping.zh-CN';
import { dataCompareBatchZh as batch } from '../../src/renderer/locales/dataCompareBatch.zh-CN';
import { dataCompareBatchProfilesZh as batchProfiles, dataCompareProfilesZh as profiles } from '../../src/renderer/locales/dataCompareProfiles.zh-CN';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { mysqlDataCompareZh as text } from '../../src/shared/mysqlDataCompare';
import { postgresDataSyncZh as sync } from '../../src/shared/postgresDataCompare';
import { mysqlBatchSyncZh as batchSync } from '../../src/renderer/locales/sqliteBatchSync.zh-CN';

test.skip(process.env.DBARK_MYSQL_DATA_SYNC_NATIVE !== '1', '仅运行隔离 MySQL／MariaDB 数据同步');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('MySQL 与 MariaDB 对两端同步所选差异并确认冲突回滚', async ({}, info) => {
  const user = process.env.DBARK_COMPARE_USER ?? '', password = process.env.DBARK_COMPARE_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_COMPARE_MYSQL_PORT), mariaPort = Number(process.env.DBARK_COMPARE_MARIA_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
      mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离源码和双端回环实库');
  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const database = user + '_a', mirror = user + '_b', writer = user + '_writer', max = '18446744073709551615';
  const connect = (port: number) => mysql.createConnection({ host: '127.0.0.1', port, user: writer, password });
  const left = await connect(mysqlPort), right = await connect(mariaPort);
  const values = async (connection: typeof left, db: string, table: string) => (await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(raw) AS raw,note,conflict_value FROM ' + db + '.' + table + ' ORDER BY ' + table + '.id'
  ))[0];
  try {
    for (const [dialect, port] of [['mysql', mysqlPort], ['mariadb', mariaPort]] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(dialect);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(writer);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const side = (label: string, key: string) => modal.getByLabel(label + key, { exact: true });
    const choose = async (label: string, connection: string, db: string, table: string) => {
      await side(label, text.connection).selectOption({ label: connection });
      await side(label, text.database).selectOption(db);
      await side(label, text.table).selectOption(table);
    };
    const run = modal.getByRole('button', { name: text.run, exact: true });
    const summary = modal.getByRole('status').filter({ hasText: text.key });
    const preview = modal.getByRole('button', { name: sync.preview, exact: true });
    const apply = modal.getByRole('button', { name: sync.apply, exact: true });
    const confirm = modal.getByLabel(sync.confirm, { exact: true });
    const committed = modal.getByRole('status').filter({ hasText: '已确认整批提交' });
    const mark = async (kind: string, key: string) => {
      await modal.getByLabel(text.kind, { exact: true }).selectOption(kind);
      await modal.getByRole('checkbox', { name: sync.select + ' "' + key + '"', exact: true }).check();
    };
    const compare = async () => { await run.click(); await expect(summary).toContainText('字段值不同 27'); };
    const target = '`' + database + '`.`ledger`';
    await choose(text.source, 'mysql', database, 'ledger');
    await choose(text.target, 'mariadb', database, 'ledger');
    await modal.getByText(mapping.title, { exact: true }).click();
    const mapField = async (source: string, target: string, key: boolean) => {
      await modal.getByLabel(mapping.source, { exact: true }).selectOption(source);
      await modal.getByLabel(mapping.target, { exact: true }).selectOption(target);
      await modal.getByRole('button', { name: mapping.add, exact: true }).click();
      if (key) await modal.getByRole('checkbox', { name: mapping.key + ' ' + source, exact: true }).check();
    };
    await mapField('id', 'id', true);
    await mapField('raw', 'raw', false);
    await run.click();
    await expect(modal.getByRole('status').filter({ hasText: mapping.keyLabel })).toContainText('相同 26 · 仅左侧 1 · 仅右侧 1 · 字段值不同 1');
    await expect(preview).toBeDisabled();
    await modal.getByRole('row').filter({ hasText: max }).getByRole('button', { name: text.details, exact: true }).click();
    const mappedDetails = modal.getByRole('group', { name: text.details, exact: true });
    await expect(mappedDetails).toContainText('raw → raw');
    await expect(mappedDetails).toContainText('AP+A');
    await expect(mappedDetails).toContainText('AP+B');
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB字段映射.png') });
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    const mappedOverview = page.getByRole('dialog', { name: batch.title, exact: true });
    await expect(mappedOverview.getByRole('button', { name: batch.customFields(2), exact: true })).toBeVisible();
    await mappedOverview.getByRole('button', { name: batch.run, exact: true }).click();
    await expect(mappedOverview.getByRole('table', { name: batch.result, exact: true })).toContainText('相同 26 · 仅左侧 1 · 仅右侧 1 · 字段值不同 1');
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB多表字段映射.png') });
    await mappedOverview.getByRole('button', { name: batch.return, exact: true }).click();
    await modal.getByText(mapping.title, { exact: true }).click();
    await modal.getByRole('button', { name: mapping.reset, exact: true }).click();
    await modal.getByText(mapping.title, { exact: true }).click();
    const original = await values(right, database, 'ledger'), mysqlOriginal = await values(left, database, 'ledger');
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    const overview = page.getByRole('dialog', { name: batch.title, exact: true });
    const profilePanel = overview.locator('details').filter({ hasText: batchProfiles.title });
    await overview.getByText(batchProfiles.title, { exact: true }).click();
    await profilePanel.getByLabel(batchProfiles.name, { exact: true }).fill('日常校验');
    await profilePanel.getByRole('button', { name: batchProfiles.add, exact: true }).click();
    await expect(profilePanel.getByText(batchProfiles.saved, { exact: true })).toBeVisible();
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await profilePanel.getByRole('button', { name: batchProfiles.apply, exact: true }).click();
    await expect(profilePanel.getByText(batchProfiles.applied, { exact: true })).toBeVisible();
    await expect(overview.getByText(batch.pending, { exact: true })).toHaveCount(1);
    await overview.getByRole('button', { name: batch.run, exact: true }).click();
    await expect(overview.getByRole('row').filter({ hasText: 'ledger' })).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB多表方案.png') });
    expect(await values(left, database, 'ledger')).toEqual(mysqlOriginal);
    expect(await values(right, database, 'ledger')).toEqual(original);
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    await compare();
    await modal.getByText(profiles.title, { exact: true }).click();
    await modal.getByLabel(profiles.name, { exact: true }).fill('双向检查');
    await modal.getByRole('button', { name: profiles.add, exact: true }).click();
    await expect(modal.getByText(profiles.saved, { exact: true })).toBeVisible();
    await mark('source-only', '101');
    const swap = modal.getByRole('button', { name: profiles.swap, exact: true });
    await swap.click();
    await expect(summary).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    await compare();
    await mark('source-only', '102');
    await preview.click();
    await expect(swap).toBeDisabled();
    await expect(modal.getByRole('button', { name: profiles.apply, exact: true })).toBeDisabled();
    await modal.getByRole('button', { name: sync.back, exact: true }).click();
    await modal.getByRole('button', { name: profiles.apply, exact: true }).click();
    await expect(modal.getByText(profiles.applied, { exact: true })).toBeVisible();
    await expect(preview).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB比较方案.png') });
    await compare();
    await mark('source-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('整批已回滚：目标唯一约束冲突');
    expect(await values(right, database, 'ledger')).toEqual(original);

    await compare();
    await mark('different', max);
    await preview.click();
    await right.query('UPDATE ' + database + '.ledger SET note=\'并发改值\' WHERE id=' + max);
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('右侧原值已变化');
    expect((await values(right, database, 'ledger')).at(-1)?.note).toBe('并发改值');
    await right.query('UPDATE ' + database + ".ledger SET note='' WHERE id=" + max);

    await compare();
    await mark('source-only', '101'); await mark('target-only', '102'); await mark('different', max);
    await preview.click();
    const review = modal.getByRole('group', { name: sync.preview, exact: true });
    await expect(review.getByRole('listitem')).toHaveText(['插入　"101"', '删除　"102"', '更新　"' + max + '"']);
    await confirm.fill('`' + mirror + '`.`mirror`');
    await expect(apply).toBeDisabled();
    await confirm.fill(target);
    await expect(review).toBeInViewport({ ratio: 0.9 });
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB差异同步.png') });
    await apply.click();
    await expect(committed).toBeVisible();
    const mariaAfter = await values(right, database, 'ledger');
    expect(mariaAfter).toEqual([...original.slice(0, 26), mysqlOriginal[26], mysqlOriginal[27]]);
    expect(await values(left, database, 'ledger')).toEqual(mysqlOriginal);
    await run.click();
    await expect(summary).toContainText('相同 2 · 仅左侧 0 · 仅右侧 0 · 字段值不同 26');

    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mysql', database, 'ledger');
    await compare();
    await mark('source-only', '102'); await mark('target-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(committed).toBeVisible();
    expect(await values(left, database, 'ledger')).toEqual([...mysqlOriginal.slice(0, 26), original[26], original[27]]);

    // 目标已被另一张表引用时，级联不能越过选择范围。
    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mysql', database, 'guard_parent');
    await compare();
    await mark('target-only', '101');
    await preview.click();
    await confirm.fill('`' + database + '`.`guard_parent`');
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText(/外键|依赖/);
    expect((await values(left, database, 'guard_parent')).find(row => row.id === '101')).toEqual(mysqlOriginal[26]);
    expect((await left.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS id FROM ' + database + '.guard_child'))[0]).toEqual([{ id: '101' }]);

    // 同连接跨库复验，预览后新增的触发器必须在目标锁内拦截。
    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mariadb', database, 'ledger');
    const compareWithin = async () => { await run.click(); await expect(summary).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 1'); };
    await compareWithin();
    await mark('different', max);
    await preview.click();
    await right.query('CREATE TRIGGER ' + database + '.guard_sync BEFORE UPDATE ON ' + database + ".ledger FOR EACH ROW SET NEW.note='意外触发'");
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('触发器');
    expect(await values(right, database, 'ledger')).toEqual(mariaAfter);
    await right.query('DROP TRIGGER ' + database + '.guard_sync');

    await compareWithin();
    await expect(modal.getByText(text.shared, { exact: true })).toBeVisible();
    await mark('source-only', '102'); await mark('target-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(committed).toBeVisible();
    expect(await values(right, database, 'ledger')).toEqual(original);

    // 第一张表允许写入，第二张表保留的右侧记录触发唯一约束，核验前一张表也回滚。
    for (const client of [left, right]) await client.query('UPDATE ' + mirror + '.mirror SET conflict_value=NULL WHERE conflict_value=55');
    await right.query('UPDATE ' + mirror + ".mirror SET note='左' WHERE id BETWEEN 1 AND 26");
    await left.query('INSERT INTO ' + mirror + ".mismatched (id,amount,raw,note,conflict_value) VALUES (201,'左值',X'00FF80','新增',55)");
    await right.query('INSERT INTO ' + mirror + ".mismatched (id,amount,raw,note,conflict_value) VALUES (202,'右值',X'00FF81','仅右',55)");
    const readBatch = async (client: typeof left) => Promise.all(['mirror', 'mismatched'].map(table => values(client, mirror, table)));
    const sourceBatch = await readBatch(left), originalBatch = await readBatch(right);
    await choose(text.source, 'mysql', mirror, 'mirror');
    await choose(text.target, 'mariadb', mirror, 'mirror');
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    await overview.getByLabel(batch.source, { exact: true }).selectOption('mismatched');
    await overview.getByLabel(batch.target, { exact: true }).selectOption('mismatched');
    await overview.getByRole('button', { name: batch.add, exact: true }).click();
    const prepareBatch = overview.getByRole('button', { name: batchSync.preview, exact: true });
    const applyBatch = overview.getByRole('button', { name: batchSync.apply, exact: true });
    const batchReview = overview.getByRole('group', { name: batchSync.previewTitle, exact: true });
    const batchConfirm = overview.getByLabel(sync.confirm, { exact: true });
    const deleteBatch = overview.getByRole('checkbox', { name: sync.delete, exact: true });
    const exactBatch = '`' + mirror + '`.`mirror` 等 2 张表';
    const confirmBatch = async () => { await batchConfirm.fill(exactBatch); await applyBatch.click(); };
    await expect(deleteBatch).not.toBeChecked();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 1 · 删除 0');
    await expect(batchReview).toContainText('更新　"' + max + '"');
    expect(await readBatch(right)).toEqual(originalBatch);
    await batchConfirm.fill('`' + mirror + '`.`mirror`');
    await expect(applyBatch).toBeDisabled();
    await confirmBatch();
    await expect(overview.getByRole('alert')).toContainText('整批已回滚：目标唯一约束冲突（`' + mirror + '`.`mismatched`）');
    expect(await readBatch(right)).toEqual(originalBatch);

    await deleteBatch.check();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 1 · 删除 2');
    await right.query('UPDATE ' + mirror + ".mismatched SET note='并发改值' WHERE id=202");
    const concurrentBatch = await readBatch(right);
    await confirmBatch();
    await expect(overview.getByRole('alert')).toContainText('右侧原值已变化');
    expect(await readBatch(right)).toEqual(concurrentBatch);
    await right.query('UPDATE ' + mirror + ".mismatched SET note='仅右' WHERE id=202");

    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 1 · 删除 2');
    await batchConfirm.fill(exactBatch);
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB多表事务同步.png') });
    await applyBatch.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(await readBatch(right)).toEqual(sourceBatch);
    expect(await readBatch(left)).toEqual(sourceBatch);
    await prepareBatch.click();
    await expect(overview.getByRole('status')).toHaveText(batchSync.noChanges);

    // 换向后右侧由 MySQL 承担事务，并保留 MariaDB 来源表的原值。
    await right.query('UPDATE ' + mirror + ".mirror SET note='反向更新' WHERE id=1");
    await right.query('UPDATE ' + mirror + ".mismatched SET amount='反向精确文本' WHERE id=201");
    const reverseBatch = await readBatch(right);
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 0 · 更新 2 · 删除 0');
    await confirmBatch();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(await readBatch(left)).toEqual(reverseBatch);
    expect(await readBatch(right)).toEqual(reverseBatch);
    await overview.getByRole('button', { name: batch.return, exact: true }).click();

    // 专项夹具的两张表没有主键，大小写不同的文本键也按比较的精确原值区分。
    const mappedLeft = mirror + '.mapped_left', mappedRight = mirror + '.mapped_right';
    await left.query('INSERT INTO ' + mappedLeft + " (code,seq,raw,conflict_token) VALUES ('Key'," + max + ",X'00FF80',70)");
    await right.query('INSERT INTO ' + mappedRight + " (identifier,serial,payload,reserved) VALUES ('Key'," + max + ",X'00FF81',70)");
    const readMappedRight = async () => (await right.query<RowDataPacket[]>('SELECT identifier AS code,CAST(serial AS CHAR) AS seq,' +
      'HEX(payload) AS raw,reserved AS token,local_note FROM ' + mappedRight + ' ORDER BY BINARY identifier, local_note'))[0];
    const readMappedLeft = async () => (await left.query<RowDataPacket[]>('SELECT code,CAST(seq AS CHAR) AS seq,' +
      'HEX(raw) AS raw,conflict_token AS token,local_note FROM ' + mappedLeft + ' ORDER BY BINARY code'))[0];
    await choose(text.source, 'mysql', mirror, 'mapped_left');
    await choose(text.target, 'mariadb', mirror, 'mapped_right');
    if (!await modal.getByLabel(mapping.source, { exact: true }).isVisible()) await modal.getByText(mapping.title, { exact: true }).click();
    const fieldPairs = [['code', 'identifier', true], ['seq', 'serial', true],
      ['raw', 'payload', false], ['conflict_token', 'reserved', false]] as const;
    for (const [source, targetField, key] of fieldPairs) await mapField(source, targetField, key);
    const mappedKey = '"Key" / "' + max + '"';
    const prepareMapped = async () => {
      await run.click();
      await expect(modal.getByRole('status').filter({ hasText: mapping.keyLabel })).toContainText('字段值不同 1');
      await modal.getByRole('checkbox', { name: sync.select + ' ' + mappedKey, exact: true }).check();
      await preview.click();
      await expect(modal.getByRole('group', { name: sync.preview, exact: true })).toContainText('更新　' + mappedKey);
      await confirm.fill('`' + mirror + '`.`mapped_right`');
    };
    await prepareMapped();
    await right.query('UPDATE ' + mappedRight + " SET local_note='右侧并发编辑'");
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('右侧映射键重复或原值已变化');
    expect(await readMappedRight()).toEqual([{ code: 'Key', seq: max, raw: '00FF81', token: 70, local_note: '右侧并发编辑' }]);
    await prepareMapped();
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB自定义字段单表同步.png') });
    await apply.click();
    await expect(committed).toBeVisible();
    expect(await readMappedRight()).toEqual([{ code: 'Key', seq: max, raw: '00FF80', token: 70, local_note: '右侧并发编辑' }]);

    await left.query('UPDATE ' + mappedLeft + " SET raw=X'00FF84' WHERE BINARY code=BINARY 'Key'");
    await left.query('INSERT INTO ' + mappedLeft + " (code,seq,raw,conflict_token) VALUES ('new',2,X'00FF83',72)");
    await right.query('INSERT INTO ' + mappedRight + " (identifier,serial,payload,reserved) VALUES ('key'," + max + ",X'00FF82',77)");
    await left.query('UPDATE ' + mirror + ".mirror SET note='新一轮' WHERE id=1");
    await left.query('INSERT INTO ' + mirror + ".mirror(id,note,conflict_value) VALUES (311,'新增',71)");
    await right.query('INSERT INTO ' + mirror + ".mirror(id,note,conflict_value) VALUES (312,'仅右',71)");
    const mappedOriginal = await readMappedRight(), mirrorOriginal = await values(right, mirror, 'mirror');
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    await overview.getByLabel(batch.source, { exact: true }).selectOption('mirror');
    await overview.getByLabel(batch.target, { exact: true }).selectOption('mirror');
    await overview.getByRole('button', { name: batch.add, exact: true }).click();
    await expect(overview.getByRole('button', { name: batch.customFields(4), exact: true })).toBeVisible();
    const mappedExact = '`' + mirror + '`.`mapped_right` 等 2 张表';
    const confirmMapped = async (table = mappedExact) => { await batchConfirm.fill(table); await applyBatch.click(); };
    await expect(deleteBatch).not.toBeChecked();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 2 · 删除 0');
    await confirmMapped();
    await expect(overview.getByRole('alert')).toContainText('整批已回滚：目标唯一约束冲突（`' + mirror + '`.`mirror`）');
    expect(await readMappedRight()).toEqual(mappedOriginal);
    expect(await values(right, mirror, 'mirror')).toEqual(mirrorOriginal);

    await deleteBatch.check();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 2 · 删除 2');
    await right.query('INSERT INTO ' + mappedRight + " (identifier,serial,payload,local_note) VALUES ('Key'," + max + ",X'FF','并发重复')");
    const concurrentMapped = await readMappedRight();
    await confirmMapped();
    await expect(overview.getByRole('alert')).toContainText('右侧映射键重复或原值已变化');
    expect(await readMappedRight()).toEqual(concurrentMapped);
    expect(await values(right, mirror, 'mirror')).toEqual(mirrorOriginal);
    await right.query('DELETE FROM ' + mappedRight + " WHERE local_note='并发重复'");

    // 第二张表的行锁把执行停在首条 DML 前，此时另一连接不能向第一张无主键表插入新键。
    const checkGap = async (server: typeof left, port: number, table: string, insert: string, confirmation: string) => {
      const probe = await connect(port);
      await server.query('START TRANSACTION');
      try {
        await server.query('SELECT id FROM ' + mirror + '.mirror WHERE id=1 FOR UPDATE');
        await confirmMapped(confirmation);
        const waiting = async () => Number((await server.query<RowDataPacket[]>(
          "SELECT count(*) AS total FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO LIKE ?",
          ['%`mirror`%FOR UPDATE'],
        ))[0][0].total);
        await expect.poll(waiting, { timeout: 3500 }).toBe(1);
        await probe.query('SET SESSION innodb_lock_wait_timeout=1');
        await expect(probe.query('INSERT INTO ' + table + insert)).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
      } finally { await Promise.allSettled([server.query('ROLLBACK'), probe.end()]); }
      await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    };
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 2 · 更新 2 · 删除 2');
    await batchConfirm.fill(mappedExact);
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB自定义字段多表同步.png') });
    await checkGap(right, mariaPort, mappedRight, " (identifier,serial) VALUES ('插入探针',3)", mappedExact);
    expect(await readMappedRight()).toEqual([
      { code: 'Key', seq: max, raw: '00FF84', token: 70, local_note: '右侧并发编辑' },
      { code: 'new', seq: '2', raw: '00FF83', token: 72, local_note: '目标默认' },
    ]);
    expect(await values(right, mirror, 'mirror')).toEqual(await values(left, mirror, 'mirror'));
    await prepareBatch.click();
    await expect(overview.getByRole('status')).toHaveText(batchSync.noChanges);

    // 反向复用相同业务键和字段映射，让 MySQL 承担无主键目标写入及间隙锁。
    await right.query('UPDATE ' + mappedRight + " SET payload=X'00FF85' WHERE BINARY identifier=BINARY 'Key'");
    await right.query('UPDATE ' + mirror + ".mirror SET note='再次换向' WHERE id=1");
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 0 · 更新 2 · 删除 0');
    await checkGap(left, mysqlPort, mappedLeft, " (code,seq) VALUES ('插入探针',3)", '`' + mirror + '`.`mapped_left` 等 2 张表');
    expect(await readMappedLeft()).toEqual([
      { code: 'Key', seq: max, raw: '00FF85', token: 70, local_note: '来源默认' },
      { code: 'new', seq: '2', raw: '00FF83', token: 72, local_note: '来源默认' },
    ]);
    expect(await values(left, mirror, 'mirror')).toEqual(await values(right, mirror, 'mirror'));
    const mappedBeforeSelection = await readMappedLeft();
    await right.query('UPDATE ' + mappedRight + " SET payload=X'88' WHERE BINARY identifier=BINARY 'new'");
    await right.query('UPDATE ' + mirror + ".mirror SET note='仅同步这张表' WHERE id=1");
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 0 · 更新 2 · 删除 0');
    await batchReview.getByRole('button', { name: batchSync.clearTable + ' `' + mirror + '`.`mapped_left`', exact: true }).click();
    await expect(batchReview).toContainText('插入 0 · 更新 1 · 删除 0');
    const mirrorUpdate = batchReview.getByRole('listitem').filter({ hasText: '更新　"1"' });
    await mirrorUpdate.getByText(batchSync.details, { exact: true }).click();
    const inspected = batchReview.getByRole('group', { name: batchSync.detailHeading, exact: true }).getByRole('row').filter({ hasText: 'note' });
    await expect(inspected).toContainText('仅同步这张表');
    await batchConfirm.fill('`' + mirror + '`.`mirror`');
    await expect(inspected).toBeInViewport();
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB多表同步逐行选择.png') });
    await applyBatch.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(await readMappedLeft()).toEqual(mappedBeforeSelection);
    expect(await values(left, mirror, 'mirror')).toEqual(await values(right, mirror, 'mirror'));
    const mariaBeforeSelection = await values(right, mirror, 'mirror');
    await left.query('UPDATE ' + mappedLeft + " SET raw=X'66' WHERE BINARY code=BINARY 'new'");
    await left.query('UPDATE ' + mirror + ".mirror SET note='跳过右侧表' WHERE id=1");
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await prepareBatch.click();
    await expect(batchReview).toContainText('插入 0 · 更新 2 · 删除 0');
    await batchReview.getByRole('button', { name: batchSync.clearTable + ' `' + mirror + '`.`mirror`', exact: true }).click();
    await batchConfirm.fill('`' + mirror + '`.`mapped_right`');
    await applyBatch.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect((await readMappedRight()).map(row => row.raw)).toEqual(['00FF85', '66']);
    expect(await values(right, mirror, 'mirror')).toEqual(mariaBeforeSelection);
    const seedLarge = (client: typeof left, start: number) => client.query(
      'INSERT INTO ' + mirror + '.mirror(id,note) VALUES ' + Array.from({ length: 125 }, (_, index) => '(' + (start + index) + ",'分页候选')").join(','),
    );
    const selectLast = async (client: typeof left, start: number, capture = false) => {
      await prepareBatch.click();
      await expect(batchReview).toContainText(batchSync.selectionCount(0, 125));
      await batchReview.getByRole('combobox', { name: batchSync.jumpPage, exact: true }).selectOption('4');
      await batchReview.getByLabel(batchSync.filterTable, { exact: true }).selectOption('`' + mirror + '`.`mirror`');
      await batchReview.getByLabel(batchSync.filterKey, { exact: true }).fill(String(start + 124));
      await expect(batchReview.getByRole('listitem')).toHaveCount(1);
      await batchReview.getByRole('button', { name: batchSync.selectTableMatches + ' `' + mirror + '`.`mirror`', exact: true }).click();
      await batchConfirm.fill('`' + mirror + '`.`mirror`');
      if (capture) await page.screenshot({ path: info.outputPath('MySQL与MariaDB多表同步预览筛选.png') });
      await applyBatch.click();
      await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
      const result = (await client.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS id,note FROM ' + mirror +
        '.mirror WHERE id BETWEEN ? AND ? ORDER BY id', [start, start + 124]))[0];
      expect(result).toEqual([{ id: String(start + 124), note: '分页候选' }]);
    };
    await overview.getByRole('checkbox', { name: sync.update, exact: true }).uncheck();
    await seedLarge(left, 1000);
    await selectLast(right, 1000, true);
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await overview.getByRole('checkbox', { name: sync.update, exact: true }).uncheck();
    await seedLarge(right, 2000);
    await selectLast(left, 2000);
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await Promise.allSettled([left.end(), right.end()]); }
});
