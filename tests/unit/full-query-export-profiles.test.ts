import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import { txtExportDefaults } from '../../src/shared/txtExport';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => '', decrypt: (value: string) => value };
const csv = { name: '日报', options: { format: 'csv', encoding: 'gb18030', delimiter: '\t' } };
const insert = { name: '日报', options: { format: 'sql', target: { schema: '报表', table: '数据', columns: ['编号', '附注'] } } };
const sqlite = { dialect: 'sqlite' };
const postgres = { dialect: 'postgresql' };
let folder: string, file: string, store: LocalStore;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dbark-query-export-profiles-'));
  file = join(folder, 'local.sqlite');
  store = await LocalStore.open(file, wasm, protector);
});
afterEach(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });

describe('完整查询导出方案', () => {
  it('旧配置直接读空，按数据库类型独立保存，关闭重开可恢复', async () => {
    const before = readFileSync(file);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual([]);
    expect(readFileSync(file)).toEqual(before);
    const sqliteList = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const postgresList = store.mutateFullQueryExportProfiles({ ...postgres, kind: 'add', profile: insert });
    expect(sqliteList).toMatchObject([csv]); expect(postgresList).toMatchObject([insert]);
    const recordProfile = { name: 'XML 记录', options: { format: 'xml-attributes' } };
    const sqliteWithXml = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: recordProfile });
    expect(sqliteWithXml).toMatchObject([csv, recordProfile]);
    store.saveSettings({ ...store.settings(), theme: 'light' });
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual(sqliteWithXml);
    expect(store.fullQueryExportProfiles(postgres)).toEqual(postgresList);
    expect(store.settings().theme).toBe('light');
    expect(store.history()).toEqual([]); expect(store.tasks()).toEqual([]);
  });

  it('允许修改和改名，拒绝重名及过期操作，删除后重建同名仍隔离版本', () => {
    const add = { ...sqlite, kind: 'add', profile: csv };
    const [{ name, revision }] = store.mutateFullQueryExportProfiles(add);
    const first = { name, revision };
    expect(() => store.mutateFullQueryExportProfiles({ ...add, profile: { ...csv, name: ' 日报 ' } })).toThrow('同名');
    const renamed = { name: '月报', options: { format: 'xlsx' } };
    const [updated] = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'update', selected: first, profile: renamed });
    expect(updated).toMatchObject(renamed);
    expect(updated.revision).not.toBe(first.revision);
    const target = { name: updated.name, revision: updated.revision };
    const remove = { ...sqlite, kind: 'delete', selected: target };
    expect(store.mutateFullQueryExportProfiles(remove)).toEqual([]);
    const recreated = store.mutateFullQueryExportProfiles({ ...add, profile: renamed });
    expect(() => store.mutateFullQueryExportProfiles(remove)).toThrow('已变化');
    expect(store.fullQueryExportProfiles(sqlite)).toEqual(recreated);
  });

  it('IPC 和直接存储均拒绝运行数据、错误方言和格式额外字段', () => {
    const before = readFileSync(file);
    for (const profile of [
      { ...csv, sql: 'SELECT :secret' }, { ...csv, fileToken: '临时授权' },
      { ...csv, parameters: [{ name: 'secret', value: '参数原值' }] },
      { ...csv, options: { format: 'xlsx', delimiter: '\t' } }, insert,
    ]) {
      const request = { ...sqlite, kind: 'add', profile };
      expect(() => validateCommand('queryExportProfiles.mutate', request)).toThrow();
      expect(() => store.mutateFullQueryExportProfiles(request)).toThrow();
    }
    expect(() => validateCommand('queryExportProfiles.list', { ...sqlite, connectionId: '不需要的连接' })).toThrow();
    expect(readFileSync(file)).toEqual(before);
  });

  it('写盘失败时保留原方案和文件，可按原版本重试', () => {
    const [{ name, revision }] = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const before = readFileSync(file);
    const update = { ...sqlite, kind: 'update', selected: { name, revision }, profile: { name, options: { format: 'xlsx' } } };
    mkdirSync(file + '.tmp');
    expect(() => store.mutateFullQueryExportProfiles(update)).toThrow('修改未保存');
    expect(readFileSync(file)).toEqual(before);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual([{ ...csv, revision }]);
    rmdirSync(file + '.tmp');
    expect(store.mutateFullQueryExportProfiles(update)).toMatchObject([update.profile]);
  });

  it('按 MySQL 和 MariaDB 独立存储完整流式导出方案，原方案重开仍可读', async () => {
    const old = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const mysql = { dialect: 'mysql' }, mariadb = { dialect: 'mariadb' };
    const streamCsv = { name: '日报', options: { format: 'stream', settings: { ...csv.options, ordinal: 2 } } };
    const streamInsert = { name: '日报', options: { format: 'stream', settings: {
      format: 'sql', encoding: 'utf16le', target: { database: '备份库', table: '日报', columns: ['id', '附注'] },
    } } };
    expect(store.mutateFullQueryExportProfiles({ ...mysql, kind: 'add', profile: streamCsv })).toMatchObject([streamCsv]);
    expect(store.mutateFullQueryExportProfiles({ ...mariadb, kind: 'add', profile: streamInsert })).toMatchObject([streamInsert]);
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.fullQueryExportProfiles(mysql)).toMatchObject([streamCsv]);
    expect(store.fullQueryExportProfiles(mariadb)).toMatchObject([streamInsert]);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual(old);
  });

  it('只接受与流式格式相符的设置，禁止将运行数据或安全确认放入方案', () => {
    const before = readFileSync(file);
    const add = (settings: unknown, dialect = 'mysql') => ({
      dialect, kind: 'add', profile: { name: '日报', options: { format: 'stream', settings } },
    });
    const record = { format: 'xml-attributes', ordinal: 200 };
    const text = { format: 'txt', encoding: 'utf16le', txtOptions: txtExportDefaults, ordinal: 1 };
    const zip = { format: 'csv-zip', encoding: 'gb18030', delimiter: ';' };
    for (const request of [
      add({ ...record, ordinal: 201 }), add({ format: 'csv', encoding: 'utf8', delimiter: ';' }),
      add({ ...zip, ordinal: 2 }), add({ ...record, encoding: 'gb18030' }),
      add({ ...text, parameters: [] }), add({ ...text, sql: 'SELECT 1' }), add({ ...text, fileToken: '旧文件' }),
      add({ ...text, acknowledged: true }), add({ ...text, protocol: 'binary-explicit' }), add(record, 'postgresql'),
      { dialect: 'mariadb', kind: 'add', profile: csv },
    ]) {
      expect(() => validateCommand('queryExportProfiles.mutate', request)).toThrow();
      expect(() => store.mutateFullQueryExportProfiles(request)).toThrow();
    }
    expect(readFileSync(file)).toEqual(before);
    for (const settings of [record, text, zip, { format: 'xlsx' }, { format: 'html' }, { format: 'xml' }])
      expect(() => validateCommand('queryExportProfiles.mutate', add(settings))).not.toThrow();
  });

  it('表页方案按方言独立持久化，并与已有查询方案使用独立的版本和命名空间', async () => {
    const table = { ...sqlite, area: 'table' };
    const projection = { name: csv.name, options: { format: 'table', settings: {
      format: 'csv', encoding: 'utf16le', delimiter: ';', columns: ['payload', '原值'],
    } } };
    const [query] = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const [stored] = store.mutateFullQueryExportProfiles({ ...table, kind: 'add', profile: projection });
    for (const dialect of ['mysql', 'mariadb', 'postgresql']) {
      const scope = { dialect, area: 'table' };
      expect(store.fullQueryExportProfiles(scope)).toEqual([]);
      store.mutateFullQueryExportProfiles({ ...scope, kind: 'add', profile: projection });
    }
    expect(() => store.mutateFullQueryExportProfiles({ ...table, kind: 'delete', selected: { name: query.name, revision: query.revision } })).toThrow('已变化');
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual([query]);
    expect(store.fullQueryExportProfiles(table)).toEqual([stored]);
    expect(stored).toMatchObject(projection);
    expect(store.fullQueryExportProfiles({ ...postgres, area: 'table' })).toMatchObject([projection]);
  });

  it('表页方案拒绝跨入口、无效方言选项、重复列及来自源对象的运行数据', () => {
    const before = readFileSync(file);
    const csvFields = { format: 'csv', encoding: 'utf8', delimiter: ';', columns: ['note', 'ID'] };
    const copy = { ...csvFields, format: 'copy' };
    const structure = { format: 'sql', sqlContent: 'structure', encoding: 'utf8', columns: [] };
    const backup = { format: 'sql-backup', encoding: 'utf8', columns: [] };
    const add = (settings: unknown, scope: object = { dialect: 'mysql', area: 'table' }) => ({
      ...scope, kind: 'add', profile: { name: '字段', options: { format: 'table', settings } },
    });
    for (const request of [
      add(csvFields, sqlite), { ...sqlite, area: 'table', kind: 'add', profile: csv },
      add(copy), add(backup), add(structure, { ...postgres, area: 'table' }), add({ ...structure, columns: ['note'] }, { ...sqlite, area: 'table' }),
      add({ ...csvFields, columns: ['note', 'note'] }), add({ ...csvFields, columns: [] }),
      ...['filters', 'sort', 'source', 'fileToken', 'sql', 'connectionId', 'table'].map(field => add({ ...csvFields, [field]: '不保存' })),
    ]) {
      expect(() => validateCommand('queryExportProfiles.mutate', request)).toThrow();
      expect(() => store.mutateFullQueryExportProfiles(request)).toThrow();
    }
    expect(readFileSync(file)).toEqual(before);
    expect(() => validateCommand('queryExportProfiles.mutate', add(copy, { ...postgres, area: 'table' }))).not.toThrow();
    expect(() => validateCommand('queryExportProfiles.mutate', add(backup, { ...postgres, area: 'table' }))).not.toThrow();
    expect(() => validateCommand('queryExportProfiles.mutate', add(structure, { ...sqlite, area: 'table' }))).not.toThrow();
  });
});
