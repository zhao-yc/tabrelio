import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_MYSQL_EDITOR_HIGHLIGHTING_NATIVE !== '1', '需要本轮回环隔离网络库');

test('MySQL 与 MariaDB 按当前会话模式着色，切换模式保留模型与目录补全', async ({}, info) => {
  const dialect = process.env.DBARK_CHECKED_RECORD_EDIT_DIALECT;
  const database = process.env.DBARK_CHECKED_RECORD_EDIT_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_RECORD_EDIT_USER;
  const password = process.env.DBARK_CHECKED_RECORD_EDIT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_CHECKED_RECORD_EDIT_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(database) ||
      user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      (dialect !== 'mysql' && dialect !== 'mariadb')) throw Error('需要本轮独占回环库');
  const source = [
    'SeLeCt "双引号--文字", `反引号``标识`, \'A\\nB\', X\'00ff\', B\'10\', @@SESSION.sql_mode, :编号, 1--2; # 井号注释',
    '-- 行注释',
    'DELIMITER //',
    '/*!40101 版本注释 */',
    '/*M!100100 MariaDB 注释 */',
    '/*+ hint */ SELECT 2;',
    '/*m!100100 小写普通注释 */',
  ].join('\n');
  const modes = [
    { sql: '', ansi: false, literal: false, suffix: '' },
    { sql: 'ANSI_QUOTES', ansi: true, literal: false, suffix: '-ansi' },
    { sql: 'NO_BACKSLASH_ESCAPES', ansi: false, literal: true, suffix: '-literal' },
    { sql: 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES', ansi: true, literal: true, suffix: '-ansi-literal' },
  ];
  try {
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    const input: NetworkConnectionProfile = { id: '', name: dialect + ' 着色', dialect, group: '',
      color: '#123456', host: '127.0.0.1', port, database, user, password, rememberPassword: false };
    await page.evaluate(async input => {
      const profile = await window.dbark.invoke('connections.save', input);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'mode-editor', tabs: [
        { id: 'mode-editor', title: '会话着色', kind: 'query', connectionId: profile.id, database: input.database, sql: '' },
        { id: 'offline-editor', title: '独立草稿', kind: 'query', connectionId: profile.id, database: input.database, sql: 'SELECT 42;' },
      ] });
    }, input);
    await page.reload();
    const query = page.locator('.query-tab:visible'), editor = query.locator('.monaco-editor');
    const box = editor.getByRole('textbox');
    await expect(box).toBeVisible();
    // 只读取真实模型、词法结果与界面颜色，输入和执行仍走原键盘及工具栏。
    const inspect = () => editor.evaluate(element => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(editor => editor.getContainerDomNode().contains(element));
      const model = instance?.getModel();
      if (!api || !model) throw Error('缺少原查询模型');
      const sql = model.getValue(), language = model.getLanguageId();
      const lines = model.getLinesContent(), tokens = api.editor.tokenize(sql, language);
      const at = (line: number, text: string) => {
        const offset = lines[line]?.indexOf(text) ?? -1;
        return offset < 0 ? undefined : tokens[line]?.filter(token => token.offset <= offset).at(-1)?.type;
      };
      const color = (text: string) => {
        const spans = element.querySelectorAll('.view-lines .view-line > span > span');
        const span = [...spans].find(span => span.textContent?.includes(text));
        return span ? getComputedStyle(span).color : '';
      };
      return { sql, language, id: model.id,
        scopes: [at(0, 'SeLeCt'), at(0, '双引号'), at(0, '反引号'), at(0, '\\n'), at(0, "X'00ff'"), at(0, "B'10'"),
          at(0, '@@SESSION'), at(0, ':编号'), at(0, '--2'), at(0, '井号注释'),
          at(1, '行注释'), at(2, 'DELIMITER'), at(3, '版本注释'), at(4, 'MariaDB'), at(5, 'hint'), at(6, '小写普通注释')],
        colors: [color('SeLeCt'), color('反引号'), color('井号注释'), color('双引号')],
      };
    });
    const edit = async (sql: string) => {
      await box.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(sql);
      await expect.poll(async () => (await inspect()).sql).toBe(sql);
    };
    const open = (id: string, title: string) => page.locator('[data-workspace-tab-id="' + id + '"]').getByRole('button', { name: title, exact: true }).click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const identity = (await inspect()).id;
    const expectedSql = [];
    for (const mode of modes) {
      const set = "SET SESSION sql_mode = '" + mode.sql + "'";
      expectedSql.push(set);
      await edit(set);
      await query.locator('.query-execute-split button.primary').click();
      await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === set)).toBe(true);
      await expect.poll(async () => (await inspect()).language).toBe('dbark-' + dialect + mode.suffix);
      await edit(source);
      const scopes = ['keyword', mode.ansi ? 'identifier' : 'string', 'identifier', mode.literal ? 'string' : 'string.escape',
        'string.binary', 'string.binary', 'variable', 'variable', 'operator', 'comment', 'comment', 'keyword.directive',
        'comment.conditional', dialect === 'mariadb' ? 'comment.conditional' : 'comment', 'comment.hint', 'comment'];
      await expect.poll(async () => (await inspect()).scopes).toEqual(scopes.map(scope => scope + '.sql'));
      expect((await inspect()).id).toBe(identity);
      if (mode.ansi && mode.literal) {
        await expect.poll(async () => {
          const [keyword, identifier, comment, double] = (await inspect()).colors;
          return !!keyword && !!identifier && !!comment && double === identifier && new Set([keyword, identifier, comment]).size === 3;
        }).toBe(true);
        await page.screenshot({ path: info.outputPath(dialect + '方言着色.png') });
        await open('offline-editor', '独立草稿');
        await expect.poll(async () => (await inspect()).language).toBe('dbark-' + dialect);
        await open('mode-editor', '会话着色');
        await expect.poll(async () => (await inspect()).language).toBe('dbark-' + dialect + mode.suffix);
        expect(await inspect()).toMatchObject({ id: identity, sql: source });
      }
    }
    await edit('SELECT * FROM key_ro');
    await page.keyboard.press('Control+Space');
    await expect(query.locator('.suggest-widget.visible .monaco-list-row.focused')).toContainText('key_rows');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await inspect()).sql).toContain('key_rows');
    const entries = await history();
    expect(entries.map(entry => entry.sql).sort()).toEqual(expectedSql.sort());
    expect(entries.every(entry => entry.success)).toBe(true);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
