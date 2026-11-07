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

it('成员变更只接受明确目标和一次性确认，禁止渲染进程提供 SQL 或撤销模式', () => {
  const member = {oid: '101', name: '成员'}, role = {oid: '102', name: '授权角色'};
  const grantor = {oid: '10', name: 'postgres'};
  const base = {connectionId: 'saved', database: 'postgres'};
  const grant = {...base, action: 'grant', member, roleName: role.name, options: {admin: false, inherit: true, set: false}};
  const revoke = {...base, action: 'revoke', member, role, grantor};
  const apply = {...base, token: '0550f154-5fc9-4447-a835-fd56f9e9a17f', confirmed: true};
  expect(validateCommand('postgres.roles.membership.preview', grant)).toEqual(grant);
  expect(validateCommand('postgres.roles.membership.preview', revoke)).toEqual(revoke);
  expect(validateCommand('postgres.roles.membership.apply', apply)).toEqual(apply);
  for (const input of [{...grant, sql: 'SELECT 1'}, {...revoke, cascade: true}, {...revoke, grantor: undefined}, {...grant, options: {admin: true}}])
    expect(() => validateCommand('postgres.roles.membership.preview', input)).toThrow();
  for (const input of [{...apply, confirmed: false}, {...apply, token: ''}, {...apply, role}])
    expect(() => validateCommand('postgres.roles.membership.apply', input)).toThrow();
});

it('角色创建预览拒绝密码，创建确认拒绝外来 SQL 和超预算凭据', () => {
  const draft = {connectionId: 'saved', name: '项目 "读者"', auth: 'password', inherit: true, createDatabase: false,
    createRole: false, superuser: false, replication: false, bypassRls: false, connectionLimit: 4, validUntil: '2098-06-07T08:09:00.000Z'};
  expect(validateCommand('postgres.roles.create.preview', draft)).toEqual(draft);
  for (const value of [{...draft, password: '合成输入'}, {...draft, auth: 'external'}, {...draft, name: 'pg_system'},
    {...draft, name: '界'.repeat(22)}, {...draft, connectionLimit: -2}])
    expect(() => validateCommand('postgres.roles.create.preview', value)).toThrow();
  const apply = {connectionId: 'saved', token: '0550f154-5fc9-4447-a835-fd56f9e9a17f', confirmed: true, password: '合成密码'};
  expect(validateCommand('postgres.roles.create.apply', apply)).toEqual(apply);
  for (const value of [{...apply, password: '界'.repeat(342)}, {...apply, password: 'x\0y'}, {...apply, sql: 'SELECT 1'}, {...apply, confirmed: false}])
    expect(() => validateCommand('postgres.roles.create.apply', value)).toThrow();
});
