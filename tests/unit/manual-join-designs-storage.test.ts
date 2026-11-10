import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { LocalStore } from '../../src/main/storage';
import { manualJoinDesignSaveSchema, singleTableQueryDesignSchema, type ManualJoinDesign } from '../../src/shared/manualJoinDesigns';
import { assertSingleQueryDraftColumns, singleQueryDesignSaveSchema, type PostgresSingleQueryDraft,
  type SqliteSingleQueryDraft } from '../../src/shared/singleQueryDesigns';

const require = createRequire(import.meta.url);
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [];
const protector = { available: () => false, encrypt: () => { throw Error('不应加密'); }, decrypt: () => { throw Error('不应解密'); } };
const scope = { connectionId: 'fixture', database: 'order_db', table: 'orders' };
const profile = { id: scope.connectionId, name: '离线样本', host: 'offline.invalid', port: 3306, user: 'test', dialect: 'mysql' as const, color: '#ffffff', group: '' };
const design: ManualJoinDesign = {
  version: 1, first: { database: 'warehouse', table: 'payments', pairs: [{ child: 'id', parent: 'order_id' }] },
  additional: [{ database: 'warehouse', table: 'regions', source: 1, kind: 'LEFT', pairs: [{ child: 'region', parent: 'id', operator: '>=' }], columns: ['label'] }],
  kind: 'INNER', distinct: false, unmatchedOnly: false, child: ['id'], parent: ['total'], limit: '42',
  projection: [{ column: 't3.label', alias: '地区' }, { column: 'c.id' }, { column: 'p.total', alias: '总额' }],
  filters: [{ id: 'where1', side: 't3', enabled: false, draft: { column: 'label', operator: 'IN', value: '', upperValue: '', valuesText: ' 保留🚢\n第二行', includeEmptyString: true } }],
  filterMode: 'all', filterGroup: { mode: 'all', children: [0] },
  sort: [{ id: 'sort1', rule: { side: 't3', column: 'label', direction: 'DESC', nulls: 'LAST' } }],
  summaryEnabled: true, summaryGroups: [{ id: 'g1', side: 't3', column: 'label', alias: '地区名称' }], summarySort: [],
  aggregates: [{ id: 'a1', fn: 'SUM', side: 'parent', column: 'total', alias: '合计' }],
  having: [{ id: 'having1', enabled: true, targetLabel: '聚合输出 · 合计', draft: { column: 'a:a1', operator: '>', value: '9007199254740993', upperValue: '', valuesText: '', includeEmptyString: false } }],
  havingMode: 'all',
};
const singleScope = { ...scope, single: true as const };
const singleDesign = singleTableQueryDesignSchema.parse({ version: 1, single: true, distinct: false, child: ['id'], limit: '8',
  filters: [{ ...design.filters[0], side: 'child' }], filterMode: 'all', filterGroup: design.filterGroup,
  sort: [], summarySort: [{ id: 's1', rule: { side: 'aggregate', column: '合计', direction: 'DESC' } }],
  summaryEnabled: true, summaryGroups: [{ id: 'g1', side: 'child', column: 'label' }],
  aggregates: [{ ...design.aggregates[0], fn: 'AVG_DISTINCT', side: 'child' }], having: design.having, havingMode: 'all' });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-manual-join-designs-')); directories.push(directory);
  const file = join(directory, 'local.sqlite'), store = await LocalStore.open(file, wasm, protector);
  store.saveConnection(profile);
  return { file, store };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('手动 JOIN 设计本地配置库', () => {
  it('PostgreSQL 单表和 JOIN 同名隔离，关联顺序及精确条件可恢复且不保存目录摘要', async () => {
    const { file, store } = await fixture();
    const pg = { connectionId: 'pg-design', dialect: 'postgresql', database: 'orders', table: '"sales"."orders"' } as const;
    const joined = { ...pg, join: true } as const;
    const single: PostgresSingleQueryDraft = {
      version: 1, dialect: 'postgresql', selected: ['id'], distinct: false, limit: '', rules: [], mode: 'all', sort: [],
      summaryEnabled: false, summary: { groups: [], aggregates: [], sort: [] }, havingRules: [], havingMode: 'all',
    };
    const step = { table: '"public"."details"', kind: 'LEFT' as const, mode: 'all' as const,
      pairs: [{ left: 't1.id', right: 'id', operator: '=' as const }] };
    const draft: PostgresSingleQueryDraft = { ...single, selected: ['t1.id', 't3.value'],
      joins: [step, { ...step, pairs: [{ left: 't2.id', right: 'id', operator: '=' }] }],
      rules: [{ column: 't3.value', operator: '>=', value: '9223372036854775807' }] };
    let id: string;
    try {
      store.saveConnection({ ...profile, id: pg.connectionId, dialect: pg.dialect, port: 5432, database: pg.database });
      store.saveSingleQueryDesign({ ...pg, name: '日报', design: single });
      id = store.saveSingleQueryDesign({ ...joined, name: '日报', design: draft }).id;
      expect(() => store.saveSingleQueryDesign({ ...pg, name: '误入单表', design: draft })).toThrow('关联模式');
      expect(singleQueryDesignSaveSchema.safeParse({ ...joined, name: '多余元数据', design: { ...draft, joins: [{ ...step, fingerprint: 'a'.repeat(64) }] } }).success).toBe(false);
    } finally { store.close(); }
    const reopened = await LocalStore.open(file, wasm, protector);
    try {
      expect(reopened.readSingleQueryDesign({ ...joined, id })).toEqual(draft);
      expect(() => reopened.readSingleQueryDesign({ ...pg, id })).toThrow('已变化');
      expect(reopened.listSingleQueryDesigns({ ...joined, table: '"elsewhere"."orders"' })).toEqual([]);
      reopened.deleteSingleQueryDesign({ ...joined, id });
      expect(reopened.listSingleQueryDesigns(joined)).toEqual([]);
      expect(reopened.listSingleQueryDesigns(pg)).toHaveLength(1);
    } finally { reopened.close(); }
  });
  it('SQLite 单表设计独立于旧设计，真实配置库重开后保留双模式及精确值', async () => {
    const { file, store } = await fixture();
    const sqlite = { ...scope, connectionId: 'sqlite-source', dialect: 'sqlite', database: 'main', kind: 'table' } as const;
    const sqliteProfile = { id: sqlite.connectionId, name: 'SQLite 样本', dialect: 'sqlite' as const, group: '', color: '#ffffff',
      sqlite: { filePath: '/isolated/sample.sqlite', readOnly: false, busyTimeoutMs: 1000 } };
    const draft: SqliteSingleQueryDraft = { version: 1, dialect: 'sqlite', selected: ['id'], limit: '', distinct: true,
      filters: [], mode: 'and', sort: [{ id: 'sort', column: 'id', direction: 'desc' }], summaryEnabled: true, havingMode: 'and',
      summary: { groups: [], aggregates: [{ id: 'sum', fn: 'SUM_DISTINCT', column: 'id', alias: '合计' }], sort: [] },
      havingFilters: [{ id: 'filter', column: 'aggregate:sum', operator: 'gte', kind: 'integer', value: '9223372036854775807' }] };
    const joined = { ...sqlite, join: true } as const;
    const joinedDraft: SqliteSingleQueryDraft = { ...draft, selected: ['t1.id'], sort: [], summaryEnabled: false,
      summary: { ...draft.summary, aggregates: [{ ...draft.summary.aggregates[0], column: 't2.id' }] },
      joins: [{ target: { table: 'link', kind: 'view' }, kind: 'LEFT', mode: 'all',
        pairs: [{ left: 't1.id', right: 'id', operator: '=' }], group: { mode: 'all', children: [0] } }] };
    let id: string, joinId: string;
    try {
      store.saveConnection(sqliteProfile);
      const main = mainColumnsHarness(); main.context.store = store; main.setRevision(store.connectionRevision());
      const entry = await main.run('singleQueryDesigns.save', { ...sqlite, name: '汇总', design: draft });
      id = entry.id;
      joinId = (await main.run('singleQueryDesigns.save', { ...joined, name: '汇总', design: joinedDraft })).id;
      expect((await main.invoke('singleQueryDesigns.delete', { ...sqlite, id }, { ...main.event(), senderFrame: {} })).ok).toBe(false);
      expect(main.request).not.toHaveBeenCalled();
    } finally { store.close(); }
    const reopened = await LocalStore.open(file, wasm, protector);
    try {
      expect(reopened.readSingleQueryDesign({ ...sqlite, id })).toEqual(draft);
      expect(reopened.readSingleQueryDesign({ ...joined, id: joinId })).toEqual(joinedDraft);
      expect(() => reopened.readSingleQueryDesign({ ...sqlite, id: joinId })).toThrow('已变化');
      expect(singleQueryDesignSaveSchema.safeParse({ ...sqlite, name: '错配', design: joinedDraft }).success).toBe(false);
      reopened.deleteSingleQueryDesign({ ...joined, id: joinId });
      expect(reopened.listSingleQueryDesigns(joined)).toEqual([]);
      expect(reopened.listSingleQueryDesigns(sqlite)).toHaveLength(1);
      expect(reopened.listSingleQueryDesigns({ ...sqlite, kind: 'view' })).toEqual([]);
      expect(() => assertSingleQueryDraftColumns(draft, ['renamed'])).toThrow('来源字段已变化');
      expect(singleQueryDesignSaveSchema.safeParse({ ...sqlite, name: '错配', design: { ...draft, sql: 'SELECT 1' } }).success).toBe(false);
      const next = reopened.saveSingleQueryDesign({ ...sqlite, name: '汇总', replaceId: id, design: { ...draft, limit: '8' } });
      expect(next.id).not.toBe(id);
      expect(() => reopened.deleteSingleQueryDesign({ ...sqlite, id })).toThrow('已变化');
      reopened.saveConnection({ ...sqliteProfile, sqlite: { ...sqliteProfile.sqlite, filePath: '/isolated/other.sqlite' } });
      expect(() => reopened.readSingleQueryDesign({ ...sqlite, id: next.id })).toThrow('连接目标已更改');
      reopened.deleteConnection(sqlite.connectionId);
      reopened.saveConnection(sqliteProfile);
      expect(reopened.listSingleQueryDesigns(sqlite)).toEqual([]);
    } finally { reopened.close(); }
  });
  it('重开真实配置文件后按原表准确恢复完整结构和精确值', async () => {
    const { file, store } = await fixture();
    let entry;
    try { entry = store.saveManualJoinDesign(manualJoinDesignSaveSchema.parse({ ...scope, name: '  有效期汇总  ', design })); }
    finally { store.close(); }
    const reopened = await LocalStore.open(file, wasm, protector);
    try {
      expect(reopened.listManualJoinDesigns(scope)).toEqual([{ id: entry.id, name: '有效期汇总' }]);
      expect(reopened.readManualJoinDesign({ ...scope, id: entry.id })).toEqual(design);
      expect(reopened.listManualJoinDesigns({ ...scope, table: 'other' })).toEqual([]);
      expect(() => reopened.readManualJoinDesign({ ...scope, table: 'other', id: entry.id })).toThrow('已变化');
      reopened.saveConnection({ ...profile, host: 'other.invalid' });
      expect(() => reopened.readManualJoinDesign({ ...scope, id: entry.id })).toThrow('连接目标已更改');
      reopened.deleteConnection(profile.id);
      reopened.saveConnection(profile);
      expect(reopened.listManualJoinDesigns(scope)).toEqual([]);
    } finally { reopened.close(); }
  });

  it('重复名称失败保留原设计，覆盖后旧编号失效，删除只作用于所选编号', async () => {
    const { store } = await fixture();
    try {
      const first = store.saveManualJoinDesign({ ...scope, name: '原设计', design });
      expect(() => store.saveManualJoinDesign({ ...scope, name: '原设计', design })).toThrow('同名');
      const replacement = store.saveManualJoinDesign({ ...scope, name: '原设计', replaceId: first.id, design: { ...design, limit: '99' } });
      expect(replacement.id).not.toBe(first.id);
      expect(() => store.deleteManualJoinDesign({ ...scope, id: first.id })).toThrow('已变化');
      expect(() => store.saveManualJoinDesign({ ...scope, name: '原设计', replaceId: first.id, design })).toThrow('已变化');
      expect(store.readManualJoinDesign({ ...scope, id: replacement.id }).limit).toBe('99');
      store.deleteManualJoinDesign({ ...scope, id: replacement.id });
      expect(store.listManualJoinDesigns(scope)).toEqual([]);
    } finally { store.close(); }
  });

  it('生产 Main 白名单、入参、文档归属与实际配置库联通，拒绝外来 frame', async () => {
    const { store } = await fixture();
    try {
      const main = mainColumnsHarness();
      main.context.store = store;
      main.setRevision(store.connectionRevision());
      const entry = await main.run('joinDesigns.save', { ...scope, name: 'IPC 设计', design });
      expect(await main.run('joinDesigns.list', scope)).toEqual([entry]);
      expect(await main.run('joinDesigns.read', { ...scope, id: entry.id })).toEqual(design);
      expect((await main.invoke('joinDesigns.delete', { ...scope, id: entry.id }, { ...main.event(), senderFrame: {} })).ok).toBe(false);
      expect(await main.run('joinDesigns.list', scope)).toEqual([entry]);
      await main.run('joinDesigns.delete', { ...scope, id: entry.id });
      expect(await main.run('joinDesigns.list', scope)).toEqual([]);
      expect(main.request).not.toHaveBeenCalled();
    } finally { store.close(); }
  });

  it('旧版单来源设计保持原样，逐条件来源可保存并读回', async () => {
    const { store } = await fixture();
    try {
      const legacy = store.saveManualJoinDesign({ ...scope, name: '原来源', design });
      const step = design.additional[0];
      const mixed = manualJoinDesignSaveSchema.parse({ ...scope, name: '混合来源', design: {
        ...design, additional: [{ ...step, pairs: [...step.pairs, { source: 0, child: 'id', parent: 'id' }],
          on: { mode: 'any', group: { mode: 'any', children: [0, 1] } } }],
      } });
      const saved = store.saveManualJoinDesign(mixed);
      expect(store.readManualJoinDesign({ ...scope, id: legacy.id })).toEqual(design);
      expect(store.readManualJoinDesign({ ...scope, id: saved.id })).toEqual(mixed.design);
    } finally { store.close(); }
  });

  it('IPC 合同拒绝目录原文、未来别名及未知版本', () => {
    const parse = (value: unknown) => manualJoinDesignSaveSchema.safeParse({ ...scope, name: '测试', design: value }).success;
    expect(parse(design)).toBe(true);
    expect(parse({ ...design, sql: 'SELECT 1' })).toBe(false);
    expect(parse({ ...design, version: 2 })).toBe(false);
    expect(parse({ ...design, first: { ...design.first, on: { mode: 'all', group: { mode: 'all', children: [1] } } } })).toBe(false);
    const step = design.additional[0];
    expect(parse({ ...design, additional: [{ ...step, source: 2 }] })).toBe(false);
    expect(parse({ ...design, additional: [{ ...step, pairs: [{ ...step.pairs[0], source: 2 }] }] })).toBe(false);
    expect(parse({ ...design, first: { ...design.first, pairs: [{ ...design.first.pairs[0], source: 0 }] } })).toBe(false);
  });

  it('从旧配置库升级并重开，保留同名 JOIN 与单表设计，跨模式不能读写或删除', async () => {
    const { file, store } = await fixture();
    const legacy = store.saveManualJoinDesign({ ...scope, name: '同名设计', design });
    store.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }), previous = new SQL.Database(readFileSync(file));
    try {
      previous.run('DROP TRIGGER single_table_query_designs_cleanup; DROP TABLE single_table_query_designs;');
      writeFileSync(file, previous.export());
    } finally { previous.close(); }
    const upgraded = await LocalStore.open(file, wasm, protector);
    let entry;
    try {
      expect(upgraded.readManualJoinDesign({ ...scope, id: legacy.id })).toEqual(design);
      expect(upgraded.listManualJoinDesigns(singleScope)).toEqual([]);
      entry = upgraded.saveManualJoinDesign({ ...singleScope, name: '同名设计', design: singleDesign });
    } finally { upgraded.close(); }
    const reopened = await LocalStore.open(file, wasm, protector);
    try {
      expect(reopened.listManualJoinDesigns(singleScope)).toEqual([entry]);
      expect(reopened.readManualJoinDesign({ ...singleScope, id: entry.id })).toEqual(singleDesign);
      expect(() => reopened.readManualJoinDesign({ ...scope, id: entry.id })).toThrow('已变化');
      expect(() => reopened.deleteManualJoinDesign({ ...singleScope, id: legacy.id })).toThrow('已变化');
      expect(() => reopened.saveManualJoinDesign({ ...singleScope, replaceId: legacy.id, name: '同名设计', design: singleDesign })).toThrow('已变化');
      const replacement = reopened.saveManualJoinDesign({ ...singleScope, replaceId: entry.id, name: '同名设计', design: { ...singleDesign, limit: '9' } });
      expect(() => reopened.deleteManualJoinDesign({ ...singleScope, id: entry.id })).toThrow('已变化');
      expect(reopened.readManualJoinDesign({ ...singleScope, id: replacement.id }).limit).toBe('9');
      expect(reopened.readManualJoinDesign({ ...scope, id: legacy.id })).toEqual(design);
      reopened.deleteConnection(profile.id);
      reopened.saveConnection(profile);
      expect(reopened.listManualJoinDesigns(scope)).toEqual([]);
      expect(reopened.listManualJoinDesigns(singleScope)).toEqual([]);
    } finally { reopened.close(); }
  });

  it('正式 IPC 仅接收单表结构化设计，重定向连接后拒绝恢复', async () => {
    const { store } = await fixture();
    try {
      const main = mainColumnsHarness();
      main.context.store = store;
      main.setRevision(store.connectionRevision());
      const request = { ...singleScope, name: '单表设计', design: singleDesign };
      const entry = await main.run('joinDesigns.save', request);
      expect(await main.run('joinDesigns.read', { ...singleScope, id: entry.id })).toEqual(singleDesign);
      for (const invalid of [ { ...request, single: undefined }, { ...request, design },
        { ...request, design: { ...singleDesign, sql: 'SELECT 1' } },
        { ...request, design: { ...singleDesign, filters: [{ ...singleDesign.filters[0], side: 'parent' }] } },
      ]) expect(manualJoinDesignSaveSchema.safeParse(invalid).success).toBe(false);
      store.saveConnection({ ...profile, host: 'other.invalid' });
      expect(() => store.readManualJoinDesign({ ...singleScope, id: entry.id })).toThrow('连接目标已更改');
      expect(main.request).not.toHaveBeenCalled();
    } finally { store.close(); }
  });
});
