import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { queryResultFindZh as findText } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { gridRangeFillZh as rangeFill } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { gridCellCenter, pasteGridRangeClipboard, readGridMenuClipboard, readGridRangeClipboard } from './grid-cell-range-clipboard';
import { gridRangeCopyZh as rangeCopy } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { gridRangeExportZh as rangeExport } from '../../src/renderer/locales/gridRangeExport.zh-CN';
import { gridRangePasteZh as selectionPaste } from '../../src/renderer/locales/gridRangePaste.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

let server: ViteDevServer, app: ElectronApplication, page: Page, directory: string, url: string;
const errors: string[] = [];
const startupLimit=128*1024;
let startup={stdout:[] as Buffer[],stderr:[] as Buffer[],sizes:{stdout:0,stderr:0},truncated:{stdout:false,stderr:false}};
let startupProcess:ReturnType<ElectronApplication['process']>|undefined,startupPage:Page|undefined;
/** 只保留本轮离线子进程的原始字节，标记截断；失败时附证据，不重试或提高就绪门。 */
function captureStartup(target:typeof startup,channel:'stdout'|'stderr',value:Buffer|string):void{
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),remaining=startupLimit-target.sizes[channel];
  if(bytes.length>remaining)target.truncated[channel]=true;
  if(remaining>0){const kept=Buffer.from(bytes.subarray(0,remaining));target[channel].push(kept);target.sizes[channel]+=kept.length;}
}
const panel = () => page.getByRole('region', { name: text.find, exact: true });
const preview = () => page.getByRole('dialog', { name: text.replaceTitle, exact: true });
test.beforeAll(async () => {
  // 固定源码夹具不依赖热更新；隔离目录监听，避免Windows根目录监听压力阻塞启动。
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen(); const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('未取得离线测试端口');
  url = `http://127.0.0.1:${address.port}/tests/fixtures/page-find-replace/index.html`;
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async () => {
  startup={stdout:[],stderr:[],sizes:{stdout:0,stderr:0},truncated:{stdout:false,stderr:false}};startupProcess=undefined;startupPage=undefined;
  errors.length = 0; directory = await mkdtemp(join(tmpdir(), 'dbark-find-e2e-'));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_FIND_FIXTURE_URL: url, DBARK_FIND_FIXTURE_DATA: directory }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['tests/fixtures/page-find-replace/electron.cjs'], env, chromiumSandbox: true });
  const ownStartup=startup;startupProcess=app.process();startupProcess.stdout?.on('data',value=>captureStartup(ownStartup,'stdout',value));startupProcess.stderr?.on('data',value=>captureStartup(ownStartup,'stderr',value));
  page = await app.firstWindow();startupPage=page; page.on('pageerror', reason => errors.push(reason.message));
  await expect(page.locator('.table-tab .results-grid [role="row"][aria-rowindex="2"]')).toBeVisible({ timeout: 30000 });
  await expect((await (await import('./navigation-menu')).navigationMenuItem(page, { name: text.find, exact: true }))).toBeEnabled({ timeout: 30000 });
});
test.afterEach(async ({},info) => {
  if(info.status!==info.expectedStatus){
    await info.attach('离线夹具启动-stdout',{body:Buffer.concat(startup.stdout),contentType:'text/plain'});
    await info.attach('离线夹具启动-stderr',{body:Buffer.concat(startup.stderr),contentType:'text/plain'});
    await info.attach('离线夹具启动状态',{body:Buffer.from(JSON.stringify({pid:startupProcess?.pid,exitCode:startupProcess?.exitCode,signalCode:startupProcess?.signalCode,url:startupPage?.url(),pageClosed:startupPage?.isClosed(),rendererErrors:errors,sizes:startup.sizes,truncated:startup.truncated})),contentType:'application/json'});
  }
  await app?.close();
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-find-e2e-')) throw new Error('拒绝清理夹具目录之外的路径');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
test('结构化控制台诊断保留真实渲染器警告和错误，不使用弃用参数', async () => {
  // 消息来自真实Electron渲染器，不能用VM监听器回执冒充跨进程事件。
  await page.evaluate(() => { console.warn('DBARK_FIND_NATIVE_WARNING'); console.error('DBARK_FIND_NATIVE_ERROR'); });
  await expect.poll(() => Buffer.concat(startup.stderr).toString('utf8').split(/\r?\n/).flatMap(line => {
    try { const item=JSON.parse(line);return item.event==='renderer-console'&&['DBARK_FIND_NATIVE_WARNING','DBARK_FIND_NATIVE_ERROR'].includes(item.message)?[{level:item.level,message:item.message}]:[]; } catch { return []; }
  })).toEqual([{level:'warning',message:'DBARK_FIND_NATIVE_WARNING'},{level:'error',message:'DBARK_FIND_NATIVE_ERROR'}]);
  expect(Buffer.concat(startup.stderr).toString('utf8')).not.toContain('console-message is deprecated');
  expect(errors).toEqual([]);
});
/** 所有查找选项来自实际输入控件；没有直接调用扫描函数或伪造 Worker 响应。 */
async function find(query: string, regex = false) {
  if (!await panel().isVisible()) await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: text.find, exact: true })).click();
  await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note');
  await panel().getByRole('checkbox', { name: text.regex, exact: true }).setChecked(regex);
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill(query);
  if (regex) await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click();
}
/** 读取网格的真实可见单元格，只通过 UI 修改草稿。 */
async function cell(key = 'note', row = 2) {
  const header = page.getByRole('columnheader').filter({ hasText: key }).first();
  const index = await header.getAttribute('aria-colindex');
  return page.locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`);
}
async function calls() { return page.evaluate(() => (window as unknown as { __pageFindCalls: string[] }).__pageFindCalls.filter(value => ['table.preview', 'table.apply', 'query.execute'].includes(value))); }

test('最小窗口同格逐处导航、单处替换及整批预览仅形成草稿', async ({}, result) => {
  await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  const query = panel().getByRole('textbox', { name: text.query, exact: true });
  await query.press('F3'); await expect(query).toBeFocused();
  await expect(panel().getByRole('status')).toContainText('1 / 3 处');
  await (await cell()).click();
  await page.keyboard.press('Shift+F3');
  await expect(panel().getByRole('status')).toContainText('3 / 3 处');
  await page.keyboard.press('Shift+F3');
  await expect(panel().locator('.page-find-current')).toContainText('第 1 行 · 列 note · 格内第 2 处 · UTF-16 位置 7');
  await expect(panel().locator('mark')).toHaveText('old'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1/$&');
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.replaceOne, exact: true })).click(); await expect(await cell()).toHaveText('😀old前$1/$&后old');
  await expect(panel().getByRole('status')).toContainText('2 / 2 处'); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.previous, exact: true })).click(); await expect(panel().locator('.page-find-current')).toContainText('格内第 1 处');
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.preview, exact: true })).click(); await expect(preview()).toBeVisible();
  await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: text.apply, exact: true })).click(); await expect(await cell()).toHaveText('😀$1/$&前$1/$&后$1/$&');
  expect(await calls()).toEqual([]); expect(errors).toEqual([]); await page.screenshot({ path: result.outputPath('最小窗口单处与整批草稿.png') });
});

test('表页支持从右下向左上选择矩形并复制，排除相邻二进制列', async () => {
  const from = await cell('other', 3), to = await cell('note', 2);
  await from.click();
  await to.click({ modifiers: ['Shift'] });
  await expect(to).toBeFocused();
  await expect(page.locator('.grid-cell-in-range')).toHaveCount(4);
  const payload = await readGridRangeClipboard(page);
  expect(JSON.parse(payload.typed).rows).toEqual([['😀old前old后old', 'OLD'], ['', '无匹配']]);
  expect(payload.text).toBe('😀old前old后old\tOLD\n\t无匹配');
  const start = await gridCellCenter(from), end = await gridCellCenter(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(page.locator('.grid-cell-in-range')).toHaveCount(4);
  await page.mouse.up();
  await expect(to).toBeFocused();
  expect(await readGridRangeClipboard(page)).toEqual(payload);
  await from.click({ button: 'right' });
  const withHeaders = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.withHeaders, exact: true }));
  expect(withHeaders.text).toBe('note\tother\n😀old前old后old\tOLD\n\t无匹配');
  expect(withHeaders.typed).toBe(payload.typed);
  await expect(to).toBeFocused();
  await from.click({ button: 'right' });
  await page.getByRole('menuitem', { name: rangeExport.action, exact: true }).click();
  const exported = page.getByRole('dialog', { name: rangeExport.action, exact: true });
  await expect(exported.getByText(rangeExport.summary(2, 2), { exact: true })).toBeVisible();
  await expect(exported.locator('.sample-grid').getByRole('columnheader').filter({ hasText: /\S/ })).toHaveText(['note', 'other']);
  await expect(exported.getByRole('gridcell', { name: '无匹配', exact: true })).toBeVisible();
  await expect(exported.getByLabel(zh.resultExport.format, { exact: true }).locator('option[value="sql"]')).toHaveText('INSERT SQL');
  expect(await calls()).toEqual([]);
});

test('MySQL 粘贴从矩形左上角写入等尺寸内容，拒绝尺寸不符且可一步撤销', async () => {
  const start = await cell('note', 2), end = await cell('other', 3);
  await start.click();
  await end.click({ modifiers: ['Shift'] });
  await expect(end).toBeFocused();
  await pasteGridRangeClipboard(page, '甲\t乙');
  await expect(page.getByRole('alert')).toContainText(selectionPaste.shape(2, 2));
  await expect(start).toHaveText('😀old前old后old');
  await pasteGridRangeClipboard(page, '甲\t乙\n丙\t丁');
  await expect(start).toHaveText('甲');
  await expect(await cell('other', 2)).toHaveText('乙');
  await expect(await cell('note', 3)).toHaveText('丙');
  await expect(end).toHaveText('丁');
  await end.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(start).toHaveText('😀old前old后old');
  await expect(end).toHaveText('无匹配');
  expect(await calls()).toEqual([]);
});

test('MySQL 表页按矩形填充字面值，只暂存且可一步撤销', async () => {
  const start = await cell('note', 2), end = await cell('other', 3);
  await start.click();
  await end.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: rangeFill.open, exact: true }).click();
  const form = page.getByRole('region', { name: rangeFill.open, exact: true });
  await expect(form).toContainText(rangeFill.scope(2, 2));
  await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('NULL');
  await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  for (const key of ['note', 'other']) {
    for (const row of [2, 3]) await expect(await cell(key, row)).toHaveText('NULL');
  }
  await end.click();
  const copied = await readGridRangeClipboard(page);
  expect(JSON.parse(copied.typed).rows).toEqual([['NULL']]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(start).toHaveText('😀old前old后old');
  await expect(end).toHaveText('无匹配');
  expect(await calls()).toEqual([]);
});

test('表页按行和字段高亮查找命中，切换列和清空查找撤销旧标记', async () => {
  await find('old');
  const highlight = panel().getByRole('checkbox', { name: findText.highlightAll, exact: true });
  const note = await cell(), other = await cell('other');
  await highlight.check();
  await expect(note).toHaveClass(/query-result-find-match/);
  await expect(other).not.toHaveClass(/query-result-find-match/);
  const column = panel().getByRole('combobox', { name: text.column, exact: true });
  await column.selectOption('');
  await expect(other).toHaveClass(/query-result-find-match/);
  const query = panel().getByRole('textbox', { name: text.query, exact: true });
  await query.press('F3');
  await expect(note).toHaveClass(/query-result-find-hit/);
  await highlight.uncheck();
  await expect(note).toHaveClass(/query-result-find-hit/);
  await expect(other).not.toHaveClass(/query-result-find-match/);
  await highlight.check();
  await column.selectOption('other');
  await expect(other).toHaveClass(/query-result-find-match/);
  await expect(note).not.toHaveClass(/query-result-find-(match|hit)/);
  await query.fill('');
  await expect(page.locator('.query-result-find-match, .query-result-find-hit')).toHaveCount(0);
  expect(await calls()).toEqual([]);
});

test('真实Worker正则支持Unicode零宽、整格与字面美元符号，非法语法可恢复', async () => {
  await find('(?=old)', true); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.next, exact: true })).click(); await expect(panel().locator('mark')).toHaveText(text.zeroWidth);
  await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1'); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.replaceOne, exact: true })).click(); await expect(await cell()).toHaveText('😀$1old前old后old');
  await find('[', true); await expect(panel().getByRole('alert')).toContainText(text.regexInvalid);
  await find('😀.*old', true); await panel().getByRole('checkbox', { name: text.whole, exact: true }).check(); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click(); await expect(panel().getByRole('status')).toContainText('0 / 1 处');
  expect(await calls()).toEqual([]); expect(errors).toEqual([]);
});

test('外部结构变化撤销旧预览，可靠键缺失仍可查找', async () => {
  await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('新');
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.preview, exact: true })).click(); await expect(preview()).toBeVisible();
  await page.evaluate(() => (document.querySelector('button') as HTMLButtonElement).click()); await expect(preview()).toHaveCount(0); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
  await page.goto(url + '?readonly'); await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.next, exact: true })).click(); await expect(panel().getByRole('button', { name: text.replaceOne, exact: true })).toBeDisabled();
  expect(await calls()).toEqual([]); expect(errors).toEqual([]);
});

test('翻页、排序、筛选、编辑及连接变化均取消正在执行的旧页查找', async () => {
  test.setTimeout(90000);
  const mutations: [string, () => Promise<unknown>][] = [
    ['翻页', () => page.getByRole('button', { name: '下一页', exact: true }).click()],
    ['排序', () => page.getByRole('columnheader').filter({ hasText: 'id' }).first().click()],
    ['筛选', async () => { await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.filter, exact: true })).click(); await page.getByRole('combobox', { name: '条件匹配方式', exact: true }).selectOption('any'); }],
    ['编辑', async () => { await (await cell('other')).dblclick(); const input = page.getByRole('textbox', { name: '编辑 other', exact: true }); await input.fill('页面已编辑'); await input.press('Enter'); }],
    ['连接', () => page.getByRole('button', { name: '夹具连接变化', exact: true }).click()],
  ];
  for (const [name, mutate] of mutations) {
    await page.goto(url + '?malicious');
    await page.evaluate(() => {
      const stats = { sent: 0, terminated: 0 }; Object.defineProperty(window, '__findWorkerStats', { value: stats });
      const Original = Worker; window.Worker = class extends Original { postMessage(value: unknown) { stats.sent++; super.postMessage(value); } terminate() { super.terminate(); stats.terminated++; } };
    });
    const stats = () => page.evaluate(() => (window as unknown as { __findWorkerStats: { sent: number; terminated: number } }).__findWorkerStats);
    await find('^(a+)+$', true); await expect.poll(async () => (await stats()).sent, { message: name + '前应实际开始匹配' }).toBe(1);
    await mutate(); await expect.poll(async () => (await stats()).terminated, { message: name + '必须终止旧线程' }).toBe(1);
    await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
    expect(await calls()).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('恶意回溯可超时或取消，编辑及关闭查找会终止旧线程并允许正常恢复', async ({}, result) => {
  await page.goto(url + '?malicious');
  // 仅旁观真实 Web Worker 的创建、发送与终止，不替代扫描或返回结果。
  await page.evaluate(() => {
    const stats = { created: 0, sent: 0, terminated: 0 }; Object.defineProperty(window, '__findWorkerStats', { value: stats });
    const Original = Worker; window.Worker = class extends Original { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); stats.created++; } postMessage(value: unknown) { stats.sent++; super.postMessage(value); } terminate() { super.terminate(); stats.terminated++; } };
  });
  const stats = () => page.evaluate(() => (window as unknown as { __findWorkerStats: { created: number; sent: number; terminated: number } }).__findWorkerStats);
  await find('^(a+)+$', true); await expect(panel().getByRole('alert')).toContainText(text.timeout); expect((await stats()).terminated).toBe((await stats()).created);
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click(); await expect.poll(async () => (await stats()).sent).toBe(2); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.cancelSearch, exact: true })).click(); await expect(panel().getByRole('alert')).toContainText(text.cancelled); expect((await stats()).terminated).toBe(2);
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click(); await expect.poll(async () => (await stats()).sent).toBe(3); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('!'); await expect.poll(async () => (await stats()).terminated).toBe(3);
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click(); await expect(panel().getByRole('status')).toContainText('0 / 1 处');
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill('^(a+)+$'); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: text.search, exact: true })).click(); await expect.poll(async () => (await stats()).sent).toBe(5); await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: text.find, exact: true })).click(); await expect.poll(async () => (await stats()).terminated).toBe(5);
  expect(await calls()).toEqual([]); expect(errors).toEqual([]); await page.screenshot({ path: result.outputPath('恶意回溯取消并关闭面板.png') });
});
