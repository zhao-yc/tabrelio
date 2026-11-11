import { Client } from 'pg';
import { columnEnumerationZh as members } from '../../src/renderer/locales/columnEnumeration.zh-CN';
import { postgresTableZh as text } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresRecordViewZh as record } from '../../src/renderer/locales/postgresRecordView.zh-CN';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('PostgreSQL 网格与记录表单选择 ENUM 成员并集中提交', async ({}, info) => {
  const database = process.env.DBARK_PG_ENUM_DATABASE ?? '', password = process.env.DBARK_PG_ENUM_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PG_ENUM_PORT), table = '"public"."enum_subject"';
  test.skip(!database, '需要显式启用本轮独占 PostgreSQL 枚举库');
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
      !/^tabrelio_en_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本轮独占回环测试库');
  const profile = { host: '127.0.0.1', database, port, user: database, password };
  const observer = new Client({ ...profile, connectionTimeoutMillis: 3000 });
  const read = async () => (await observer.query('SELECT id, state::text, domain_state::text, states::text FROM public.enum_subject ORDER BY id')).rows;
  try {
    await observer.connect();
    const baseline = await read();
    await page.evaluate(async ({ profile, table }) => {
      const connection = await window.dbark.invoke('connections.save', { ...profile, id: '', dialect: 'postgresql',
        name: '枚举字段验收', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'enum-table', tabs: [
        { kind: 'table', id: 'enum-table', title: 'enum_subject', connectionId: connection.id, database: profile.database, table },
      ] });
    }, { profile, table });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    const cell = async (name: string, row = 2) => {
      const header = tab.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: new RegExp('^' + name + '$') }) });
      await expect(header).toBeVisible();
      const index = await header.getAttribute('aria-colindex');
      return tab.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
    };
    const editor = (name: string) => page.getByRole('region', { name: text.cellEdit(name), exact: true });
    const open = async (name: string, row?: number) => { await (await cell(name, row)).dblclick(); await expect(editor(name)).toBeVisible(); return editor(name); };
    const stage = async (name: string) => {
      await editor(name).getByRole('button', { name: text.stage, exact: true }).click();
      await expect(editor(name)).toHaveCount(0);
    };

    const state = await open('state');
    const picker = state.getByRole('combobox', { name: members.enum, exact: true });
    const labels = ['等待', '处理中', 'NULL', members.empty, "O'Reilly"];
    await expect(picker.getByRole('option')).toHaveText(labels);
    await picker.selectOption({ label: members.empty });
    await state.getByRole('button', { name: members.raw, exact: true }).click();
    const raw = state.getByRole('textbox', { name: text.value, exact: true });
    await expect(raw).toHaveValue('');
    await raw.fill('处理中');
    await state.getByRole('button', { name: members.choose, exact: true }).click();
    await expect(picker.locator('option:checked')).toHaveText('处理中');
    await picker.selectOption({ label: members.empty });
    await page.screenshot({ path: info.outputPath('PostgreSQL枚举空标签.png') });
    await stage('state');

    const array = await open('states');
    await expect(array.getByRole('combobox', { name: members.enum, exact: true })).toHaveCount(0);
    await expect(array.getByRole('textbox', { name: text.value, exact: true })).toHaveValue('{等待}');
    await array.getByRole('button', { name: text.cancel, exact: true }).click();

    const other = await open('state', 3);
    const mode = other.getByRole('combobox', { name: text.valueMode, exact: true });
    await expect(mode).toHaveValue('null');
    await mode.selectOption('text');
    await other.getByRole('combobox', { name: members.enum, exact: true }).selectOption({ label: 'NULL' });
    await stage('state');

    await (await cell('id')).click();
    await tab.getByRole('button', { name: record.view, exact: true }).click();
    const form = tab.getByRole('region', { name: record.title, exact: true });
    await form.getByRole('combobox', { name: 'domain_state ' + text.valueMode, exact: true }).selectOption('text');
    const domain = form.getByRole('combobox', { name: 'domain_state ' + text.value, exact: true });
    await expect(domain.getByRole('option')).toHaveText(labels);
    await domain.selectOption({ label: "O'Reilly" });
    await form.getByRole('button', { name: record.stage, exact: true }).click();
    await tab.getByRole('button', { name: record.grid, exact: true }).click();

    expect(await read()).toEqual(baseline);
    await tab.getByRole('button', { name: text.preview, exact: true }).click();
    const preview = page.getByRole('dialog', { name: text.preview, exact: true });
    await expect(preview).toBeVisible();
    expect(await read()).toEqual(baseline);
    await preview.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(read).toEqual([
      { ...baseline[0], state: '', domain_state: "O'Reilly" },
      { ...baseline[1], state: 'NULL' },
      baseline[2],
    ]);
    expect(pageErrors).toEqual([]);
    await observer.end();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    await observer.end().catch(() => undefined);
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
