import { randomUUID } from 'node:crypto';
import { test as baseTest, type Locator, type TestInfo } from '@playwright/test';
import type { DatabaseObject, TableInfo } from '../../src/shared/contracts';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationZh as text } from '../../src/renderer/locales/navigation.zh-CN';
import { actionMenuZh } from '../../src/renderer/locales/actionMenu.zh-CN';
import { sidebarLocateZh } from '../../src/renderer/locales/sidebarLocate.zh-CN';
import { sidebarViewZh } from '../../src/renderer/locales/sidebarView.zh-CN';
import { objectInformationZh } from '../../src/renderer/locales/objectInformation.zh-CN';
import type { UiCommandId } from '../../src/shared/uiCommands';
import { productName } from '../../src/shared/productName';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_NAVIGATION_WORKBENCH_TEST === '1';

// 列表及默认入口不加载桌面夹具；明确离线后才允许启动新临时应用。
if (enabled) {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || Object.keys(process.env).some(key => key.startsWith('DBARK_TEST_') && process.env[key]) || process.env.DBARK_DEV_URL) throw Error('导航专项必须显式离线，且不能继承实库凭据或开发页面地址');
  register();
} else baseTest.skip('菜单与对象浏览专项默认关闭（未执行）', () => {});

interface ReadCall { command: string; database?: string; name?: string; kind?: string; cursor?: string; taskId?: string; released: boolean; }
interface Summary { calls: ReadCall[]; prohibited: string[]; pending: number; reboundFrames: number; }
type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: Record<string, unknown> }) => Promise<unknown>;
interface Audit {
  summary(): Summary; replaceObjects(objects: DatabaseObject[]): void;
  holdObjects(): void; releaseObjects(objects: DatabaseObject[]): void;
  holdTableDefinition(): void; releaseTableDefinition(): void;
  prepareReload(): void; restore(): void;
}
type AuditRoot = typeof globalThis & { __navigationWorkbenchAudit?: Audit };

/** 每例均由原desktop fixture持有应用和临时配置；失败保留，不强杀或重试。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test, expect } = runtime;
  let halted = false, info: TestInfo, connectionId = '', connectionName = '';
  const alpha = 'navigation_alpha', beta = 'navigation_beta', same = '同名对象', viewName = '导航只读视图', routine = '导航过程';
  const smallObjects: DatabaseObject[] = [
    { kind: 'table', name: same }, { kind: 'view', name: same }, { kind: 'view', name: viewName },
    { kind: 'procedure', name: routine }, { kind: 'function', name: '导航函数' },
    { kind: 'trigger', name: '导航触发器' }, { kind: 'event', name: '导航事件' }
  ];
  let original: { id: string; kind: 'query'; title: string; connectionId: string; database: string; databaseContext: { state: 'known'; database: string }; sql: string };
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: {
    assertCurrent() { if (halted) throw Error('导航专项前例已保留，禁止启动下一应用'); }
  } });
  test.describe.configure({ mode: 'serial', retries: 0 });

  /** 每步异步调用前后核对同一所属应用，不从共享句柄推断所有者。 */
  async function main<T>(callback: (electron: typeof import('electron')) => T | Promise<T>): Promise<T> {
    const owned = runtime.ownedDesktopResources(info);
    const result = await owned.application.evaluate(callback);
    const after = runtime.ownedDesktopResources(info);
    if (after.application !== owned.application || after.page !== owned.page || after.closed) throw Error('导航专项应用归属发生变化');
    return result;
  }
  const audit = () => main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.summary());
  const settings = () => runtime.page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const browser = () => runtime.page.locator('.object-browser:visible');
  const row = (kind: string, database = alpha, name = same, parent?: Locator) => (parent ?? runtime.page.locator('.sidebar')).locator(`[data-sidebar-node=${JSON.stringify(JSON.stringify([connectionId, kind === 'connection' ? null : database, kind, ['connection', 'database'].includes(kind) ? null : name]))}]`);
  const toolbar = () => runtime.page.locator('.navigation-toolbar');

  /** 真正调用原生MenuItem的生产click，不直接向renderer派发菜单事件。 */
  async function native(id: UiCommandId): Promise<void> {
    const owned = runtime.ownedDesktopResources(info);
    await owned.application.evaluate(({ Menu, BrowserWindow }, command) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(command), windows = BrowserWindow.getAllWindows();
      if (!item || !item.enabled || windows.length !== 1) throw Error('准确原生命令当前不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }, id);
    runtime.ownedDesktopResources(info);
  }
  async function nativeEnabled(id: UiCommandId) {
    return runtime.desktop.evaluate(({ Menu }, command) => Menu.getApplicationMenu()?.getMenuItemById(command)?.enabled === true, id);
  }
  async function openTree() {
    await row('connection').locator('.tree-label').click();
    await expect(row('database')).toBeVisible();
  }
  /** 无树数据库选择时，通过真正的选库表单打开对象页。 */
  async function chooseObjects(database = alpha) {
    await toolbar().getByRole('button', { name: text.table, exact: true }).click();
    const picker = runtime.page.getByRole('dialog', { name: text.pickTitle, exact: true });
    await expect(picker).toBeVisible();
    await picker.getByLabel(text.pickConnection, { exact: true }).selectOption(connectionId);
    await picker.getByRole('button', { name: text.readDatabases, exact: true }).click();
    await picker.getByLabel(text.pickDatabase, { exact: true }).selectOption(database);
    await picker.getByRole('button', { name: text.open, exact: true }).click();
    await expect(picker).toBeHidden(); await expect(browser()).toBeVisible();
    await expect(browser().locator('.object-list-row').first()).toBeVisible();
  }
  /** 正式标签按钮激活原草稿，不创建或替换编辑器文档。 */
  async function activateOriginal() {
    await runtime.page.locator('.tab-strip .tab-select').filter({ hasText: original.title }).click();
    await expect(runtime.page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('原导航草稿不执行');
  }
  async function originalPreserved() {
    const current = await settings(); expect(current.tabs.find(tab => tab.id === original.id)).toEqual(original);
    expect(await runtime.page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  }

  test.beforeEach(async ({}, currentInfo) => {
    info = currentInfo;
    const actual = await main(({ app }) => ({ pid: process.pid, platform: process.platform, architecture: process.arch, packaged: app.isPackaged, appPath: app.getAppPath(), version: app.getVersion() }));
    await info.attach('导航专项原Main启动归属', { body: JSON.stringify({ actual, noRealDatabase: true, noSystemClipboard: true }), contentType: 'application/json' });
    connectionName = '导航离线验收 ' + randomUUID();
    await expect.poll(() => nativeEnabled('new-connection')).toBe(true); await native('new-connection');
    const form = runtime.page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'dbark_navigation']]) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click(); await expect(form).toBeHidden();
    const profiles = await runtime.page.evaluate(() => window.dbark.invoke('connections.list', {}));
    expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'dbark_navigation', rememberPassword: false }); connectionId = profiles[0].id;
    original = { id: 'navigation-query-' + randomUUID(), kind: 'query', title: '原导航草稿', connectionId, database: alpha, databaseContext: { state: 'known', database: alpha }, sql: '-- 原导航草稿不执行\nSELECT 9007199254740993;' };
    await runtime.page.evaluate(async tab => { const settings = await window.dbark.invoke('settings.get', {}); await window.dbark.invoke('settings.save', { ...settings, tabs: [tab], activeTabId: tab.id }); }, original);
    await runtime.page.reload(); await expect(runtime.page.locator('.query-tab:visible .monaco-editor')).toBeVisible();

    await runtime.desktop.evaluate(({ ipcMain, BrowserWindow }, input) => {
      const root = globalThis as AuditRoot, handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const original = handlers.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents;
      if (root.__navigationWorkbenchAudit || !original || windows.length !== 1 || !contents?.mainFrame) throw Error('导航专项原Main不唯一');
      let frame = contents.mainFrame, token = frame.frameToken, rendererProcess = frame.processId, reloadArmed = false, reboundFrames = 0;
      const url = contents.getURL(), calls: ReadCall[] = [], prohibited: string[] = [], held: { call: ReadCall; finish(value: unknown): void }[] = [];
      const definitions: (() => void)[] = [];
      const pendingDependencyDefinitions = new Set<string>();
      let objects = input.objects, hold = false, holdDefinition = false;
      /** 仅显式受控reload可更换原webContents下的frame；窗口、处理器和页面地址始终固定。 */
      const check = (event?: Electron.IpcMainInvokeEvent) => {
        if (root.__navigationWorkbenchAudit !== state || handlers.get('dbark:request') !== wrapped || contents.isDestroyed() || window.isDestroyed() || contents.getURL() !== url || BrowserWindow.getAllWindows().length !== 1) throw Error('导航专项原Main/端口归属失效');
        const now = contents.mainFrame;
        if (now !== frame || now.frameToken !== token || now.processId !== rendererProcess) {
          if (!reloadArmed || event && event.senderFrame !== now) throw Error('导航专项frame未经批准变化');
          frame = now; token = now.frameToken; rendererProcess = now.processId; reloadArmed = false; reboundFrames++;
        }
        if (event && (event.sender !== contents || event.senderFrame !== frame)) throw Error('导航专项请求不属于原frame');
      };
      const state: Audit = {
        summary() { check(); return { calls: calls.map(call => ({ ...call })), prohibited: [...prohibited], pending: held.length + definitions.length, reboundFrames }; },
        replaceObjects(next) { check(); if (held.length || next.length > 6000) throw Error('合成目录预算或在途归属无效'); objects = next; },
        holdObjects() { check(); hold = true; },
        releaseObjects(next) { check(); if (next.length > 6000) throw Error('合成目录超预算'); objects = next; hold = false; for (const item of held.splice(0)) { item.call.released = true; item.finish({ ok: true, result: objects }); } },
        holdTableDefinition() { check(); holdDefinition = true; },
        releaseTableDefinition() { check(); holdDefinition = false; for (const release of definitions.splice(0)) release(); },
        prepareReload() { check(); if (held.length || definitions.length || reloadArmed) throw Error('目录仍在途或重载已占用'); reloadArmed = true; },
        restore() { check(); if (held.length || definitions.length) throw Error('导航目录仍在途，不能恢复端口'); handlers.set('dbark:request', original); delete root.__navigationWorkbenchAudit; }
      };
      const wrapped: Handler = async (event, payload) => {
        check(event); const command = payload.command;
        if (command === 'query.cancel' && typeof payload.input.taskId === 'string' && pendingDependencyDefinitions.has(payload.input.taskId)) {
          calls.push({ command, taskId: payload.input.taskId, released: true });
          return { ok: true, result: undefined };
        }
        const read = ['connections.open', 'connections.close', 'metadata.databases', 'metadata.objects', 'metadata.table',
          'metadata.tableElements', 'table.page', 'metadata.ddl', 'mysql.view.dependencies', 'table.incomingReferences', 'query.objectDefinition', 'workbench.resolve'].includes(command);
        if (read) {
          if ((payload.input.id ?? payload.input.connectionId) !== input.id) throw Error('合成读取拒绝其它连接');
          const profiles = await original(event, { command: 'connections.list', input: {} }) as { ok: boolean; result?: { id: string; host: string; port: number; user: string }[] }; check(event);
          const profile = profiles.result?.find(value => value.id === input.id);
          if (!profiles.ok || !profile || profile.host !== '127.0.0.1' || profile.port !== 1 || profile.user !== 'dbark_navigation') throw Error('合成读取仅接纳本例虚构loopback:1配置');
          if (calls.length >= 128) throw Error('导航合成读取超预算');
          const database = typeof payload.input.database === 'string' ? payload.input.database : undefined, name = typeof (payload.input.name ?? payload.input.table) === 'string' ? String(payload.input.name ?? payload.input.table) : undefined;
          if (database !== undefined && !input.databases.includes(database)) throw Error('合成读取拒绝其它数据库');
          const call: ReadCall = { command, database, name, kind: typeof payload.input.kind === 'string' ? payload.input.kind : undefined, released: true }; calls.push(call);
          if (typeof payload.input.cursor === 'string') call.cursor = payload.input.cursor;
          if (command === 'connections.open') return { ok: true, result: { dialect: 'mysql', version: '8.4.11', connectionId: 84001 } };
          if (command === 'connections.close') return { ok: true, result: undefined };
          if (command === 'metadata.databases') return { ok: true, result: input.databases };
          if (command === 'metadata.objects') {
            if (hold) { call.released = false; return new Promise(finish => held.push({ call, finish })); }
            return { ok: true, result: objects };
          }
          if (command === 'workbench.resolve') {
            if (!database || !name || !['table', 'view'].includes(call.kind ?? '') ||
                !objects.some(item => item.name === name && item.kind === call.kind)) throw Error('打开目标必须是本例目录中的表或视图');
            return { ok: true, result: payload.input };
          }
          if (command === 'query.objectDefinition') {
            const taskId = payload.input.taskId;
            if (!database || !name || !['第一个子表', '第二个子表'].includes(name) || Object.hasOwn(payload.input, 'sessionId') ||
                typeof taskId !== 'string' || !/^object-definition:[a-f0-9-]{36}$/.test(taskId)) throw Error('定义预览必须使用本例依赖目录项和独立任务');
            call.taskId = taskId;
            const response = { ok: true, result: { request: payload.input, database, name, kind: 'table', temporary: false,
              ddl: `CREATE TABLE \`${name}\` (parent_id BIGINT);` } };
            if (holdDefinition) {
              call.released = false; pendingDependencyDefinitions.add(taskId);
              return new Promise(finish => definitions.push(() => {
                pendingDependencyDefinitions.delete(taskId); call.released = true; finish(response);
              }));
            }
            return response;
          }
          const object = objects.find(item => item.name === name && (command === 'metadata.ddl' ? item.kind === payload.input.kind :
            command === 'mysql.view.dependencies' ? item.kind === 'view' : item.kind === 'table' || item.kind === 'view'));
          if (!database || !object) throw Error('合成读取拒绝目录之外对象');
          if (command === 'mysql.view.dependencies') return { ok: true, result: { source: 'catalogue', referenced: [{ database, name: '视图依赖表' }],
            referencing: [{ database, name: '上层视图' }], skipped: 0, referencedUnknown: false, truncated: false } };
          if (command === 'metadata.ddl') {
            const definition = object.kind === 'procedure' ? `CREATE PROCEDURE \`${object.name}\`() SELECT 1;`
              : object.kind === 'function' ? `CREATE FUNCTION \`${object.name}\`() RETURNS INT DETERMINISTIC RETURN 1;`
              : object.kind === 'table' ? `CREATE TABLE \`${object.name}\` (id BIGINT);`
              : `CREATE VIEW \`${object.name}\` AS SELECT 1 AS id;`;
            const response = { ok: true, result: `-- 导航离线定义 ${object.kind}\n${definition}` };
            if (holdDefinition && object.kind === 'table') {
              call.released = false;
              return new Promise(finish => definitions.push(() => { call.released = true; finish(response); }));
            }
            return response;
          }
          if (command === 'metadata.tableElements' && object.kind === 'table') {
            return { ok: true, result: { columns: [{ name: 'id', type: 'bigint', primary: true, generated: false }], indexes: [], foreignKeys: [] } };
          }
          const metadata: TableInfo = { database, name: object.name, objectKind: object.kind as 'table' | 'view', columns: [{ name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: '', comment: '', generated: false }], indexes: [], foreignKeys: [], primaryKey: object.kind === 'table' ? ['id'] : [], editableKey: object.kind === 'table' ? ['id'] : [], engine: object.kind === 'table' ? 'InnoDB' : '', ddl: `-- 导航离线定义 ${object.name}` };
          if (command === 'table.incomingReferences' && object.kind === 'table') {
            if (call.cursor !== undefined && call.cursor !== '原父表第二页') throw Error('未知入向目录页');
            const key = { name: 'fk_parent', columns: ['parent_id'], referencedDatabase: database, referencedTable: object.name,
              referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' };
            return { ok: true, result: { source: metadata, sourceDigest: '原父表摘要', scope: 'visible-only',
              relations: [{ database, table: call.cursor ? '第二个子表' : '第一个子表', foreignKey: key, digest: '原外键摘要' }],
              ...(call.cursor ? {} : { nextCursor: '原父表第二页' }) } };
          }
          if (command === 'metadata.table') return { ok: true, result: metadata };
          return { ok: true, result: { rows: [], columns: [{ key: 'id', name: 'id', type: 'bigint' }], hasMore: false, page: payload.input.page, pageSize: payload.input.pageSize } };
        }
        const local = ['app.runtimeInfo', 'app.info', 'app.setDirty', 'app.menuState', 'settings.get', 'settings.save', 'connections.list', 'tasks.list', 'tasks.cancelState', 'history.list',
          'workbench.get', 'workbench.save', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish',
          'query.completionState', 'query.sessionState', 'queryFileSources.status', 'queryFileSources.recent', 'table.preferences.get', 'table.presets.list'];
        if (local.includes(command)) return original(event, payload);
        // 未列出的新增命令也默认拒绝；文件来源保存/打开及所有剪贴板路径不能绕过字符串前缀检查。
        prohibited.push(command); return { ok: false, error: '导航离线专项拒绝数据库执行、写入、文件及系统剪贴板路径' };
      };
      root.__navigationWorkbenchAudit = state; handlers.set('dbark:request', wrapped);
    }, { id: connectionId, databases: [alpha, beta], objects: smallObjects });
  });

  test.afterEach(async ({}, currentInfo) => {
    if (currentInfo.status !== currentInfo.expectedStatus) { halted = true; runtime.retainOwnedDesktopResources(currentInfo); return; }
    try {
      const facts = await audit(); expect(facts.prohibited).toEqual([]); expect(facts.pending).toBe(0); expect(runtime.pageErrors).toEqual([]);
      const actual = await main(({ app }) => ({ pid: process.pid, platform: process.platform, architecture: process.arch, packaged: app.isPackaged, appPath: app.getAppPath() }));
      await currentInfo.attach('导航专项原Main离线旁观', { body: JSON.stringify({ actual, ...facts, noRealDatabase: true, noSystemClipboard: true }), contentType: 'application/json' });
      await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.restore());
      await runtime.confirmOwnedDesktopExit(currentInfo); expect(runtime.ownedDesktopResources(currentInfo).closed).toBe(true);
      await currentInfo.attach('导航专项原应用正常退出', { body: JSON.stringify({ confirmed: true, mainPid: actual.pid }), contentType: 'application/json' });
    } catch (reason) { halted = true; runtime.retainOwnedDesktopResources(currentInfo); throw reason; }
  });

  test('七类原生菜单和命令状态真实联动，树选库不改当前查询，窗口命令仅切换原标签', async () => {
    const menu = await main(({ Menu }) => ({ mac: process.platform === 'darwin', labels: Menu.getApplicationMenu()!.items.map(item => item.label) }));
    expect(menu.labels).toEqual([...(menu.mac ? [productName] : []), '文件', '编辑', '查看', '收藏夹', '工具', '窗口', '帮助']);
    await expect.poll(() => nativeEnabled('execute')).toBe(true); await native('help');
    await expect(runtime.page.getByRole('dialog', { name: text.helpTitle, exact: true })).toBeVisible(); await expect.poll(() => nativeEnabled('execute')).toBe(false);
    await runtime.page.keyboard.press('Escape'); await expect(runtime.page.getByRole('dialog')).toHaveCount(0); await expect.poll(() => nativeEnabled('execute')).toBe(true);
    await openTree(); const before = await audit();
    await row('database', beta).click({ button: 'right' }); await expect(row('database', beta)).toHaveClass(/\bactive\b/);
    expect((await audit()).calls).toEqual(before.calls); await originalPreserved(); await runtime.page.keyboard.press('Escape');
    await toolbar().getByRole('button', { name: text.table, exact: true }).click(); await expect(browser()).toBeVisible();
    await expect(browser().locator('.object-browser-header')).toContainText(beta); await expect.poll(() => nativeEnabled('execute')).toBe(false);
    const first = (await settings()).tabs.find(tab => tab.kind === 'objects')!;
    expect(first.database).toBe(beta); expect((await settings()).tabs).toHaveLength(2);
    await native('previous-tab'); await expect(runtime.page.locator('.query-tab:visible')).toBeVisible(); await expect.poll(() => nativeEnabled('execute')).toBe(true);
    await originalPreserved(); expect((await audit()).calls.some(call => call.command === 'metadata.objects' && call.database === beta)).toBe(true);
  });

  test('定位只展开当前标签需要的节点，切换标签后丢弃迟到的对象目录', async () => {
    const sidebar = runtime.page.locator('.sidebar'), search = sidebar.locator('.search-box input');
    const locate = sidebar.getByRole('button', { name: sidebarLocateZh.action, exact: true });
    const database = row('database'), target = row('view', alpha, viewName);
    await search.fill('隐藏连接的筛选');
    await locate.press('Enter');
    await expect(search).toHaveValue('');
    await expect(database).toHaveClass(/\bactive\b/);
    await expect(database.locator('.tree-label')).toBeFocused();
    await expect(database.locator('.tree-label')).toHaveAttribute('aria-expanded', 'false');
    expect((await audit()).calls.map(call => call.command)).toEqual(['connections.open', 'metadata.databases']);
    await originalPreserved();

    await toolbar().getByRole('button', { name: text.view, exact: true }).click();
    await row('view', alpha, viewName, browser()).dblclick();
    await expect(runtime.page.locator('.table-tab:visible .results-grid')).toBeVisible();
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdObjects());
    await locate.click();
    await expect.poll(async () => (await audit()).pending).toBe(1);
    await expect(locate).toHaveAttribute('aria-busy', 'true');
    await activateOriginal();
    await expect(locate).toHaveAttribute('aria-busy', 'false');
    await runtime.desktop.evaluate((_, objects) => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseObjects(objects), smallObjects);
    await expect(database.locator('.tree-label')).toHaveAttribute('aria-expanded', 'false');
    await expect(target).toHaveCount(0);
    await originalPreserved();

    await runtime.page.locator('.tab-strip .tab-select').filter({ hasText: viewName }).click();
    await locate.click();
    await expect(target).toHaveClass(/\bactive\b/);
    await expect(target.locator('.tree-label')).toBeFocused();
    const before = (await audit()).calls;
    await locate.click();
    await expect(target.locator('.tree-label')).toBeFocused();
    expect((await audit()).calls).toEqual(before);
    await originalPreserved();
  });

  test('对象树筛选、星标、扁平显示和折叠全部使用原连接及目录状态', async () => {
    const sidebar = runtime.page.locator('.sidebar');
    const trigger = sidebar.getByRole('button', { name: sidebarViewZh.controls, exact: true });
    const panel = sidebar.getByRole('group', { name: sidebarViewZh.controls, exact: true });
    const locate = sidebar.getByRole('button', { name: sidebarLocateZh.action, exact: true });
    const connection = row('connection'), database = row('database');
    const vendor = panel.getByRole('combobox', { name: sidebarViewZh.vendor, exact: true });
    const starredOnly = panel.getByRole('checkbox', { name: sidebarViewZh.starredOnly, exact: true });
    const flat = panel.getByRole('checkbox', { name: sidebarViewZh.flat, exact: true });
    const headings = sidebar.locator('.connection-group-heading');
    await openTree();
    const before = (await audit()).calls;

    await trigger.press('Enter');
    await runtime.page.keyboard.press('Tab');
    await expect(vendor).toBeFocused();
    await flat.check();
    await expect(headings).toHaveCount(0);
    await expect(database).toBeVisible();
    await starredOnly.check();
    await expect(connection).toBeHidden();
    await expect(sidebar.getByText(sidebarViewZh.noMatch, { exact: true })).toBeVisible();
    await starredOnly.uncheck();
    await vendor.selectOption('sqlite');
    await expect(connection).toBeHidden();
    await vendor.selectOption('mysql');
    await expect(database).toBeVisible();
    await vendor.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect((await audit()).calls).toEqual(before);

    await connection.click({ button: 'right' });
    await runtime.page.getByRole('menuitem', { name: sidebarViewZh.star, exact: true }).click();
    await expect(connection.locator('.sidebar-connection-star')).toBeVisible();
    await trigger.click();
    await starredOnly.check();
    await vendor.selectOption('sqlite');
    await expect(connection).toBeHidden();
    await locate.click();
    await expect(database.locator('.tree-label')).toBeFocused();
    expect((await audit()).calls).toEqual(before);
    await expect.poll(async () => (await settings()).sidebarView).toEqual({ flat: true, starred: [connectionId] });

    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdObjects());
    await database.locator('.tree-label').click();
    await expect.poll(async () => (await audit()).pending).toBe(1);
    await trigger.click();
    await panel.getByRole('button', { name: sidebarViewZh.collapse, exact: true }).click();
    await expect(connection.locator('.tree-label')).toHaveAttribute('aria-expanded', 'false');
    await expect(connection.locator('.connection-dot')).toBeVisible();
    await expect(database).toHaveCount(0);
    await runtime.desktop.evaluate((_, objects) => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseObjects(objects), smallObjects);
    await originalPreserved();
    expect((await audit()).calls.map(call => call.command)).toEqual([...before.map(call => call.command), 'metadata.objects']);
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.prepareReload());
    await runtime.page.reload();
    await expect(connection.locator('.sidebar-connection-star')).toBeVisible();
    await expect(headings).toHaveCount(0);
    await connection.click({ button: 'right' });
    await runtime.page.getByRole('menuitem', { name: sidebarViewZh.unstar, exact: true }).click();
    await expect(connection.locator('.sidebar-connection-star')).toHaveCount(0);
    await expect.poll(async () => (await settings()).sidebarView).toEqual({ flat: true, starred: [] });
  });

  test('树搜索展开已读取的命中路径，清除后恢复手动状态且没有额外读取', async () => {
    const sidebar = runtime.page.locator('.sidebar'), search = sidebar.getByRole('textbox', { name: zh.sidebar.text003 });
    const connection = row('connection'), database = row('database');
    const view = row('view', alpha, viewName), table = row('table');
    const viewControls = sidebar.getByRole('button', { name: sidebarViewZh.controls, exact: true });
    const collapse = sidebar.getByRole('button', { name: sidebarViewZh.collapse, exact: true });
    await search.fill(viewName);
    await expect(sidebar.getByRole('status')).toHaveText(sidebarViewZh.noSearchMatch);
    await expect(sidebar.locator('.connection-group-heading')).toHaveCount(0);
    expect((await audit()).calls).toEqual([]);
    await sidebar.getByRole('button', { name: sidebarViewZh.resetSearch, exact: true }).click();
    await openTree();
    await database.locator('.tree-label').click();
    await expect(view).toBeVisible();
    const calls = (await audit()).calls;
    await search.fill(viewName);
    await expect(view).toBeVisible();
    await expect(table).toHaveCount(0);
    await expect(row('database', beta)).toBeHidden();
    await connection.locator('.tree-label').click();
    await expect(view).toBeHidden();
    await search.clear();
    await expect(view).toBeVisible();
    await expect(table).toBeVisible();
    await expect(row('database', beta)).toBeVisible();

    await viewControls.click();
    await collapse.click();
    await expect(database).toHaveCount(0);
    await search.fill(viewName);
    await expect(view).toBeVisible();
    await expect(database.locator('.tree-label')).toHaveAttribute('aria-expanded', 'true');
    await viewControls.click();
    await collapse.click();
    await expect(search).toHaveValue(viewName);
    await expect(connection.locator('.tree-label')).toHaveAttribute('aria-expanded', 'false');
    await search.fill('  ' + beta.toUpperCase() + '  ');
    await expect(row('database', beta)).toBeVisible();
    await expect(database).toBeHidden();
    await search.clear();
    await expect(row('database', beta)).toHaveCount(0);
    expect((await audit()).calls).toEqual(calls);
    await originalPreserved();

    await search.fill(viewName);
    await expect(view).toBeVisible();
    await connection.locator('.tree-label').click({ button: 'right' });
    await runtime.page.getByRole('menuitem', { name: zh.sidebar.text011, exact: true }).click();
    await expect(sidebar.getByRole('status')).toHaveText(sidebarViewZh.noSearchMatch);
    await expect(view).toBeHidden();
    expect((await audit()).calls.slice(calls.length).map(call => call.command)).toEqual(['connections.open', 'metadata.databases']);
  });

  test('五千合成对象只渲染有界行，搜索和类别切换复用同库对象页并保留原稿', async () => {
    const objects = [...Array.from({ length: 5000 }, (_, index): DatabaseObject => ({ kind: 'table', name: '合成表_' + String(index).padStart(5, '0') })), ...smallObjects.filter(item => item.kind !== 'table')];
    await runtime.desktop.evaluate((_, next) => (globalThis as AuditRoot).__navigationWorkbenchAudit!.replaceObjects(next), objects);
    await chooseObjects(); await expect(browser().locator('.object-browser-footer')).toContainText('5000 个对象');
    const count = await browser().locator('.object-list-row').count(); expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(100);
    const id = (await settings()).tabs.find(tab => tab.kind === 'objects')!.id;
    await browser().locator('.object-browser-grid').hover(); await runtime.page.mouse.wheel(0, 160000);
    await expect(row('table', alpha, '合成表_04999', browser())).toBeVisible(); expect(await browser().locator('.object-list-row').count()).toBeLessThan(100);
    await browser().locator('.object-browser-columns > button').click(); await expect(browser().locator('.object-list-row').first()).toContainText('合成表_04999');
    await browser().getByRole('textbox', { name: text.search, exact: true }).fill('合成表_04999'); await expect(browser().locator('.object-list-row')).toHaveCount(1);
    await expect(browser().locator('.object-list-row')).toContainText('合成表_04999'); await browser().getByRole('textbox', { name: text.search, exact: true }).clear();
    await toolbar().getByRole('button', { name: text.view, exact: true }).click(); await expect(browser().getByRole('combobox', { name: text.type, exact: true })).toHaveValue('view');
    await toolbar().getByRole('button', { name: text.routine, exact: true }).click(); await expect(browser().getByRole('combobox', { name: text.type, exact: true })).toHaveValue('routine');
    await expect(browser().locator('.object-list-row')).toHaveCount(2);
    for (const category of ['trigger', 'event'] as const) {
      await toolbar().getByRole('button', { name: text.other, exact: true }).click();
      await runtime.page.getByRole('menu', { name: text.other, exact: true }).getByRole('menuitem', { name: text.categories[category], exact: true }).click();
      await expect(browser().getByRole('combobox', { name: text.type, exact: true })).toHaveValue(category); await expect(browser().locator('.object-list-row')).toHaveCount(1);
    }
    expect((await settings()).tabs.filter(tab => tab.kind === 'objects').map(tab => tab.id)).toEqual([id]); await originalPreserved();
    await info.attach('五千对象实际DOM预算', { body: JSON.stringify({ catalogTables: 5000, renderedRows: count, maximumRows: 99, noTablePageRead: !(await audit()).calls.some(call => call.command === 'table.page') }), contentType: 'application/json' });
  });

  test('对象列表右键只选中，表视图同名身份分开，双击才浏览数据或查看定义', async () => {
    await chooseObjects(); const target = row('table', alpha, same, browser()), before = await audit(), current = await settings();
    await target.click({ button: 'right' }); await expect(target).toHaveClass(/\bactive\b/); await expect(runtime.page.locator('.sidebar-context-menu')).toBeVisible();
    expect((await audit()).calls).toEqual(before.calls); expect((await settings()).tabs).toEqual(current.tabs); await runtime.page.keyboard.press('Escape');
    await target.dblclick(); await expect(runtime.page.locator('.table-tab:visible .results-grid')).toBeVisible();
    expect((await audit()).calls.some(call => call.command === 'metadata.table' && call.database === alpha && call.name === same)).toBe(true);
    await runtime.page.locator('.tab-strip .tab-select').filter({ hasText: text.objects }).click();
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('view');
    const view = row('view', alpha, same, browser()); await view.click({ button: 'right' }); await expect(view).toHaveClass(/\bactive\b/); await runtime.page.keyboard.press('Escape');
    await row('view', alpha, viewName, browser()).dblclick();
    const tablePage = runtime.page.locator('.table-tab:visible'); await expect(tablePage.locator('.results-grid')).toBeVisible();
    await expect(tablePage.getByRole('button', { name: zh.common.add, exact: true })).toBeDisabled();
    await runtime.page.locator('.tab-strip .tab-select').filter({ hasText: text.objects }).click();
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('routine'); await row('procedure', alpha, routine, browser()).dblclick();
    await expect(runtime.page.getByRole('dialog')).toContainText(routine);
    await expect.poll(async () => (await audit()).calls.filter(call => call.command === 'metadata.ddl').map(call => ({ database: call.database, name: call.name, kind: call.kind })) ).toEqual([{ database: alpha, name: routine, kind: 'procedure' }]);
    await runtime.page.keyboard.press('Escape'); await originalPreserved();
  });

  test('原生对象信息跟随同名不同类对象，旧 DDL 回包不能覆盖新定义', async () => {
    const t = objectInformationZh;
    const pane = runtime.page.getByRole('complementary', { name: t.title, exact: true });
    const toggle = toolbar().getByRole('button', { name: t.title, exact: true });
    const ddl = pane.locator('.object-info-content .view-lines');
    await expect.poll(() => nativeEnabled('object-information')).toBe(true);
    await native('object-information');
    await expect(pane.getByText(t.select, { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect((await audit()).calls).toEqual([]);
    await chooseObjects();
    const tabs = (await settings()).tabs, before = (await audit()).calls;
    await row('table', alpha, same, browser()).click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await expect(pane.locator('.object-info-subject')).toContainText(same);
    expect((await audit()).calls).toEqual(before);
    await pane.getByRole('button', { name: t.structure, exact: true }).click();
    await expect(pane.getByRole('region', { name: '字段', exact: true })).toContainText('bigint');
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdTableDefinition());
    await pane.getByRole('button', { name: t.ddl, exact: true }).click();
    await expect.poll(async () => (await audit()).pending).toBe(1);
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('view');
    await row('view', alpha, same, browser()).click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await expect(pane.getByRole('button', { name: t.structure, exact: true })).toHaveCount(0);
    await expect(ddl).toContainText('CREATE VIEW');
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseTableDefinition());
    await expect(ddl).toContainText('CREATE VIEW');
    await pane.getByRole('button', { name: t.find, exact: true }).click();
    const find = pane.locator('.find-widget.visible');
    await expect(find).toBeVisible();
    await find.getByRole('textbox', { name: 'Find', exact: true }).fill('CREATE VIEW');
    await expect(find.locator('.matchesCount')).toContainText('1 of 1');
    await runtime.page.keyboard.press('Escape');
    await expect(find).toHaveCount(0);
    const definitions = (await audit()).calls.filter(call => call.command === 'metadata.ddl');
    expect(definitions.map(call => [call.database, call.name, call.kind])).toEqual([[alpha, same, 'table'], [alpha, same, 'view']]);
    expect((await settings()).tabs.map(tab => tab.id)).toEqual(tabs.map(tab => tab.id));
    await originalPreserved();

    await main(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 680); });
    const work = runtime.page.locator('.main-workspace');
    await expect.poll(() => runtime.page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1130);
    const width = (await work.boundingBox())!.width;
    await expect(pane).toBeVisible();
    await runtime.page.screenshot({ path: info.outputPath('窄窗口对象信息.png') });
    await pane.getByRole('button', { name: t.close, exact: true }).click();
    await expect(pane).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect((await work.boundingBox())!.width).toBe(width);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('对象信息展示双向依赖，并沿原表摘要翻页', async () => {
    const t = objectInformationZh;
    const pane = runtime.page.getByRole('complementary', { name: t.title, exact: true });
    const outbound = pane.getByRole('region', { name: t.references, exact: true });
    const inbound = pane.getByRole('region', { name: t.referencedBy, exact: true });
    await chooseObjects();
    const ids = (await settings()).tabs.map(tab => tab.id);
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('view');
    await row('view', alpha, same, browser()).click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await native('object-information');
    await pane.getByRole('button', { name: t.dependencies, exact: true }).click();
    await expect(outbound).toContainText('视图依赖表');
    await expect(inbound).toContainText('上层视图');
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('table');
    await row('table', alpha, same, browser()).click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await expect(inbound).toContainText('第一个子表');
    await expect(inbound).toContainText('parent_id → id');
    await inbound.getByRole('button', { name: t.nextDependencies, exact: true }).click();
    await expect(inbound).toContainText('第二个子表');
    await expect(inbound.getByRole('button', { name: t.nextDependencies, exact: true })).toBeDisabled();
    const open = inbound.getByRole('button', { name: t.openDependencyDefinition(alpha + ' / 第二个子表'), exact: true });
    const preview = pane.getByRole('region', { name: t.dependencyDefinition, exact: true });
    const back = preview.getByRole('button', { name: t.backToDependencies, exact: true });
    await open.press('Enter');
    await expect(preview.locator('.view-lines')).toContainText('CREATE TABLE');
    await expect(preview.locator('.view-lines')).toContainText('第二个子表');
    await expect(back).toBeFocused();
    await preview.getByRole('button', { name: t.find, exact: true }).click();
    const find = preview.locator('.find-widget.visible');
    await find.getByRole('textbox', { name: 'Find', exact: true }).fill('parent_id');
    await expect(find.locator('.matchesCount')).toContainText('1 of 1');
    await runtime.page.keyboard.press('Escape');
    await expect(find).toHaveCount(0);

    const resize = pane.getByRole('separator', { name: t.resize, exact: true });
    const readsBeforeLayout = (await audit()).calls;
    await expect(pane).toHaveAttribute('data-layout', 'docked');
    await expect(resize).toHaveAttribute('aria-valuenow', '340');
    await resize.press('Shift+ArrowLeft');
    await expect(resize).toHaveAttribute('aria-valuenow', '390');
    await expect.poll(async () => (await settings()).objectInformationWidth).toBe(390);
    const mouse = runtime.page.mouse;
    async function dragWider() {
      const bounds = (await resize.boundingBox())!;
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await mouse.move(x, y);
      await mouse.down();
      await mouse.move(x - 120, y, { steps: 6 });
      await expect(resize).toHaveAttribute('aria-valuenow', '510');
    }
    await dragWider();
    expect((await settings()).objectInformationWidth).toBe(390);
    await runtime.page.keyboard.press('Escape');
    await mouse.up();
    await expect(resize).toHaveAttribute('aria-valuenow', '390');
    await dragWider();
    await mouse.up();
    await expect.poll(async () => (await settings()).objectInformationWidth).toBe(510);

    const expand = pane.getByRole('button', { name: t.expand, exact: true });
    const restore = pane.getByRole('button', { name: t.restoreSize, exact: true });
    const work = runtime.page.locator('.main-workspace');
    await expand.press('Enter');
    await expect(pane).toHaveAttribute('data-layout', 'expanded');
    await expect(restore).toBeFocused();
    await expect(resize).toHaveCount(0);
    await expect(work).toHaveAttribute('inert', '');
    await expect.poll(() => pane.evaluate(element => element.clientWidth - element.parentElement!.clientWidth)).toBe(0);
    await expect(preview.locator('.view-lines')).toContainText('第二个子表');
    await runtime.page.screenshot({ path: info.outputPath('展开依赖对象定义.png') });
    await restore.press('Enter');
    await expect(expand).toBeFocused();
    await expect(work).not.toHaveAttribute('inert', '');
    await expect(resize).toHaveAttribute('aria-valuenow', '510');

    await main(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1140, 680); });
    await expect.poll(() => runtime.page.evaluate(() => innerWidth)).toBe(1140);
    await expect(pane).toHaveAttribute('data-layout', 'docked');
    await expect.poll(async () => Number(await resize.getAttribute('aria-valuemax'))).toBeLessThan(510);
    const clamped = Number(await resize.getAttribute('aria-valuemax'));
    await expect(resize).toHaveAttribute('aria-valuenow', String(clamped));
    await main(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 680); });
    await expect(pane).toHaveAttribute('data-layout', 'overlay');
    await expect(resize).toHaveAttribute('aria-valuenow', '510');
    await expect(preview.locator('.view-lines')).toContainText('第二个子表');
    expect((await settings()).objectInformationWidth).toBe(510);
    expect((await audit()).calls).toEqual(readsBeforeLayout);
    await runtime.page.screenshot({ path: info.outputPath('窄窗口依赖对象定义.png') });
    await back.press('Enter');
    await expect(open).toBeFocused();
    await expect(inbound).toContainText(t.dependencyPage(2));
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdTableDefinition());
    await open.press('Enter');
    await expect(preview).toBeVisible();
    await expect.poll(async () => (await audit()).pending).toBe(1);
    await back.click();
    await expect(open).toBeFocused();
    await expect.poll(async () => (await audit()).calls.some(call => call.command === 'query.cancel')).toBe(true);
    const pending = (await audit()).calls.find(call => call.command === 'query.objectDefinition' && !call.released);
    expect((await audit()).calls.find(call => call.command === 'query.cancel')?.taskId).toBe(pending?.taskId);
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseTableDefinition());
    await expect(preview).toHaveCount(0);
    await expect(inbound).toContainText(t.dependencyPage(2));
    await open.click();
    await expect(preview.locator('.view-lines')).toContainText('第二个子表');
    await back.click();
    await expect(open).toBeFocused();
    await inbound.getByRole('button', { name: t.previousDependencies, exact: true }).click();
    await expect(inbound).toContainText('第一个子表');
    expect((await audit()).calls.filter(call => call.command === 'table.incomingReferences').map(call => call.cursor))
      .toEqual([undefined, '原父表第二页', undefined]);
    expect((await settings()).tabs.map(tab => tab.id)).toEqual(ids);
    await pane.getByRole('button', { name: t.close, exact: true }).click();
    await native('object-information');
    await expect(resize).toHaveAttribute('aria-valuenow', '510');
    await resize.dblclick();
    await expect(resize).toHaveAttribute('aria-valuenow', '340');
    await expect.poll(async () => (await settings()).objectInformationWidth).toBe(340);
    await originalPreserved();
  });

  test('对象页布局恢复只重读目录，刷新中的迟到目录不能保留旧菜单目标', async () => {
    await chooseObjects(); await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('view');
    await expect.poll(async () => (await settings()).tabs.find(tab => tab.kind === 'objects')?.objectCategory).toBe('view');
    const before = await settings(), mainPid = await main(() => process.pid); await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.prepareReload());
    await runtime.page.reload(); await expect(browser()).toBeVisible(); await expect(browser().getByRole('combobox', { name: text.type, exact: true })).toHaveValue('view');
    expect((await settings()).tabs).toEqual(before.tabs); expect(await main(() => process.pid)).toBe(mainPid); await originalPreserved();
    await browser().getByRole('combobox', { name: text.type, exact: true }).selectOption('table');
    const old = row('table', alpha, same, browser()); await old.click({ button: 'right' }); await expect(runtime.page.locator('.sidebar-context-menu')).toBeVisible();
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdObjects());
    await browser().getByRole('button', { name: text.refresh, exact: true }).click(); await expect.poll(async () => (await audit()).pending).toBe(1);
    await expect(runtime.page.locator('.sidebar-context-menu')).toHaveCount(0); await expect(old).toHaveCount(0);
    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseObjects([{ kind: 'table', name: '刷新后新对象' }]));
    await expect(browser().locator('.object-list-row')).toHaveCount(1); await expect(browser().locator('.object-list-row')).toContainText('刷新后新对象');
    await expect(old).toHaveCount(0); await originalPreserved();
  });

  test('信息窗格搜索并分页查看标识符，打开原视图，拒绝迟到的旧库目录', async () => {
    const t = objectInformationZh;
    const pane = runtime.page.getByRole('complementary', { name: t.title, exact: true });
    const identifiers = pane.getByRole('region', { name: t.identifiers, exact: true });
    const search = identifiers.getByRole('searchbox', { name: t.searchRelationIdentifiers, exact: true });
    const mode = pane.getByRole('button', { name: t.identifiers, exact: true });
    await openTree();
    await row('database').locator('.tree-label').click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await native('object-information');
    const originalCalls = (await audit()).calls;
    await expect(mode).toBeVisible();
    expect((await audit()).calls).toEqual(originalCalls);
    await main((_) => {
      const audit = (globalThis as AuditRoot).__navigationWorkbenchAudit!;
      audit.replaceObjects(Array.from({ length: 51 }, (_, i) => ({ kind: 'table', name: '目录_' + String(i).padStart(2, '0') })));
    });
    await mode.click();
    await expect(identifiers.getByRole('status')).toContainText(t.identifierRange(1, 50, 51));
    await identifiers.getByRole('button', { name: t.nextIdentifiers, exact: true }).click();
    await expect(identifiers.getByRole('list')).toContainText('目录_50');
    await search.fill('目录_03');
    await expect(identifiers.getByRole('status')).toContainText(t.identifierRange(1, 1, 1));
    await expect(identifiers.getByRole('listitem')).toHaveCount(1);
    expect((await audit()).calls.filter(call => call.command === 'metadata.objects').map(call => call.database)).toEqual([alpha]);

    await main(() => (globalThis as AuditRoot).__navigationWorkbenchAudit!.holdObjects());
    await pane.getByRole('button', { name: t.refresh, exact: true }).click();
    await expect.poll(async () => (await audit()).pending).toBe(1);
    await row('connection').locator('.tree-label').click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await expect(mode).toHaveCount(0);
    const special = '导航.视`图';
    await runtime.desktop.evaluate((_, name) => (globalThis as AuditRoot).__navigationWorkbenchAudit!.releaseObjects([{ kind: 'view', name }]), special);
    await expect(identifiers).toHaveCount(0);
    await row('database').locator('.tree-label').click({ button: 'right' });
    await runtime.page.keyboard.press('Escape');
    await expect(identifiers.getByRole('listitem')).toHaveCount(1);
    const copy = identifiers.getByRole('button', { name: t.copyIdentifier(special), exact: true });
    const clipboard = await copy.evaluate(button => {
      if (Object.hasOwn(document, 'execCommand') || !(button instanceof HTMLButtonElement)) throw Error('复制捕获不可用');
      const data = new DataTransfer();
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('只捕获本次标识符复制');
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        return true;
      } });
      try { button.click(); return data.getData('text/plain'); }
      finally { Reflect.deleteProperty(document, 'execCommand'); }
    });
    expect(clipboard).toBe('`' + alpha + '`.`导航.视``图`');
    await main(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 680); });
    await expect(pane).toHaveAttribute('data-layout', 'overlay');
    await expect.poll(() => identifiers.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    await runtime.page.screenshot({ path: info.outputPath('数据库标识符.png') });
    await identifiers.getByRole('button', { name: t.openIdentifier(special), exact: true }).press('Enter');
    await expect(runtime.page.locator('.table-tab:visible .results-grid')).toBeVisible();
    expect((await audit()).calls.filter(call => call.command === 'workbench.resolve')).toEqual([
      { command: 'workbench.resolve', database: alpha, name: special, kind: 'view', released: true },
    ]);
    await originalPreserved();
  });

  test('最小窗口及600侧栏明暗布局无横向溢出，更多菜单支持键盘和真实帮助入口', async () => {
    await main(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 680); });
    await runtime.page.getByRole('button', { name: zh.app.text009, exact: true }).click();
    const preferences = runtime.page.getByRole('dialog'); await preferences.getByLabel(zh.app.text022, { exact: true }).fill('600');
    await preferences.getByRole('button', { name: zh.common.done, exact: true }).click(); await expect(runtime.page.locator('.sidebar-container')).toHaveCSS('width', '600px');
    const facts: unknown[] = [];
    for (const theme of ['dark', 'light']) {
      if ((await settings()).theme !== theme) await runtime.page.getByRole('button', { name: zh.app.text008, exact: true }).click();
      await expect(runtime.page.locator('html')).toHaveAttribute('data-theme', theme);
      const boxes = await runtime.page.locator('.navigation-toolbar,.query-primary-toolbar,.query-result-toolbar').evaluateAll(nodes => nodes.map(node => ({ className: node.className, client: node.clientWidth, scroll: node.scrollWidth, rect: node.getBoundingClientRect().toJSON() })));
      expect(boxes).toHaveLength(3); for (const box of boxes) expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
      expect(await runtime.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // 工具栏无溢出不代表会话行可用：单独核对入口完整坐标并实际打开菜单。
      const context = await runtime.page.locator('.query-context-bar').evaluate(node => {
        const options = node.querySelector('.query-context-options')!;
        return { client: node.clientWidth, scroll: node.scrollWidth, rect: node.getBoundingClientRect().toJSON(), options: options.getBoundingClientRect().toJSON(), viewport: window.innerWidth,
          titles: [...node.querySelectorAll('strong,.query-file-source-caption,.query-session-state')].map(item => item.getAttribute('title')) };
      });
      expect(context.scroll).toBeLessThanOrEqual(context.client + 1);
      expect(context.options.left).toBeGreaterThanOrEqual(context.rect.left - 1);
      expect(context.options.right).toBeLessThanOrEqual(Math.min(context.rect.right, context.viewport) + 1);
      expect(context.options.width).toBeGreaterThan(0); for (const title of context.titles) expect(title).toBeTruthy();
      const beforeMenu = await audit();
      await runtime.page.getByRole('button', { name: actionMenuZh.sessionOptions, exact: true }).click();
      await expect(runtime.page.getByRole('menu', { name: actionMenuZh.sessionOptions, exact: true })).toBeVisible();
      await runtime.page.keyboard.press('Escape'); await expect(runtime.page.locator('.action-menu-panel')).toHaveCount(0);
      expect((await audit()).calls).toEqual(beforeMenu.calls); facts.push({ theme, boxes, context });
      await runtime.page.screenshot({ path: info.outputPath(`导航最小窗口-${theme}.png`) });
    }
    const more = toolbar().locator('.toolbar-overflow > .action-menu-trigger'); await more.press('ArrowDown');
    const menu = runtime.page.locator('.action-menu-panel[role="menu"]').first(); await expect(menu).toBeVisible(); await runtime.page.keyboard.press('End'); await runtime.page.keyboard.press('Home');
    await menu.getByRole('menuitem', { name: '帮助', exact: true }).focus(); await runtime.page.keyboard.press('ArrowRight');
    const help = runtime.page.getByRole('menu', { name: '帮助', exact: true }); await expect(help).toBeVisible(); await runtime.page.keyboard.press('Home'); await runtime.page.keyboard.press('Enter');
    await expect(runtime.page.getByRole('dialog', { name: text.helpTitle, exact: true })).toBeVisible(); await runtime.page.keyboard.press('Escape');
    await expect(runtime.page.locator('.action-menu-panel')).toHaveCount(0); await originalPreserved();
    await info.attach('导航最小窗口实际布局', { body: JSON.stringify(facts), contentType: 'application/json' });
  });
}
