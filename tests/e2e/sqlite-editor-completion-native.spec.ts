import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteCompletionInputSchema } from '../../src/shared/sqliteCompletion';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
const scenarios = [
  { verb: 'UPSERT', prefix: "INSERT INTO main.subject AS t(id,value) VALUES(1,'新🚢')\nON CONFLICT(id) DO UPDATE SET value=concat(t.value,excluded.",
    typed: 'va', column: 'value', trail: ") WHERE excluded.value<>'skip' RETURNING subject.value,subject.virtual_value", incoming: true,
    row: { id: 1, value: '旧新🚢', virtual_value: '旧新🚢!' }, output: '旧新🚢!' },
  { verb: 'UPDATE FROM', prefix: 'UPDATE main.subject AS t SET (id,value)=(src.id,src.value)\nFROM inbox src WHERE t.id=src.id RETURNING subject.',
    typed: 'vir', column: 'virtual_value', trail: '', incoming: false,
    row: { id: 1, value: '新🚢', virtual_value: '新🚢!' }, output: '新🚢!' },
  { verb: 'DELETE RETURNING', prefix: 'DELETE FROM main.subject AS t WHERE t.id=1 RETURNING subject.',
    typed: 'vir', column: 'virtual_value', trail: '', incoming: false, row: undefined, output: '旧!' },
  { verb: 'INDEXED BY', prefix: 'EXPLAIN QUERY PLAN SELECT id FROM main.subject INDEXED BY ', typed: 'subject_', column: 'subject_by_value',
    trail: " WHERE value='旧'", incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'subject_by_value' },
] as const;

async function exercise(scenario: typeof scenarios[number], info: TestInfo) {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
    !['darwin', 'win32'].includes(process.platform)) throw Error('只允许 Windows 或 macOS 的离线源码验收');
  const filePath = join(realpathSync(dataDir), 'sqlite-editor-completion.sqlite');
  const connectionId = 'sqlite-editor-completion';
  const lookupKind = scenario.verb === 'INDEXED BY' ? 'indexes' : 'columns';
  const { prefix, trail, typed, column } = scenario;
  const draft = prefix + typed + 'suffix' + trail, accepted = prefix + '"' + column + '"' + trail;
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY,value TEXT,virtual_value TEXT GENERATED ALWAYS AS (value||'!'));
      CREATE UNIQUE INDEX subject_by_value ON subject(value);
      CREATE TABLE excluded(other TEXT); CREATE TABLE inbox(id INTEGER PRIMARY KEY,value TEXT); CREATE INDEX inbox_other ON inbox(value);
      INSERT INTO subject(id,value) VALUES(1,'旧'); INSERT INTO excluded VALUES('不变'); INSERT INTO inbox VALUES(1,'新🚢');`);
  } finally { db.close(); }
  const disk = () => {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try { return { row: db.prepare('SELECT id,value,virtual_value FROM subject').get(),
      other: db.prepare('SELECT * FROM excluded').get(), inbox: db.prepare('SELECT * FROM inbox').get() }; }
    finally { db.close(); }
  };
  interface Fact { command: string; input: Record<string, unknown>; reply?: unknown; }
  const snapshot = () => desktop.evaluate(() => (globalThis as typeof globalThis & { __dmlCompletionFacts?: Fact[] }).__dmlCompletionFacts ?? []);
  try {
    await desktop.evaluate(({ BrowserWindow, dialog, ipcMain }, setup) => {
      const window = BrowserWindow.getAllWindows()[0], originalChooser = dialog.showOpenDialog;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>> })._invokeHandlers;
      const entry = handlers?.get('dbark:request');
      if (!window || !entry) throw Error('原 SQLite 入口不可用');
      const facts: Fact[] = [];
      let sessionId: string | undefined;
      (globalThis as typeof globalThis & { __dmlCompletionFacts?: Fact[] }).__dmlCompletionFacts = facts;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = originalChooser;
        if (args[0] !== window || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite')) throw Error('本例只授权合成库');
        return { canceled: false, filePaths: [setup.filePath] };
      }) as typeof originalChooser;
      handlers.set('dbark:request', async (event, payload) => {
        const { command, input } = payload as { command: string; input: Record<string, unknown> };
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || /clipboard/i.test(command)) throw Error('非本例查询文档');
        if (['query.execute', 'sessions.open', 'sessions.close', 'sqlite.completion'].includes(command)) {
          if ((command === 'sessions.open' || command === 'sqlite.completion') && input.connectionId !== setup.connectionId) throw Error('连接越出合成库');
          if ((command === 'query.execute' || command === 'sessions.close') && (!sessionId || input.sessionId !== sessionId)) throw Error('不是本例原查询会话');
          if (command === 'query.execute' && (typeof input.sql !== 'string' || input.sql.replaceAll('\r\n', '\n') !== setup.accepted ||
            facts.some(fact => fact.command === 'query.execute'))) throw Error('SQL 不是本例唯一明确操作');
          if (command === 'sqlite.completion' && (input.kind === setup.lookupKind && (input.table !== 'subject' || input.schema !== 'main') || 'sql' in input)) throw Error('目录越出真实目标');
          const fact: Fact = { command, input }; facts.push(fact);
          const reply = await entry(event, payload);
          fact.reply = reply;
          if (command === 'sessions.open' && reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply &&
            reply.result && typeof reply.result === 'object' && 'sessionId' in reply.result && typeof reply.result.sessionId === 'string') sessionId = reply.result.sessionId;
          return reply;
        }
        return entry(event, payload);
      });
    }, { filePath, connectionId, accepted, lookupKind });

    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.evaluate(async ({ id, sql }) => {
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('合成库授权失败');
      const profile = await window.dbark.invoke('connections.save', { id, name: 'SQLite 写入编辑器验收', dialect: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: file.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'sqlite-dml', tabs: [
        { id: 'sqlite-dml', title: 'SQLite 写入验收', kind: 'query', connectionId: profile.id, database: 'main', sql },
      ] });
    }, { id: connectionId, sql: draft });
    await page.reload();
    const query = page.locator('.query-tab:visible'), editor = query.locator('.monaco-editor'), textbox = editor.getByRole('textbox');
    await expect(textbox).toBeVisible();
    const inspect = () => editor.evaluate(element => {
      const monaco = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = monaco?.editor.getEditors().find(editor => editor.getContainerDomNode().contains(element));
      const model = instance?.getModel(), position = instance?.getPosition();
      if (!model || !position) throw Error('原查询编辑器模型缺失');
      return { sql: model.getValue().replaceAll('\r\n', '\n'), offset: model.getOffsetAt(position), eol: model.getEOL() };
    });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await textbox.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    for (const _point of prefix + typed) await page.keyboard.press('ArrowRight');
    const original = await inspect();
    expect(original.sql).toBe(draft);
    expect(original.offset).toBe((prefix + typed).replaceAll('\n', original.eol).length);
    const before = disk(), previous = (await snapshot()).length;
    await page.keyboard.press('Control+Space');
    const widget = query.locator('.suggest-widget:visible');
    await expect(widget.locator('.monaco-list-row .label-name').filter({ hasText: new RegExp('^' + column + '$') })).toHaveCount(1);
    await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText(column);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await inspect()).sql).toBe(accepted);
    const completion = (await snapshot()).slice(previous).filter(fact => fact.command === 'sqlite.completion');
    const requests = completion.map(fact => sqliteCompletionInputSchema.parse(fact.input));
    expect(requests.filter(input => input.kind !== 'stamp')).toEqual([
      expect.objectContaining({ kind: lookupKind, table: 'subject', schema: 'main', prefix: typed }),
    ]);
    expect(completion.every(fact => fact.reply && typeof fact.reply === 'object' && 'ok' in fact.reply && fact.reply.ok === true)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(modifier + '+K');
    await page.keyboard.press(modifier + '+I');
    const hover = query.locator('.monaco-hover:visible');
    if (scenario.incoming) await expect(hover).toContainText('UPSERT 待插入行');
    if (lookupKind === 'indexes') await expect(hover).toContainText('SQLite 索引');
    await expect(hover).toContainText('"main"."subject"');
    await page.keyboard.press('Escape');
    expect((await snapshot()).filter(fact => fact.command === 'query.execute' || fact.command === 'sessions.open')).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(disk()).toEqual(before);
    await (await navigationMenuItem(query, { name: zh.query.text011, exact: true })).click();
    await expect.poll(disk).toEqual({ ...before, row: scenario.row });
    await expect(query.locator('.result-body').getByRole('grid')).toContainText(scenario.output);
    const facts = await snapshot();
    const executions = facts.filter(fact => fact.command === 'query.execute');
    expect(executions).toEqual([expect.objectContaining({ reply: expect.objectContaining({ ok: true }) })]);
    expect(String(executions[0].input.sql).replaceAll('\r\n', '\n')).toBe(accepted);
    expect(facts.filter(fact => fact.command === 'sessions.open')).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    await info.attach('SQLite 编辑器真实验收', { body: JSON.stringify({ verb: scenario.verb, platform: process.platform, before, after: disk(), facts }), contentType: 'application/json' });
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
}

for (const scenario of scenarios) {
  test.describe(scenario.verb, () => {
    const enabled = scenario.verb === 'INDEXED BY' ? process.env.DBARK_SQLITE_INDEX_COMPLETION_NATIVE === '1' :
      process.env.DBARK_SQLITE_DML_COMPLETION_NATIVE === '1' || scenario.verb === 'UPSERT' && process.env.DBARK_SQLITE_UPSERT_COMPLETION_NATIVE === '1';
    test.skip(!enabled || process.argv.includes('--list'), '需要显式启用离线 SQLite 编辑器专项');
    test(`SQLite ${scenario.verb} 补全、悬停和明确提交`, ({}, info) => exercise(scenario, info));
  });
}
