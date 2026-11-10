import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { postgresTableZh as pgText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { tableReadHistoryZh as historyText } from '../../src/renderer/locales/tableReadHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('网络数据库表页按真实事务结果记录 SQL 模板', async ({}, info) => {
  const dialect = process.env.DBARK_TABLE_WRITE_HISTORY_DIALECT;
  test.skip(!dialect, '需要显式启用独占回环实库');
  if (dialect !== 'postgresql' && dialect !== 'mysql' && dialect !== 'mariadb') throw Error('数据库类型不符');
  const database = process.env.DBARK_TABLE_WRITE_HISTORY_DATABASE ?? '';
  const port = Number(process.env.DBARK_TABLE_WRITE_HISTORY_PORT);
  const password = process.env.DBARK_TABLE_WRITE_HISTORY_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_hd_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本例独占回环实库');
  const postgres = dialect === 'postgresql';
  const connection = { host: '127.0.0.1', port, database, user: database, password };
  const profile: NetworkConnectionProfile | PostgresConnectionProfile = {
    ...connection, dialect, id: '', name: dialect, group: '', color: '#123456', rememberPassword: false,
  };
  const accepted = 'good-secret', rejected = 'blocked-secret';

  // 使用独立只读连接核对事务结果，避免将表格草稿当作已落库的值。
  async function storedLabel(): Promise<string> {
    if (postgres) {
      const observer = new Client(connection);
      try {
        await observer.connect();
        return (await observer.query("SELECT label FROM ONLY public.update_subject WHERE scope = 'A'")).rows[0].label;
      } finally { await observer.end(); }
    }
    const observer = await mysql.createConnection(connection);
    try {
      const [rows] = await observer.query<mysql.RowDataPacket[]>("SELECT label FROM update_subject WHERE scope = 'A'");
      return rows[0].label;
    } finally { await observer.end(); }
  }

  try {
    await page.evaluate(async profile => {
      const saved = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      const id = 'write-history-table';
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: id, tabs: [
        { id, kind: 'table', title: 'update_subject', connectionId: saved.id, database: profile.database,
          table: profile.dialect === 'postgresql' ? '"public"."update_subject"' : 'update_subject' },
      ] });
    }, profile);
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const button = (name: string) => navigationMenuItem(tab, { name, exact: true });
    const preview = page.getByRole('dialog', { name: postgres ? pgText.preview : zh.table.text031, exact: true });
    const history = page.getByRole('region', { name: historyText.title, exact: true });
    const writes = history.locator('details').filter({ hasText: '表格提交 ·' });

    async function stage(from: string, to: string) {
      const cell = tab.getByRole('gridcell', { name: from, exact: true });
      if (postgres) {
        await cell.click();
        await (await button(pgText.edit)).click();
        const form = page.getByRole('dialog', { name: pgText.edit, exact: true });
        await form.getByLabel('label ' + pgText.valueMode, { exact: true }).selectOption('text');
        await form.getByLabel('label ' + pgText.value, { exact: true }).fill(to);
        await form.getByRole('button', { name: pgText.stage, exact: true }).click();
      } else {
        await cell.dblclick();
        const input = tab.locator('.grid-input');
        await input.fill(to);
        await input.press('Enter');
      }
    }

    async function openPreview() {
      await (await button(postgres ? pgText.preview : zh.table.text019)).click();
      await expect(preview).toBeVisible();
    }

    async function apply() {
      await preview.getByRole('button', { name: postgres ? pgText.apply : zh.common.confirmApply, exact: true }).click();
    }

    async function backToEdit() {
      await (await navigationMenuItem(preview, { name: postgres ? pgText.cancel : zh.common.backToEdit, exact: true })).click();
      await expect(preview).toBeHidden();
    }

    async function checkHistory(outcome?: 'committed' | 'rolled-back') {
      await (await button(historyText.title)).click();
      await expect(history).toBeVisible();
      if (!outcome) await expect(writes).toHaveCount(0);
      else {
        const write = writes.filter({ hasText: historyText.outcomes[outcome] }).first();
        await expect(write).toBeVisible();
        if (await write.getAttribute('open') === null) await write.locator('summary').click();
        const sql = write.locator('pre');
        await expect(sql).toHaveCount(3);
        await expect(sql.first()).toHaveText(postgres ? /^BEGIN\b/ : 'START TRANSACTION');
        await expect(sql.nth(1)).toContainText(postgres ? /UPDATE .+\$1/ : /UPDATE .+\?/);
        await expect(sql.last()).toHaveText(outcome === 'committed' ? 'COMMIT' : 'ROLLBACK');
        for (const value of [accepted, rejected]) {
          await expect(history).not.toContainText(value);
          await expect(history).not.toContainText(Buffer.from(value).toString('hex'));
        }
      }
      await history.getByRole('button', { name: historyText.close, exact: true }).last().click();
      await expect(history).toBeHidden();
    }

    expect(await storedLabel()).toBe('row A');
    await stage('row A', accepted);
    await openPreview();
    await backToEdit();
    await checkHistory();
    expect(await storedLabel()).toBe('row A');

    await openPreview();
    await apply();
    await expect(preview).toBeHidden();
    expect(await storedLabel()).toBe(accepted);
    await checkHistory('committed');

    await stage(accepted, rejected);
    await openPreview();
    await apply();
    if (postgres) {
      await expect(preview).toBeHidden();
      await expect(tab.getByRole('status')).toContainText('整批已回滚');
    } else {
      await expect(preview.locator('.error-box')).toBeVisible();
      await backToEdit();
    }
    expect(await storedLabel()).toBe(accepted);
    await checkHistory('rolled-back');

    await stage(rejected, 'row A');
    await openPreview();
    await apply();
    await expect(preview).toBeHidden();
    expect(await storedLabel()).toBe('row A');
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
