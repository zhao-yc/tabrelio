import { Client } from 'pg';
import { answerDialogs, test, expect, page, pageErrors } from './desktop-fixture';
import { postgresResultOriginsZh as text } from '../../src/renderer/locales/postgresResultOrigins.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { dataSearchRecordsZh as recordText } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { cellClipboardType, encodeClipboard } from '../../src/renderer/gridClipboard';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_QUERY_RECORD_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

function isolatedConnection() {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  return { host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 };
}

async function loadQuery({ port, user, database, password }: ReturnType<typeof isolatedConnection>, sql: string) {
  const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
    id: '', name: '原记录专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
    port, user, database, password, rememberPassword: false,
  });
  await page.evaluate(async ({ connectionId, database, sql }) => {
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-query-record',
      tabs: [{ id: 'pg-query-record', title: '原记录查询', kind: 'query', connectionId, database,
        sql }] });
  }, { connectionId, database, sql });
  await page.reload();
}

test('PostgreSQL 查询单元格按原行及原列定位，预览确认后提交并拒绝陈旧原值', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.record_subject(id bigint PRIMARY KEY, detail text, guard text, payload bytea);
      INSERT INTO public.record_subject VALUES (2, '另一行', '原保护值', decode('CAFE','hex')),
      (9223372036854775807, '原内容', '原保护值', decode('00FEFF','hex'))`);
    await loadQuery(config, 'SELECT id AS 编号, detail AS 同名, payload AS 同名 FROM public.record_subject ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const edit = query.getByRole('button', { name: text.edit, exact: true });
    const cell = (name: string) => query.getByRole('gridcell', { name, exact: true });
    const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
      .filter(task => task.kind === 'query.execute'));
    const read = async () => (await observer.query('SELECT id::text, detail, guard FROM public.record_subject ORDER BY id')).rows;

    await execute.click();
    await expect(edit).toBeVisible();
    await query.getByRole('columnheader', { name: '编号' }).click();
    await expect(cell('另一行').locator('..')).toHaveAttribute('aria-rowindex', '2');
    await cell('原内容').click();
    const form = page.getByRole('dialog', { name: tableText.edit, exact: true });
    const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
    const stage = async (value: string) => {
      await edit.click();
      await form.getByLabel('detail ' + tableText.valueMode, { exact: true }).selectOption('text');
      await form.getByLabel('detail ' + tableText.value, { exact: true }).fill(value);
      await form.getByRole('button', { name: tableText.stage, exact: true }).click();
      await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."record_subject"');
    };
    const original = cell('原内容');
    const editor = page.getByRole('region', { name: tableText.cellEdit('detail'), exact: true });
    const input = editor.getByRole('textbox', { name: tableText.value, exact: true });
    await original.press('F2');
    await expect(input).toHaveValue('原内容');
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(editor).toBeHidden();
    await expect(original).toBeFocused();

    await original.dblclick();
    await expect(input).toBeFocused();
    await input.fill('确认后更新');
    await info.attach('PostgreSQL查询结果就地编辑', { body: await page.screenshot(), contentType: 'image/png' });
    await input.press('Enter');
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."record_subject" SET "detail" = $1');
    await preview.getByRole('button', { name: tableText.edit, exact: true }).click();
    await expect(input).toHaveValue('确认后更新');
    await input.fill('取消二次编辑');
    await input.press('Escape');
    await expect(preview.locator('dd')).toHaveText('确认后更新');
    expect((await read()).map(row => row.detail)).toEqual(['另一行', '原内容']);
    const before = await executions();
    const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
    await expect(apply).toBeDisabled();
    await info.attach('PostgreSQL查询原记录编辑预览', { body: await page.screenshot(), contentType: 'image/png' });
    await preview.getByRole('checkbox', { name: recordText.postgresConfirm, exact: true }).check();
    await apply.click();
    await expect(preview).toBeHidden();
    await expect(edit).toBeHidden();
    expect(await read()).toEqual([
      { id: '2', detail: '另一行', guard: '原保护值' },
      { id: '9223372036854775807', detail: '确认后更新', guard: '原保护值' },
    ]);
    expect(await executions()).toEqual(before);

    await execute.click();
    await expect(edit).toBeVisible();
    await expect(cell('另一行')).toBeVisible();
    await observer.query("UPDATE public.record_subject SET detail='并发改写' WHERE id=2");
    await cell('另一行').click();
    await edit.click();
    const rejected = page.getByRole('dialog', { name: text.edit, exact: true });
    await expect(rejected.locator('.error-box')).toContainText('PostgreSQL 查询原记录无法核验');
    await rejected.getByRole('button', { name: text.editBack, exact: true }).click();
    expect((await read()).map(row => row.detail)).toEqual(['并发改写', '确认后更新']);

    // 表单打开后，未参与查询投影的字段发生变化也必须使待提交版本失效。
    await cell('确认后更新').click();
    await stage('冲突时不得写入');
    await observer.query("UPDATE public.record_subject SET guard='新保护值' WHERE id=9223372036854775807");
    await preview.getByRole('checkbox', { name: recordText.postgresConfirm, exact: true }).check();
    await apply.click();
    await expect(preview.locator('.error-box')).toContainText('原记录已被修改、删除或替换，整批未写入');
    expect((await read())[1]).toEqual({ id: '9223372036854775807', detail: '确认后更新', guard: '新保护值' });
    await answerDialogs([0]);
    const [discard] = await Promise.all([page.waitForEvent('dialog'),
      preview.getByRole('button', { name: text.editBack, exact: true }).click()]);
    expect(discard.message()).toBe(text.editDiscard);
    await expect(preview).toBeHidden();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 查询网格按可见矩形粘贴，约束失败整批回滚并支持类型化提交', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.query_paste (
      id bigint PRIMARY KEY, detail text DEFAULT '默认内容', payload bytea,
      CONSTRAINT no_rejected CHECK (detail IS DISTINCT FROM '拒绝'));
      INSERT INTO public.query_paste VALUES (2, '原第一行', decode('0102','hex')),
        (9223372036854775807, '原第二行', decode('CAFE','hex'));
      CREATE SEQUENCE public.query_paste_attempt;
      CREATE FUNCTION public.count_query_paste_attempt() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN PERFORM nextval('public.query_paste_attempt'); RETURN NEW; END $$;
      CREATE TRIGGER count_query_paste_attempt BEFORE UPDATE ON public.query_paste
        FOR EACH ROW EXECUTE FUNCTION public.count_query_paste_attempt()`);
    await loadQuery(config, 'SELECT id AS 编号, detail AS 同名, payload AS 同名 FROM public.query_paste ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    await query.getByRole('columnheader', { name: '编号' }).click();
    const anchor = query.getByRole('gridcell', { name: '原第一行', exact: true });
    await expect(anchor.locator('..')).toHaveAttribute('aria-rowindex', '2');
    const read = async () => (await observer.query("SELECT id::text, detail, encode(payload,'hex') AS payload FROM public.query_paste ORDER BY id")).rows;
    const before = await read();
    const paste = async (source: { text: string; typed?: string }) => {
      await query.locator('[role="gridcell"]:focus').evaluate((element, { source, mime }) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', source.text);
        if (source.typed) clipboardData.setData(mime, source.typed);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
      }, { source, mime: cellClipboardType });
    };
    const preview = page.getByRole('dialog', { name: text.pasteTitle, exact: true });
    const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
    const submit = async () => {
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: text.pasteConfirm(2), exact: true }).check();
      await apply.click();
    };

    await anchor.click();
    await paste({ text: '先写第一行\n拒绝' });
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."query_paste" SET "detail" = $1');
    expect(await read()).toEqual(before);
    await submit();
    await expect(preview.locator('.error-box')).toContainText('no_rejected');
    expect((await observer.query('SELECT last_value::int FROM public.query_paste_attempt')).rows[0].last_value).toBe(2);
    expect(await read()).toEqual(before);
    await answerDialogs([0]);
    const [discard] = await Promise.all([page.waitForEvent('dialog'),
      preview.getByRole('button', { name: text.editBack, exact: true }).click()]);
    expect(discard.message()).toBe(text.pasteDiscard);
    await expect(preview).toBeHidden();

    await anchor.click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await paste(encodeClipboard([['修改第一行', { type: 'binary', base64: 'AP7/' }], [undefined, null]]));
    await expect(preview.locator('pre')).toContainText('SET "detail" = DEFAULT, "payload" = $1');
    await expect(preview.locator('dd')).toHaveText(['修改第一行', '00feff', 'DEFAULT', 'NULL']);
    expect(await read()).toEqual(before);
    await info.attach('PostgreSQL查询结果矩形粘贴', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual([
      { id: '2', detail: '修改第一行', payload: '00feff' },
      { id: '9223372036854775807', detail: '默认内容', payload: null },
    ]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
