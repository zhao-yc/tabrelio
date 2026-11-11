import { beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionProfile, CommandMap } from '../../src/shared/contracts';
import { readDependencyDefinition } from '../../src/renderer/objectDependencies';
import { invoke } from '../../src/renderer/lib';
import { viewDependenciesZh } from '../../src/renderer/locales/viewDependencies.zh-CN';

vi.mock('../../src/renderer/lib', () => ({ invoke: vi.fn(), uid: () => '20000000-0000-4000-8000-000000000001' }));
const send = vi.mocked(invoke);
const profile: ConnectionProfile = { id: 'c', name: '测试连接', group: '', color: '#000000', dialect: 'mysql', host: 'local', port: 3306, user: 'u' };
beforeEach(() => send.mockReset());

it('PostgreSQL 从真实目录字段引用并核对原关系 OID 和类型', async () => {
  send.mockResolvedValueOnce('CREATE VIEW');
  const ownTask = vi.fn();
  await expect(readDependencyDefinition({ ...profile, dialect: 'postgresql' }, {
    database: 'd', relation: { oid: '321', kind: 'm', schema: 'A.B', name: '标"识' },
  }, ownTask)).resolves.toBe('CREATE VIEW');
  expect(send).toHaveBeenCalledExactlyOnceWith('postgres.structure.definition', {
    connectionId: 'c', database: 'd', name: '"A.B"."标""识"', kind: 'view', expectedRelation: { oid: '321', kind: 'm' },
  });
  expect(ownTask).not.toHaveBeenCalled();
});

it('独立读取保留库名和对象名，拒绝外键目标被替换为同名视图', async () => {
  const ownTask = vi.fn();
  const request: CommandMap['query.objectDefinition']['input'] = {
    connectionId: 'c', database: '库 / 名', table: '表.名', taskId: 'object-definition:20000000-0000-4000-8000-000000000001',
  };
  send.mockResolvedValueOnce({ request, database: request.database, name: request.table, kind: 'view', temporary: false, ddl: 'CREATE VIEW' });
  await expect(readDependencyDefinition(profile, { database: '库 / 名', name: '表.名', expectedKind: 'table' }, ownTask))
    .rejects.toThrow(viewDependenciesZh.kindChanged);
  expect(ownTask).toHaveBeenCalledExactlyOnceWith(request.taskId);
  expect(send).toHaveBeenCalledExactlyOnceWith('query.objectDefinition', request);
});
