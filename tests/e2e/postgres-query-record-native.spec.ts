import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { answerDialogs, clickNativeFind, test, expect, page, pageErrors } from './desktop-fixture';
import { postgresResultOriginsZh as text } from '../../src/renderer/locales/postgresResultOrigins.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { dataSearchRecordsZh as recordText } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { gridRangeFillZh as fillText } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { postgresBatchDuplicateZh as duplicateText } from '../../src/renderer/locales/postgresBatchDuplicate.zh-CN';
import { postgresBatchEditZh as batchText } from '../../src/renderer/locales/postgresBatchEdit.zh-CN';
import { postgresTableFindZh as findText } from '../../src/renderer/locales/postgresTableFind.zh-CN';
import { queryResultFindZh as resultFind } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSelectedFilterZh } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { primaryKeyCopyZh as keyCopy } from '../../src/renderer/locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh as updateCopy } from '../../src/renderer/locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh as deleteCopy } from '../../src/renderer/locales/deleteSqlCopy.zh-CN';
import { copyInsertSqlZh as insertCopy } from '../../src/shared/copyInsertSql.zh-CN';
import { postgresReferencePickerZh as referenceText } from '../../src/renderer/locales/postgresReferencePicker.zh-CN';
import { cellClipboardType, encodeClipboard } from '../../src/renderer/gridClipboard';
import { tableCellFilterZh } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

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

async function loadQuery({ port, user, database, password }: ReturnType<typeof isolatedConnection>, sql: string, table?: string) {
  const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
    id: '', name: '原记录专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
    port, user, database, password, rememberPassword: false,
  });
  await page.evaluate(async ({ connectionId, database, sql, table }) => {
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: table ? 'pg-filter-table' : 'pg-query-record',
      tabs: table ? [{ id: 'pg-filter-table', title: table, kind: 'table', connectionId, database, table }]
        : [{ id: 'pg-query-record', title: '原记录查询', kind: 'query', connectionId, database, sql }] });
  }, { connectionId, database, sql, table });
  await page.reload();
}

test('PostgreSQL 表页文本快捷筛选按字面排除且保留原 NULL 语义', async () => {
  const config = isolatedConnection(), observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.filter_text (id bigint PRIMARY KEY, note varchar(60));
      INSERT INTO public.filter_text VALUES (1,'A%_'),(2,'前A%_后'),(3,'a%_'),(4,'普通'),(5,NULL)`);
    await loadQuery(config, '', 'filter_text');
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    await cell('A%_').click({ button: 'right' });
    await page.getByRole('menuitem', { name: tableCellFilterZh.notContains, exact: true }).click();
    await expect(tab.getByLabel(zh.table.filterOperatorLabel, { exact: true })).toHaveValue('NOT CONTAINS');
    await tab.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(cell('前A%_后')).toBeVisible();
    await tab.getByRole('button', { name: tableText.applyAdvancedFilter, exact: true }).click();
    await expect(grid.locator('[role="gridcell"][aria-colindex="2"]')).toHaveText(['3', '4']);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 只读查询结果可沿复合外键查看父子记录并拒绝陈旧原行', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE SCHEMA query_fk;
      CREATE SCHEMA query_fk_target;
      CREATE TABLE public.query_fk_parent (tenant text, id bigint, label text, PRIMARY KEY (tenant, id));
      CREATE TABLE query_fk_target.query_fk_parent (LIKE public.query_fk_parent INCLUDING ALL);
      CREATE TABLE query_fk.subject (tenant text, id bigint, parent_id bigint, label text,
        PRIMARY KEY (tenant, id), FOREIGN KEY (tenant, parent_id) REFERENCES query_fk_target.query_fk_parent (tenant, id));
      CREATE TABLE query_fk.detail (id integer PRIMARY KEY, tenant text, subject_id bigint, label text,
        FOREIGN KEY (tenant, subject_id) REFERENCES query_fk.subject (tenant, id));
      INSERT INTO public.query_fk_parent VALUES ('区甲', 9007199254740993, '同名表干扰');
      INSERT INTO query_fk_target.query_fk_parent VALUES ('区甲', 9007199254740993, '准确父甲'), ('区乙', 9007199254740993, '父乙干扰');
      INSERT INTO query_fk.subject VALUES ('区甲', 2, 9007199254740993, '所选甲'), ('区乙', 3, 9007199254740993, '所选乙');
      INSERT INTO query_fk.detail VALUES (1, '区甲', 2, '明细甲一'), (2, '区甲', 2, '明细甲二'), (3, '区乙', 3, '明细乙干扰');
      CREATE ROLE query_fk_reader LOGIN PASSWORD '${password}';
      GRANT USAGE ON SCHEMA query_fk, query_fk_target TO query_fk_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA query_fk, query_fk_target TO query_fk_reader;
      GRANT SELECT ON public.query_fk_parent TO query_fk_reader;`);
    await loadQuery({ ...config, user: 'query_fk_reader', password },
      'SELECT tenant AS 区, id AS 编号, label AS 内容 FROM query_fk.subject ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    const button = (name: string) => query.getByRole('button', { name, exact: true });
    const cell = query.getByRole('gridcell', { name: '所选甲', exact: true });
    const parent = page.getByRole('dialog', { name: referenceText.browseTitle, exact: true });
    const children = page.getByRole('dialog', { name: referenceText.childrenTitle, exact: true });
    const related = page.locator('.postgres-related-table-tab:visible');
    const tasks = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
      .filter(task => task.kind === 'query.execute'));

    await button(postgresZh.execute).click();
    await expect(button(referenceText.browse)).toBeDisabled();
    await expect(button(text.edit)).toHaveCount(0);
    await query.getByRole('columnheader', { name: '编号' }).click();
    await expect(cell.locator('..')).toHaveAttribute('aria-rowindex', '2');
    await cell.click();
    const before = await tasks();
    await button(referenceText.browse).click();
    await expect(parent.getByRole('table')).toContainText('准确父甲');
    await expect(parent.getByRole('table')).not.toContainText(/父乙干扰|同名表干扰/);
    await expect(parent.getByRole('button', { name: referenceText.use, exact: true })).toHaveCount(0);
    await info.attach('PostgreSQL查询结果外键关联', { body: await page.screenshot(), contentType: 'image/png' });
    await parent.getByRole('button', { name: referenceText.openRelated, exact: true }).click();
    await expect(related.getByRole('grid')).toContainText('准确父甲');
    await expect(related.getByRole('grid')).not.toContainText(/父乙干扰|同名表干扰/);
    await page.locator('.tab-strip .tab-select').getByText('原记录查询', { exact: true }).click();
    await cell.click();
    await button(referenceText.children).click();
    await expect(children.getByRole('table')).toContainText('明细甲一');
    await expect(children.getByRole('table')).toContainText('明细甲二');
    await expect(children.getByRole('table')).not.toContainText('明细乙干扰');
    await children.getByRole('searchbox', { name: referenceText.childQuery }).fill('明细甲二');
    await children.getByRole('button', { name: referenceText.childSearch, exact: true }).click();
    await expect(children.getByRole('table')).not.toContainText('明细甲一');
    await children.getByRole('button', { name: referenceText.openRelated, exact: true }).click();
    await expect(related.getByRole('grid')).toContainText('明细甲二');
    await expect(related.getByRole('grid')).not.toContainText(/明细甲一|明细乙干扰/);

    await page.locator('.tab-strip .tab-select').getByText('原记录查询', { exact: true }).click();
    await cell.click();
    await button(referenceText.browse).click();
    await expect(parent.getByRole('table')).toContainText('准确父甲');
    await observer.query("UPDATE query_fk.subject SET label = '已改变' WHERE tenant = '区甲' AND id = 2");
    await parent.getByRole('button', { name: referenceText.openRelated, exact: true }).click();
    await expect(parent.getByRole('alert')).toContainText('原记录已变化');
    await parent.press('Escape');
    await expect(parent).toBeHidden();
    await cell.click();
    await button(referenceText.browse).click();
    await expect(parent.getByRole('alert')).toContainText('查询原记录无法核验');
    expect(await tasks()).toEqual(before);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

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
    await observer.query(`CREATE TABLE public.query_fill (id bigint PRIMARY KEY, note text, src bytea, dst bytea, qty bigint);
      INSERT INTO public.query_fill VALUES
        (2, '首行样本', decode('00FEFF','hex'), decode('BEEF','hex'), 15),
        (3, '首行样本', NULL, decode('CAFE','hex'), 16),
        (9223372036854775807, '末行原值', decode('1234','hex'), decode('CAFE','hex'), 17)`);
    await loadQuery(config, 'SELECT id AS 编号, note, src AS 同名, dst AS 同名, qty FROM public.query_fill ORDER BY id DESC;');
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const edit = query.getByRole('button', { name: text.edit, exact: true });
    const cell = (name: string) => query.getByRole('gridcell', { name, exact: true });
    const preview = page.getByRole('dialog', { name: text.fillTitle, exact: true });
    const read = async () => (await observer.query(`SELECT id::text, note, encode(src,'hex') AS src,
      encode(dst,'hex') AS dst, qty::text AS qty, xmin::text FROM public.query_fill ORDER BY id`)).rows;
    const expectPreview = async () => {
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
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
    await expectPreview();
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
    await cell('0x1234').click({ button: 'right' });
    await page.getByRole('menuitem', { name: fillText.right, exact: true }).click();
    await expectPreview();
    await expect(preview.locator('dt')).toHaveText(['dst', 'dst']);
    await expect(preview.locator('dd')).toHaveText(['1234', 'NULL']);
    expect(await read()).toEqual(afterDown);
    await info.attach('PostgreSQL查询结果选区填充', { body: await page.screenshot(), contentType: 'image/png' });
    await submit(2);
    const afterRight = await read();
    expect(afterRight[0]).toEqual(before[0]);
    expect(afterRight.map(row => [row.src, row.dst])).toEqual([['00feff', 'beef'], [null, null], ['1234', '1234']]);
    await execute.click();
    await expect(cell('15')).toBeVisible();
    const idHeader = query.getByRole('columnheader', { name: '编号' });
    if (!await idHeader.getByLabel(queryResultSortZh.ascending).isVisible()) await idHeader.click();
    await expect(cell('15').locator('..')).toHaveAttribute('aria-rowindex', '2');
    await cell('15').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await query.getByRole('button', { name: fillText.open, exact: true }).click();
    const form = query.getByRole('region', { name: fillText.open, exact: true });
    await form.getByRole('combobox', { name: fillText.kind, exact: true }).selectOption('sequence');
    await form.getByRole('textbox', { name: fillText.sequenceStart, exact: true }).fill('-9223372036854775808');
    await form.getByRole('textbox', { name: fillText.sequenceStep, exact: true }).fill('3');
    await form.getByRole('button', { name: fillText.stage, exact: true }).click();
    await expectPreview();
    const sequence = ['-9223372036854775808', '-9223372036854775805', '-9223372036854775802'];
    await expect(preview.locator('dd')).toHaveText(sequence);
    expect(await read()).toEqual(afterRight);
    await submit(3);
    expect((await read()).map(row => row.qty)).toEqual(sequence);
    await observer.query("UPDATE public.query_fill SET note = CASE id WHEN 2 THEN NULL WHEN 3 THEN '' ELSE 'NULL' END");
    await execute.click();
    await expect(cell('2')).toBeVisible();
    if (!await idHeader.getByLabel(queryResultSortZh.ascending).isVisible()) await idHeader.click();
    const beforeNullFill = await read();
    const noteColumn = await query.getByRole('columnheader').filter({ hasText: /^note/ }).getAttribute('aria-colindex');
    await cell('2').locator('..').locator('[role="gridcell"][aria-colindex="' + noteColumn + '"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await query.getByRole('button', { name: fillText.open, exact: true }).click();
    await form.getByRole('textbox', { name: fillText.value, exact: true }).fill('补齐');
    await form.getByRole('checkbox', { name: fillText.onlyNull, exact: true }).check();
    await form.getByRole('button', { name: fillText.stage, exact: true }).click();
    await expectPreview();
    await expect(preview.locator('dd')).toHaveText(['补齐']);
    expect(await read()).toEqual(beforeNullFill);
    await submit(1);
    const afterNullFill = await read();
    expect(afterNullFill[0]).toMatchObject({ note: '补齐' });
    expect(afterNullFill.slice(1)).toEqual(beforeNullFill.slice(1));
    await execute.click();
    await expect(cell('补齐')).toBeVisible();
    if (!await idHeader.getByLabel(queryResultSortZh.ascending).isVisible()) await idHeader.click();
    await cell(sequence[0]).click();
    await page.keyboard.press('Shift+ArrowDown');
    const endpoint = cell(sequence[1]);
    await expect(endpoint).toBeFocused();
    await endpoint.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: queryResultSelectedFilterZh.range, exact: true }).press('Enter');
    const filter = query.getByRole('region', { name: queryResultFilterZh.title, exact: true });
    await expect(filter.getByLabel(queryResultFilterZh.operator + ' 1', { exact: true })).toHaveValue('in');
    await expect(cell(sequence[2])).toBeVisible();
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell(sequence[0])).toBeVisible();
    await expect(cell(sequence[1])).toBeVisible();
    await expect(cell(sequence[2])).toHaveCount(0);
    await (await navigationMenuItem(query, { name: queryResultFilterZh.clear, exact: true })).click();
    await expect(cell(sequence[2])).toBeVisible();
    await cell(sequence[0]).click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(endpoint).toBeFocused();
    await endpoint.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: queryResultSelectedFilterZh.rangeExclude, exact: true }).press('Enter');
    await expect(filter.getByLabel(queryResultFilterZh.operator + ' 1', { exact: true })).toHaveValue('notIn');
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell(sequence[0])).toHaveCount(0);
    await expect(cell(sequence[1])).toHaveCount(0);
    await expect(cell(sequence[2])).toBeVisible();
    await (await navigationMenuItem(query, { name: queryResultFilterZh.clear, exact: true })).click();
    await cell(sequence[1]).click({ button: 'right' });
    await page.getByRole('menuitem', { name: queryResultFilterZh.cellBounds.lte, exact: true }).press('Enter');
    await expect(filter.getByLabel(queryResultFilterZh.input + ' 1', { exact: true })).toHaveValue(sequence[1]);
    await filter.getByRole('button', { name: queryResultFilterZh.apply, exact: true }).click();
    await expect(cell(sequence[0])).toBeVisible();
    await expect(cell(sequence[1])).toBeVisible();
    await expect(cell(sequence[2])).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

for (const join of ['', 'LEFT JOIN', 'INNER JOIN'] as const) test(`PostgreSQL ${join || '单表'}查询按勾选原主键删除并验证整批回滚`, async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  const schema = 'query_delete_' + (join === 'LEFT JOIN' ? 'left' : join ? 'inner' : 'single');
  const user = schema + '_user';
  const table = schema + '.subject', linked = schema + '.linked', reference = schema + '.detail',
    attempt = schema + '.attempt', audit = schema + '.audit';
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE SCHEMA ${schema};
      CREATE ROLE ${user} LOGIN PASSWORD '${password}';
      CREATE TABLE ${table} (tenant text, id bigint, note text, guard text, PRIMARY KEY (tenant,id));
      INSERT INTO ${table} VALUES ('区甲', 2, '待删甲', '保护'),
        ('区甲', 3, '保留同区', '保护'), ('区乙', 2, '保留同号', '保护'),
        ('区乙', 9223372036854775807, '待删乙', '保护');
      CREATE TABLE ${reference} (tenant text, id bigint,
        CONSTRAINT guarded_query_delete FOREIGN KEY (tenant,id) REFERENCES ${table});
      INSERT INTO ${reference} VALUES ('区乙', 9223372036854775807);
      CREATE TABLE ${audit} (tenant text, id bigint);
      CREATE SEQUENCE ${attempt};
      CREATE FUNCTION ${schema}.count_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path TO pg_catalog AS
        $$ BEGIN
          PERFORM nextval('${attempt}');
          INSERT INTO ${audit} VALUES (OLD.tenant, OLD.id);
          RETURN OLD;
        END $$;
      CREATE TRIGGER count_attempt BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${schema}.count_attempt();
      GRANT USAGE ON SCHEMA ${schema} TO ${user};
      GRANT SELECT, DELETE ON ${table} TO ${user}`);
    if (join) {
      await observer.query(`CREATE TABLE ${linked} (id bigint PRIMARY KEY, note text);
        INSERT INTO ${linked} VALUES (2,'连接内容'),(3,'连接同区');
        GRANT SELECT ON ${linked} TO ${user}`);
      if (join === 'INNER JOIN') await observer.query(`INSERT INTO ${linked} VALUES (9223372036854775807,'连接乙')`);
    }
    await loadQuery({ ...config, user, password }, `SELECT p.tenant AS 区域, p.id AS 编号, p.note AS 备注
      ${join ? ', l.note AS 连接备注' : ''} FROM ${table} p ${join ? `${join} ${linked} l ON p.id=l.id` : ''}
      ORDER BY p.id DESC, p.tenant DESC;`);
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const remove = query.getByRole('button', { name: join ? text.deleteCheckedJoin : text.deleteChecked, exact: true });
    const preview = page.getByRole('dialog', { name: text.deleteTitle, exact: true });
    const read = async () => (await observer.query(`SELECT tenant, id::text, note, guard FROM ${table} ORDER BY tenant,id`)).rows;
    const readLinks = async () => (await observer.query(`SELECT id::text, note FROM ${linked} ORDER BY id`)).rows;
    const readAudit = async () => (await observer.query(`SELECT tenant, id::text FROM ${audit} ORDER BY tenant,id`)).rows;
    const before = await read();
    const beforeLinks = join ? await readLinks() : undefined;
    const stage = async () => {
      const rows = ['待删甲', '待删乙'].map(name => query.getByRole('gridcell', { name, exact: true }).locator('..'));
      const positions = await Promise.all(rows.map(async row => String(Number(await row.getAttribute('aria-rowindex')) - 1)));
      for (const row of rows.slice().reverse()) await row.getByRole('checkbox').check();
      await remove.click();
      const target = '"' + schema + '"."subject"';
      await expect(preview.locator('pre')).toContainText('DELETE FROM ONLY ' + target);
      await expect(preview.locator('pre')).not.toContainText('"linked"');
      await expect(preview.getByText(text.deleteTarget(target), { exact: true })).toBeVisible();
      await expect(preview.locator('tbody td')).toHaveText([positions[0], '区甲', '2', positions[1], '区乙', '9223372036854775807']);
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
    await expect(query.getByRole('button', { name: join ? text.editJoin : text.edit, exact: true })).toBeHidden();
    await expect(remove).toBeDisabled();
    await stage();
    expect(await read()).toEqual(before);
    await observer.query(`UPDATE ${table} SET guard='外部改动' WHERE tenant='区乙' AND id=9223372036854775807`);
    await submit();
    await expect(preview.locator('.error-box')).toContainText('原记录已被修改、删除或替换，整批未写入');
    expect((await observer.query(`SELECT is_called FROM ${attempt}`)).rows[0].is_called).toBe(false);
    expect(await readAudit()).toEqual([]);
    expect(await read()).toHaveLength(4);
    await discard();

    await run();
    await stage();
    const current = await read();
    await submit();
    await expect(preview.locator('.error-box')).toContainText('guarded_query_delete');
    expect((await observer.query(`SELECT last_value::int FROM ${attempt}`)).rows[0].last_value).toBe(2);
    expect(await readAudit()).toEqual([]);
    expect(await read()).toEqual(current);
    await discard();

    await observer.query(`DELETE FROM ${reference}`);
    if (join) {
      await stage();
      await observer.query(`REVOKE DELETE ON ${table} FROM ${user}`);
      await submit();
      await expect(preview.locator('.error-box')).toContainText('权限已变化');
      expect(await read()).toEqual(current);
      expect(await readAudit()).toEqual([]);
      await discard();
      await observer.query(`GRANT DELETE ON ${table} TO ${user}`);
      await run();
    }
    await stage();
    expect(await read()).toEqual(current);
    await info.attach(`PostgreSQL${join ? join.replace(' ', '') : '单表'}查询勾选删除预览`, { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    await expect(remove).toBeHidden();
    expect(await read()).toEqual(current.filter(row => row.note.startsWith('保留')));
    expect(await readAudit()).toEqual(current.filter(row => row.note.startsWith('待删')).map(({ tenant, id }) => ({ tenant, id })));
    if (join) expect(await readLinks()).toEqual(beforeLinks);
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

test('PostgreSQL JOIN 只写入明确定位的首张表，重复主键和自连接保持只读', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE SCHEMA join_main; CREATE SCHEMA join_side;
      CREATE TABLE join_main.subject (id bigint PRIMARY KEY, side_id bigint, note text);
      CREATE TABLE join_side.subject (id bigint PRIMARY KEY, note text);
      INSERT INTO join_main.subject VALUES (2,1,'主表已匹配'), (9223372036854775807,99,'主表未匹配');
      INSERT INTO join_side.subject VALUES (1,'右表原值'), (2,'右表第二行')`);
    await loadQuery(config, `SELECT s.note AS 同名, p.id, p.note AS 同名, s.id AS 侧编号
      FROM join_main.subject AS p LEFT OUTER JOIN join_side.subject AS s ON p.side_id=s.id ORDER BY p.id DESC;`);
    const query = page.locator('.postgres-query:visible');
    const execute = query.getByRole('button', { name: postgresZh.execute, exact: true });
    const edit = query.getByRole('button', { name: text.editJoin, exact: true });
    const remove = query.getByRole('button', { name: text.deleteCheckedJoin, exact: true });
    const cell = (name: string) => query.getByRole('gridcell', { name, exact: true });
    await execute.click();
    await expect(edit).toBeVisible();
    await expect(remove).toBeDisabled();
    for (const name of [text.add, text.deleteChecked, text.duplicateChecked])
      await expect(query.getByRole('button', { name, exact: true })).toBeHidden();
    const inline = page.getByRole('region', { name: tableText.cellEdit('note'), exact: true });
    await cell('右表原值').click();
    await page.keyboard.press('F2');
    await expect(cell('右表原值')).toBeFocused();
    await expect(inline).toBeHidden();
    await page.keyboard.press('Shift+ArrowRight');
    await query.locator('[role="gridcell"]:focus').evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', '拒绝\t拒绝');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(query.getByText(text.joinColumnReadOnly, { exact: true })).toBeVisible();

    await cell('主表未匹配').dblclick();
    const input = inline.getByRole('textbox', { name: tableText.value, exact: true });
    await expect(input).toHaveValue('主表未匹配');
    await input.fill('只更新主表');
    await input.press('Enter');
    const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "join_main"."subject" SET "note" = $1');
    await info.attach('PostgreSQL连接查询主表编辑', { body: await page.screenshot(), contentType: 'image/png' });
    await preview.getByRole('checkbox', { name: recordText.postgresConfirm, exact: true }).check();
    await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(preview).toBeHidden();
    expect((await observer.query('SELECT id::text, note FROM join_main.subject ORDER BY id')).rows).toEqual([
      { id: '2', note: '主表已匹配' }, { id: '9223372036854775807', note: '只更新主表' },
    ]);
    expect((await observer.query('SELECT id::text, note FROM join_side.subject ORDER BY id')).rows).toEqual([
      { id: '1', note: '右表原值' }, { id: '2', note: '右表第二行' },
    ]);

    const rerun = async (sql: string, resultLimit?: number) => {
      await page.evaluate(async ({ sql, resultLimit }) => {
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, resultLimit: resultLimit ?? settings.resultLimit,
          tabs: settings.tabs.map(tab => tab.id === 'pg-query-record' ? { ...tab, sql } : tab) });
      }, { sql, resultLimit });
      await page.reload();
      await execute.click();
    };
    await rerun('SELECT p.*, s.note AS 侧注 FROM join_main.subject p INNER JOIN join_side.subject s ON p.side_id=s.id;');
    await cell('主表已匹配').click();
    await edit.click();
    const form = page.getByRole('dialog', { name: tableText.edit, exact: true });
    await expect(form.getByLabel('note ' + tableText.valueMode, { exact: true })).toBeVisible();
    await form.getByRole('button', { name: tableText.cancel, exact: true }).click();
    await rerun('SELECT p.id, p.note, s.note AS 侧注 FROM join_main.subject p JOIN join_main.subject s ON p.id=s.id;');
    await expect(cell('只更新主表')).toHaveCount(2);
    await expect(edit).toBeHidden();
    await expect(remove).toBeHidden();
    await rerun('SELECT p.id, p.note, s.note AS 侧注 FROM join_main.subject p JOIN join_side.subject s ON p.side_id<=s.id;');
    await expect(cell('主表已匹配')).toHaveCount(2);
    await expect(edit).toBeHidden();
    await expect(remove).toBeHidden();
    await rerun('SELECT p.id, p.note, s.note AS 侧注 FROM join_main.subject p LEFT JOIN join_side.subject s ON p.side_id=s.id ORDER BY p.id;', 1);
    await expect(edit).toBeVisible();
    await expect(cell('主表已匹配')).toBeVisible();
    await expect(cell('只更新主表')).toHaveCount(0);
    await expect(remove).toBeHidden();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 查询文本替换按原字段去重，保留计算列和查询范围外记录', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  try {
    await observer.connect();
    await observer.query(`CREATE TABLE public.query_replace (
      id bigint PRIMARY KEY, note text, tag varchar(64), auto_text text GENERATED ALWAYS AS (note || '标记') STORED);
      INSERT INTO public.query_replace(id,note,tag) VALUES (1,'旧甲-旧甲','旧甲'), (2,'旧乙','保留'), (3,'旧乙','旧乙')`);
    await loadQuery(config, `SELECT id, note AS 同名, upper(note) AS 同名, note AS 重复, tag, auto_text
      FROM public.query_replace WHERE id < 3 ORDER BY id DESC;`);
    const query = page.locator('.postgres-query:visible');
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    const replace = query.getByRole('button', { name: text.replace, exact: true });
    await expect(replace).toBeEnabled();
    await query.getByRole('columnheader', { name: 'id' }).click();
    const cell = query.getByRole('gridcell', { name: '1', exact: true });
    await cell.click();
    await clickNativeFind();
    const search = query.getByRole('textbox', { name: resultFind.input, exact: true });
    await expect(search).toBeFocused();
    await query.getByRole('combobox', { name: resultFind.columns, exact: true }).selectOption({ label: resultFind.columnOption('同名', 2) });
    await search.fill('旧甲');
    await expect(query.locator('.query-result-find-status').getByRole('status')).toHaveText(resultFind.count(1, -1));
    await query.getByRole('button', { name: resultFind.close, exact: true }).click();
    await cell.click();
    const shortcut = process.platform === 'darwin' ? 'Alt+Meta+f' : 'Control+h';
    await page.keyboard.press(shortcut);
    const panel = query.getByRole('region', { name: findText.title, exact: true });
    const replacement = panel.getByLabel(findText.replacement, { exact: true });
    await expect(replacement).toBeFocused();
    await query.getByRole('gridcell', { name: '1', exact: true }).click();
    await page.keyboard.press(shortcut);
    await expect(replacement).toBeFocused();
    const read = async () => (await observer.query('SELECT id::text, note, tag, auto_text FROM public.query_replace ORDER BY id')).rows;
    const before = await read();
    await panel.getByRole('checkbox', { name: findText.regex, exact: true }).check();
    await panel.getByRole('checkbox', { name: findText.captures, exact: true }).check();
    await panel.getByLabel(findText.query, { exact: true }).fill('(旧)([甲乙])');
    await replacement.fill('$2新');
    const review = panel.getByRole('region', { name: findText.review, exact: true });
    await panel.getByRole('button', { name: findText.one, exact: true }).click();
    await expect(review).toContainText(findText.reviewCount(1, 1));
    await expect(review).toContainText('甲新-旧甲');
    await review.getByRole('button', { name: findText.cancel, exact: true }).click();
    expect(await read()).toEqual(before);
    await panel.getByRole('button', { name: findText.all, exact: true }).click();
    await expect(review).toContainText(findText.reviewCount(3, 2));
    await expect(review).toContainText('甲新-甲新');
    await review.getByRole('button', { name: tableText.stage, exact: true }).click();
    const preview = page.getByRole('dialog', { name: text.replaceTitle, exact: true });
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."query_replace" SET "note" = $1, "tag" = $2');
    await expect(preview.locator('dt')).toHaveText(['note', 'tag', 'note']);
    expect(await read()).toEqual(before);
    const apply = preview.getByRole('button', { name: tableText.apply, exact: true });
    await expect(apply).toBeDisabled();
    await info.attach('PostgreSQL查询文本替换预览', { body: await page.screenshot(), contentType: 'image/png' });
    await preview.getByRole('checkbox', { name: text.rangeConfirm(2), exact: true }).check();
    await apply.click();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual([
      { id: '1', note: '甲新-甲新', tag: '甲新', auto_text: '甲新-甲新标记' },
      { id: '2', note: '乙新', tag: '保留', auto_text: '乙新标记' },
      before[2],
    ]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});

test('PostgreSQL 只读查询按复合主键生成可回放的原表 SQL 和查询草稿', async ({}, info) => {
  const config = isolatedConnection();
  const observer = new Client(config);
  const table = '"row.sql"."two""names"';
  try {
    await observer.connect();
    const password = randomBytes(32).toString('hex');
    await observer.query(`CREATE ROLE query_row_sql_user LOGIN PASSWORD '${password}';
      CREATE SCHEMA "row.sql";
      CREATE TABLE ${table} (tenant text, id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993),
        note text, payload bytea, calc integer GENERATED ALWAYS AS (length(note)) STORED,
        PRIMARY KEY (tenant,id));
      INSERT INTO ${table}(tenant,note,payload) VALUES ('区甲','原''值',decode('00FEFF','hex')), ('区乙','',NULL), ('范围外','保留',NULL);
      GRANT USAGE ON SCHEMA "row.sql" TO query_row_sql_user;
      GRANT SELECT ON ${table} TO query_row_sql_user`);
    await loadQuery({ ...config, user: 'query_row_sql_user', password },
      `SELECT id AS 编号, note AS 同名, upper(note) AS 同名, tenant AS 分组, payload, note AS 重复, calc
        FROM ${table} WHERE tenant <> '范围外' ORDER BY id DESC;`);
    const query = page.locator('.postgres-query:visible');
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    const button = (name: string) => query.getByRole('button', { name, exact: true });
    await expect(button(insertCopy.selected)).toBeVisible();
    await expect(button(text.edit)).toBeHidden();
    await expect(button(text.add)).toBeHidden();
    await query.getByRole('columnheader', { name: '编号' }).click();
    const cell = (id: string) => query.getByRole('gridcell', { name: id, exact: true });
    for (const id of ['9007199254740994', '9007199254740993']) await cell(id).locator('..').getByRole('checkbox').check();
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const beforeTasks = await tasks();
    const read = async () => (await observer.query(`SELECT tenant,id::text,note,encode(payload,'hex') AS payload,calc FROM ${table} ORDER BY id`)).rows;
    const before = await read();
    const handle = await page.evaluateHandle(() => {
      const captured: string[] = [];
      const descriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', { configurable: true, value: (command: string) => {
        if (command !== 'copy') return false;
        const clipboardData = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
        captured.push(clipboardData.getData('text/plain'));
        return true;
      } });
      return { captured, restore: () => {
        if (descriptor) Object.defineProperty(document, 'execCommand', descriptor);
        else Reflect.deleteProperty(document, 'execCommand');
      } };
    });
    let sql: string[];
    try {
      for (const name of [insertCopy.selected, keyCopy.action, updateCopy.action, deleteCopy.action]) await button(name).click();
      sql = await handle.evaluate(value => value.captured);
    } finally {
      await handle.evaluate(value => value.restore());
      await handle.dispose();
    }
    expect(sql).toHaveLength(4);
    const [insert, select, update, remove] = sql;
    expect(insert).toContain(`INSERT INTO ${table} ("id", "note", "tenant", "payload") OVERRIDING SYSTEM VALUE`);
    expect(select).toContain(`SELECT * FROM ONLY ${table}\nWHERE ("tenant" = E'区甲' AND "id" = E'9007199254740993')`);
    expect(update).toContain(`UPDATE ONLY ${table}\nSET "note" = E'原''值', "payload" =`);
    expect(remove).toContain(`DELETE FROM ONLY ${table}\nWHERE ("tenant" = E'区甲' AND "id" = E'9007199254740993')`);
    expect(await tasks()).toEqual(beforeTasks);
    expect(await read()).toEqual(before);

    await observer.query('BEGIN');
    try {
      await observer.query('SET LOCAL standard_conforming_strings = off');
      expect((await observer.query(select)).rows.map(row => row.id).sort()).toEqual(['9007199254740993', '9007199254740994']);
      await observer.query(update);
      await observer.query(remove);
      expect(await read()).toEqual([before[2]]);
      await observer.query(insert);
      expect(await read()).toEqual(before);
    } finally { await observer.query('ROLLBACK'); }

    await button(updateCopy.open).click();
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).tabs
      .filter(tab => tab.title.endsWith('UPDATE 草稿')).map(tab => ({ sql: tab.sql, database: tab.database })))).toEqual([
      { sql: update, database: config.database },
    ]);
    const editor = query.locator('.view-lines');
    await expect(editor).toContainText('UPDATE');
    await expect(editor).toContainText('9007199254740993');
    await info.attach('PostgreSQL查询结果原记录SQL草稿', { body: await page.screenshot(), contentType: 'image/png' });
    expect(await tasks()).toEqual(beforeTasks);
    expect(await read()).toEqual(before);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
