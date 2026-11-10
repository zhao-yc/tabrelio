import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from '../../src/main/storage';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { sqlBlockCommentZh as messages } from '../../src/renderer/locales/sqlBlockComment.zh-CN';
import { dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const label = uiCommandLabels['sql-toggle-block-comment'];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const activeEditor = () => page.locator('.query-tab:visible .monaco-editor');

/** 等原生菜单已投影当前选区再点击一次，避免使用仍来自空选区的旧菜单代次。 */
async function nativeQueryCommand(id: string, selection: boolean) {
  await expect.poll(() => desktop.evaluate(({ Menu }, { id, selection }) => {
    const menu = Menu.getApplicationMenu();
    return menu?.getMenuItemById(id)?.enabled === true && menu.getMenuItemById('execute-selection')?.enabled === selection;
  }, { id, selection })).toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }, { id, selection }) => {
    const menu = Menu.getApplicationMenu(), item = menu?.getMenuItemById(id), [window] = BrowserWindow.getAllWindows();
    if (!item?.enabled || !window || menu?.getMenuItemById('execute-selection')?.enabled !== selection) throw Error('原生命令所属的查询或选区不可用');
    item.click(item, window, {} as Electron.KeyboardEvent);
  }, { id, selection });
}

/** 用正式存储准备离线查询和本例专用的 SQLite 文件，实际操作经过原生窗口。 */
async function seed(dialect: 'mysql' | 'mariadb' | 'sqlite' | 'postgresql', sql: string, secondQuery?: string) {
  await quitDesktop();
  const id = 'block-comment-offline', database = dialect === 'sqlite' ? 'main' : 'offline_db';
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'),
    { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    const profile = { id, name: '离线块注释', group: '', color: '#123456' };
    if (dialect === 'sqlite') {
      const filePath = join(realpathSync(dataDir), 'block-comment.sqlite');
      const db = new DatabaseSync(filePath);
      try { db.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY)'); }
      finally { db.close(); }
      store.saveConnection({ ...profile, dialect, sqlite: { filePath, readOnly: true, busyTimeoutMs: 1000 } });
    } else {
      store.saveConnection({ ...profile, dialect, database, host: '127.0.0.1', port: 1, user: 'offline' });
    }
    if (secondQuery !== undefined) store.saveConnection({
      ...profile, id: 'zoom-other', name: '离线缩放另一个连接', dialect: 'postgresql', host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres',
    });
    store.saveSettings({ ...store.settings(), activeTabId: id, tabs: [
      { id, kind: 'query', title: '原查询', connectionId: id, database, sql },
      ...(secondQuery === undefined ? [] : [{ id: 'zoom-other', kind: 'query' as const, title: '另一个查询', connectionId: 'zoom-other', sql: secondQuery }]),
    ] });
  } finally { store.close(); }
  await launchDesktop();
  await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
  await page.reload();
  await expect(activeEditor().getByRole('textbox')).toBeVisible();
}

for (const dialect of ['mysql', 'mariadb', 'sqlite', 'postgresql'] as const) {
  test(`${dialect} 在选区内查找替换保留同一行的区外匹配`, async ({}, info) => {
    const prefix = "select 'needle outside', ";
    const fragment = "needle 🚢 A',\n  'needle";
    const selected = dialect === 'postgresql' || dialect === 'sqlite' ? `'${fragment} B'` :
      "'needle 🚢 A', 'needle B'" + (dialect === 'mysql' ? ` /* ${'x '.repeat(1001)}*/` : '');
    const suffix = ", 'needle outside';\n" + (dialect === 'sqlite' ? `select '${fragment} B';` : "select 'needle later';") + (dialect === 'mariadb' ? '\n  ' : '');
    const source = prefix + selected + suffix;
    await seed(dialect, dialect === 'mariadb' ? source.slice(0, -2) : dialect === 'sqlite' ? source.replaceAll('\n', '\r\n') : source);
    const editor = activeEditor();
    if (dialect === 'mariadb') {
      // 模拟 Monaco 留待后续编辑清理的自动缩进，确保替换保留选区外的空白行。
      await editor.evaluate(node => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(candidate => candidate.getContainerDomNode().contains(node));
        const model = instance?.getModel();
        if (!instance || !model || !model.getOptions().trimAutoWhitespace) throw Error('编辑器未启用自动缩进清理');
        const line = model.getLineCount();
        const autoIndent = { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, text: '  ', isAutoWhitespaceEdit: true };
        if (!instance.executeEdits('test-auto-indent', [autoIndent])) throw Error('无法准备选区外的自动缩进');
      });
    }
    const findPanel = page.getByRole('dialog', { name: '在选区内查找', exact: true });
    const replacePanel = page.getByRole('dialog', { name: '在选区内替换', exact: true });
    async function selectRange() {
      return editor.evaluate((node, { prefix, selected, crlf }) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(candidate => candidate.getContainerDomNode().contains(node));
        const model = instance?.getModel();
        if (!instance || !model) throw Error('原查询模型不可读');
        if (crlf && model.getEOL() !== '\r\n') throw Error('测试查询未使用 CRLF');
        const start = model.getPositionAt(prefix.length), end = model.getPositionAt(prefix.length + selected.replaceAll('\n', model.getEOL()).length);
        instance.focus();
        instance.setSelection({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
        const bounds = instance.getDomNode()!.getBoundingClientRect();
        const point = instance.getScrolledVisiblePosition({ lineNumber: start.lineNumber, column: start.column + 4 });
        if (!point) throw Error('选区不可见');
        return { x: bounds.x + point.left, y: bounds.y + point.top + point.height / 2 };
      }, { prefix, selected, crlf: dialect === 'sqlite' });
    }
    const point = await selectRange();
    if (dialect === 'sqlite') {
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: '在选区内查找', exact: true }).click({ delay: 120 });
    } else {
      await nativeQueryCommand('sql-find-selection', true);
    }
    const findQuery = findPanel.getByLabel('查找内容', { exact: true });
    await expect(findQuery).toBeFocused();
    if (dialect === 'postgresql') {
      await findQuery.fill(fragment);
      await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 1 处');
    }
    await findQuery.fill('NEEDLE');
    await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
    if (dialect === 'mysql') {
      await findPanel.getByLabel('区分大小写').check();
      await expect(findPanel.getByRole('status')).toHaveText('选区内无匹配。');
      await findQuery.fill('needle');
    }
    await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
    const preview = findPanel.getByLabel('选区匹配预览');
    await expect(preview.locator('mark')).toHaveCount(2);
    await expect(preview.locator('mark').nth(0)).toHaveAttribute('aria-current', 'true');
    await findQuery.press('Shift+Enter');
    await expect(findPanel.getByRole('status')).toHaveText('第 2 处，共 2 处');
    await expect(preview.locator('mark').nth(1)).toHaveAttribute('aria-current', 'true');
    await findQuery.press('Enter');
    await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
    await findQuery.press('Enter');
    await expect(findPanel.getByRole('status')).toHaveText('第 2 处，共 2 处');
    await findPanel.getByRole('button', { name: '定位到当前匹配', exact: true }).click();
    await expect(findPanel).toBeHidden();
    expect(await editor.evaluate(node => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(candidate => candidate.getContainerDomNode().contains(node));
      const model = instance?.getModel(), selection = instance?.getSelection();
      return model && selection ? model.getValueInRange(selection) : undefined;
    })).toBe('needle');

    if (dialect === 'mysql') {
      await selectRange();
      await nativeQueryCommand('sql-find-selection', true);
      const selectMatches = findPanel.getByRole('button', { name: '选中全部匹配', exact: true });
      await findQuery.fill('x');
      await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 1001 处');
      await expect(selectMatches).toBeDisabled();
      await expect(findPanel.getByText('一次最多选中 1000 处，请缩小范围后再使用多光标。')).toBeVisible();
      await findQuery.fill('needle');
      await expect(findPanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
      await findQuery.press('Enter');
      await findPanel.screenshot({ path: info.outputPath('sql-selection-multi-cursor.png') });
      await selectMatches.click();
      await expect(findPanel).toBeHidden();
      const editorState = () => editor.evaluate(node => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(candidate => candidate.getContainerDomNode().contains(node));
        const model = instance?.getModel();
        if (!instance || !model) throw Error('原查询模型不可读');
        return { sql: model.getValue().replaceAll('\r\n', '\n'), matches: instance.getSelections()?.map(match => ({
          offset: model.getOffsetAt(match.getStartPosition()), text: model.getValueInRange(match),
        })) };
      });
      expect(await editorState()).toEqual({ sql: source, matches: [selected.lastIndexOf('needle'), selected.indexOf('needle')]
        .map(offset => ({ offset: prefix.length + offset, text: 'needle' })) });
      await page.keyboard.type('X');
      await expect.poll(async () => (await editorState()).sql).toBe(prefix + selected.replaceAll('needle', 'X') + suffix);
      await page.keyboard.press(`${modifier}+z`);
      await expect.poll(async () => (await editorState()).sql).toBe(source);
    }

    await selectRange();
    await nativeQueryCommand('sql-replace-selection', true);
    const query = dialect === 'postgresql' ? "needle (🚢 A)',\\r?\\n  'needle (B)" : 'needle';
    const replaceQuery = replacePanel.getByLabel('查找内容', { exact: true });
    const replaceAll = replacePanel.getByRole('button', { name: '全部替换', exact: true });
    await expect(replaceQuery).toBeFocused();
    if (dialect === 'postgresql') await replacePanel.getByLabel('正则表达式').check();
    await replaceQuery.fill(query);
    await expect(replacePanel.getByRole('status')).toHaveText(dialect === 'postgresql' ? '第 1 处，共 1 处' : '第 1 处，共 2 处');
    if (dialect === 'sqlite') {
      const regex = replacePanel.getByLabel('正则表达式');
      await regex.check();
      await replaceQuery.fill('needle|(?= )');
      await expect(replacePanel.getByLabel('选区匹配预览').locator('mark.zero-width').first()).toBeVisible();
      await replacePanel.getByRole('button', { name: '选中全部匹配', exact: true }).click();
      await expect(replacePanel.getByRole('alert')).toHaveText('当前匹配无法分别选中，请调整查找条件。');
      await regex.uncheck();
      await replaceQuery.fill('absent');
      await expect(replaceAll).toBeDisabled();
      await replaceQuery.fill('🚢 A');
      await expect(replacePanel.getByRole('status')).toHaveText('第 1 处，共 1 处');
      await replaceQuery.fill(query);
      await expect(replacePanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
      const oversized = 'needle'.repeat(100);
      await replaceQuery.fill(oversized);
      await expect(replaceQuery).toHaveValue(oversized);
      await expect(replacePanel.getByRole('alert')).toHaveText('查找内容超出匹配上限，请缩短后重试。');
      await expect(replaceAll).toBeDisabled();
      await replacePanel.getByLabel('整词匹配').check();
      const [line1, line2] = fragment.split('\n');
      await replaceQuery.fill(line1);
      await replaceQuery.press('Alt+Enter');
      await page.keyboard.insertText(line2);
      await expect(replaceQuery).toHaveValue(fragment);
      await expect(replacePanel.getByRole('status')).toHaveText('第 1 处，共 1 处');
      expect(await replacePanel.getByLabel('选区匹配预览').locator('mark').textContent()).toBe(fragment.replaceAll('\n', '\r\n'));
    }
    const read = () => page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n');
    });
    const replacement = replacePanel.getByLabel('替换为', { exact: true });
    const replaceCurrent = replacePanel.getByRole('button', { name: '替换当前匹配', exact: true });
    await replacement.fill(dialect === 'postgresql' ? '组合 $1\n$2' : dialect === 'mariadb' ? 'needle X' : '替换后的值');
    if (dialect === 'sqlite') await replacePanel.screenshot({ path: info.outputPath('sql-selection-multiline.png') });
    const firstEdit = prefix + selected.replace('needle', 'needle X') + suffix;
    if (dialect === 'mariadb') {
      await replaceCurrent.click();
      await expect.poll(read).toBe(firstEdit);
      await expect(replacePanel.getByRole('status')).toHaveText('第 2 处，共 2 处');
      await replacePanel.screenshot({ path: info.outputPath('sql-selection-repeat.png') });
      await replaceCurrent.click();
      await expect(replacePanel.getByRole('status')).toHaveText('已到选区末尾，仍有 2 处匹配。');
      await expect(replaceCurrent).toBeDisabled();
      await expect(replaceAll).toBeEnabled();
      await replacePanel.getByRole('button', { name: '下一处', exact: true }).click();
      await expect(replacePanel.getByRole('status')).toHaveText('第 1 处，共 2 处');
    } else if (dialect === 'postgresql') {
      await replaceCurrent.click();
      await expect(replacePanel.getByRole('status')).toHaveText('选区内无匹配。');
    } else {
      await replaceAll.click();
    }
    if (dialect === 'mariadb' || dialect === 'postgresql') await replacePanel.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(replacePanel).toBeHidden();
    const result = dialect === 'postgresql' ? "'组合 🚢 A\nB'" : dialect === 'mariadb'
      ? selected.replaceAll('needle', 'needle X') : selected.replaceAll(dialect === 'sqlite' ? fragment : 'needle', '替换后的值');
    await expect.poll(read).toBe(prefix + result + suffix);
    await page.keyboard.press(`${modifier}+z`);
    if (dialect === 'mariadb') {
      await expect.poll(read).toBe(firstEdit);
      await page.keyboard.press(`${modifier}+z`);
    }
    await expect.poll(read).toBe(source);
    if (dialect === 'sqlite') {
      await selectRange();
      await nativeQueryCommand('sql-replace-selection', true);
      await replacePanel.getByLabel('正则表达式').check();
      await replaceQuery.fill('(?=needle)');
      await expect(replacePanel.getByLabel('选区匹配预览').locator('mark.zero-width')).toHaveCount(2);
      await replacement.fill('新');
      await replaceCurrent.click();
      await expect(replacePanel.getByRole('status')).toHaveText('第 2 处，共 2 处');
      const zeroWidthEdit = prefix + selected.replace('needle', '新needle') + suffix;
      await expect.poll(read).toBe(zeroWidthEdit);
      await editor.evaluate(node => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(candidate => candidate.getContainerDomNode().contains(node));
        if (!instance) throw Error('原查询编辑器不可读');
        instance.setPosition({ lineNumber: 1, column: 1 });
      });
      await expect(replacePanel.getByRole('alert')).toHaveText('原选区或查询已变化，请关闭并重新发起。');
      await expect(replacePanel.getByLabel('选区匹配预览')).toHaveCount(0);
      await expect(replaceAll).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(replacePanel).toBeHidden();
      await expect.poll(read).toBe(zeroWidthEdit);
      await page.keyboard.press(`${modifier}+z`);
      await expect.poll(read).toBe(source);
    }
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'postgresql'] as const) {
  test(`${dialect} 按选项格式化 SQL 绑定原选区并按选择保存偏好`, async ({}, info) => {
    const body = 'select * from t where id in (100,200,300);';
    const source = 'select 1;\n' + body + '\nselect 2;';
    const result = 'select 1;\n' + (dialect === 'mysql'
      ? 'SELECT\n  *\nFROM\n  t\nWHERE\n  id IN (\n    100,\n    200,\n    300\n  );'
      : 'select\n  *\nfrom\n  t\nwhere\n  id in (\n    100,\n    200,\n    300\n  );') + '\nselect 2;';
    await seed(dialect, source);
    async function select(line: number, empty = false) {
      await activeEditor().evaluate((element, { line, empty }) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const model = editor?.getModel();
        if (!editor || !model) throw Error('原查询模型不可读');
        editor.setSelection({ startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: empty ? 1 : model.getLineMaxColumn(line) });
      }, { line, empty });
    }
    const panel = page.getByRole('dialog', { name: '按选项格式化 SQL', exact: true });
    const once = panel.getByRole('button', { name: '仅本次格式化', exact: true });
    const read = () => page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return { width: settings.sqlExpressionWidth, sql: settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n') };
    });
    async function openOptions() {
      if (dialect === 'mysql') {
        await nativeQueryCommand('sql-format-options', true);
      } else {
        await (await navigationMenuItem(page.locator('.query-tab:visible'), { name: '按选项格式化 SQL', exact: true })).click();
      }
      await expect(panel).toBeVisible();
    }
    await select(2);
    await openOptions();
    await select(3);
    await once.click();
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(await read()).toEqual({ width: undefined, sql: source });
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await select(2);
    await openOptions();
    await panel.getByRole('spinbutton', { name: '括号内单行宽度', exact: true }).fill('10');
    if (dialect === 'mysql') {
      await panel.getByRole('combobox', { name: '关键字大小写', exact: true }).selectOption('upper');
      await panel.screenshot({ path: info.outputPath('sql-format-options.png') });
      await once.click();
    } else {
      await panel.getByRole('button', { name: '格式化并保存偏好', exact: true }).click();
    }
    const width = dialect === 'mysql' ? undefined : 10;
    await expect(panel).toBeHidden();
    await expect.poll(read).toEqual({ width, sql: result });
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(read).toEqual({ width, sql: source });
    if (dialect === 'postgresql') {
      await select(1, true);
      await openOptions();
      await expect(panel.getByRole('spinbutton', { name: '括号内单行宽度', exact: true })).toHaveValue('10');
      await once.click();
      await expect(panel).toBeHidden();
      const whole = 'select\n  1;\n\nselect\n  *\nfrom\n  t\nwhere\n  id in (\n    100,\n    200,\n    300\n  );\n\nselect\n  2;';
      await expect.poll(read).toEqual({ width, sql: whole });
      await page.keyboard.press(`${modifier}+z`);
      await expect.poll(read).toEqual({ width, sql: source });
    }
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'mariadb', 'sqlite', 'postgresql'] as const) {
  test(`${dialect} 括号内单行宽度只在显式格式化时生效`, async ({}, info) => {
    const source = 'select * from t where id in (100,200,300);';
    const expanded = 'select\n  *\nfrom\n  t\nwhere\n  id in (\n    100,\n    200,\n    300\n  );';
    await seed(dialect, source);
    async function invokeMenu(id: string) {
      await expect.poll(() => desktop.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled, id)).toBe(true);
      await desktop.evaluate(({ Menu, BrowserWindow }, id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id), [window] = BrowserWindow.getAllWindows();
        if (!item?.enabled || !window) throw Error('格式化菜单命令不可用');
        item.click(item, window, {} as Electron.KeyboardEvent);
      }, id);
    }
    const read = () => page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return { width: settings.sqlExpressionWidth, sql: settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n') };
    });
    const panel = page.getByRole('dialog', { name: 'SQL 格式化偏好', exact: true });
    const width = panel.getByRole('spinbutton', { name: '括号内单行宽度', exact: true });
    const save = panel.getByRole('button', { name: '保存格式化偏好', exact: true });
    await invokeMenu('sql-format-preferences');
    await expect(width).toHaveValue('50');
    if (dialect === 'mysql') {
      await width.fill('0');
      await save.click();
      await expect(panel.getByRole('alert')).toContainText('请输入 1 至 200');
      expect(await read()).toEqual({ width: undefined, sql: source });
    }
    await width.fill('10');
    await save.click();
    await expect(panel.getByRole('status')).toHaveText('格式化偏好已保存。');
    expect(await read()).toEqual({ width: 10, sql: source });
    if (dialect === 'sqlite') await panel.screenshot({ path: info.outputPath('sql-expression-width.png') });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    if (dialect === 'postgresql') {
      await quitDesktop();
      await launchDesktop();
      await expect(activeEditor().getByRole('textbox')).toBeVisible();
      expect(await read()).toEqual({ width: 10, sql: source });
    }
    await invokeMenu('format');
    await expect.poll(read).toEqual({ width: 10, sql: expanded });
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(read).toEqual({ width: 10, sql: source });
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'mariadb', 'sqlite', 'postgresql'] as const) {
  test(`${dialect} 压缩 SQL 保留注释与原文边界，可一步撤销`, async ({}, info) => {
    const selected = dialect === 'mysql' || dialect === 'sqlite';
    const prefix = 'SELECT    0;\n', suffix = '\nSELECT     4;';
    const body = "SELECT   (  1 + 2  )  ,   '🚢  -- 文本' ; -- 保留\n    SELECT  3;";
    const compacted = "SELECT (1 + 2), '🚢  -- 文本'; -- 保留\nSELECT 3;";
    const original = prefix + body + suffix, expected = selected ? prefix + compacted + suffix : 'SELECT 0; ' + compacted + ' SELECT 4;';
    await seed(dialect, original);
    function model(select = false) {
      return activeEditor().evaluate((element, select) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const text = editor?.getModel();
        if (!editor || !text) throw Error('当前 SQL 模型不可读');
        if (select) {
          editor.focus();
          editor.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: text.getLineMaxColumn(3) });
        }
        const range = editor.getSelection();
        return { id: text.id, sql: text.getValue().replaceAll('\r\n', '\n'), selected: range ? text.getValueInRange(range).replaceAll('\r\n', '\n') : '' };
      }, select);
    }
    const before = await model(selected);
    expect(before.sql).toBe(original);
    expect(before.selected).toBe(selected ? body : '');
    if (dialect === 'mysql' || dialect === 'postgresql') {
      await nativeQueryCommand('compact-sql', selected);
    } else {
      await (await navigationMenuItem(page.locator('.query-tab:visible'), { name: '压缩 SQL', exact: true })).click();
    }
    await expect.poll(() => model()).toEqual({ id: before.id, sql: expected, selected: selected ? compacted : '' });
    await expect.poll(() => page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n');
    })).toBe(expected);
    if (dialect === 'sqlite') await page.screenshot({ path: info.outputPath('sql-compact-selection.png') });
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(async () => (await model()).sql).toBe(original);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
    await expect.poll(async () => (await model()).sql).toBe(expected);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'mariadb', 'sqlite', 'postgresql'] as const) {
  test(`${dialect} 块注释按原选区往返，保护冲突分隔符且零执行`, async () => {
    const body = dialect === 'postgresql' ? "SELECT '船🚢'; /* 内层 */" : "SELECT '船🚢';";
    const lines = ['SELECT 0;', body, 'SELECT 3;'];
    const unsafe = dialect === 'mysql' ? '/*!50100 SELECT 4 */' : dialect === 'mariadb' ? '/*M! SELECT 4 */' : "SELECT '*/';";
    const sql = [...lines, unsafe].join('\n');
    await seed(dialect, sql);
    function model(edit?: { line: number; end: number }) {
      return activeEditor().evaluate((element, edit) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const original = instance?.getModel();
        if (!instance || !original) throw Error('当前模型不可读');
        if (edit) {
          instance.focus();
          instance.setSelection({ startLineNumber: edit.line, endLineNumber: edit.line, startColumn: 1, endColumn: edit.end });
        }
        const range = instance.getSelection();
        const bounds = instance.getDomNode()!.getBoundingClientRect();
        const point = instance.getScrolledVisiblePosition({ lineNumber: 2, column: 7 });
        if (!point) throw Error('目标选区未显示');
        return { id: original.id, sql: original.getValue().replaceAll('\r\n', '\n'),
          selected: range ? original.getValueInRange(range) : '', x: bounds.x + point.left, y: bounds.y + point.top + point.height / 2 };
      }, edit);
    }
    const initial = await model({ line: 2, end: body.length + 1 });
    await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-toggle-block-comment')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-toggle-block-comment'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('块注释原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    const wrapped = '/* ' + body + ' */', expected = [lines[0], wrapped, lines[2], unsafe].join('\n');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql: expected, selected: wrapped });
    await page.mouse.click(initial.x, initial.y, { button: 'right' });
    await page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: label, exact: true }).click({ delay: 120 });
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql, selected: body });
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql: expected });
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toMatchObject({ id: initial.id, sql });
    await model({ line: 4, end: unsafe.length + 1 });
    await page.keyboard.press('Alt+Shift+a');
    await expect(page.getByText(dialect === 'mysql' || dialect === 'mariadb' ? messages.directive : messages.delimiters, { exact: true })).toBeVisible();
    expect(await model()).toMatchObject({ id: initial.id, sql, selected: unsafe });
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'postgresql'] as const) {
  test(`${dialect} SQL 剪贴板栈选择早期复制、拒绝漂移选区并一步撤销`, async ({}, info) => {
    const lines = ["SELECT '早期🚢';", "SELECT '最近';", 'SELECT 3;'];
    const sql = lines.join('\n');
    await seed(dialect, sql);
    /** 仅向原 Monaco 文本输入派发内存 ClipboardEvent，不访问系统剪贴板。 */
    async function model(command?: { line: number; text?: string; kind?: 'copy' | 'cut' }) {
      return activeEditor().evaluate((element, command) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const original = editor?.getModel();
        if (!editor || !original) throw Error('原模型不可用');
        if (command) {
          if (command.kind) editor.focus();
          editor.setSelection({ startLineNumber: command.line, endLineNumber: command.line, startColumn: 1,
            endColumn: (command.text?.length ?? 0) + 1 });
          if (command.kind) {
            const target = document.activeElement;
            if (!target || !element.contains(target)) throw Error('复制目标不是原编辑器');
            const data = new DataTransfer();
            const event = new ClipboardEvent(command.kind, { bubbles: true, cancelable: true, clipboardData: data });
            target.dispatchEvent(event);
            if (!event.defaultPrevented || data.getData('text/plain') !== command.text) throw Error('Monaco 未写入准确的内存剪贴板');
          }
        }
        return original.getValue().replaceAll('\r\n', '\n');
      }, command);
    }
    const dialog = page.getByRole('dialog', { name: 'SQL 剪贴板栈', exact: true });
    const paste = dialog.getByRole('button', { name: '粘贴所选文本', exact: true });
    await model({ line: 1, text: lines[0], kind: 'copy' });
    await model({ line: 2, text: lines[1], kind: 'cut' });
    await expect.poll(() => model()).toBe([lines[0], '', lines[2]].join('\n'));
    await model({ line: 3, text: lines[2] });
    await activeEditor().getByRole('textbox').focus();
    await page.keyboard.press(modifier + '+Shift+v');
    await expect(dialog.getByRole('combobox')).toHaveValue('0');
    await expect(dialog.locator('pre')).toHaveText(lines[1]);
    await dialog.getByRole('combobox').selectOption('1');
    await expect(dialog.locator('pre')).toHaveText(lines[0]);
    if (dialect === 'mysql') await page.screenshot({ path: info.outputPath('SQL剪贴板栈.png') });
    await model({ line: 1 });
    await paste.click();
    await expect(dialog.getByRole('alert')).toHaveText('原查询编辑器或选区已变化，请重新打开剪贴板栈。');
    await page.keyboard.press('Escape');
    await model({ line: 3, text: lines[2] });
    await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-clipboard-stack')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-clipboard-stack'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('剪贴板栈原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    await dialog.getByRole('combobox').selectOption('1');
    await paste.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => model()).toBe([lines[0], '', lines[0]].join('\n'));
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toBe([lines[0], '', lines[2]].join('\n'));
    await page.keyboard.press(modifier + '+z');
    await expect.poll(() => model()).toBe(sql);
    await page.keyboard.press(modifier + '+Shift+v');
    await dialog.getByRole('button', { name: '清空剪贴板栈', exact: true }).click();
    await page.keyboard.press(modifier + '+Shift+v');
    await expect(dialog.getByText('还没有从查询编辑器复制或剪切的文本。', { exact: true })).toBeVisible();
    await expect(paste).toBeDisabled();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const dialect of ['mysql', 'postgresql'] as const) {
  test(`${dialect} 带引号复制 SQL 保留正文和精确选区，失效时不写剪贴板`, async ({}, info) => {
    const lines = [String.raw`SELECT '船🚢', "字段", '\n';`, 'SELECT 3;'];
    const sql = lines.join('\n');
    await seed(dialect, sql);
    await page.evaluate(() => {
      // 只拦本例明确复制，在内存里模拟浏览器的可写事件，不调用系统剪贴板。
      const copies: string[] = [];
      Object.assign(window, { __quotedSqlCopies: copies });
      const original = document.execCommand.bind(document);
      document.execCommand = (command, ...rest) => {
        if (command !== 'copy') return original(command, ...rest);
        const data = new DataTransfer();
        const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
        document.dispatchEvent(event);
        if (event.defaultPrevented) copies.push(data.getData('text/plain'));
        return event.defaultPrevented;
      };
    });
    function model(range?: 'all' | 'first' | 'move') {
      return activeEditor().evaluate((element, range) => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const original = instance?.getModel();
        if (!instance || !original) throw Error('当前模型不可读');
        if (range) {
          if (range !== 'move') instance.focus();
          instance.setSelection(range === 'all' ? original.getFullModelRange() :
            { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: range === 'first' ? original.getLineMaxColumn(1) : 1 });
        }
        const bounds = instance.getDomNode()!.getBoundingClientRect();
        const point = instance.getScrolledVisiblePosition({ lineNumber: 1, column: 7 });
        if (!point) throw Error('无法定位原选区');
        const selection = instance.getSelection();
        return { sql: original.getValue(), selection: selection ? original.getValueInRange(selection) : '',
          x: bounds.x + point.left, y: bounds.y + point.top + point.height / 2 };
      }, range);
    }
    async function openNative() {
      await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-copy-quoted')?.enabled)).toBe(true);
      await desktop.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('sql-copy-quoted'), windows = BrowserWindow.getAllWindows();
        if (!item?.enabled || windows.length !== 1) throw Error('带引号复制原生命令不可用');
        item.click(item, windows[0], {} as Electron.KeyboardEvent);
      });
    }
    const dialog = page.getByRole('dialog', { name: '带引号复制 SQL', exact: true });
    const confirm = dialog.getByRole('button', { name: '复制字符串', exact: true });
    const copies = () => page.evaluate(() => (window as Window & { __quotedSqlCopies?: string[] }).__quotedSqlCopies);
    const expected = String.raw`'SELECT \'船🚢\', "字段", \'\\n\';\nSELECT 3;'`;
    await model('all');
    await openNative();
    await dialog.getByRole('combobox').selectOption('python');
    await expect(dialog.locator('pre')).toHaveText(expected);
    await model('move');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText('原查询编辑器或选区已变化，请重新选择后复制。');
    expect(await copies()).toEqual([]);
    await page.keyboard.press('Escape');
    const first = await model('first');
    await page.mouse.click(first.x, first.y, { button: 'right' });
    await page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: '带引号复制 SQL', exact: true }).click({ delay: 120 });
    await dialog.getByRole('combobox').selectOption('java');
    await expect(dialog.locator('pre')).toHaveText(JSON.stringify(lines[0]));
    if (dialect === 'mysql') await page.screenshot({ path: info.outputPath('带引号复制SQL.png') });
    await confirm.click();
    await expect(dialog).toBeHidden();
    expect(await copies()).toEqual([JSON.stringify(lines[0])]);
    expect(await model()).toMatchObject({ sql, selection: lines[0] });
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('SQL 编辑器缩放隔离查询标签、保留选区撤销，重启后回到全局字号', async ({}, info) => {
  const sql = "SELECT '长脚本🚢';", other = 'SELECT 42;';
  await seed('mysql', sql, other);
  const zoomIn = 'sql-editor-zoom-in';
  const font = () => activeEditor().locator('.view-lines').evaluate(element => getComputedStyle(element).fontSize);
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const nativeZoom = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  const selectAll = async () => {
    await activeEditor().getByRole('textbox').focus();
    await page.keyboard.press(modifier + '+a');
  };
  function readModel() {
    return activeEditor().evaluate(element => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const model = instance?.getModel(), selection = instance?.getSelection();
      if (!model || !selection) throw Error('当前模型或选区不可读');
      return { id: model.id, sql: model.getValue(), selection: model.getValueInRange(selection) };
    });
  }
  async function invokeMenu(command: string) {
    await expect.poll(() => desktop.evaluate(({ Menu }, command) => Menu.getApplicationMenu()?.getMenuItemById(command)?.enabled, command)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }, command) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(command), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('编辑器缩放原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }, command);
  }
  async function selectTab(title: string) {
    await page.locator('.tab-strip').getByText(title, { exact: true }).click();
    await expect(activeEditor().getByRole('textbox')).toBeVisible();
  }
  await expect.poll(font).toBe('13px');
  const initialWindowZoom = await nativeZoom();
  await activeEditor().getByRole('textbox').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText('X');
  await expect.poll(() => readModel().then(value => value.sql)).toBe(sql + 'X');
  await selectAll();
  const original = await readModel();
  await page.keyboard.press(modifier + '+Alt+Equal');
  await expect.poll(font).toBe('14px');
  await invokeMenu(zoomIn);
  await expect.poll(font).toBe('15px');
  expect(await readModel()).toEqual(original);
  expect(await nativeZoom()).toBe(initialWindowZoom);
  await selectTab('另一个查询');
  await expect.poll(font).toBe('13px');
  await activeEditor().getByRole('textbox').focus();
  await page.keyboard.press(modifier + '+Alt+Minus');
  await expect.poll(font).toBe('12px');
  await selectTab('原查询');
  await expect.poll(font).toBe('15px');
  await expect(activeEditor().locator('.view-lines')).toContainText('长脚本');
  await page.screenshot({ path: info.outputPath('SQL编辑器独立缩放.png') });
  await activeEditor().getByRole('textbox').focus();
  await page.keyboard.press(modifier + '+z');
  await expect.poll(() => readModel().then(value => value.sql)).toBe(sql);
  await page.keyboard.press(modifier + '+Alt+Digit0');
  await expect.poll(font).toBe('13px');
  await selectTab('另一个查询');
  await expect.poll(font).toBe('12px');
  expect(await nativeZoom()).toBe(initialWindowZoom);
  expect((await settings()).editorFontSize).toBe(13);
  await quitDesktop();
  await launchDesktop();
  await expect.poll(font).toBe('13px');
  expect((await settings()).tabs.map(tab => tab.sql)).toEqual([sql, other]);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
