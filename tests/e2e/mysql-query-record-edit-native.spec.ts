import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryRecordEditZh as text } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { binaryCellZh } from '../../src/renderer/locales/binaryCell.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询原行和单格按权限预览提交并拒绝并发修改`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'edit_' + nonce, table = database + '.subject', host = '127.0.0.1', user = 'edit_writer';
  const writerPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${table} (tenant VARCHAR(10), id BIGINT, note VARCHAR(30), guard VARCHAR(30), auxiliary VARCHAR(30), payload VARBINARY(2), PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `INSERT INTO ${table} VALUES ('A',9007199254740993,'所选记录','隐藏原值',NULL,X'CAFE'),('A',9007199254740992,'相邻主键','隐藏邻值',NULL,X'F00D')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${writerPassword}'`,
      `GRANT SELECT, UPDATE (note, auxiliary) ON ${table} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT s.tenant AS 内容, s.id AS 编号, s.note AS 内容, s.payload AS 字节 FROM ${table} s ORDER BY s.id DESC;`;
    const connectionId = await page.evaluate(async ({ host, port, user, writerPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: writerPassword, database, dialect,
        name: '查询编辑专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'edit-query',
        tabs: [{ id: 'edit-query', kind: 'query', title: '原行编辑查询', connectionId: connection.id, database, sql }] });
      return connection.id;
    }, { host, port, user, writerPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    const open = async (name: string) => {
      await grid.getByRole('gridcell', { name, exact: true }).click();
      await (await navigationMenuItem(query, { name: text.edit, exact: true })).click();
    };
    const edit = page.getByRole('dialog', { name: text.edit, exact: true });
    const preview = page.getByRole('dialog', { name: text.preview, exact: true });
    const apply = preview.getByRole('button', { name: text.apply, exact: true });
    const field = edit.getByLabel('note · ' + recordViewZh.value, { exact: true });
    const inline = page.getByRole('region', { name: text.inlineLabel('内容'), exact: true });
    const inlineField = inline.getByLabel('note · ' + recordViewZh.value, { exact: true });
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const inlinePreview = async (note: string) => {
      await inlineField.fill(note);
      await inlineField.press('Enter');
      await expect(preview.locator('pre')).toContainText('9007199254740993');
      await expect(preview.locator('pre')).toContainText('SET `note`');
      await expect(preview.locator('pre')).toContainText(note);
      await expect(apply).toBeDisabled();
    };
    const stage = async (note: string) => {
      await field.fill(note);
      await edit.getByRole('button', { name: text.preview, exact: true }).click();
      await expect(preview.locator('pre')).toContainText(`UPDATE \`${database}\`.\`subject\``);
      await expect(preview.locator('pre')).toContainText('9007199254740993');
      await expect(preview.locator('pre')).toContainText(note);
      await expect(apply).toBeDisabled();
    };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: text.confirm, exact: true }).check();
      await apply.click();
    };
    const read = async () => (await observer.query(`SELECT id,note,guard FROM ${table} ORDER BY id`))[0];
    const expected = (note: string, guard: string) => [
      { id: '9007199254740992', note: '相邻主键', guard: '隐藏邻值' },
      { id: '9007199254740993', note, guard },
    ];

    await execute();
    await expect(grid.getByRole('gridcell', { name: '所选记录', exact: true })).toBeVisible();
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    await expect(grid.getByRole('gridcell').filter({ hasText: /所选记录|相邻主键/ })).toHaveText(['相邻主键', '所选记录']);

    await grid.getByRole('gridcell', { name: /0xcafe/i }).dblclick();
    const binary = page.getByRole('dialog', { name: binaryCellZh.title + '：字节', exact: true });
    await expect(binary).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(binary).toBeHidden();

    await cell('A').last().dblclick();
    await expect(inline.getByRole('alert')).toContainText('当前查询字段不可编辑');
    await inline.getByRole('button', { name: text.inlineCancel }).press('Escape');
    await expect(inline).toBeHidden();
    await expect(cell('A').last()).toBeFocused();
    await cell('所选记录').dblclick();
    await expect(inlineField).toBeFocused();
    await expect(inlineField).toHaveValue('所选记录');
    await info.attach(`${dialect}查询单元格编辑`, { body: await page.screenshot(), contentType: 'image/png' });
    await inlineField.fill('取消的草稿');
    await inlineField.press('Escape');
    await expect(inline).toBeHidden();
    await expect(cell('所选记录')).toBeFocused();
    expect(await read()).toEqual(expected('所选记录', '隐藏原值'));

    await open('所选记录');
    await expect(field).toHaveValue('所选记录');
    const guard = edit.getByRole('region', { name: 'guard', exact: true });
    await expect(guard).toContainText('隐藏原值');
    await expect(guard).toContainText(text.readOnly);
    await info.attach(`${dialect}查询原记录编辑`, { body: await page.screenshot(), contentType: 'image/png' });
    await stage('已确认更新');
    expect(await read()).toEqual(expected('所选记录', '隐藏原值'));
    await submit();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual(expected('已确认更新', '隐藏原值'));

    await execute();
    await cell('已确认更新').click();
    await cell('已确认更新').press('F2');
    await expect(inlineField).toHaveValue('已确认更新');
    await inlinePreview('单格已确认');
    await preview.getByRole('button', { name: recordViewZh.editField, exact: true }).click();
    await expect(inlineField).toHaveValue('单格已确认');
    await inlinePreview('单格已确认');
    expect(await read()).toEqual(expected('已确认更新', '隐藏原值'));
    await submit();
    await expect(preview).toBeHidden();
    await expect(cell('已确认更新')).toBeFocused();
    expect(await read()).toEqual(expected('单格已确认', '隐藏原值'));

    await execute();
    await cell('单格已确认').click();
    await cell('单格已确认').press('X');
    await expect(inlineField).toHaveValue('X');
    await inlinePreview('不得覆盖并发修改');
    // 变更未投影列，只有整行快照重验才能拒绝已预览的更新。
    await observer.query(`UPDATE ${table} SET guard='外部变更' WHERE tenant='A' AND id=9007199254740993`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    await expect(apply).toBeDisabled();
    expect(await read()).toEqual(expected('单格已确认', '外部变更'));
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(3);
    expect(tasks.filter(task => task.kind === 'table.apply')).toHaveLength(3);
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items).toHaveLength(3);
    const committed = items.filter(item => item.outcome === 'committed');
    expect(committed).toHaveLength(2);
    for (const item of committed) expect(item).toMatchObject({
      committedReportedRows: 1, intent: { insert: 0, update: 1, delete: 0, statementCount: 1 },
    });
    expect(items.find(item => item.outcome === 'not-sent')).toMatchObject({
      committedReportedRows: 0, evidence: { dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, rollbackAcknowledged: true },
    });
    // 另一个字段同样具备 UPDATE 权限，单格引用也不能把它追加到预览。
    const forged = await page.evaluate(async ({ connectionId, database, sql, executionId, taskId }) => {
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database });
      try {
        await window.dbark.invoke('query.execute', { sessionId, sql, taskId: executionId, maxRows: 2 });
        const original = await window.dbark.invoke('mysql.queryRecordEdit', { connectionId, sessionId, executionId, taskId, rowIndex: 0, columnIndex: 2 });
        try {
          await window.dbark.invoke('table.preview', { connectionId, database, table: 'subject', queryRecord: { sessionId, token: original.token },
            changes: [{ kind: 'update', before: original.row, values: { note: '正确字段', auxiliary: '跨列伪造' } }] });
          return '';
        } catch (reason) { return String(reason); }
      } finally { await window.dbark.invoke('sessions.close', { sessionId }); }
    }, { connectionId, database, sql, executionId: randomUUID(), taskId: randomUUID() });
    expect(forged).toContain('查询原记录编辑引用或字段范围已变化');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
