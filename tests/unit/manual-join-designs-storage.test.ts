import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { LocalStore } from '../../src/main/storage';
import { manualJoinDesignSaveSchema, type ManualJoinDesign } from '../../src/shared/manualJoinDesigns';

const require = createRequire(import.meta.url);
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [];
const protector = { available: () => false, encrypt: () => { throw Error('不应加密'); }, decrypt: () => { throw Error('不应解密'); } };
const scope = { connectionId: 'fixture', database: 'order_db', table: 'orders' };
const profile = { id: scope.connectionId, name: '离线样本', host: 'offline.invalid', port: 3306, user: 'test', dialect: 'mysql' as const, color: '#ffffff', group: '' };
const design: ManualJoinDesign = {
  version: 1, first: { database: 'warehouse', table: 'payments', pairs: [{ child: 'id', parent: 'order_id' }] },
  additional: [{ database: 'warehouse', table: 'regions', source: 1, kind: 'LEFT', pairs: [{ child: 'region', parent: 'id', operator: '>=' }], columns: ['label'] }],
  kind: 'INNER', distinct: false, unmatchedOnly: false, child: ['id'], parent: ['total'], limit: '42',
  filters: [{ id: 'where1', side: 't3', enabled: false, draft: { column: 'label', operator: 'IN', value: '', upperValue: '', valuesText: ' 保留🚢\n第二行', includeEmptyString: true } }],
  filterMode: 'all', filterGroup: { mode: 'all', children: [0] },
  sort: [{ id: 'sort1', rule: { side: 't3', column: 'label', direction: 'DESC', nulls: 'LAST' } }],
  summaryEnabled: true, summaryGroups: [{ id: 'g1', side: 't3', column: 'label' }], summarySort: [],
  aggregates: [{ id: 'a1', fn: 'SUM', side: 'parent', column: 'total', alias: '合计' }],
  having: [{ id: 'having1', enabled: true, targetLabel: '聚合输出 · 合计', draft: { column: 'a:a1', operator: '>', value: '9007199254740993', upperValue: '', valuesText: '', includeEmptyString: false } }],
  havingMode: 'all',
};

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-manual-join-designs-')); directories.push(directory);
  const file = join(directory, 'local.sqlite'), store = await LocalStore.open(file, wasm, protector);
  store.saveConnection(profile);
  return { file, store };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('手动 JOIN 设计本地配置库', () => {
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
        ...design, additional: [{ ...step, pairs: [...step.pairs, { source: 0, child: 'id', parent: 'id' }] }],
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
    const step = design.additional[0];
    expect(parse({ ...design, additional: [{ ...step, source: 2 }] })).toBe(false);
    expect(parse({ ...design, additional: [{ ...step, pairs: [{ ...step.pairs[0], source: 2 }] }] })).toBe(false);
    expect(parse({ ...design, first: { ...design.first, pairs: [{ ...design.first.pairs[0], source: 0 }] } })).toBe(false);
  });
});
