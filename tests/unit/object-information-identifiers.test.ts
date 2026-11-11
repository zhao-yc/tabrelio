import { beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { invoke } from '../../src/renderer/lib';
import { readObjectIdentifiers } from '../../src/renderer/objectIdentifiers';

vi.mock('../../src/renderer/lib', () => ({ invoke: vi.fn() }));
const send = vi.mocked(invoke);
const profile: ConnectionProfile = { id: 'c', dialect: 'mysql', name: '目录', group: '', color: '#000000', host: 'localhost', port: 3306, user: 'u' };
const database = { kind: 'database', connectionId: 'c', database: '库.名' } as const;
const current = () => true;
beforeEach(() => send.mockReset());

it('从选中库读取表和视图并逐段引用，不把名称中的点号拆开', async () => {
  send.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
    { kind: 'table', name: '表.`名' }, { kind: 'view', name: '视图' }, { kind: 'procedure', name: '过程' },
  ]);
  await expect(readObjectIdentifiers(profile, database, current)).resolves.toEqual({ identifiers: [
    { name: '表.`名', sql: '`库.名`.`表.``名`', relation: { ...database, kind: 'table', name: '表.`名' } },
    { name: '视图', sql: '`库.名`.`视图`', relation: { ...database, kind: 'view', name: '视图' } },
  ] });
  expect(send).toHaveBeenLastCalledWith('metadata.objects', { connectionId: 'c', database: '库.名' });
});

it('选库变化后不接续目录读取，原表被同名视图替换时拒绝字段回包', async () => {
  send.mockResolvedValueOnce(undefined);
  await expect(readObjectIdentifiers(profile, database, () => false)).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledExactlyOnceWith('connections.open', { id: 'c' });
  send.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ database: database.database, name: '原表', objectKind: 'view', columns: [] });
  await expect(readObjectIdentifiers({ ...profile, dialect: 'mariadb' }, { ...database, kind: 'table', name: '原表' }, current)).rejects.toThrow('已变化');
});

it('PostgreSQL 复核限定名和物化视图种类，字段按真实双引号规则引用', async () => {
  send.mockResolvedValueOnce({ schema: 'A.B', name: '视图', kind: 'm', columns: [{ name: '列"名', type: 'bigint' }] });
  await expect(readObjectIdentifiers({ ...profile, dialect: 'postgresql' }, { ...database, kind: 'view', name: '"A.B"."视图"' }, current))
    .resolves.toEqual({ identifiers: [{ name: '列"名', type: 'bigint', sql: '"列""名"' }] });
  expect(send).toHaveBeenCalledExactlyOnceWith('postgres.structure.read', { connectionId: 'c', database: '库.名', table: '"A.B"."视图"' });
});

it('SQLite 在 main 核对视图身份并保留未声明的字段类型', async () => {
  const sqlite: ConnectionProfile = { id: 'c', name: '测试', dialect: 'sqlite', group: '', color: '#000000', sqlite: { readOnly: true, busyTimeoutMs: 1000 } };
  const request = { connectionId: 'c', database: 'main', kind: 'view', table: 'v' } as const;
  send.mockResolvedValueOnce({ target: request, schemaKey: '目录', columns: [{ name: '列.名', declaredType: '' }] });
  await expect(readObjectIdentifiers(sqlite, { connectionId: 'c', database: 'main', kind: 'view', name: 'v' }, current))
    .resolves.toEqual({ identifiers: [{ name: '列.名', type: '', sql: '"列.名"' }] });
  expect(send).toHaveBeenCalledExactlyOnceWith('sqlite.queryBuilder.describe', request);
});
