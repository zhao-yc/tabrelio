import { describe, expect, it, vi } from 'vitest';
import { assertObjectBrowserTabs, objectCategories, readObjectBrowserTabs } from '../../src/shared/objectBrowser';
import { validateCommand } from '../../src/shared/validation';
import { defaultSettings } from '../../src/main/storage';
import { compareBrowserObjects, objectPropertyText } from '../../src/renderer/objectBrowserDetails';
import { sidebarLocatedObject, sidebarLocation } from '../../src/renderer/sidebarLocate';
import { sidebarSearchMatch, type SidebarCatalog } from '../../src/renderer/sidebarSearch';
import type { DatabaseObject, PostgresConnectionProfile } from '../../src/shared/contracts';
import type { WorkspaceTab } from '../../src/renderer/store';

vi.mock('../../src/renderer/store', () => ({ useWorkspace: vi.fn() }));

const browser = { id: 'objects', kind: 'objects', title: '对象', connectionId: 'c', database: '库.名`/🚢', objectCategory: 'table' };

it('树搜索保留命中路径及同名对象身份，并排除过期库目录', () => {
  const profile: PostgresConnectionProfile = {
    id: 'c', name: '业务连接', group: '分析组', color: '#123456', dialect: 'postgresql',
    host: 'localhost', port: 5432, user: 'tester',
  };
  const items: DatabaseObject[] = [
    { name: '"Reporting"."Daily.View"', kind: 'table' }, { name: '"Reporting"."Daily.View"', kind: 'view' },
    { name: '"Reporting"."Other"', kind: 'view' },
  ];
  const catalog: SidebarCatalog = { databases: ['目录', '其他库'], objects: new Map([['目录', { version: 4, items }]]) };
  const scope = JSON.stringify(['c', '目录']);
  expect(sidebarSearchMatch(profile, catalog, '分析组', {})?.visible).toBe(true);
  expect(sidebarSearchMatch(profile, catalog, '分析组', {})?.reveal).toBe(false);
  expect(sidebarSearchMatch(profile, catalog, '其他库', {})?.databases.get('其他库')).toEqual({ reveal: false, items: undefined });
  const match = sidebarSearchMatch(profile, catalog, 'daily.view', { [scope]: 4 });
  expect(match?.databases.get('目录')).toEqual({ reveal: true, items: items.slice(0, 2) });
  expect(match?.databases.has('其他库')).toBe(false);
  expect(sidebarSearchMatch(profile, catalog, 'daily.view', { [scope]: 5 })?.visible).toBe(false);
});

describe('当前标签在对象树中的位置', () => {
  const profile: PostgresConnectionProfile = {
    id: 'c', name: '连接', group: '', color: '#123456', dialect: 'postgresql',
    host: 'localhost', port: 5432, user: 'tester', database: '旧默认库',
  };
  const query = { id: 'q', kind: 'query', title: '查询', connectionId: 'c', sql: '', database: '初始库' } as const;

  it('使用查询的显式库上下文；未知、空库和无初始库都只定位连接', () => {
    expect(sidebarLocation(query, profile)).toEqual({ connectionId: 'c', database: '初始库' });
    expect(sidebarLocation({ ...query, databaseContext: { state: 'known', database: '实际库' } }, profile))
      .toEqual({ connectionId: 'c', database: '实际库' });
    for (const patch of [{ databaseContext: { state: 'unknown' } }, { databaseContext: { state: 'known', database: null } }, { database: undefined }] as const) {
      expect(sidebarLocation({ ...query, ...patch }, profile)).toEqual({ connectionId: 'c' });
    }
    expect(sidebarLocation({ ...browser, kind: 'objects', objectCategory: 'table' }, profile))
      .toEqual({ connectionId: 'c', database: browser.database });
    expect(sidebarLocation(query, { ...profile, id: 'other' })).toBeUndefined();
  });

  it('按表页使用的 PostgreSQL 标识符定位，拒绝无法唯一识别的关系', () => {
    const tab: WorkspaceTab = { id: 't', kind: 'table', title: '标题', connectionId: 'c', database: 'db', table: 'Odd.Name' };
    expect(sidebarLocation(tab, profile)).toEqual({ connectionId: 'c', database: 'db', relation: '"public"."Odd.Name"' });
    const relation = '"odd.schema"."Odd""Name"';
    expect(sidebarLocation({ ...tab, table: relation }, profile)?.relation).toBe(relation);
    expect(sidebarLocation({ ...tab, database: undefined }, profile)).toBeUndefined();
    const view: DatabaseObject = { name: relation, kind: 'view' };
    const routine: DatabaseObject = { name: relation, kind: 'function' };
    expect(sidebarLocatedObject([routine, view], relation)).toBe(view);
    expect(sidebarLocatedObject([view, { ...view, kind: 'table' }], relation)).toBeUndefined();
    expect(sidebarLocatedObject([view], relation.toLowerCase())).toBeUndefined();
  });
});

describe('对象浏览标签设置合同', () => {
  it('五类对象定位可经原设置入口读写，旧查询及表标签保持兼容', () => {
    for (const objectCategory of objectCategories) {
      const tabs = [
        { id: 'q', kind: 'query', title: '草稿', connectionId: 'c', sql: '原查询正文' },
        { id: 't', kind: 'table', title: '原表', connectionId: 'c', database: '库', table: '表' },
        { ...browser, objectCategory }
      ];
      const settings = { ...defaultSettings, tabs, activeTabId: 'objects' };
      expect(validateCommand('settings.save', settings)).toEqual(settings);
    }
  });

  it('对象浏览必须有明确连接/库/分类，禁止携带查询、表记录及来源权限', () => {
    for (const patch of [{ database: '' }, { database: undefined }, { objectCategory: undefined }, { objectCategory: 'function' }, { connectionId: '' }, { database: 'a\0b' }]) {
      const settings = { ...defaultSettings, tabs: [{ ...browser, ...patch }] };
      expect(() => validateCommand('settings.save', settings)).toThrow();
    }
    for (const field of ['sql', 'table', 'databaseContext', 'sourceBinding', 'fileSourceBinding', 'queryEditorHeight']) {
      expect(() => assertObjectBrowserTabs({ tabs: [{ ...browser, [field]: undefined }] })).toThrow();
      expect(() => validateCommand('settings.save', { ...defaultSettings, tabs: [{ ...browser, [field]: undefined }] })).toThrow();
    }
    expect(() => validateCommand('settings.save', { ...defaultSettings, tabs: [{ id: 'q', kind: 'query', title: '查询', connectionId: 'c', objectCategory: 'table' }] })).toThrow();
    expect(() => assertObjectBrowserTabs({ tabs: [{ ...browser, fileBinding: '不得保存的来源' }] })).toThrow('其它字段');
  });

  it('原始分类和库必须是自有数据属性，不能从原型或访问器提升定位', () => {
    for (const field of ['database', 'connectionId', 'objectCategory']) {
      const own: Record<string, unknown> = { ...browser }, value = own[field]; delete own[field];
      expect(() => assertObjectBrowserTabs({ tabs: [Object.assign(Object.create({ [field]: value }), own)] })).toThrow('自有');
      Object.defineProperty(own, field, { enumerable: true, get: () => value });
      expect(() => assertObjectBrowserTabs({ tabs: [own] })).toThrow('数据属性');
    }
  });

  it('读取只过滤损坏的对象浏览项，不改动旧标签或原列表', () => {
    const query = { id: 'q', kind: 'query', sql: '待保存正文' }, table = { id: 't', kind: 'table', table: '原表' };
    const good = { ...browser }, bad = { ...browser, database: '' }, input = [query, bad, table, good];
    const restored = readObjectBrowserTabs(input);
    expect(restored).toEqual([query, table, good]);
    expect(restored[0]).toBe(query); expect(restored[2]).toBe(good); expect(input).toEqual([query, bad, table, good]);
  });
});

describe('对象详情读取与精确排序', () => {
  it('表结构子节点只接受有明确目标的目录读取', () => {
    const target = { connectionId: 'c', database: 'main', table: '大小写.表名' };
    expect(validateCommand('metadata.tableElements', target)).toEqual(target);
    for (const patch of [{ table: '' }, { database: 'x\0y' }, { connectionId: '' }, { sessionId: '用户事务' }, { sql: 'SELECT 1' }]) {
      expect(() => validateCommand('metadata.tableElements', { ...target, ...patch })).toThrow();
    }
  });
  it('原调用仍合法，只有显式 true 才申请读取表详情', () => {
    const target = { connectionId: 'c', database: 'main' };
    expect(validateCommand('metadata.objects', target)).toEqual(target);
    expect(validateCommand('metadata.objects', { ...target, tableDetails: true })).toEqual({ ...target, tableDetails: true });
    for (const tableDetails of [false, 1, 'true', null]) {
      expect(() => validateCommand('metadata.objects', { ...target, tableDetails })).toThrow();
    }
  });

  it('按全部位数比较，零和未知分别显示，未知在两种方向均排在最后', () => {
    const make = (name: string, estimatedRows?: string): DatabaseObject => ({ name, kind: 'table', details: { estimatedRows } });
    const unknown = make('A'), zero = make('B', '0'), lower = make('Z', '9007199254740992'), higher = make('C', '9007199254740993');
    const objects = [higher, unknown, zero, lower];
    expect([...objects].sort((a, b) => compareBrowserObjects(a, b, 'estimatedRows', false))).toEqual([zero, lower, higher, unknown]);
    expect([...objects].sort((a, b) => compareBrowserObjects(a, b, 'estimatedRows', true))).toEqual([higher, lower, zero, unknown]);
    expect(objectPropertyText(higher, 'estimatedRows')).toBe('≈ 9,007,199,254,740,993');
    expect(objectPropertyText(zero, 'estimatedRows')).toBe('≈ 0');
    expect(objectPropertyText(unknown, 'estimatedRows')).toBe('—');
  });
});
