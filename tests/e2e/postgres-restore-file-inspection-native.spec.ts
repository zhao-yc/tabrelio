import { writeFile } from 'node:fs/promises';
import { postgresSqlFileZh as text } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('无需保存连接即可检查 PostgreSQL 文件，报告跨块 COPY 和换库指令', async ({}, info) => {
  const { page, application } = ownedDesktopResources(info);
  const valid = info.outputPath('离线合成备份.sql'), unsupported = info.outputPath('含换库指令.sql');
  const copy = '跨块合成文本' + 'x'.repeat(150_000) + '\n';
  let closed = false;
  try {
    await writeFile(valid, 'BEGIN;\nCREATE TABLE demo(note text);\nCOPY demo FROM STDIN;\n' + copy + '\\.\nCOMMIT;\n');
    await writeFile(unsupported, 'SELECT 1;\n\\connect synthetic_private_database\n');
    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== input.title || !input.paths.length)
          throw Error('出现非本例的文件选择');
        return { canceled: false, filePaths: [input.paths.shift()!] };
      }) as typeof dialog.showOpenDialog;
    }, { title: text.title, paths: [valid, unsupported] });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true })).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    const report = modal.getByRole('region', { name: text.inspectionTitle });
    await expect(modal.getByLabel(text.connection, { exact: true }).locator('option')).toHaveCount(1);
    await expect(button(text.execute)).toBeDisabled();
    await button(text.choose).click();
    await button(text.inspect).click();
    await expect(report).toContainText(text.inspectionComplete);
    await expect(report).toContainText(text.inspectionSummary(2, 1, 0, 1, Buffer.byteLength(copy), 0));
    await expect(report).not.toContainText('跨块合成文本');
    await modal.screenshot({ path: info.outputPath('PostgreSQL 离线检查文件.png') });

    await button(text.choose).click();
    await expect(report).toHaveCount(0);
    await button(text.inspect).click();
    await expect(report).toContainText(text.reason.command);
    await expect(report).toContainText(text.failedAt(2));
    await expect(report).not.toContainText('synthetic_private_database');
    await expect(button(text.execute)).toBeDisabled();
    await modal.screenshot({ path: info.outputPath('PostgreSQL 离线检查问题.png') });
    const process = application.process();
    await confirmOwnedDesktopExit(info);
    closed = true;
    expect(process.exitCode).toBe(0);
  } finally {
    if (!closed) retainOwnedDesktopResources(info);
  }
});
