import { describe, expect, it } from 'vitest';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import { canInsertObjectIdentifier } from '../../src/renderer/objectIdentifierInsertion';
import type { WorkspaceTab } from '../../src/renderer/store';

const postgres: PostgresConnectionProfile = {
  id: 'pg', name: 'PostgreSQL', dialect: 'postgresql', database: 'fallback',
  group: '', color: '', host: 'localhost', port: 5432, user: 'postgres', rememberPassword: false,
};
const draft: WorkspaceTab = { id: 'q', kind: 'query', title: '查询', connectionId: 'pg', database: 'source' };

describe('对象限定名的查询上下文', () => {
  it('PostgreSQL 必须同连接同数据库，缺省库跟随查询工作区', () => {
    expect(canInsertObjectIdentifier(draft, postgres, 'source')).toBe(true);
    expect(canInsertObjectIdentifier(draft, postgres, 'fallback')).toBe(false);
    expect(canInsertObjectIdentifier({ ...draft, database: undefined }, postgres, 'fallback')).toBe(true);
    expect(canInsertObjectIdentifier({ ...draft, database: undefined }, { ...postgres, database: '' }, 'postgres')).toBe(true);
    expect(canInsertObjectIdentifier({ ...draft, connectionId: 'other' }, postgres, 'source')).toBe(false);
  });

  it('显式数据库上下文优先，未知和空库不会沿用旧的 PostgreSQL 库名', () => {
    expect(canInsertObjectIdentifier({ ...draft, databaseContext: { state: 'unknown' } }, postgres, 'source')).toBe(false);
    expect(canInsertObjectIdentifier({ ...draft, databaseContext: { state: 'known', database: null } }, postgres, 'fallback')).toBe(false);
    expect(canInsertObjectIdentifier({ ...draft, databaseContext: { state: 'known', database: 'actual' } }, postgres, 'actual')).toBe(true);
  });

  it.each(['mysql', 'mariadb'] as const)('%s 的同连接查询可以引用其它数据库', dialect => {
    expect(canInsertObjectIdentifier(draft, { ...postgres, dialect }, 'another')).toBe(true);
    expect(canInsertObjectIdentifier({ ...draft, kind: 'objects' }, { ...postgres, dialect }, 'another')).toBe(false);
    expect(canInsertObjectIdentifier(undefined, { ...postgres, dialect }, 'another')).toBe(false);
  });
});
