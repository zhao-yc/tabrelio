import { Client } from 'pg';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { postgresTableFindZh as find } from '../../src/renderer/locales/postgresTableFind.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';
import { tableGridZh as gridText } from '../../src/renderer/locales/tableGrid.zh-CN';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(60_000);

test('PostgreSQL 网格正则替换保留原值、捕获组与零宽位置', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.regex_grid(id bigint PRIMARY KEY, note text, fixed text GENERATED ALWAYS AS ('Shadow99') STORED);
      INSERT INTO public.regex_grid(id,note) VALUES (12,'Foo12 Bar34'),(34,'Baz56'),(56,'😀xx'),(78,repeat('a',36) || '!')`);
    const notes = async () => (await observer.query('SELECT note FROM public.regex_grid ORDER BY id LIMIT 3')).rows.map(row => row.note);
    const original = await notes();
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '本例 PostgreSQL 网格正则', group: '', color: '#123456', dialect: 'postgresql' as const,
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-grid-regex', tabs: [
        { id: 'pg-grid-regex', title: 'regex_grid', kind: 'table', connectionId, database, table: '"public"."regex_grid"' },
      ] });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    await expect(grid).toContainText('Foo12 Bar34');
    await button(find.replaceTitle).click();
    const panel = tab.getByRole('region', { name: find.title, exact: true });
    const query = panel.getByRole('textbox', { name: find.query, exact: true });
    const replacement = panel.getByRole('textbox', { name: find.replacement, exact: true });
    const capture = panel.getByRole('checkbox', { name: find.captures, exact: true });
    const status = panel.getByRole('status');
    const review = panel.getByRole('region', { name: find.review, exact: true });
    const draft = tab.getByLabel(table.draft, { exact: true });
    const stageButton = review.getByRole('button', { name: table.stage, exact: true });
    const stage = () => stageButton.click();
    await query.fill('Foo');
    await expect(status).toHaveText(find.ready(1, 0));
    await replacement.fill('test$&');
    await button(find.one).click();
    await expect(review).toContainText('test$&12 Bar34');
    await button(find.cancel).click();
    await expect(draft).toHaveCount(0);

    await panel.getByRole('checkbox', { name: find.regex, exact: true }).check();
    await expect(capture).not.toBeChecked();
    await panel.getByRole('combobox', { name: find.column, exact: true }).selectOption({ label: 'note' });
    await query.fill('[');
    await expect(panel.getByText(gridText.regexInvalid, { exact: true })).toBeVisible();
    await query.fill('^(a+)+$');
    await expect(panel.getByText(gridText.timeout, { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(draft).toHaveCount(0);

    await query.fill('(?<word>[A-Za-z]+)([0-9]+)');
    await expect(status).toHaveText(find.ready(3, 0));
    await replacement.fill('$2-$<word>');
    await button(find.one).click();
    await expect(review).toContainText('$2-$<word> Bar34');
    await button(find.cancel).click();
    await expect(draft).toHaveCount(0);

    await capture.check();
    await button(find.one).click();
    await expect(review).toContainText('12-Foo Bar34');
    await stage();
    await expect(status).toHaveText(find.ready(2, 0));
    await expect(draft).toContainText('12-Foo Bar34');
    expect(await notes()).toEqual(original);
    await button(history.undo).click();
    await expect(status).toContainText('共 3 处');

    await query.fill('(?=x)');
    await replacement.fill('-');
    await expect(status).toHaveText(find.ready(2, 0));
    await button(find.one).click();
    await expect(review).toContainText('😀-xx');
    await stage();
    await expect(status).toHaveText(find.ready(2, 1));
    await button(history.undo).click();
    await expect(draft).toHaveCount(0);

    await panel.getByRole('combobox', { name: find.column, exact: true }).selectOption('');
    await query.fill('([A-Za-z]+)([0-9]+)');
    await replacement.fill('$2-$1');
    await expect(status).toContainText('共 7 处');
    await button(find.all).click();
    await expect(review).toContainText(find.reviewCount(2, 2));
    await expect(review).not.toContainText('Shadow99');
    await panel.screenshot({ path: info.outputPath('PostgreSQL 网格正则查找面板.png') });
    await stageButton.scrollIntoViewIfNeeded();
    await expect(stageButton).toBeInViewport();
    await review.screenshot({ path: info.outputPath('PostgreSQL 网格正则替换完整预览.png') });
    await stage();
    expect(await notes()).toEqual(original);
    await button(history.undo).click();
    await expect(draft).toHaveCount(0);
    await button(history.redo).click();
    await expect(draft).toContainText(table.changes(2));
    await button(find.close).click();
    await button(table.preview).click();
    const sql = page.getByRole('dialog', { name: table.preview, exact: true });
    await expect(sql).toContainText(table.previewHint);
    await sql.getByRole('button', { name: table.apply, exact: true }).click();
    await expect(tab.getByRole('status')).toContainText('已确认整批提交');
    expect(await notes()).toEqual(['12-Foo 34-Bar', '56-Baz', '😀xx']);
    expect((await observer.query('SELECT DISTINCT fixed FROM public.regex_grid')).rows).toEqual([{fixed: 'Shadow99'}]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});
