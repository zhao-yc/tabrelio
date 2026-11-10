import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { childReferencesZh as referenceText } from '../../src/renderer/locales/childReferences.zh-CN';
import { tableForeignKeyJoinFilterZh as filterText } from '../../src/renderer/locales/tableForeignKeyJoinFilter.zh-CN';
import { tableFilterGroupsZh as groupText } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { tableForeignKeyJoinSummaryZh as summaryText } from '../../src/renderer/locales/tableForeignKeyJoinSummary.zh-CN';
import { tableForeignKeyJoinHavingZh as havingText } from '../../src/renderer/locales/tableForeignKeyJoinHaving.zh-CN';
import { explainZh as explainText } from '../../src/renderer/locales/explain.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

const enabled = process.env.DBARK_JOIN_ORDER_NATIVE === '1';
test.skip(!enabled, 'JOIN排序离线原生组件专项默认关闭，未执行');
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
let server: Awaited<ReturnType<typeof createServer>>, address: string;
test.beforeAll(async () => {
  if (!enabled) return;
  const forbidden = Object.keys(process.env).filter(key => /^(?:DBARK_TEST_|MYSQL_|MARIADB_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length) throw Error('JOIN离线组件拒绝实库认证和模块注入；字段名：' + forbidden.join('、'));
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen(); const bound = server.httpServer!.address(); if (!bound || typeof bound === 'string') throw Error('JOIN夹具没有取得本地端口'); address = 'http://127.0.0.1:' + bound.port + '/tests/fixtures/join-order/index.html';
});
test.afterAll(async () => { await server?.close(); });

for (const scenario of ['open', 'cancel', 'stale'] as const) {
  test('从新建查询进入 JOIN：' + scenario, async ({}, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'dbark-join-order-native-'));
    const app = await electron.launch({ args: ['tests/fixtures/join-order/electron.cjs'], env: { ...process.env,
      DBARK_JOIN_ORDER_FIXTURE_DATA: directory, DBARK_JOIN_ORDER_FIXTURE_URL: address + '?entry=query&hold=' + (scenario === 'open' ? '0' : '1') }, chromiumSandbox: true });
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', reason => errors.push(reason.message));
    const evidence = () => page.evaluate(() => (window as typeof window & { __joinOrderEvidence(): {
      calls: Array<{ command: string; input: Record<string, unknown> }>; tabs: Array<{ kind: string; sql?: string; database?: string; databaseContext?: unknown }>;
      denied: string[]; jobs: Record<string, unknown>;
    } }).__joinOrderEvidence());
    const control = (action: 'releaseSource' | 'releaseCancel' | 'invalidate') => page.evaluate(name =>
      (window as typeof window & { __joinEntryControls: Record<typeof name, () => void> }).__joinEntryControls[name](), action);
    try {
      const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
      const entry = newQuery.getByRole('button', { name: text.builderEntry, exact: true });
      await expect(entry).toBeEnabled({ timeout: 30000 });
      await entry.click();
      const start = page.getByRole('dialog', { name: text.builderTitle, exact: true });
      await expect(newQuery).toHaveCount(0);
      if (scenario === 'open') {
        await start.getByRole('button', { name: text.builderBack, exact: true }).click();
        await expect(newQuery.getByLabel(zh.app.text050, { exact: true })).toHaveValue('合成关联库');
        await entry.click();
      }
      await start.getByRole('button', { name: text.builderCatalog, exact: true }).click();
      const source = start.getByRole('combobox', { name: text.builderTable, exact: true });
      await expect(source.getByRole('option', { name: 'view_only', exact: true })).toHaveCount(0);
      await start.getByRole('textbox', { name: text.builderSearch, exact: true }).fill('child');
      await source.selectOption('child');
      if (scenario === 'open') await page.screenshot({ path: info.outputPath('query-join-entry.png') });
      await start.getByRole('button', { name: text.builderRead, exact: true }).click();
      const builder = page.getByRole('dialog', { name: text.manualTitle, exact: true });
      if (scenario === 'open') {
        await expect(builder).toBeVisible();
        await expect(start).toHaveCount(0);
        await builder.getByRole('button', { name: text.manualDatabases, exact: true }).click();
        await builder.getByRole('combobox', { name: text.manualDatabase, exact: true }).selectOption('另一库');
        await builder.getByRole('button', { name: text.manualTables, exact: true }).click();
        await builder.getByRole('combobox', { name: text.manualTable, exact: true }).selectOption('payments');
        await builder.getByRole('button', { name: text.manualRead, exact: true }).click();
        await builder.getByRole('combobox', { name: text.manualChild(1), exact: true }).selectOption('id');
        await builder.getByRole('combobox', { name: text.manualParent(1), exact: true }).selectOption('order_id');
        await builder.getByRole('button', { name: text.open, exact: true }).click();
        const sql = page.getByLabel('本例独立查询SQL', { exact: true });
        await expect(sql).toContainText('FROM `合成关联库`.`child` AS c');
        await expect(sql).toContainText('INNER JOIN `另一库`.`payments` AS p');
        await expect(sql).toContainText('LIMIT 43;');
        const result = await evidence();
        expect(result.tabs).toHaveLength(2);
        expect(result.tabs[1].databaseContext).toEqual({ state: 'known', database: '合成关联库' });
        expect(result.calls.filter(call => call.command === 'metadata.table').map(call => call.input.table)).toEqual(['child', 'payments', 'child', 'payments']);
      } else {
        await expect.poll(async () => (await evidence()).calls.find(call => call.command === 'metadata.table')?.input.taskId).toEqual(expect.any(String));
        if (scenario === 'cancel') await start.getByRole('button', { name: zh.common.cancel, exact: true }).click();
        else { await control('invalidate'); await expect(start.getByRole('alert')).toHaveText(text.stale); }
        await expect.poll(async () => (await evidence()).calls.filter(call => call.command === 'query.cancel').length).toBe(1);
        const calls = (await evidence()).calls;
        expect(calls.find(call => call.command === 'query.cancel')?.input.taskId).toBe(calls.find(call => call.command === 'metadata.table')?.input.taskId);
        if (scenario === 'stale') await start.getByRole('button', { name: zh.common.cancel, exact: true }).click();
        await control('releaseSource');
        await expect(start.getByText(text.closing, { exact: true })).toBeVisible();
        await expect(builder).toHaveCount(0);
        await control('releaseCancel');
        await expect(page.getByText('返回原查询', { exact: true })).toBeVisible();
        expect((await evidence()).tabs).toHaveLength(1);
      }
      const result = await evidence();
      expect(result.tabs[0].sql).toBe('SELECT 7');
      expect(result.denied).toEqual([]);
      expect(Object.values(result.jobs).some(Boolean)).toBe(false);
      expect(result.calls.some(call => call.command === 'table.page' || call.command === 'query.execute')).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const mode of ['dark', 'light', 'filter-dark', 'filter-light', 'group-dark', 'group-light', 'summary-dark', 'summary-light', 'having-dark', 'having-light', 'distinct-dark', 'distinct-light'] as const) {
  const distinct = mode.startsWith('distinct-'), having = mode.startsWith('having-'), summarizing = mode.startsWith('summary-') || having, theme = mode.endsWith('light') ? 'light' : 'dark', grouping = mode.startsWith('group-') || summarizing, filtering = mode.startsWith('filter-') || grouping;
  test('JOIN真实菜单、双侧排序、上限及独立草稿：' + mode, async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-join-order-native-')), app = await electron.launch({ args: ['tests/fixtures/join-order/electron.cjs'], env: { ...process.env, DBARK_JOIN_ORDER_FIXTURE_DATA: directory, DBARK_JOIN_ORDER_FIXTURE_URL: address + '?theme=' + theme }, chromiumSandbox: true });
  const taskProcess = app.process(), pid = taskProcess.pid, exit = new Promise<{ code: number | null; signal: string | null }>(resolve => taskProcess.once('exit', (code, signal) => resolve({ code, signal }))), page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message)); let accepted = false, closed = false;
  await info.attach('JOIN组件原窗口身份', { body: JSON.stringify({ pid, directory, theme, mode }), contentType: 'application/json' });
  /** 全部动作仍属本例原进程、原窗口和原120秒零重试，不使用观察超时重开。 */
  function check(): void { if (info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || app.process() !== taskProcess || taskProcess.pid !== pid || closed || page.isClosed()) throw Error('JOIN原生组件原归属变化'); }
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); const value = await action(); check(); return value; }
  const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
  const evidence = () => step(() => page.evaluate(() => (window as typeof window & { __joinOrderEvidence(): { calls: { command: string; input: Record<string, unknown> }[]; denied: string[]; tabs: { kind: string; sql?: string }[]; resultLimit: number; dirty: Record<string, boolean>; jobs: Record<string, unknown> } }).__joinOrderEvidence()));
  try {
    await step(() => expect(page.getByRole('grid', { name: '当前页数据网格', exact: true })).toBeVisible({ timeout: 30000 }));
    // Windows缩放会对原生客户区取整；按实际CSS视口校准本例唯一窗口，保留精确1024断言。
    const measured = await step(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
    const sizing: { width: number; height: number }[] = [], requested = { width: 1024, height: 680 };
    /** 仅采集原唯一窗口与显示几何，不读标题/URL/正文，不切分辨率或修改原尺寸门槛。 */
    const geometry = async () => ({ measured, sizing: [...sizing], requested: { ...requested }, page: await step(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }))), native: await step(() => app.evaluate(({ BrowserWindow, screen }) => { const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('不是原唯一窗口'); const window = windows[0], bounds = window.getBounds(), display = screen.getDisplayMatching(bounds); return { bounds, contentBounds: window.getContentBounds(), contentSize: window.getContentSize(), zoom: window.webContents.getZoomFactor(), display: { bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor } }; })) });
    await info.attach('JOIN组件初始显示几何', { body: JSON.stringify(await geometry()), contentType: 'application/json' });
    // 保留请求基准，避免把已经取整的getContentSize再次当作请求；只校准原窗口，最多四步。
    for (let index = 0; index < 4; index++) {
      const actual = await step(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))); sizing.push(actual); if (actual.width === 1024 && actual.height === 680) break;
      if (Math.abs(actual.width - 1024) > 32 || Math.abs(actual.height - 680) > 32) { await info.attach('JOIN组件失败显示几何', { body: JSON.stringify(await geometry()), contentType: 'application/json' }); throw Error('JOIN原窗口尺寸无法确认'); } requested.width += 1024 - actual.width; requested.height += 680 - actual.height;
      await step(() => app.evaluate(({ BrowserWindow }, requested) => { const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('不是原唯一窗口'); windows[0].setContentSize(requested.width, requested.height); }, requested));
      await step(() => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    }
    await info.attach('JOIN组件原尺寸请求', { body: JSON.stringify({ measured, sizing, originalRequest: { width: 1024, height: 680 } }), contentType: 'application/json' });
    await info.attach('JOIN组件校准后显示几何', { body: JSON.stringify(await geometry()), contentType: 'application/json' });
    await step(() => expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 1024, height: 680 }));
    await info.attach('JOIN组件视口校准', { body: JSON.stringify({ measured, target: { width: 1024, height: 680 }, originalDpiPreserved: true }), contentType: 'application/json' });
    await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.entry, exact: true }, check)).click()); await step(() => dialog().getByRole('button', { name: text.preview, exact: true }).click());
    await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('LIMIT 43;')); const before = await evidence();
    await step(() => dialog().getByRole('button', { name: text.sortAdd, exact: true }).click()); await step(() => dialog().getByLabel(text.sortSide(1), { exact: true }).selectOption('parent')); await step(() => dialog().getByLabel(text.sortDirection(1), { exact: true }).selectOption('DESC')); await step(() => dialog().getByLabel(text.sortNulls(1), { exact: true }).selectOption('LAST'));
    await step(() => dialog().getByRole('button', { name: text.sortAdd, exact: true }).click()); await step(() => dialog().getByRole('button', { name: text.sortEarlier(2), exact: true }).click()); await step(() => dialog().getByLabel(text.resultLimit, { exact: true }).fill(''));
    await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled()); await step(() => expect(dialog().getByRole('alert')).toContainText(text.limitInvalid));
    await step(() => dialog().getByLabel(text.resultLimit, { exact: true }).fill('1000000')); await step(() => expect(dialog().getByLabel(text.resultLimit, { exact: true })).toHaveValue('1000000')); await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled()); await step(() => dialog().getByLabel(text.resultLimit, { exact: true }).fill('2'));
    if (filtering) {
      await step(() => dialog().getByRole('button', { name: filterText.add, exact: true }).click()); await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled());
      await step(() => dialog().getByLabel(filterText.value(1), { exact: true }).fill('1e20')); await step(() => expect(dialog().getByLabel(filterText.value(1), { exact: true })).toHaveValue('1e20')); await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled()); await step(() => dialog().getByLabel(filterText.value(1), { exact: true }).fill('9007199254740993'));
      await step(() => dialog().getByRole('button', { name: filterText.add, exact: true }).click()); await step(() => dialog().getByLabel(filterText.side(2), { exact: true }).selectOption('parent')); await step(() => dialog().getByLabel(filterText.column(2), { exact: true }).selectOption('amount')); await step(() => dialog().getByLabel(filterText.operator(2), { exact: true }).selectOption('IN')); await step(() => dialog().getByLabel(filterText.values(2), { exact: true }).fill('12.3400\n12.3500'));
      await step(() => dialog().getByRole('button', { name: filterText.add, exact: true }).click()); await step(() => dialog().getByLabel(filterText.side(3), { exact: true }).selectOption('parent')); await step(() => dialog().getByLabel(filterText.operator(3), { exact: true }).selectOption('IS NULL')); await step(() => dialog().getByLabel(filterText.mode, { exact: true }).selectOption('any'));
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('WHERE')); await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText(' OR ')); await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('p.`amount` IN')); await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('p.`id` IS NULL'));
      // NULL位置排序同样包含IS NULL，启停必须核WHERE段，不能把仍保留的排序误判为条件残留。
      const where = async () => (await step(() => dialog().getByLabel(text.preview, { exact: true }).textContent()))?.split('\nWHERE ')[1]?.split('\nORDER BY ')[0];
      await expect.poll(where).toContain('p.`id` IS NULL');
      await step(() => dialog().getByLabel(filterText.enabled(3), { exact: true }).uncheck()); await expect.poll(where).not.toContain('p.`id` IS NULL'); await step(() => dialog().getByLabel(filterText.enabled(3), { exact: true }).check()); await expect.poll(where).toContain('p.`id` IS NULL');
    }
    if (grouping) {
      const old = await step(() => dialog().getByLabel(text.preview, { exact: true }).textContent()), region = () => dialog().getByRole('region', { name: groupText.title, exact: true });
      await step(() => dialog().getByRole('button', { name: filterText.groups, exact: true }).click()); await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled()); await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toHaveCount(0)); await step(() => expect(region().getByLabel(groupText.groupMode(), { exact: true })).toBeFocused());
      // 逻辑组合事件验证Modal捕获层不会吞掉内联保护；不是实体系统输入法验收。
      await step(() => region().dispatchEvent('compositionstart', { data: '' })); await step(() => page.keyboard.press('Escape')); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')); await step(() => expect(region()).toBeVisible()); await step(() => region().dispatchEvent('compositionend', { data: '' })); await step(() => region().getByLabel(groupText.groupMode(), { exact: true }).focus()); await step(() => page.keyboard.press('Escape')); await step(() => expect(region()).toHaveCount(0)); await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toHaveText(old!));
      await step(() => dialog().getByRole('button', { name: filterText.groups, exact: true }).click()); await step(() => region().getByLabel(groupText.groupMode(), { exact: true }).selectOption('all')); await step(() => region().getByRole('button', { name: groupText.addGroup(), exact: true }).click());
      for (const position of [2,3]) { const selector=region().getByLabel(groupText.destination(position), { exact: true }), value=await step(() => selector.getByRole('option', { name: groupText.group('1'), exact: true }).getAttribute('value')); if(value===null)throw Error('JOIN分组缺少准确可见目标');await step(()=>selector.selectOption(value)); }
      await step(() => region().scrollIntoViewIfNeeded()); const bounds=await step(()=>region().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth})));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width); await info.attach('JOIN分组原生窗口-'+mode,{body:await step(()=>page.screenshot()),contentType:'image/png'});
      await step(() => region().getByLabel(groupText.groupMode(), { exact: true }).focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')); await step(() => expect(region()).toHaveCount(0)); await step(() => expect(dialog().getByLabel(filterText.structure, { exact: true })).toHaveText('(条件1 且 (条件2 或 条件3))'));
      const where=(await step(()=>dialog().getByLabel(text.preview,{exact:true}).textContent()))!.split('\nWHERE ')[1].split('\nORDER BY ')[0];expect(where).toContain(' AND ');expect(where).toContain(' OR ');expect(where.indexOf('c.`id` =')).toBeLessThan(where.indexOf('p.`amount` IN'));
    }
    if(summarizing){
      const original=await step(()=>dialog().getByLabel(text.preview,{exact:true}).textContent());await step(()=>dialog().getByLabel(summaryText.enabled,{exact:true}).check());await step(()=>expect(dialog().getByRole('button',{name:text.open,exact:true})).toBeDisabled());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toHaveCount(0));
      await step(()=>dialog().getByRole('button',{name:summaryText.addAggregate,exact:true}).click());await step(()=>dialog().getByLabel(summaryText.alias(1),{exact:true}).fill('行数'));await step(()=>dialog().getByRole('button',{name:summaryText.addGroup,exact:true}).click());await step(()=>dialog().getByLabel(summaryText.groupSide(1),{exact:true}).selectOption('parent'));
      await step(()=>dialog().getByRole('button',{name:summaryText.addAggregate,exact:true}).click());await step(()=>dialog().getByLabel(summaryText.fn(2),{exact:true}).selectOption('SUM'));await step(()=>dialog().getByLabel(summaryText.side(2),{exact:true}).selectOption('parent'));await step(()=>dialog().getByLabel(summaryText.column(2),{exact:true}).selectOption('amount'));await step(()=>dialog().getByLabel(summaryText.alias(2),{exact:true}).fill('金额合计'));
      await step(()=>dialog().getByRole('button',{name:text.sortAdd,exact:true}).click());await step(()=>dialog().getByLabel(text.sortSide(1),{exact:true}).selectOption('aggregate'));await step(()=>dialog().getByLabel(text.sortColumn(1),{exact:true}).selectOption('金额合计'));await step(()=>dialog().getByLabel(text.sortDirection(1),{exact:true}).selectOption('DESC'));await step(()=>dialog().getByLabel(text.sortNulls(1),{exact:true}).selectOption('LAST'));await step(()=>dialog().getByRole('button',{name:text.sortAdd,exact:true}).click());
      await step(()=>dialog().getByLabel(summaryText.alias(1),{exact:true}).fill(''));await step(()=>expect(dialog().getByRole('button',{name:text.open,exact:true})).toBeDisabled());await step(()=>dialog().getByLabel(summaryText.alias(1),{exact:true}).fill('行数'));const summary=await step(()=>dialog().getByLabel(text.preview,{exact:true}).textContent());await step(()=>dialog().getByLabel(summaryText.enabled,{exact:true}).uncheck());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toHaveText(original!));await step(()=>dialog().getByLabel(summaryText.enabled,{exact:true}).check());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toHaveText(summary!));await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toContainText('GROUP BY p.`id`'));
    }
    if(having){
      /** 按可见指标名选择稳定输出ID，不猜下标或直接改组件状态。 */
      const output=async(n:number,name:string)=>{const selector=dialog().getByLabel(havingText.target(n),{exact:true}),id=await step(()=>selector.getByRole('option',{name:havingText.aggregate+' · '+name,exact:true}).getAttribute('value'));if(id===null)throw Error('HAVING缺少原输出身份');await step(()=>selector.selectOption(id));};
      await step(()=>dialog().getByRole('button',{name:havingText.add,exact:true}).click());await step(()=>expect(dialog().getByRole('button',{name:text.open,exact:true})).toBeDisabled());await output(1,'行数');await step(()=>dialog().getByLabel(havingText.operator(1),{exact:true}).selectOption('>='));await step(()=>dialog().getByLabel(havingText.value(1),{exact:true}).fill('2'));
      await step(()=>dialog().getByLabel(summaryText.alias(1),{exact:true}).fill('总行数'));await step(()=>expect(dialog().getByLabel(havingText.target(1),{exact:true})).toContainText(havingText.aggregate+' · 总行数'));await step(()=>dialog().getByLabel(summaryText.alias(1),{exact:true}).fill('行数'));
      await step(()=>dialog().getByRole('button',{name:havingText.add,exact:true}).click());await output(2,'金额合计');await step(()=>dialog().getByLabel(havingText.operator(2),{exact:true}).selectOption('BETWEEN'));await step(()=>dialog().getByLabel(havingText.value(2),{exact:true}).fill('12.3400'));await step(()=>dialog().getByLabel(havingText.upper(2),{exact:true}).fill('100.0000'));
      await step(()=>dialog().getByRole('button',{name:havingText.add,exact:true}).click());await output(3,'行数');await step(()=>dialog().getByLabel(havingText.operator(3),{exact:true}).selectOption('IS NULL'));await step(()=>dialog().getByLabel(havingText.mode,{exact:true}).selectOption('any'));
      const flat=await step(()=>dialog().getByLabel(text.preview,{exact:true}).textContent()),region=()=>dialog().getByRole('region',{name:groupText.title,exact:true});await step(()=>dialog().getByRole('button',{name:havingText.groups,exact:true}).click());await step(()=>expect(region().getByLabel(groupText.groupMode(),{exact:true})).toBeFocused());await step(()=>page.keyboard.press('Escape'));await step(()=>expect(dialog().getByRole('button',{name:havingText.groups,exact:true})).toBeFocused());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toHaveText(flat!));
      await step(()=>dialog().getByRole('button',{name:havingText.groups,exact:true}).click());await step(()=>region().getByLabel(groupText.groupMode(),{exact:true}).selectOption('all'));await step(()=>region().getByRole('button',{name:groupText.addGroup(),exact:true}).click());for(const n of [2,3]){const selector=region().getByLabel(groupText.destination(n),{exact:true}),id=await step(()=>selector.getByRole('option',{name:groupText.group('1'),exact:true}).getAttribute('value'));if(id===null)throw Error('HAVING分组目标失效');await step(()=>selector.selectOption(id));}
      await step(()=>region().getByLabel(groupText.groupMode(),{exact:true}).focus());await step(()=>page.keyboard.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter'));await step(()=>expect(region()).toHaveCount(0));await step(()=>expect(dialog().getByLabel(havingText.structure,{exact:true})).toHaveText('(条件1 且 (条件2 或 条件3))'));await step(()=>expect(dialog().getByLabel(filterText.structure,{exact:true})).toHaveText('(条件1 且 (条件2 或 条件3))'));
      const sql=await step(()=>dialog().getByLabel(text.preview,{exact:true}).textContent());expect(sql).toContain('COUNT(*) >=');expect(sql).toContain('SUM(p.`amount`) BETWEEN');expect(sql!.indexOf('\nHAVING ')).toBeGreaterThan(sql!.indexOf('\nGROUP BY '));await step(()=>dialog().getByLabel(summaryText.enabled,{exact:true}).uncheck());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).not.toContainText('HAVING'));await step(()=>dialog().getByLabel(summaryText.enabled,{exact:true}).check());await step(()=>expect(dialog().getByLabel(text.preview,{exact:true})).toHaveText(sql!));
    }
    if (distinct) {
      const plain = await step(() => dialog().getByLabel(text.preview, { exact: true }).textContent());
      await step(() => dialog().getByLabel(text.distinct, { exact: true }).check());
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toHaveText(plain!.replace('SELECT\n', 'SELECT DISTINCT\n')));
      await step(() => dialog().getByLabel(text.childSelect('id'), { exact: true }).uncheck());
      await step(() => expect(dialog().getByRole('alert')).toContainText(text.distinctSort));
      await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled());
      await step(() => dialog().getByLabel(text.distinct, { exact: true }).uncheck());
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('ORDER BY c.`id` ASC'));
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).not.toContainText('c.`id` AS `c_1_id`'));
      await step(() => dialog().getByLabel(text.distinct, { exact: true }).check());
      await step(() => dialog().getByLabel(text.childSelect('id'), { exact: true }).check());
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('SELECT DISTINCT\n'));
      const selected = await step(() => dialog().getByLabel(text.preview, { exact: true }).textContent());
      await step(() => dialog().getByLabel(summaryText.enabled, { exact: true }).check());
      await step(() => dialog().getByRole('button', { name: summaryText.addAggregate, exact: true }).click());
      await step(() => expect(dialog().getByLabel(text.distinct, { exact: true })).toHaveCount(0));
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).not.toContainText('DISTINCT'));
      await step(() => dialog().getByLabel(summaryText.enabled, { exact: true }).uncheck());
      await step(() => expect(dialog().getByLabel(text.distinct, { exact: true })).toBeChecked());
      await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toHaveText(selected!));
    }
    if (mode === 'filter-dark') {
      const kind = dialog().getByLabel(text.joinKind, { exact: true }), unmatched = dialog().getByRole('checkbox', { name: text.unmatchedOnly, exact: true });
      const sql = dialog().getByLabel(text.preview, { exact: true });
      await step(() => unmatched.check());
      await step(() => expect(sql).toContainText('WHERE p.`id` IS NULL AND ('));
      await step(() => kind.selectOption('RIGHT'));
      await step(() => expect(unmatched).toBeChecked());
      await step(() => expect(sql).toContainText('WHERE c.`parent_id` IS NULL AND ('));
      await step(() => kind.selectOption('INNER'));
      await step(() => expect(unmatched).toBeDisabled());
      await step(() => expect(unmatched).not.toBeChecked());
      await step(() => expect(sql).not.toContainText('WHERE c.`parent_id` IS NULL AND ('));
      await step(() => kind.selectOption('RIGHT'));
      await step(() => expect(sql).toContainText('RIGHT JOIN'));
      await step(() => unmatched.check());
      await step(() => sql.scrollIntoViewIfNeeded());
      await step(() => page.screenshot({ path: info.outputPath('foreign-key-join-right-unmatched.png') }));
    }
    const suffix = summarizing ? 'ORDER BY (SUM(p.`amount`) IS NULL) ASC, SUM(p.`amount`) DESC, p.`id` ASC\nLIMIT 2;' : 'ORDER BY c.`id` ASC, (p.`id` IS NULL) ASC, p.`id` DESC\nLIMIT 2;'; await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText(suffix)); const edited = await evidence(); expect(edited.calls.filter(call => call.command !== 'settings.save')).toEqual(before.calls.filter(call => call.command !== 'settings.save')); expect(edited.tabs).toEqual(before.tabs); expect(edited.resultLimit).toBe(43); expect(edited.dirty).toEqual(before.dirty);
    const panel = having ? havingText.title : summarizing ? summaryText.title : filtering ? filterText.title : text.sortTitle;
    await step(() => dialog().getByLabel(panel, { exact: true }).scrollIntoViewIfNeeded()); const layout = await step(() => dialog().getByLabel(panel, { exact: true }).evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, viewport: window.innerWidth, theme: document.documentElement.dataset.theme }))); expect(layout.scroll).toBeLessThanOrEqual(layout.width); expect(layout.viewport).toBe(1024); expect(layout.theme).toBe(theme); await info.attach('JOIN排序原生窗口-' + mode, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    await step(() => dialog().getByRole('button', { name: text.open, exact: true }).click()); await step(() => expect(page.getByLabel('本例独立查询SQL', { exact: true })).toContainText(suffix)); const final = await evidence(); expect(final.tabs).toHaveLength(2); expect(final.tabs.filter(tab => tab.kind === 'query')).toHaveLength(1); expect(final.resultLimit).toBe(43); expect(final.denied).toEqual([]); expect(final.dirty).toEqual(before.dirty); expect(final.jobs).toEqual(before.jobs); expect(Object.values(final.jobs).some(Boolean)).toBe(false); expect(final.calls.filter(call => call.command === 'metadata.table').map(call => call.input.table)).toEqual(['child', 'parent', 'child', 'parent']); expect(final.calls.some(call => /query\.|table\.(apply|preview)/.test(call.command))).toBe(false); expect(errors).toEqual([]);
    const sql = final.tabs.find(tab => tab.kind === 'query')?.sql; if (distinct) expect(sql).toMatch(/^SELECT DISTINCT\n/); if (filtering) { expect(sql).toContain('WHERE'); expect(sql).toContain('p.`amount` IN'); expect(sql).toContain('p.`id` IS NULL'); expect(sql).toContain(' OR '); } else expect(sql).not.toContain('WHERE');
    if (mode === 'filter-dark') { expect(sql).toContain('RIGHT JOIN'); expect(sql).toContain('WHERE c.`parent_id` IS NULL AND ('); }
    if (mode === 'dark') {
      await step(() => page.goto(address + '?theme=dark&direction=manual'));
      await step(() => expect(page.getByRole('grid', { name: '当前页数据网格', exact: true })).toBeVisible());
      await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.manualEntry, exact: true }, check)).click());
      const manual = page.getByRole('dialog', { name: text.manualTitle, exact: true });
      const open = manual.getByRole('button', { name: text.open, exact: true });
      const button = (name: string) => manual.getByRole('button', { name, exact: true });
      const field = (name: string) => manual.getByRole('combobox', { name, exact: true });
      await step(() => expect(field(text.joinKind)).toHaveValue('INNER'));
      await step(() => button(text.manualDatabases).click());
      await step(() => field(text.manualDatabase).selectOption('另一库'));
      await step(() => button(text.manualTables).click());
      await step(() => expect(field(text.manualTable).getByRole('option', { name: 'view_only' })).toHaveCount(0));
      await step(() => field(text.manualTable).selectOption('other_payments'));
      await step(() => button(text.manualRead).click());
      await step(() => field(text.manualChild(1)).selectOption('id'));
      await step(() => field(text.manualParent(1)).selectOption('order_id'));
      await step(() => expect(open).toBeEnabled());
      await step(() => field(text.manualTable).selectOption('payments'));
      await step(() => expect(field(text.manualChild(1))).toHaveCount(0));
      await step(() => expect(open).toBeDisabled());
      await step(() => button(text.manualRead).click());
      await step(() => field(text.manualChild(1)).selectOption('id'));
      await step(() => expect(open).toBeDisabled());
      await step(() => field(text.manualParent(1)).selectOption('order_id'));
      await step(() => button(text.manualAddPair).click());
      await step(() => field(text.manualChild(2)).selectOption('amount'));
      await step(() => field(text.manualParent(2)).selectOption('total'));
      const preview = manual.getByLabel(text.preview, { exact: true });
      await step(() => expect(preview).toContainText('INNER JOIN `另一库`.`payments` AS p\nON\n  c.`id` = p.`order_id`\n  AND c.`amount` = p.`total`'));
      const comparison = field(text.manualOperator(2));
      await step(() => expect(comparison).toHaveValue('='));
      await step(() => comparison.selectOption('>='));
      await step(() => expect(preview).toContainText('c.`amount` >= p.`total`'));
      await step(() => field(text.joinKind).selectOption('LEFT'));
      await step(() => manual.getByRole('checkbox', { name: text.unmatchedOnly, exact: true }).check());
      await step(() => expect(preview).toContainText('AND c.`amount` >= p.`total`\nWHERE p.`order_id` IS NULL'));
      const firstMode = manual.getByRole('combobox', { name: text.manualOnMode, exact: true }).first();
      await step(() => firstMode.selectOption('any'));
      await step(() => expect(preview).toContainText('OR c.`amount` >= p.`total`\nWHERE p.`order_id` IS NULL AND p.`total` IS NULL'));
      await step(() => firstMode.selectOption('all'));
      const add = button(text.additionalAdd);
      const extra = (alias: string) => manual.getByRole('group', { name: text.additionalTitle(alias), exact: true });
      await step(() => add.click());
      await step(() => expect(open).toBeDisabled());
      const third = extra('t3');
      await step(() => third.getByRole('button', { name: text.manualTables, exact: true }).click());
      await step(() => third.getByRole('combobox', { name: text.manualTable, exact: true }).selectOption('other_payments'));
      await step(() => third.getByRole('button', { name: text.manualRead, exact: true }).click());
      await step(() => third.getByRole('combobox', { name: text.additionalChild(1), exact: true }).selectOption('order_id'));
      await step(() => third.getByRole('combobox', { name: text.manualParent(1), exact: true }).selectOption('order_id'));
      await step(() => third.getByRole('combobox', { name: text.joinKind, exact: true }).selectOption('LEFT'));
      await step(() => third.getByText(text.additionalColumns, { exact: false }).click());
      await step(() => third.getByRole('checkbox', { name: 'total', exact: true }).check());
      await step(() => add.click());
      const fourth = extra('t4');
      await step(() => fourth.getByRole('button', { name: text.manualTables, exact: true }).click());
      await step(() => fourth.getByRole('combobox', { name: text.manualTable, exact: true }).selectOption('payments'));
      await step(() => fourth.getByRole('button', { name: text.manualRead, exact: true }).click());
      await step(() => fourth.getByRole('combobox', { name: text.additionalPairSource(1), exact: true }).selectOption('2'));
      await step(() => fourth.getByRole('combobox', { name: text.additionalChild(1), exact: true }).selectOption('total'));
      await step(() => fourth.getByRole('combobox', { name: text.manualParent(1), exact: true }).selectOption('total'));
      await step(() => fourth.getByRole('button', { name: text.manualAddPair, exact: true }).click());
      const secondSource = fourth.getByRole('combobox', { name: text.additionalPairSource(2), exact: true });
      const secondChild = fourth.getByRole('combobox', { name: text.additionalChild(2), exact: true });
      await step(() => expect(secondSource).toHaveValue('1'));
      await step(() => secondChild.selectOption('order_id'));
      await step(() => secondSource.selectOption('0'));
      await step(() => expect(secondChild).toHaveValue(''));
      await step(() => expect(open).toBeDisabled());
      await step(() => expect(fourth.getByRole('combobox', { name: text.additionalChild(1), exact: true })).toHaveValue('total'));
      await step(() => secondChild.selectOption('id'));
      await step(() => fourth.getByRole('combobox', { name: text.manualParent(2), exact: true }).selectOption('order_id'));
      const fourthMode = fourth.getByRole('combobox', { name: text.manualOnMode, exact: true });
      await step(() => fourthMode.selectOption('any'));
      await step(() => expect(preview).toContainText('t3.`total` = t4.`total`\n  OR c.`id` = t4.`order_id`'));
      await step(() => fourthMode.selectOption('all'));
      await step(() => fourth.getByRole('button', { name: text.manualAddPair, exact: true }).click());
      await step(() => fourth.getByRole('combobox', { name: text.additionalPairSource(3), exact: true }).selectOption('0'));
      await step(() => fourth.getByRole('combobox', { name: text.additionalChild(3), exact: true }).selectOption('amount'));
      await step(() => fourth.getByRole('combobox', { name: text.manualOperator(3), exact: true }).selectOption('>='));
      await step(() => fourth.getByRole('combobox', { name: text.manualParent(3), exact: true }).selectOption('total'));
      const onGroups = fourth.getByRole('button', { name: text.manualOnGroups, exact: true });
      await step(() => onGroups.click());
      const onEditor = manual.getByRole('region', { name: groupText.title, exact: true });
      await step(() => expect(open).toBeDisabled());
      await step(() => onEditor.getByRole('button', { name: groupText.addGroup(), exact: true }).click());
      for (const position of [1, 2]) {
        const destination = onEditor.getByLabel(groupText.destination(position), { exact: true });
        const groupId = await step(() => destination.getByRole('option', { name: groupText.group('1'), exact: true }).getAttribute('value'));
        if (!groupId) throw Error('ON 条件分组不存在');
        await step(() => destination.selectOption(groupId));
      }
      await step(() => onEditor.getByLabel(groupText.groupMode(), { exact: true }).focus());
      await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'));
      await step(() => expect(onGroups).toBeFocused());
      const sql = 'LEFT JOIN `另一库`.`other_payments` AS t3\nON\n  p.`order_id` = t3.`order_id`\nINNER JOIN `另一库`.`payments` AS t4\nON\n  (c.`amount` >= t4.`total` AND (t3.`total` = t4.`total` OR c.`id` = t4.`order_id`))\nWHERE p.`order_id` IS NULL';
      await step(() => expect(preview).toContainText(sql));
      await step(() => expect(preview).toContainText('t3.`total` AS `t3_2_total`'));
      const select = (name: string, value: string) => step(() => manual.getByLabel(name, { exact: true }).selectOption(value));
      await step(() => button(filterText.add).click());
      await select(filterText.side(1), 't3');
      await select(filterText.column(1), 'total');
      await select(filterText.operator(1), 'IS NOT NULL');
      await step(() => button(text.sortAdd).click());
      await select(text.sortSide(1), 't4');
      await select(text.sortColumn(1), 'total');
      await step(() => expect(fourth.getByRole('button', { name: text.additionalRemove, exact: true })).toBeDisabled());
      await step(() => expect(preview).toContainText('AND (((t3.`total` IS NOT NULL)))\nORDER BY t4.`total` ASC'));
      await step(() => manual.getByLabel(summaryText.enabled, { exact: true }).check());
      await step(() => button(summaryText.addGroup).click());
      await select(summaryText.groupSide(1), 't3');
      await select(summaryText.groupColumn(1), 'order_id');
      await step(() => button(summaryText.addAggregate).click());
      await select(summaryText.fn(1), 'SUM');
      await select(summaryText.side(1), 't4');
      await select(summaryText.column(1), 'total');
      await step(() => manual.getByLabel(summaryText.alias(1), { exact: true }).fill('合计'));
      await step(() => button(havingText.add).click());
      await step(() => manual.getByLabel(havingText.target(1), { exact: true }).selectOption({ label: havingText.aggregate + ' · 合计' }));
      await select(havingText.operator(1), '>');
      await step(() => manual.getByLabel(havingText.value(1), { exact: true }).fill('1'));
      await step(() => button(text.sortAdd).click());
      await select(text.sortSide(1), 'aggregate');
      await step(() => expect(preview).toContainText('SUM(t4.`total`) AS `合计`'));
      await step(() => expect(preview).toContainText('GROUP BY t3.`order_id`\nHAVING ((SUM(t4.`total`) > '));
      await step(() => expect(preview).toContainText('ORDER BY SUM(t4.`total`) ASC'));
      const original = await step(() => preview.textContent());
      const designPanel = manual.getByText(text.designTitle, { exact: true }).filter({ visible: true }).first();
      const designs = manual.getByRole('combobox', { name: text.designTitle, exact: true });
      await step(() => designPanel.click());
      await step(() => manual.getByRole('textbox', { name: text.designName, exact: true }).fill('区域支付汇总'));
      await step(() => button(text.designSave).click());
      await step(() => expect(manual.getByText(text.designSaved, { exact: true })).toBeVisible());
      await step(() => button(text.close).click());
      await step(() => expect(manual).toBeHidden());
      await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.manualEntry, exact: true }, check)).click());
      await step(() => designPanel.click());
      await step(() => button(text.designRefresh).click());
      await step(() => designs.selectOption({ label: '区域支付汇总' }));
      await step(() => button(text.designLoad).click());
      await step(() => expect(manual.getByText(text.designRestored, { exact: true })).toBeVisible());
      await step(() => expect(secondSource).toHaveValue('0'));
      await step(() => expect(fourth.getByRole('combobox', { name: text.additionalPairSource(1), exact: true })).toHaveValue('2'));
      await step(() => expect(preview).toHaveText(original!));
      await step(() => expect(manual.getByLabel(summaryText.column(1), { exact: true })).toHaveValue('total'));
      await step(() => manual.getByLabel(summaryText.enabled, { exact: true }).uncheck());
      await step(() => expect(preview).toContainText('ORDER BY t4.`total` ASC'));
      await step(() => manual.getByLabel(summaryText.enabled, { exact: true }).check());
      await step(() => expect(preview).toHaveText(original!));
      const pairGroup = fourth.getByRole('group', { name: text.manualPairs, exact: true });
      const geometry = await step(() => pairGroup.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth })));
      expect(geometry.content).toBeLessThanOrEqual(geometry.width);
      await step(() => button(text.sample).click());
      const sample = manual.getByRole('region', { name: text.sampleTitle, exact: true });
      await step(() => expect(sample.getByText(text.sampleRows(1, true), { exact: true })).toBeVisible());
      await step(() => expect(sample.getByText('18446744073709551615', { exact: true })).toBeVisible());
      await step(() => sample.scrollIntoViewIfNeeded());
      await step(() => page.screenshot({ path: info.outputPath('join-sample-preview.png') }));
      await step(() => button(text.explain).click());
      const plan = sample.getByRole('region', { name: explainText.title, exact: true });
      const indexed = plan.getByRole('treeitem', { name: /· p(?:\s|$)/ });
      await step(() => expect(indexed).toBeVisible());
      await step(() => expect(sample.getByText('18446744073709551615', { exact: true })).toHaveCount(0));
      await step(() => indexed.click());
      await step(() => expect(plan.getByLabel(explainText.details).getByText('idx_order_id', { exact: false }).first()).toBeVisible());
      await step(() => sample.evaluate(element => element.scrollIntoView({ block: 'start' })));
      await step(() => page.screenshot({ path: info.outputPath('join-estimated-plan.png') }));
      await step(() => plan.getByRole('button', { name: explainText.raw, exact: true }).click());
      await step(() => expect(plan.getByLabel(explainText.raw, { exact: true })).toContainText('"key": "idx_order_id"'));
      await step(() => plan.getByRole('button', { name: explainText.text, exact: true }).click());
      await step(() => expect(plan.getByRole('gridcell', { name: 'idx_order_id' })).toBeVisible());
      await step(() => manual.getByLabel(text.resultLimit, { exact: true }).fill('42'));
      await step(() => expect(sample.getByText(text.sampleRows(1, true), { exact: true })).toHaveCount(0));
      await step(() => expect(plan).toHaveCount(0));
      await step(() => open.click());
      const draft = page.getByLabel('本例独立查询SQL', { exact: true });
      await step(() => expect(draft).toContainText(sql));
      await step(() => expect(draft).toContainText('GROUP BY t3.`order_id`\nHAVING ((SUM(t4.`total`) > '));
      const result = await evidence();
      expect(result.tabs).toHaveLength(2);
      expect(result.calls.filter(call => call.command === 'metadata.table').map(call => call.input.table)).toEqual(['parent', 'other_payments', 'payments', 'other_payments', 'payments', 'parent', 'payments', 'other_payments', 'parent', 'payments', 'other_payments']);
      expect(result.calls.filter(call => call.command === 'mysql.join.preview').map(call => call.input.mode)).toEqual(['rows', 'explain', 'explainText']);
      expect(result.calls.filter(call => call.command.startsWith('joinDesigns.')).map(call => call.command)).toEqual(['joinDesigns.save', 'joinDesigns.list', 'joinDesigns.read']);
      expect(result.calls.filter(call => call.command === 'table.page').map(call => call.input.table)).toEqual(['parent']);
      expect(result.calls.some(call => /query\./.test(call.command))).toBe(false);
      expect(result.denied).toEqual([]);
      expect(Object.values(result.jobs).some(Boolean)).toBe(false);
    }
    if (mode === 'light') {
      // 同一原生窗口换入独立父表夹具，父表没有出向外键，结果表也没有可选记录。
      await step(() => page.goto(address + '?theme=light&direction=incoming'));
      await step(() => expect(page.getByRole('grid', { name: '当前页数据网格', exact: true })).toBeVisible());
      await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.incomingEntry, exact: true }, check)).click());
      const directory = page.getByRole('dialog', { name: text.incomingTitle, exact: true });
      const select = directory.getByRole('combobox', { name: referenceText.relations, exact: true });
      const proceed = directory.getByRole('button', { name: text.incomingOpen, exact: true });
      await step(() => expect(select.getByRole('option').last()).toContainText('fk_other_parent'));
      await step(() => select.selectOption('0'));
      await step(() => directory.getByRole('button', { name: referenceText.nextRelations, exact: true }).click());
      await step(() => expect(directory.getByText(referenceText.relationPage(2), { exact: true })).toBeVisible());
      await step(() => expect(proceed).toBeDisabled());
      await step(() => expect(select.getByRole('option').last()).toContainText('· fk_parent'));
      await step(() => select.selectOption('0'));
      await step(() => page.screenshot({ path: info.outputPath('incoming-foreign-key-directory.png') }));
      await step(() => proceed.click());
      await step(() => expect(directory).toBeHidden());
      await step(() => expect(dialog().getByLabel(text.fk, { exact: true })).toBeDisabled());
      await step(() => expect(dialog().getByLabel(text.fk, { exact: true })).toHaveValue('fk_parent'));
      await step(() => expect(dialog().getByLabel(text.joinKind, { exact: true })).toHaveValue('RIGHT'));
      const sqlPreview = dialog().getByLabel(text.preview, { exact: true });
      await step(() => expect(sqlPreview).toContainText('RIGHT JOIN `合成关联库`.`parent` AS p'));
      await step(() => expect(sqlPreview).toContainText('c.`parent_id` = p.`id`'));
      await step(() => dialog().getByRole('button', { name: text.open, exact: true }).click());
      await step(() => expect(page.getByLabel('本例独立查询SQL', { exact: true })).toContainText('RIGHT JOIN'));
      const inbound = await evidence();
      expect(inbound.tabs).toHaveLength(2);
      expect(inbound.calls.filter(call => call.command === 'table.incomingReferences').map(call => [call.input.table, call.input.cursor])).toEqual([
        ['parent', undefined], ['parent', 'fixture-page-2'],
      ]);
      expect(inbound.calls.filter(call => call.command === 'metadata.table').map(call => call.input.table)).toEqual(['parent', 'child', 'child', 'parent']);
      expect(inbound.calls.filter(call => call.command === 'table.page').map(call => call.input.table)).toEqual(['parent']);
      expect(inbound.calls.some(call => /query\.|childReferencePage/.test(call.command))).toBe(false);
      expect(inbound.denied).toEqual([]);
      expect(Object.values(inbound.jobs).some(Boolean)).toBe(false);
    }
    check(); await app.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); expect(taskProcess.killed).toBe(false); await info.attach('JOIN排序原生组件终态', { body: JSON.stringify({ pid, directory, theme, mode, sql, filtering, grouping, summarizing, having, calls: final.calls, zeroDatabaseExecutions: true, zeroClipboardOperations: true, sourceDraftUnchanged: true, newQueryCount: 1, originalGlobalLimit: 43, normalExit: true, realDatabaseVerified: false }), contentType: 'application/json' }); accepted = true;
  } finally {
    // 失败原件保留；只请求原应用正常退出，不终止其它窗口或伪称完成清理。
    if (!closed && taskProcess.exitCode === null && taskProcess.signalCode === null) { await app.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); }
    await info.attach('JOIN组件原窗口收尾', { body: JSON.stringify({ pid, directory, accepted, exitCode: taskProcess.exitCode, signal: taskProcess.signalCode, forced: taskProcess.killed, directoryRetained: !accepted }), contentType: 'application/json' });
    if (accepted) { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-join-order-native-')) throw Error('JOIN目录越界'); await rm(directory, { recursive: true }); }
  }
});
}
