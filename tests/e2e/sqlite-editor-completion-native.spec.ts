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
  { verb: '函数', prefix: 'SELECT ', typed: 'json_ex', column: 'json_extract', trail: ' AS extracted', args: `'{"id":7}', '$.id'`,
    incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: '7' },
  { verb: 'COLLATE', prefix: "SELECT 'Z' AS marker UNION ALL SELECT 'a' ORDER BY marker COLLATE ", typed: 'no', column: 'NOCASE',
    trail: '', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'a' },
  { verb: 'CREATE VIEW', prefix: 'CREATE VIEW completion_view(display_value) AS SELECT s.', typed: 'vir', column: 'virtual_value',
    trail: ' FROM subject s', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: '旧!' },
  { verb: 'CREATE INDEX', prefix: 'CREATE UNIQUE INDEX main.completion_index ON subject(', typed: 'vir', column: 'virtual_value',
    trail: ") WHERE value='旧'", incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'completion_index' },
  { verb: 'RENAME COLUMN', prefix: 'ALTER TABLE main.subject RENAME COLUMN ', typed: 'old', column: 'old_extra',
    trail: ' TO renamed_extra', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: '保留' },
  { verb: 'DROP COLUMN', prefix: 'ALTER TABLE main.subject DROP COLUMN ', typed: 'old', column: 'old_extra',
    trail: '', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'old_extra' },
  { verb: 'STRICT TYPE', prefix: 'ALTER TABLE main.strict_subject ADD COLUMN imported ', typed: 'an', column: 'ANY',
    trail: '', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'ANY' },
  { verb: 'CREATE TYPE', prefix: 'CREATE TABLE completion_typed(amount ', typed: 'DOUBLE  PR', column: 'DOUBLE PRECISION',
    trail: '(10,2) NOT NULL)', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'DOUBLE PRECISION(10,2)' },
  { verb: 'FOREIGN KEY TABLE', prefix: 'CREATE TABLE completion_fk(owner INTEGER REFERENCES ', typed: 'subj', column: 'subject',
    trail: '(id) ON DELETE CASCADE)', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'CASCADE' },
  { verb: 'FOREIGN KEY COLUMN', prefix: 'ALTER TABLE strict_subject ADD COLUMN linked INTEGER REFERENCES subject(', typed: 'i', column: 'id',
    trail: ')', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'NO ACTION' },
  { verb: 'TRIGGER TARGET', prefix: 'CREATE TRIGGER editor_trigger AFTER UPDATE OF value ON main.', typed: 'subj', column: 'subject',
    trail: ' WHEN OLD.value IS NOT NEW.value BEGIN INSERT INTO trigger_log VALUES(OLD.value, NEW.value); END',
    incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'editor_trigger' },
  { verb: 'TRIGGER ROW', prefix: 'CREATE TRIGGER editor_trigger AFTER UPDATE OF value ON main.subject WHEN OLD.value IS NOT NEW.value BEGIN INSERT INTO trigger_log VALUES(OLD.value, NEW.',
    typed: 'va', column: 'value', trail: '); END', incoming: false,
    row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'editor_trigger' },
  { verb: 'TRIGGER ACTION', prefix: 'CREATE TRIGGER editor_trigger AFTER UPDATE OF value ON subject WHEN OLD.value IS NOT NEW.value BEGIN UPDATE trigger_log SET ',
    typed: 'ol', column: 'old_value', trail: ' = OLD.value, new_value = NEW.value; END', incoming: false,
    row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'editor_trigger' },
  { verb: 'DROP INDEX', prefix: 'DROP INDEX IF EXISTS main.', typed: 'subject_', column: 'subject_by_value',
    trail: '', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'subject_by_value' },
  { verb: 'ANALYZE INDEX', prefix: 'ANALYZE main.', typed: 'subject_', column: 'subject_by_value',
    trail: '', incoming: false, row: { id: 1, value: '旧', virtual_value: '旧!' }, output: 'subject_by_value' },
] as const;

async function exercise(scenario: typeof scenarios[number], info: TestInfo) {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
    !['darwin', 'win32'].includes(process.platform)) throw Error('只允许 Windows 或 macOS 的离线源码验收');
  const filePath = join(realpathSync(dataDir), 'sqlite-editor-completion.sqlite');
  const connectionId = 'sqlite-editor-completion';
  const strictType = scenario.verb === 'STRICT TYPE';
  const createType = scenario.verb === 'CREATE TYPE';
  const foreignTable = scenario.verb === 'FOREIGN KEY TABLE', foreignColumn = scenario.verb === 'FOREIGN KEY COLUMN';
  const foreignChild = foreignTable ? 'completion_fk' : foreignColumn ? 'strict_subject' : undefined;
  const foreignField = foreignTable ? 'owner' : 'linked';
  const triggerTarget = scenario.verb === 'TRIGGER TARGET', triggerRow = scenario.verb === 'TRIGGER ROW';
  const triggerAction = scenario.verb === 'TRIGGER ACTION';
  const isTrigger = triggerTarget || triggerRow || triggerAction;
  const dropIndex = scenario.verb === 'DROP INDEX';
  const analyzeIndex = scenario.verb === 'ANALYZE INDEX';
  const targetTable = strictType ? 'strict_subject' : triggerAction ? 'trigger_log' : 'subject';
  const lookupKind = analyzeIndex ? 'maintenance-objects' : dropIndex ? 'drop-objects' : foreignTable || triggerTarget ? 'relations' : strictType ? 'table-options' : scenario.verb === 'INDEXED BY' ? 'indexes' :
    scenario.verb === '函数' ? 'functions' : scenario.verb === 'COLLATE' ? 'collations' : 'columns';
  const alterColumn = scenario.verb === 'RENAME COLUMN' ? 'rename' : scenario.verb === 'DROP COLUMN' ? 'drop' : undefined;
  const { prefix, trail, typed, column } = scenario;
  const draft = prefix + typed + 'suffix' + trail;
  const accepted = prefix + (scenario.verb === '函数' ? column + '(' + scenario.args + ')' :
    strictType || createType ? column : '"' + column + '"') + trail;
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY,value TEXT,virtual_value TEXT GENERATED ALWAYS AS (value||'!'),old_extra TEXT DEFAULT '保留',id_related TEXT);
      CREATE UNIQUE INDEX subject_by_value ON subject(value);
      CREATE VIEW subject_view AS SELECT * FROM subject;
      CREATE TABLE trigger_log(old_value TEXT,new_value TEXT);
      CREATE TABLE strict_subject(id INTEGER PRIMARY KEY) STRICT; INSERT INTO strict_subject VALUES(1);
      CREATE TABLE excluded(other TEXT); CREATE TABLE inbox(id INTEGER PRIMARY KEY,value TEXT); CREATE INDEX inbox_other ON inbox(value);
      INSERT INTO subject(id,value) VALUES(1,'旧'); INSERT INTO excluded VALUES('不变'); INSERT INTO inbox VALUES(1,'新🚢');`);
    if (triggerAction) db.exec("INSERT INTO trigger_log VALUES('基准','未改')");
  } finally { db.close(); }
  const disk = () => {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const view = db.prepare("SELECT sql FROM sqlite_schema WHERE name='completion_view' AND type='view'").get();
      const index = db.prepare("SELECT name,\"unique\",partial FROM pragma_index_list('subject','main') WHERE name='completion_index'").get();
      const indexed = index ? { index, keys: db.prepare("SELECT name FROM pragma_index_info('completion_index','main') ORDER BY seqno").all() } : undefined;
      const extra = alterColumn ? db.prepare("SELECT name FROM pragma_table_xinfo('subject','main') WHERE name IN ('old_extra','renamed_extra')").get()?.name : undefined;
      const altered = alterColumn ? { extra, value: extra === 'renamed_extra' ? db.prepare('SELECT renamed_extra FROM subject').get()?.renamed_extra : undefined } : undefined;
      const addedColumn = strictType ? db.prepare("SELECT name,type FROM pragma_table_xinfo('strict_subject','main') WHERE name='imported'").get() : undefined;
      const declaredColumn = createType ? db.prepare("SELECT name,upper(type) AS type,\"notnull\" FROM pragma_table_xinfo('completion_typed','main')").get() : undefined;
      const foreignKey = foreignChild ? db.prepare('SELECT "table" AS parent, "from" AS child, "to" AS target, on_delete AS onDelete FROM pragma_foreign_key_list(?,?)')
        .get(foreignChild, 'main') : undefined;
      const trigger = isTrigger ? db.prepare("SELECT name,tbl_name AS target FROM sqlite_schema WHERE name='editor_trigger' AND type='trigger'").get() : undefined;
      const triggerLog = isTrigger ? db.prepare('SELECT old_value,new_value FROM trigger_log').all() : undefined;
      const dropIndexRemaining = dropIndex ? !!db.prepare("SELECT name FROM sqlite_schema WHERE name='subject_by_value' AND type='index'").get() : undefined;
      const indexStats = analyzeIndex && db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_stat1'").get() ?
        db.prepare('SELECT tbl,idx,stat FROM sqlite_stat1').all() : undefined;
      return { row: db.prepare('SELECT id,value,virtual_value FROM subject').get(), other: db.prepare('SELECT * FROM excluded').get(),
        inbox: db.prepare('SELECT * FROM inbox').get(), ...(view ? { view: { sql: view.sql, rows: db.prepare('SELECT display_value FROM completion_view').all() } } : {}),
        ...(indexed ? { indexed } : {}), ...(altered ? { altered } : {}), ...(addedColumn ? { addedColumn } : {}),
        ...(declaredColumn ? { declaredColumn } : {}), ...(foreignKey ? { foreignKey } : {}), ...(trigger ? { trigger } : {}),
        ...(triggerLog ? { triggerLog } : {}), ...(dropIndex ? { dropIndexRemaining } : {}), ...(indexStats ? { indexStats } : {}) };
    }
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
          if (command === 'sqlite.completion') {
            if (setup.createType) throw Error('建表声明类型无需访问目录');
            if ('sql' in input) throw Error('目录接收了编辑器原文');
            if (setup.dropIndex && input.kind !== 'stamp' && (input.kind !== 'drop-objects' || input.object !== 'index' ||
              input.schema !== 'main' || (input.exact === undefined ? input.prefix !== setup.typed : input.prefix !== '' || input.exact !== setup.catalogName))) {
              throw Error('DROP 目录越出本例索引');
            }
            if (setup.analyzeIndex && input.kind !== 'stamp' && (input.kind !== 'maintenance-objects' || input.operation !== 'analyze' ||
              input.schema !== 'main' || (input.exact === undefined ? input.prefix !== setup.typed : input.prefix !== '' || input.exact !== setup.catalogName))) {
              throw Error('ANALYZE 目录越出本例索引');
            }
            if (setup.isTrigger && input.kind !== 'stamp') {
              if (setup.triggerAction && input.kind === 'trigger-owner') {
                if (input.triggerTarget !== 'table' || input.table !== 'subject' || input.prefix !== '' || 'schema' in input) throw Error('触发体归属越出实际目标');
              } else if (input.kind !== setup.lookupKind || input.schema !== 'main' ||
                input.prefix !== setup.catalogName && input.prefix !== setup.typed ||
                (setup.triggerTarget ? input.triggerTarget !== 'table' || 'table' in input : input.table !== setup.targetTable)) {
                throw Error('触发器目录越出实际目标');
              }
            }
            if (setup.foreignChild && input.kind !== 'stamp') {
              if (input.kind === 'table-options' && setup.foreignColumn) {
                if (input.table !== setup.foreignChild || input.prefix !== '' || input.schema !== undefined) throw Error('外键子表越出本例');
              } else {
                const key = input.foreignKey;
                const validKey = setup.foreignColumn && input.prefix === setup.typed ?
                  !!key && typeof key === 'object' && 'arity' in key && key.arity === 1 &&
                    'used' in key && Array.isArray(key.used) && key.used.length === 0 : key === true;
                if (input.kind !== setup.lookupKind || !validKey || input.schema !== 'main' ||
                  input.prefix !== setup.catalogName && input.prefix !== setup.typed ||
                  (setup.foreignColumn ? input.table !== 'subject' : 'table' in input)) throw Error('外键父表越出本例');
              }
            }
            if (input.kind === 'functions' || input.kind === 'collations') {
              const indexFunction = setup.createIndex && input.kind === 'functions' && input.deterministicOnly === true && input.prefix === setup.typed;
              if (!indexFunction && (input.kind !== setup.lookupKind || input.prefix !== setup.catalogName && input.prefix !== setup.typed) || 'table' in input || 'schema' in input) throw Error('连接目录越出本例');
            } else if (!setup.foreignChild && !setup.triggerTarget && !setup.dropIndex && !setup.analyzeIndex && input.kind === setup.lookupKind && (input.table !== setup.targetTable || input.schema !== 'main' ||
              setup.createIndex && input.indexTable !== true || input.alterColumn !== setup.alterColumn ||
              input.kind === 'table-options' && input.prefix !== '')) throw Error('目录越出真实目标');
          }
          const fact: Fact = { command, input }; facts.push(fact);
          const reply = await entry(event, payload);
          fact.reply = reply;
          if (command === 'sessions.open' && reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply &&
            reply.result && typeof reply.result === 'object' && 'sessionId' in reply.result && typeof reply.result.sessionId === 'string') sessionId = reply.result.sessionId;
          return reply;
        }
        return entry(event, payload);
      });
    }, { filePath, connectionId, accepted, lookupKind, targetTable, typed, catalogName: column, createType, foreignChild, foreignColumn, triggerTarget, isTrigger, triggerAction, dropIndex, analyzeIndex,
      createIndex: scenario.verb === 'CREATE INDEX', alterColumn });

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
    if (foreignColumn) await expect(widget.locator('.monaco-list-row .label-name').filter({ hasText: /^id_related$/ })).toHaveCount(0);
    if (triggerTarget) await expect(widget.locator('.monaco-list-row .label-name').filter({ hasText: /^subject_view$/ })).toHaveCount(0);
    await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText(column);
    await page.keyboard.press('Enter');
    const inserted = scenario.verb === '函数' ? prefix + column + '()' + trail : accepted;
    await expect.poll(async () => (await inspect()).sql).toBe(inserted);
    const completion = (await snapshot()).slice(previous).filter(fact => fact.command === 'sqlite.completion');
    const requests = completion.map(fact => sqliteCompletionInputSchema.parse(fact.input));
    expect(requests.filter(input => input.kind !== 'stamp')).toEqual(createType ? [] : [
      ...(foreignColumn ? [expect.objectContaining({ kind: 'table-options', table: foreignChild, prefix: '' })] : []),
      ...(triggerAction ? [expect.objectContaining({ kind: 'trigger-owner', triggerTarget: 'table', table: 'subject', prefix: '' })] : []),
      dropIndex ? expect.objectContaining({ kind: 'drop-objects', object: 'index', schema: 'main', prefix: typed }) :
        analyzeIndex ? expect.objectContaining({ kind: 'maintenance-objects', operation: 'analyze', schema: 'main', prefix: typed }) :
        triggerTarget ? expect.objectContaining({ kind: 'relations', schema: 'main', triggerTarget: 'table', prefix: typed }) :
        foreignTable ? expect.objectContaining({ kind: 'relations', schema: 'main', foreignKey: true, prefix: typed }) :
        lookupKind === 'functions' || lookupKind === 'collations' ? expect.objectContaining({ kind: lookupKind, prefix: typed }) :
        expect.objectContaining({ kind: lookupKind, table: targetTable, schema: 'main', prefix: strictType ? '' : typed,
          ...(scenario.verb === 'CREATE INDEX' ? { indexTable: true } : {}), ...(alterColumn ? { alterColumn } : {}),
          ...(foreignColumn ? { foreignKey: { arity: 1, used: [] } } : {}) }),
      ...(scenario.verb === 'CREATE INDEX' ? [expect.objectContaining({ kind: 'functions', prefix: typed, deterministicOnly: true })] : []),
    ]);
    expect(completion.every(fact => fact.reply && typeof fact.reply === 'object' && 'ok' in fact.reply && fact.reply.ok === true)).toBe(true);
    if (scenario.verb === '函数') {
      expect((await inspect()).offset).toBe(prefix.length + column.length + 1);
      await page.keyboard.insertText(scenario.args);
      await expect.poll(async () => (await inspect()).sql).toBe(accepted);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
      for (const _point of prefix + column.slice(0, 2)) await page.keyboard.press('ArrowRight');
      expect((await inspect()).offset).toBe(prefix.length + 2);
    } else await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(modifier + '+K');
    await page.keyboard.press(modifier + '+I');
    const hover = query.locator('.monaco-hover:visible');
    if (scenario.incoming) await expect(hover).toContainText('UPSERT 待插入行');
    if (lookupKind === 'indexes') await expect(hover).toContainText('SQLite 索引');
    if (lookupKind === 'functions') await expect(hover).toContainText('SQLite 标量函数');
    else if (lookupKind === 'collations') await expect(hover).toContainText('忽略 ASCII 字母的大小写');
    else if (strictType) await expect(hover).toContainText('SQLite STRICT 类型');
    else if (createType) await expect(hover).toContainText('REAL 亲和性');
    else if (foreignTable) await expect(hover).toContainText('SQLite 外键父表');
    else if (foreignColumn) await expect(hover).toContainText('"main"."subject"."id"');
    else if (triggerTarget) await expect(hover).toContainText('SQLite 触发目标表');
    else if (triggerRow) await expect(hover).toContainText('SQLite 触发器 NEW 行');
    else if (triggerAction) await expect(hover).toContainText('"main"."trigger_log"');
    else if (dropIndex) await expect(hover).toContainText('"main"."subject_by_value"');
    else if (analyzeIndex) {
      await expect(hover).toContainText('"main"."subject_by_value"');
      await expect(hover).toContainText('收集单个索引的查询规划统计');
    }
    else await expect(hover).toContainText('"main"."subject"');
    await page.keyboard.press('Escape');
    expect((await snapshot()).filter(fact => fact.command === 'query.execute' || fact.command === 'sessions.open')).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(disk()).toEqual(before);
    await (await navigationMenuItem(query, { name: zh.query.text011, exact: true })).click();
    const created = scenario.verb === 'CREATE VIEW' ? { view: { sql: accepted, rows: [{ display_value: scenario.output }] } } :
      scenario.verb === 'CREATE INDEX' ? { indexed: { index: { name: scenario.output, unique: 1, partial: 1 }, keys: [{ name: column }] } } : {};
    const altered = alterColumn === 'rename' ? { altered: { extra: 'renamed_extra', value: scenario.output } } :
      alterColumn === 'drop' ? { altered: { extra: undefined, value: undefined } } : {};
    const addedColumn = strictType ? { addedColumn: { name: 'imported', type: scenario.output } } : {};
    const declaredColumn = createType ? { declaredColumn: { name: 'amount', type: scenario.output, notnull: 1 } } : {};
    const foreignKey = foreignChild ? { foreignKey: { parent: 'subject', child: foreignField, target: 'id', onDelete: scenario.output } } : {};
    const trigger = isTrigger ? { trigger: { name: scenario.output, target: 'subject' } } : {};
    await expect.poll(disk).toEqual({ ...before, row: scenario.row, ...created, ...altered, ...addedColumn, ...declaredColumn, ...foreignKey, ...trigger,
      ...(dropIndex ? { dropIndexRemaining: false } : {}),
      ...(analyzeIndex ? { indexStats: [{ tbl: 'subject', idx: column, stat: '1 1' }] } : {}) });
    if (foreignChild) {
      const integrity = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
      try {
        integrity.exec('BEGIN');
        const insert = integrity.prepare(foreignTable ? 'INSERT INTO completion_fk(owner) VALUES(?)' : 'INSERT INTO strict_subject(linked) VALUES(?)');
        expect(() => insert.run(999)).toThrow('FOREIGN KEY constraint failed');
        expect(insert.run(1).changes).toBe(1);
        integrity.exec('ROLLBACK');
      } finally { integrity.close(); }
    }
    if (isTrigger) {
      const integrity = new DatabaseSync(filePath);
      try {
        integrity.exec('BEGIN; UPDATE subject SET id=id; UPDATE subject SET value=value;');
        expect(integrity.prepare('SELECT old_value,new_value FROM trigger_log').all()).toEqual(before.triggerLog);
        integrity.prepare('UPDATE subject SET value=? WHERE id=1').run('新🚢');
        expect(integrity.prepare('SELECT old_value,new_value FROM trigger_log').all()).toEqual([{ old_value: '旧', new_value: '新🚢' }]);
        integrity.exec('ROLLBACK');
      } finally { integrity.close(); }
    }
    const grid = query.locator('.result-body').getByRole('grid');
    if (scenario.verb !== 'CREATE VIEW' && scenario.verb !== 'CREATE INDEX' && !alterColumn && !strictType && !createType && !foreignChild &&
      !isTrigger && !dropIndex && !analyzeIndex) await expect(grid).toContainText(scenario.output);
    if (lookupKind === 'collations') {
      await expect(grid.getByRole('row').nth(1).getByText('a', { exact: true })).toBeVisible();
      await expect(grid.getByRole('row').nth(2).getByText('Z', { exact: true })).toBeVisible();
    }
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
    const enabled = scenario.verb === 'DROP INDEX' ? process.env.DBARK_SQLITE_DROP_COMPLETION_NATIVE === '1' :
      scenario.verb === 'ANALYZE INDEX' ? process.env.DBARK_SQLITE_MAINTENANCE_COMPLETION_NATIVE === '1' :
      scenario.verb.startsWith('TRIGGER ') ? process.env.DBARK_SQLITE_TRIGGER_COMPLETION_NATIVE === '1' :
      scenario.verb === 'FOREIGN KEY TABLE' || scenario.verb === 'FOREIGN KEY COLUMN' ? process.env.DBARK_SQLITE_FOREIGN_KEY_COMPLETION_NATIVE === '1' :
      scenario.verb === 'STRICT TYPE' || scenario.verb === 'CREATE TYPE' ? process.env.DBARK_SQLITE_COLUMN_TYPE_COMPLETION_NATIVE === '1' :
      scenario.verb === 'RENAME COLUMN' || scenario.verb === 'DROP COLUMN' ? process.env.DBARK_SQLITE_ALTER_TABLE_COMPLETION_NATIVE === '1' :
      scenario.verb === 'CREATE INDEX' ? process.env.DBARK_SQLITE_CREATE_INDEX_COMPLETION_NATIVE === '1' :
      scenario.verb === 'CREATE VIEW' ? process.env.DBARK_SQLITE_CREATE_QUERY_COMPLETION_NATIVE === '1' :
      scenario.verb === 'COLLATE' ? process.env.DBARK_SQLITE_COLLATION_COMPLETION_NATIVE === '1' :
      scenario.verb === '函数' ? process.env.DBARK_SQLITE_FUNCTION_COMPLETION_NATIVE === '1' : scenario.verb === 'INDEXED BY' ? process.env.DBARK_SQLITE_INDEX_COMPLETION_NATIVE === '1' :
      process.env.DBARK_SQLITE_DML_COMPLETION_NATIVE === '1' || scenario.verb === 'UPSERT' && process.env.DBARK_SQLITE_UPSERT_COMPLETION_NATIVE === '1';
    test.skip(!enabled || process.argv.includes('--list'), '需要显式启用离线 SQLite 编辑器专项');
    test(`SQLite ${scenario.verb} 补全、悬停和明确提交`, ({}, info) => exercise(scenario, info));
  });
}
