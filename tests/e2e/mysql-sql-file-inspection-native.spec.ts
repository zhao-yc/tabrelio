import { writeFile } from 'node:fs/promises';
import { mysqlSqlFileZh as text } from '../../src/renderer/locales/mysqlSqlFile.zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('无保存连接也能检查 SQL，按 MySQL 和 MariaDB 版本核对显式库操作', async ({}, info) => {
  const { page, application } = ownedDesktopResources(info);
  const path = info.outputPath('离线合成脚本.sql');
  let closed = false;
  try {
    await writeFile(path, '/*!50701 USE `仅MySQL` */;\nCREATE DATABASE IF NOT EXISTS `目标库`;\nUSE `目标库`;\n' +
      'DELIMITER $$\nCREATE PROCEDURE p() BEGIN DROP DATABASE body_only; END$$\nDELIMITER ;\n' +
      'INSERT INTO t VALUES (\'不显示的正文\');\nDROP SCHEMA IF EXISTS `旧库`;\n');
    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== input.title) throw Error('非本例的文件选择');
        return { canceled: false, filePaths: [input.path] };
      }) as typeof dialog.showOpenDialog;
    }, { title: text.title, path });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true })).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    const report = modal.getByRole('region', { name: text.inspectTitle });
    await expect(modal.getByLabel(text.connection, { exact: true }).locator('option')).toHaveCount(1);
    await button(text.choose).click();
    await modal.getByLabel(text.version).fill('8.4.11');
    await button(text.inspect).click();
    await expect(report).toContainText(text.inspectionDone);
    await expect(report).toContainText(text.inspectionCounts(6, 3, 1, 1));
    await expect(report).toContainText('选择库 · 仅MySQL');
    await expect(report).toContainText('创建库 · 目标库');
    await expect(report).toContainText('删除库 · 旧库');
    await expect(report).not.toContainText(/body_only|不显示的正文/);
    await modal.screenshot({ path: info.outputPath('MySQL SQL 离线检查.png') });

    await modal.getByLabel(text.family).selectOption('mariadb');
    await expect(report).toHaveCount(0);
    await modal.getByLabel(text.version).fill('11.4.13');
    await button(text.inspect).click();
    await expect(report).toContainText(text.inspectionCounts(5, 3, 1, 1));
    await expect(report).not.toContainText('仅MySQL');
    await expect(button(text.run)).toBeDisabled();
    await modal.screenshot({ path: info.outputPath('MariaDB SQL 离线检查.png') });
    const process = application.process();
    await confirmOwnedDesktopExit(info);
    closed = true;
    expect(process.exitCode).toBe(0);
  } finally {
    if (!closed) retainOwnedDesktopResources(info);
  }
});
