import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryBatchEditZh as text } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 复制勾选的查询原行并逐条编辑副本`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'copy_' + nonce, table = database + '.subject', host = '127.0.0.1', user = 'query_copier';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${table} (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE,
        payload VARBINARY(8), qty BIGINT, note VARCHAR(40) DEFAULT '默认说明', guard VARCHAR(30),
        derived VARCHAR(60) AS (CONCAT(code, '-生成')) STORED) ENGINE=InnoDB`,
      `INSERT INTO ${table} (id,code,payload,qty,note,guard) VALUES
        (9007199254740992,'来源甲',X'00FF',9223372036854775807,'甲自定义','未投影甲'),
        (9007199254740993,'保留乙',X'CAFE',9007199254740993,'乙自定义','未投影乙'),
        (9007199254740994,'来源丙',X'FF00',-9223372036854775808,'丙自定义','未投影丙')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, INSERT ON ${table} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT s.id AS 编号, s.code AS 内容 FROM ${table} s ORDER BY s.id DESC;`;
    await page.evaluate(async ({ host, port, user, userPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '查询副本专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'query-copy',
        tabs: [{ id: 'query-copy', kind: 'query', title: '复制勾选原行', connectionId: connection.id, database, sql }] });
    }, { host, port, user, userPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const draft = page.getByRole('dialog', { name: text.insert, exact: true });
    const preview = page.getByRole('dialog', { name: text.copyPreview, exact: true });
    const apply = preview.getByRole('button', { name: text.copyApply, exact: true });
    const row = (name: string) => grid.getByRole('gridcell', { name, exact: true }).locator('..');
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    let completed = 0;
    const execute = async () => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(++completed);
      if (!await sort.getByLabel(queryResultSortZh.ascending).isVisible()) await sort.click();
      await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    };
    const open = async () => {
      for (const name of ['来源丙', '来源甲']) await row(name).getByRole('checkbox').check();
      await (await navigationMenuItem(query, { name: text.insert, exact: true })).click();
      try { await expect(draft.getByRole('combobox', { name: text.copyRow })).toBeVisible(); }
      catch (failure) {
        await info.attach('查询副本诊断', { body: JSON.stringify(await page.getByRole('alert').allTextContents()), contentType: 'application/json' });
        throw failure;
      }
    };
    const field = (name: string) => draft.getByLabel(name + ' · ' + recordViewZh.value, { exact: true });
    const chooseField = (name: string) => draft.getByRole('combobox', { name: text.copyField }).selectOption(name);
    const chooseRow = (label: string) => draft.getByRole('combobox', { name: text.copyRow }).selectOption({ label });
    const review = async () => {
      await draft.getByRole('button', { name: text.copyPreview, exact: true }).click();
      try { await expect(preview.getByRole('table')).toBeVisible(); }
      catch (failure) {
        await info.attach('查询副本诊断', { body: JSON.stringify(await page.getByRole('alert').allTextContents()), contentType: 'application/json' });
        throw failure;
      }
      await expect(apply).toBeDisabled();
    };
    const code = async (position: string, value: string) => { await chooseRow(position); await chooseField('code'); await field('code').fill(value); };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: text.copyConfirm, exact: true }).check();
      await apply.click();
    };
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT id,code,HEX(payload) AS bytes,qty,note,guard,derived FROM ${table} ORDER BY id`))[0];

    await execute();
    const initial = await read();
    await open();
    await expect(draft.getByRole('combobox', { name: text.copyField }).locator('option')).toHaveText(['code', 'payload', 'qty', 'note', 'guard']);
    await draft.getByRole('button', { name: text.copyPreview, exact: true }).click();
    await expect(draft.getByRole('alert')).toContainText('存在主键或唯一键冲突');
    await code('1', '副本甲');
    await chooseField('note');
    await draft.getByRole('combobox', { name: recordViewZh.mode, exact: true }).selectOption('default');
    await code('3', '副本丙');
    await review();
    await expect(preview.getByRole('table')).toContainText('未投影甲');
    await expect(preview.getByRole('table')).toContainText('-9223372036854775808');
    await preview.getByText(text.sql, { exact: true }).click();
    const plan = await preview.locator('details pre').textContent();
    expect(plan?.match(/INSERT INTO /g)).toHaveLength(2);
    expect(plan).not.toContain('`id`');
    expect(plan).not.toContain('`derived`');
    expect(await read()).toEqual(initial);
    await info.attach(`${dialect}查询记录副本预览`, { body: await page.screenshot(), contentType: 'image/png' });
    await preview.getByRole('button', { name: text.copyBack, exact: true }).click();
    await chooseField('code');
    await expect(field('code')).toHaveValue('副本甲');
    await review();
    await submit();
    await expect(preview).toBeHidden();
    const copied = await read();
    expect(copied).toEqual([
      ...initial,
      { ...initial[0], id: '9007199254740995', code: '副本甲', note: '默认说明', derived: '副本甲-生成' },
      { ...initial[2], id: '9007199254740996', code: '副本丙', derived: '副本丙-生成' },
    ]);

    await execute();
    await open();
    await code('1', '不得保留的副本');
    await code('3', '保留乙');
    await review();
    await submit();
    await expect(preview.getByRole('alert')).toContainText('整批已回滚：目标唯一约束冲突');
    expect(await read()).toEqual(copied);
    await preview.getByRole('button', { name: text.cancel, exact: true }).click();

    await open();
    await code('1', '并发副本甲');
    await code('3', '并发副本丙');
    await review();
    await observer.query(`UPDATE ${table} SET guard='外部变更' WHERE id=9007199254740994`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([copied[0], copied[1], { ...copied[2], guard: '外部变更' }, copied[3], copied[4]]);
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items).toHaveLength(3);
    expect(items.find(item => item.outcome === 'committed')).toMatchObject({ intent: { insert: 2, statementCount: 2 }, committedReportedRows: 2 });
    expect(items.find(item => item.outcome === 'rolled-back')).toMatchObject({ evidence: { dmlAcknowledged: 1, rollbackAcknowledged: true } });
    expect(items.find(item => item.outcome === 'not-sent')).toMatchObject({ evidence: { dmlMayHaveBeenSent: false, rollbackAcknowledged: true } });
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
