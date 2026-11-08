import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt() { throw Error('不应写入凭据'); }, decrypt() { throw Error('不应读取凭据'); } };
const sqlite = { family: 'sqlite' } as const, mysql = { family: 'mysql' } as const;
const fileConnection = { id: 'left', name: '左文件', group: '', color: '', dialect: 'sqlite' as const,
  sqlite: { filePath: '/fixtures/left.sqlite', readOnly: true, busyTimeoutMs: 500 } };
const network = { id: 'mysql', name: '网络连接', group: '', color: '', dialect: 'mysql' as const,
  host: 'mysql.invalid', port: 3306, user: 'offline' };
const exact = { column: 'id', value: { kind: 'integer', value: '9223372036854775807' } };
const profile = { name: '库存核对', configuration: { ...sqlite,
  source: { connectionId: 'left', database: 'main', table: '库存' },
  target: { connectionId: 'right', database: 'main', table: '库存' }, filter: exact,
} };
const add = { ...sqlite, kind: 'add', profile };
let dir: string, file: string, store: LocalStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabrelio-data-compare-profiles-'));
  file = join(dir, 'local.sqlite');
  store = await LocalStore.open(file, wasm, protector);
  store.saveConnection(fileConnection);
  store.saveConnection({ ...fileConnection, id: 'right', sqlite: { ...fileConnection.sqlite, filePath: '/fixtures/right.sqlite' } });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('数据比较方案', () => {
  it('旧库读取为空且不改盘，精确筛选和两端在重开后保持，连接改名可用', async () => {
    const before = readFileSync(file);
    expect(store.listDataCompareProfiles(sqlite)).toEqual([]);
    expect(readFileSync(file)).toEqual(before);
    const [selected] = store.mutateDataCompareProfiles(add);
    expect(Object.keys(selected).sort()).toEqual(['name', 'revision']);
    expect(store.listDataCompareProfiles(mysql)).toEqual([]);
    store.saveConnection({ ...fileConnection, name: '左文件新名称' });
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.listDataCompareProfiles(sqlite)).toEqual([selected]);
    expect(store.readDataCompareProfile({ ...sqlite, selected })).toEqual(profile.configuration);
    expect(store.history()).toEqual([]);
    expect(store.tasks()).toEqual([]);
  });

  it('共享 MySQL 和 MariaDB 作用域，连接路由变化后必须重新保存', () => {
    store.saveConnection(network);
    store.saveConnection({ ...network, id: 'maria', host: 'maria.invalid', dialect: 'mariadb' });
    const configuration = { ...mysql, source: { connectionId: 'mysql', database: 'db', table: 'ledger' },
      target: { connectionId: 'maria', database: 'db', table: 'ledger' } };
    const request = { ...mysql, kind: 'add', profile: { name: profile.name, configuration } };
    const [selected] = store.mutateDataCompareProfiles(request);
    expect(store.readDataCompareProfile({ ...mysql, selected })).toEqual(configuration);
    store.saveConnection({ ...network, port: 3307 });
    expect(() => store.readDataCompareProfile({ ...mysql, selected })).toThrow('连接配置已变化');
    const [next] = store.mutateDataCompareProfiles({ ...request, kind: 'update', selected });
    expect(store.readDataCompareProfile({ ...mysql, selected: next })).toEqual(configuration);
    expect(() => store.mutateDataCompareProfiles({ ...request, kind: 'add', profile: {
      name: '无效连接', configuration: { ...configuration, target: { ...configuration.target, connectionId: 'left' } },
    } })).toThrow('连接不可用');
  });

  it('拒绝重名及过期修订，写盘失败保留旧方案并可按原修订重试', () => {
    const [selected] = store.mutateDataCompareProfiles(add);
    expect(() => store.mutateDataCompareProfiles({ ...add, profile: { ...profile, name: ' 库存核对 ' } })).toThrow('同名');
    const changed = { ...add, kind: 'update', selected, profile: { ...profile, name: '月末库存' } };
    const before = readFileSync(file);
    mkdirSync(file + '.tmp');
    expect(() => store.mutateDataCompareProfiles(changed)).toThrow('修改未保存');
    expect(readFileSync(file)).toEqual(before);
    expect(store.readDataCompareProfile({ ...sqlite, selected })).toEqual(profile.configuration);
    rmdirSync(file + '.tmp');
    const [next] = store.mutateDataCompareProfiles(changed);
    expect(() => store.readDataCompareProfile({ ...sqlite, selected })).toThrow('已变化');
    expect(() => store.mutateDataCompareProfiles({ ...sqlite, kind: 'delete', selected })).toThrow('已变化');
    expect(store.mutateDataCompareProfiles({ ...sqlite, kind: 'delete', selected: next })).toEqual([]);
  });

  it('IPC 与存储拒绝运行数据、凭据、相同目标和无效筛选', () => {
    const before = readFileSync(file);
    for (const configuration of [
      { ...profile.configuration, syncSnapshotId: '旧快照' },
      { ...profile.configuration, source: { ...profile.configuration.source, password: '凭据' } },
      { ...profile.configuration, target: profile.configuration.source },
      { ...profile.configuration, filter: { ...exact, value: { ...exact.value, value: '9223372036854775808' } } },
      { ...profile.configuration, family: 'postgresql' },
    ]) {
      const request = { ...add, profile: { ...profile, configuration } };
      expect(() => validateCommand('dataCompareProfiles.mutate', request)).toThrow();
      expect(() => store.mutateDataCompareProfiles(request)).toThrow();
    }
    expect(readFileSync(file)).toEqual(before);
  });
});

describe('多表比较方案', () => {
  const scope = { ...sqlite, area: 'batch' } as const;
  const configuration = { ...sqlite, source: { connectionId: 'left', database: 'main' }, target: { connectionId: 'right', database: 'main' },
    pairs: [{ source: 'ledger', target: 'ledger' }, { source: '旧名', target: '新名' }] };
  const request = { ...scope, kind: 'add', profile: { name: profile.name, configuration } };

  it('独立于同名单表方案，重开后保持表对顺序，换路由及过期修订均拦截', async () => {
    const [single] = store.mutateDataCompareProfiles(add);
    const [selected] = store.mutateDataCompareProfiles(request);
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.listDataCompareProfiles(sqlite)).toEqual([single]);
    expect(store.listDataCompareProfiles(scope)).toEqual([selected]);
    expect(store.readDataCompareProfile({ ...scope, selected })).toEqual(configuration);
    expect(() => store.readDataCompareProfile({ ...sqlite, selected })).toThrow('已变化');
    store.saveConnection({ ...fileConnection, sqlite: { ...fileConnection.sqlite, filePath: '/fixtures/moved.sqlite' } });
    expect(() => store.readDataCompareProfile({ ...scope, selected })).toThrow('连接配置已变化');
    const [next] = store.mutateDataCompareProfiles({ ...request, kind: 'update', selected });
    expect(() => store.mutateDataCompareProfiles({ ...scope, kind: 'delete', selected })).toThrow('已变化');
    expect(store.mutateDataCompareProfiles({ ...scope, kind: 'delete', selected: next })).toEqual([]);
    expect(store.listDataCompareProfiles(sqlite)).toEqual([single]);
  });

  it('拒绝混用入口、重复目标、无映射、同范围自比较和运行状态', () => {
    const before = readFileSync(file);
    for (const input of [
      { ...request, area: undefined },
      { ...add, area: 'batch' },
      ...[
        { ...configuration, pairs: [] },
        { ...configuration, pairs: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x' }] },
        { ...configuration, pairs: [{ source: 'a', target: 'x' }, { source: 'a', target: 'y' }] },
        { ...configuration, pairs: Array.from({ length: 33 }, (_, index) => ({ source: 'a' + index, target: 'b' + index })) },
        { ...configuration, target: configuration.source },
        { ...configuration, results: [] },
        { ...configuration, source: { ...configuration.source, password: '凭据' } },
      ].map(item => ({ ...request, profile: { ...request.profile, configuration: item } })),
    ]) {
      expect(() => validateCommand('dataCompareProfiles.mutate', input)).toThrow();
      expect(() => store.mutateDataCompareProfiles(input)).toThrow();
    }
    expect(readFileSync(file)).toEqual(before);
  });
});
