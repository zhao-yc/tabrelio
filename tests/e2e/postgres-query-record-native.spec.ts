import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { answerDialogs, test, expect, page, pageErrors } from './desktop-fixture';
import { postgresResultOriginsZh as text } from '../../src/renderer/locales/postgresResultOrigins.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { dataSearchRecordsZh as recordText } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { gridRangeFillZh as fillText } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { postgresBatchDuplicateZh as duplicateText } from '../../src/renderer/locales/postgresBatchDuplicate.zh-CN';
import { postgresBatchEditZh as batchText } from '../../src/renderer/locales/postgresBatchEdit.zh-CN';
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
      await preview.getByRole('checkbox', { name: text.rangeConfirm(2), exact: true }).check();
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

test('PostgreSQL 查询矩形按显示边缘复制，仅更新有变化的目标格并保留二进制', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.query_fill (id bigint PRIMARY KEY, note text, src bytea, dst bytea);
      INSERT INTO public.query_fill VALUES
        (2, '首行样本', decode('00FEFF','hex'), decode('BEEF','hex')),
        (3, '首行样本', NULL, decode('CAFE','hex')),
        (9223372036854775807, '末行原值', decode('1234','hex'), decode('CAFE','hex'))`);
    await loadQuery(config, 'SELECT id AS 编号, note, src AS 同名, dst AS 同名 FROM public.query_fill ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const edit = query.getByRole('button', { name: text.edit, exact: true });
    const cell = (name: string) => query.getByRole('gridcell', { name, exact: true });
    const preview = page.getByRole('dialog', { name: text.fillTitle, exact: true });
    const read = async () => (await observer.query(`SELECT id::text, note, encode(src,'hex') AS src,
      encode(dst,'hex') AS dst, xmin::text FROM public.query_fill ORDER BY id`)).rows;
    const stage = async (direction: 'down' | 'right') => {
      await query.getByRole('button', { name: fillText.open, exact: true }).click();
      const panel = query.getByRole('region', { name: fillText.open, exact: true });
      await panel.getByRole('combobox').selectOption(direction);
      await panel.getByRole('button', { name: fillText.stage, exact: true }).click();
      await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."query_fill"');
    };
    const submit = async (rows: number) => {
      const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: text.rangeConfirm(rows), exact: true }).check();
      await apply.click();
      await expect(preview).toBeHidden();
    };

    await execute.click();
    await expect(edit).toBeVisible();
    await query.getByRole('columnheader', { name: '编号' }).click();
    const before = await read();
    await expect(cell('末行原值').locator('..')).toHaveAttribute('aria-rowindex', '4');
    await cell('首行样本').first().click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await stage('down');
    await expect(preview.locator('strong')).toHaveText(text.rangeRow(3));
    await expect(preview.locator('dd')).toHaveText('首行样本');
    expect(await read()).toEqual(before);
    await submit(1);
    const afterDown = await read();
    expect(afterDown.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(afterDown[2]).toMatchObject({ id: '9223372036854775807', note: '首行样本', src: '1234', dst: 'cafe' });

    await execute.click();
    await expect(edit).toBeVisible();
    await cell('0x1234').click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await stage('right');
    await expect(preview.locator('dt')).toHaveText(['dst', 'dst']);
    await expect(preview.locator('dd')).toHaveText(['1234', 'NULL']);
    expect(await read()).toEqual(afterDown);
    await info.attach('PostgreSQL查询结果选区填充', { body: await page.screenshot(), contentType: 'image/png' });
    await submit(2);
    const afterRight = await read();
    expect(afterRight[0]).toEqual(before[0]);
    expect(afterRight.map(row => [row.src, row.dst])).toEqual([['00feff', 'beef'], [null, null], ['1234', '1234']]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 查询按勾选原主键删除，拒绝并发变更并整批回滚外键失败', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE ROLE query_delete_user LOGIN PASSWORD '${password}';
      CREATE TABLE public.query_delete (tenant text, id bigint, note text, guard text, PRIMARY KEY (tenant,id));
      INSERT INTO public.query_delete VALUES ('区甲', 2, '待删甲', '保护'),
        ('区甲', 3, '保留同区', '保护'), ('区乙', 2, '保留同号', '保护'),
        ('区乙', 9223372036854775807, '待删乙', '保护');
      CREATE TABLE public.query_delete_ref (tenant text, id bigint,
        CONSTRAINT guarded_query_delete FOREIGN KEY (tenant,id) REFERENCES public.query_delete);
      INSERT INTO public.query_delete_ref VALUES ('区乙', 9223372036854775807);
      CREATE SEQUENCE public.query_delete_attempt;
      CREATE FUNCTION public.count_query_delete_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path TO pg_catalog AS
        $$ BEGIN PERFORM nextval('public.query_delete_attempt'); RETURN OLD; END $$;
      CREATE TRIGGER count_query_delete_attempt BEFORE DELETE ON public.query_delete
        FOR EACH ROW EXECUTE FUNCTION public.count_query_delete_attempt();
      GRANT SELECT, DELETE ON public.query_delete TO query_delete_user`);
    await loadQuery({ ...config, user: 'query_delete_user', password },
      'SELECT tenant AS 区域, id AS 编号, note AS 备注 FROM public.query_delete ORDER BY id DESC, tenant DESC;');
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const remove = query.getByRole('button', { name: text.deleteChecked, exact: true });
    const preview = page.getByRole('dialog', { name: text.deleteTitle, exact: true });
    const read = async () => (await observer.query('SELECT tenant, id::text, note, guard FROM public.query_delete ORDER BY tenant,id')).rows;
    const before = await read();
    const stage = async () => {
      for (const name of ['待删乙', '待删甲']) await query.getByRole('gridcell', { name, exact: true }).locator('..').getByRole('checkbox').check();
      await remove.click();
      await expect(preview.locator('pre')).toContainText('DELETE FROM ONLY "public"."query_delete"');
      await expect(preview.locator('tbody td')).toHaveText(['区甲', '2', '区乙', '9223372036854775807']);
    };
    const submit = async () => {
      const apply = preview.getByRole('button', { name: text.deleteApply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: text.deleteConfirm(2), exact: true }).check();
      await apply.click();
    };
    const discard = async () => {
      await answerDialogs([0]);
      const [confirmation] = await Promise.all([page.waitForEvent('dialog'),
        preview.getByRole('button', { name: text.editBack, exact: true }).click()]);
      expect(confirmation.message()).toBe(text.deleteDiscard);
      await expect(preview).toBeHidden();
    };
    const sortAscending = async () => {
      await expect(remove).toBeVisible();
      await query.getByRole('columnheader', { name: '编号' }).click();
      await expect(query.getByRole('gridcell', { name: '待删乙', exact: true }).locator('..')).toHaveAttribute('aria-rowindex', '5');
    };
    let completed = 0;
    const run = async () => {
      await execute.click();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(++completed);
      await sortAscending();
    };

    await run();
    await expect(query.getByRole('button', { name: text.edit, exact: true })).toBeHidden();
    await expect(remove).toBeDisabled();
    await stage();
    expect(await read()).toEqual(before);
    await observer.query("UPDATE public.query_delete SET guard='外部改动' WHERE tenant='区乙' AND id=9223372036854775807");
    await submit();
    await expect(preview.locator('.error-box')).toContainText('原记录已被修改、删除或替换，整批未写入');
    expect((await observer.query('SELECT is_called FROM public.query_delete_attempt')).rows[0].is_called).toBe(false);
    expect(await read()).toHaveLength(4);
    await discard();

    await run();
    await stage();
    const current = await read();
    await submit();
    await expect(preview.locator('.error-box')).toContainText('guarded_query_delete');
    expect((await observer.query('SELECT last_value::int FROM public.query_delete_attempt')).rows[0].last_value).toBe(2);
    expect(await read()).toEqual(current);
    await discard();

    await observer.query('DELETE FROM public.query_delete_ref');
    await stage();
    expect(await read()).toEqual(current);
    await info.attach('PostgreSQL查询勾选删除预览', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    await expect(remove).toBeHidden();
    expect(await read()).toEqual(current.filter(row => row.note.startsWith('保留')));
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 带计算列的查询只修改原字段，重复主键结果保持只读', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.query_projection(id bigint PRIMARY KEY, note text);
      INSERT INTO public.query_projection VALUES (2, '另外值'), (9223372036854775807, '原记录甲');
      CREATE SEQUENCE public.query_projection_reads`);
    await loadQuery(config, `SELECT nextval('public.query_projection_reads') AS 次数,
      substring(note FROM 1 FOR 2) AS 同名, note AS 同名, id, (note IS DISTINCT FROM '无') AS 差异
      FROM public.query_projection ORDER BY id DESC;`);
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const edit = query.getByRole('button', { name: text.edit, exact: true });
    const cell = (name: string) => query.getByRole('gridcell', { name, exact: true });
    await execute.click();
    await expect(edit).toBeVisible();
    const inline = page.getByRole('region', { name: tableText.cellEdit('note'), exact: true });
    await cell('原记').click();
    await page.keyboard.press('F2');
    await expect(cell('原记')).toBeFocused();
    await expect(inline).toBeHidden();
    await page.keyboard.press('Shift+ArrowRight');
    await query.locator('[role="gridcell"]:focus').evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', '拒绝\t拒绝');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(query.getByText(text.expressionReadOnly, { exact: true })).toBeVisible();

    await cell('原记录甲').dblclick();
    const input = inline.getByRole('textbox', { name: tableText.value, exact: true });
    await expect(input).toHaveValue('原记录甲');
    await input.fill('修改后');
    await info.attach('PostgreSQL含计算列的结果编辑', { body: await page.screenshot(), contentType: 'image/png' });
    await input.press('Enter');
    const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."query_projection" SET "note" = $1');
    const readCount = async () => (await observer.query('SELECT last_value::int FROM public.query_projection_reads')).rows[0].last_value;
    expect(await readCount()).toBe(2);
    await preview.getByRole('checkbox', { name: recordText.postgresConfirm, exact: true }).check();
    await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(preview).toBeHidden();
    expect((await observer.query('SELECT id::text, note FROM public.query_projection ORDER BY id')).rows).toEqual([
      { id: '2', note: '另外值' }, { id: '9223372036854775807', note: '修改后' },
    ]);
    expect(await readCount()).toBe(2);

    await page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, tabs: settings.tabs.map(tab => tab.id === 'pg-query-record' ? {
        ...tab, sql: 'SELECT id, note, generate_series(1,2) AS 展开 FROM public.query_projection ORDER BY id DESC;',
      } : tab) });
    });
    await page.reload();
    await execute.click();
    await expect(cell('修改后')).toHaveCount(2);
    await expect(edit).toBeHidden();
    await expect(query.getByRole('button', { name: text.deleteChecked, exact: true })).toBeHidden();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 查询勾选记录可复制完整原值，保留类型并在第二条失败时整批回滚', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE ROLE query_duplicate_user LOGIN PASSWORD '${password}';
      CREATE TABLE public.query_duplicate (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993) PRIMARY KEY,
        note text NOT NULL, amount numeric(30,5), payload bytea, optional text,
        chars integer GENERATED ALWAYS AS (length(note)) STORED,
        CONSTRAINT no_bad_duplicate CHECK (note <> '拒绝'));
      INSERT INTO public.query_duplicate(note,amount,payload,optional) VALUES
        ('甲原样', 9007199254740993.12345, decode('00FEFF','hex'), NULL),
        ('乙原样', -0.00001, decode('CAFE','hex'), '');
      GRANT SELECT, INSERT ON public.query_duplicate TO query_duplicate_user;
      GRANT USAGE ON SEQUENCE public.query_duplicate_id_seq TO query_duplicate_user`);
    await loadQuery({ ...config, user: 'query_duplicate_user', password },
      'SELECT length(note) AS 计算列, id, note FROM public.query_duplicate ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const duplicate = query.getByRole('button', { name: text.duplicateChecked, exact: true });
    const form = page.getByRole('dialog', { name: duplicateText.title, exact: true });
    const preview = page.getByRole('dialog', { name: text.duplicateTitle, exact: true });
    const read = async () => (await observer.query(`SELECT id::text, note, amount::text, encode(payload,'hex') AS payload,
      optional, chars FROM public.query_duplicate ORDER BY id`)).rows;
    const before = await read();
    const secondValue = () => form.getByRole('region', { name: batchText.record(2), exact: true })
      .getByLabel('note ' + tableText.value, { exact: true });
    const stage = async () => {
      await form.getByRole('button', { name: duplicateText.stage, exact: true }).click();
      await expect(preview.locator('pre')).toContainText('INSERT INTO "public"."query_duplicate" ("note", "amount", "payload", "optional")');
      expect(await read()).toEqual(before);
    };
    const submit = async () => {
      const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: text.duplicateConfirm(2), exact: true }).check();
      await apply.click();
    };

    await execute.click();
    await expect(duplicate).toBeVisible();
    await expect(duplicate).toBeDisabled();
    await expect(query.getByRole('button', { name: text.edit, exact: true })).toBeHidden();
    await expect(query.getByRole('button', { name: text.deleteChecked, exact: true })).toBeHidden();
    await query.getByRole('columnheader', { name: 'id', exact: false }).click();
    await expect(query.getByRole('gridcell', { name: '甲原样', exact: true }).locator('..')).toHaveAttribute('aria-rowindex', '2');
    for (const name of ['乙原样', '甲原样'])
      await query.getByRole('gridcell', { name, exact: true }).locator('..').getByRole('checkbox').check();
    await duplicate.click();
    await expect(form.getByText(duplicateText.omitted('id、chars'), { exact: true })).toBeVisible();
    await form.getByRole('button', { name: batchText.record(2), exact: true }).click();
    await expect(secondValue()).toHaveValue('乙原样');
    await secondValue().fill('拒绝');
    await stage();
    await submit();
    await expect(preview.locator('.error-box')).toContainText('no_bad_duplicate');
    expect((await observer.query('SELECT last_value::text FROM public.query_duplicate_id_seq')).rows[0].last_value).toBe('9007199254740996');
    expect(await read()).toEqual(before);

    await preview.getByRole('button', { name: tableText.edit, exact: true }).click();
    await form.getByRole('button', { name: batchText.record(2), exact: true }).click();
    await expect(secondValue()).toHaveValue('拒绝');
    await secondValue().fill('乙的副本');
    await stage();
    await info.attach('PostgreSQL查询勾选记录副本', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual([...before,
      { ...before[0], id: '9007199254740997' },
      { ...before[1], id: '9007199254740998', note: '乙的副本', chars: 4 },
    ]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 可从空结果向无主键来源表新增，预览后结构变化拒绝写入', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE ROLE query_new_user LOGIN PASSWORD '${password}';
      CREATE SCHEMA query_new_scope;
      CREATE TABLE query_new_scope.subject (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993),
        note text NOT NULL DEFAULT '默认内容');
      CREATE TABLE public.subject(note text);
      GRANT USAGE ON SCHEMA query_new_scope TO query_new_user;
      GRANT SELECT, INSERT ON query_new_scope.subject, public.subject TO query_new_user;
      GRANT USAGE ON SEQUENCE query_new_scope.subject_id_seq TO query_new_user`);
    await loadQuery({ ...config, user: 'query_new_user', password },
      "SELECT note AS 说明 FROM query_new_scope.subject WHERE note = '匹配条件';");
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const add = query.getByRole('button', { name: text.add, exact: true });
    const form = page.getByRole('dialog', { name: tableText.add, exact: true });
    const preview = page.getByRole('dialog', { name: text.addTitle, exact: true });
    const read = async () => (await observer.query('SELECT id::text, note FROM query_new_scope.subject ORDER BY id')).rows;
    const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
      .filter(task => task.kind === 'query.execute' && task.status === 'completed').length);
    let completed = 0;
    const run = async () => {
      await execute.click();
      await expect.poll(executions).toBe(++completed);
      await expect(add).toBeEnabled();
    };
    const stage = async (note?: string) => {
      await add.click();
      if (note !== undefined) {
        await form.getByLabel('note ' + tableText.valueMode, { exact: true }).selectOption('text');
        await form.getByLabel('note ' + tableText.value, { exact: true }).fill(note);
      }
      await form.getByRole('button', { name: tableText.stage, exact: true }).click();
      await expect(preview.locator('pre')).toHaveText('INSERT INTO "query_new_scope"."subject"' +
        (note === undefined ? ' DEFAULT VALUES' : ' ("note") VALUES ($1)'));
    };
    const submit = async () => {
      const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: text.addConfirm, exact: true }).check();
      await apply.click();
    };

    await run();
    await expect(query.getByRole('gridcell')).toHaveCount(0);
    await expect(query.getByRole('button', { name: text.edit, exact: true })).toBeHidden();
    await stage();
    await observer.query('ALTER TABLE query_new_scope.subject ADD COLUMN optional text');
    await submit();
    await expect(preview.locator('.error-box')).toContainText('关系结构或权限已变化');
    expect(await read()).toEqual([]);
    await answerDialogs([0]);
    const [confirmation] = await Promise.all([page.waitForEvent('dialog'),
      preview.getByRole('button', { name: text.editBack, exact: true }).click()]);
    expect(confirmation.message()).toBe(text.addDiscard);
    await expect(preview).toBeHidden();

    await run();
    await stage();
    expect(await read()).toEqual([]);
    await submit();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual([{ id: '9007199254740993', note: '默认内容' }]);
    expect(await executions()).toBe(completed);

    await run();
    await expect(query.getByRole('gridcell')).toHaveCount(0);
    await stage('匹配条件');
    await info.attach('PostgreSQL查询来源表新增预览', { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    expect(await executions()).toBe(completed);
    expect(await read()).toEqual([
      { id: '9007199254740993', note: '默认内容' }, { id: '9007199254740994', note: '匹配条件' },
    ]);
    expect((await observer.query('SELECT * FROM public.subject')).rows).toEqual([]);
    await run();
    await expect(query.getByRole('gridcell', { name: '匹配条件', exact: true })).toBeVisible();
    for (const name of [text.edit, text.deleteChecked, text.duplicateChecked])
      await expect(query.getByRole('button', { name, exact: true })).toBeHidden();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
