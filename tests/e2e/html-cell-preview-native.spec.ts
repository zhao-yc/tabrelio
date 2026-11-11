import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test, expect, desktop, page, dataDir, pageErrors, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { htmlCellPreviewZh as web } from '../../src/renderer/locales/htmlCellPreview.zh-CN';
import { sqliteTableEditZh as edit } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { binaryCellZh as binary } from '../../src/renderer/locales/binaryCell.zh-CN';

const host = 'https://html-cell-preview.invalid';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD8sAAAAASUVORK5CYII=';
const source = [
  `<style>@import url(${host}/import.css); #rendered{color:rgb(9,52,129);background-image:url(${host}/bg.png)}</style>`,
  '<h2 id="rendered" onclick="parent.document.body.dataset.test=1">账单摘要</h2>',
  '<table><tr><th>项目</th><td>数据库</td></tr></table>',
  `<img src="data:image/png;base64,${png}" alt="内嵌样本">`,
  `<img src="${host}/img.png" alt="外链替代文字"><a href="${host}/link" target="_blank">链接文字</a>`,
  `<meta http-equiv="refresh" content="0;url=${host}/refresh"><iframe src="${host}/frame"></iframe>`,
  `<script>fetch('${host}/script');parent.document.body.dataset.test=1;</script><form action="${host}/form"><button>提交</button></form>`,
  `<svg><image href="${host}/svg"></image></svg><math><mtext>外部命名空间</mtext></math>`,
].join('');

test.use({trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true});
test.describe.configure({timeout: 90_000, retries: 0});
test('SQLite 数据格和字段编辑预览 HTML，外部资源零请求且提交保留原文', async ({}, info) => {
  test.skip(process.env.DBARK_HTML_CELL_PREVIEW_NATIVE !== '1', '仅显式运行 HTML 单元格原生验收');
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('HTML 单元格验收只使用独占的 SQLite 测试文件');
  const path = join(dataDir, 'html-cell-preview.sqlite'), fixture = new DatabaseSync(path);
  const changed = source.replace('账单摘要', '本地草稿摘要');
  try {
    fixture.exec('CREATE TABLE cells(id INTEGER PRIMARY KEY, memo TEXT, raw BLOB, plain TEXT); CREATE VIEW cell_view AS SELECT id,memo FROM cells;');
    fixture.prepare('INSERT INTO cells VALUES(?,?,?,?)').run(1, source, Buffer.from('<strong>二进制网页</strong>'), '普通文本');
  } finally { fixture.close(); }
  function stored() {
    const db = new DatabaseSync(path, {readOnly: true});
    try { return db.prepare('SELECT memo FROM cells WHERE id=1').get()?.memo; } finally { db.close(); }
  }
  let requests = 0;
  await page.route(host + '/**', async route => { requests++; await route.abort(); });
  try {
    const process = desktop.process();
    await desktop.evaluate(({dialog, BrowserWindow}, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('仅可选择本例 SQLite 文件');
        return {canceled: false, filePaths: [file]};
      }) as typeof original;
    }, path);
    await page.evaluate(async () => {
      const id = 'html-cell-preview', file = await window.dbark.invoke('files.choose', {purpose: 'sqlite-database', sqliteConnectionId: id});
      if (!file) throw Error('本例 SQLite 未授权');
      const connection = await window.dbark.invoke('connections.save', {id, name: 'HTML 样本', group: '', color: '#123456', dialect: 'sqlite',
        sqlite: {fileToken: file.token, readOnly: false, busyTimeoutMs: 1000}});
      const settings = await window.dbark.invoke('settings.get', {}), target = {database: 'main', connectionId: connection.id};
      await window.dbark.invoke('settings.save', {...settings, activeTabId: 'web-table', tabs: [
        {id: 'web-table', title: 'HTML 数据表', kind: 'table', table: 'cells', ...target},
        {id: 'web-view', title: 'HTML 视图', kind: 'table', table: 'cell_view', ...target},
        {id: 'web-query', title: 'HTML 查询', kind: 'query',
          sql: "SELECT memo,'<p>' || replace(hex(zeroblob(90000)), '00', '中') || '</p>' AS large,plain FROM cells;", ...target},
      ]});
    });
    await page.reload();
    const select = (id: string) => page.locator(`[data-workspace-tab-id="${id}"] .tab-select`).click();
    const table = page.locator('.sqlite-table-tab:visible');
    const field = async (scope: typeof table, name: string) => {
      const header = scope.getByRole('columnheader').filter({hasText: new RegExp('^' + name + '(?:SQLITE|\\b)')});
      await expect(header).toHaveCount(1);
      const index = await header.getAttribute('aria-colindex');
      if (!index || !/^\d+$/.test(index)) throw Error('缺少测试列坐标 ' + name);
      return scope.locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`);
    };
    const menu = () => page.locator('[data-grid-cell-menu]');
    const panel = (name: string) => page.getByRole('region', {name: web.field(name), exact: true});
    const frame = () => page.frameLocator('iframe.html-cell-frame');
    const assertFrame = async (title: string) => {
      await expect(frame().getByRole('heading', {name: title, exact: true})).toHaveCSS('color', 'rgb(9, 52, 129)');
      await expect(frame().getByRole('cell', {name: '数据库', exact: true})).toBeVisible();
      await expect(frame().locator('body')).toContainText('外链替代文字');
      await expect(frame().getByRole('heading', {name: title, exact: true})).toHaveCSS('background-image', 'none');
      const image = frame().getByRole('img', {name: '内嵌样本', exact: true});
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1);
      await expect(frame().locator('script,form,iframe,svg,math,[onclick],a[href],img[srcset]')).toHaveCount(0);
      const embedded = page.locator('iframe.html-cell-frame');
      await expect(embedded).toHaveAttribute('sandbox', '');
      expect(await embedded.evaluate(node => (node as HTMLIFrameElement).contentDocument)).toBeNull();
      expect(requests).toBe(0);
    };
    const open = async (cell: Awaited<ReturnType<typeof field>>, column: string) => {
      await cell.click({button: 'right'});
      await menu().getByRole('menuitem', {name: web.open, exact: true}).click();
      await expect(panel(column)).toBeVisible();
    };
    const close = (column: string) => panel(column).getByRole('button', {name: web.close, exact: true}).click();
    const memo = () => field(table, 'memo');
    await open(await memo(), 'memo');
    await assertFrame('账单摘要');
    await panel('memo').screenshot({path: info.outputPath('HTML 数据格网页预览.png')});
    expect(stored()).toBe(source);
    await close('memo');

    await (await memo()).dblclick();
    const form = page.getByRole('dialog', {name: edit.editCell, exact: true});
    const input = form.getByRole('textbox', {name: edit.value('memo'), exact: true});
    await expect(input).toHaveValue(source);
    await form.getByRole('button', {name: web.open, exact: true}).click();
    await assertFrame('账单摘要');
    await input.fill(changed);
    await assertFrame('本地草稿摘要');
    await form.screenshot({path: info.outputPath('HTML 字段草稿预览.png')});
    expect(stored()).toBe(source);
    await form.getByRole('button', {name: edit.saveInput, exact: true}).click();
    await expect(form).toBeHidden();
    expect(stored()).toBe(source);
    await (await navigationMenuItem(table, {name: edit.preview, exact: true})).click();
    const confirmation = page.getByRole('dialog', {name: edit.previewTitle, exact: true});
    await confirmation.getByRole('checkbox', {name: edit.confirmation, exact: true}).check();
    await confirmation.getByRole('button', {name: edit.submit, exact: true}).click();
    await expect.poll(stored).toBe(changed);
    await expect(confirmation).toBeHidden();

    await (await field(table, 'raw')).dblclick();
    await form.getByRole('button', {name: binary.text, exact: true}).click();
    await form.getByRole('button', {name: web.open, exact: true}).click();
    await expect(frame().locator('strong')).toHaveText('二进制网页');
    await form.getByRole('button', {name: edit.cancelInput, exact: true}).click();

    await select('web-view');
    await open(await memo(), 'memo');
    await assertFrame('本地草稿摘要');
    await select('web-query');
    await expect(panel('memo')).toBeHidden();
    const query = page.locator('.query-tab:visible');
    await query.locator('.query-execute-split button.primary').click();
    await open(await field(query, 'memo'), 'memo');
    await assertFrame('本地草稿摘要');
    await close('memo');
    await open(await field(query, 'large'), 'large');
    await expect(panel('large').getByText(web.bytes, {exact: true})).toBeVisible();
    await expect(page.locator('iframe.html-cell-frame')).toHaveCount(0);
    await close('large');
    await (await field(query, 'plain')).click({button: 'right'});
    await expect(menu().getByRole('menuitem', {name: web.open, exact: true})).toHaveCount(0);
    expect(requests).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(stored()).toBe(changed);
    await confirmOwnedDesktopExit(info);
    expect(process.exitCode).toBe(0);
  } catch (reason) {
    try {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 6000));
      await info.attach('原生失败界面', {body, contentType: 'text/plain'});
    } catch { /* 窗口已退出时保留原失败原因。 */ }
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
