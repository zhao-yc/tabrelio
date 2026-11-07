import { expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

it('PostgreSQL 角色目录只接受已保存连接、目录筛选和精确对象身份', () => {
  const base = {connectionId: 'saved', taskId: 'roles'};
  const list = {...base, kind: 'list', search: "'%;_ 真实搜索", after: '带空格的角色'};
  const detail = {...base, kind: 'detail', role: {oid: '4294967295', name: '角色🚢'}, scope: {schema: 'QA Scope', relation: "Sales'Row"}};
  expect(validateCommand('postgres.roles.read', list)).toEqual(list);
  expect(validateCommand('postgres.roles.read', detail)).toEqual(detail);
  for (const input of [{...list, sql: 'SELECT 1'}, {...list, profile: {id: 'saved'}}, {...detail, scope: {relation: 'x'}},
    {...detail, role: {...detail.role, oid: '4294967296'}}, {...detail, role: {...detail.role, name: 'x\0y'}}, {...list, after: ''}])
    expect(() => validateCommand('postgres.roles.read', input)).toThrow();
});
