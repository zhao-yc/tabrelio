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

it('登录密码轮换预览只接受原角色身份，确认只接受一次性令牌和非空密码', () => {
  const draft = {connectionId: 'saved', database: 'postgres', role: {oid: '42', name: '原登录角色'}};
  const apply = {connectionId: draft.connectionId, database: draft.database, token: '0550f154-5fc9-4447-a835-fd56f9e9a17f',
    confirmed: true, password: '合成密码'};
  expect(validateCommand('postgres.roles.password.preview', draft)).toEqual(draft);
  expect(validateCommand('postgres.roles.password.apply', apply)).toEqual(apply);
  for (const value of [{...draft, password: apply.password}, {...draft, role: {...draft.role, oid: '0'}},
    {...draft, sql: 'ALTER ROLE CURRENT_USER PASSWORD NULL'}])
    expect(() => validateCommand('postgres.roles.password.preview', value)).toThrow();
  for (const value of [{...apply, password: undefined}, {...apply, password: ''}, {...apply, password: '界'.repeat(342)},
    {...apply, confirmed: false}, {...apply, role: draft.role}, {...apply, validUntil: 'infinity'}])
    expect(() => validateCommand('postgres.roles.password.apply', value)).toThrow();
});

it('表权限预览绑定实际对象和角色，只接受去重的权限白名单和明确动作', () => {
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '受权者'},
    table: {oid: '100', schema: '带 空格', name: '含"引号'}, action: 'revokeOption', privileges: ['SELECT', 'INSERT']};
  expect(validateCommand('postgres.roles.tablePrivileges.preview', draft)).toEqual(draft);
  for (const input of [{...draft, sql: 'GRANT ALL'}, {...draft, cascade: true}, {...draft, database: undefined},
    {...draft, privileges: ['ALL']}, {...draft, privileges: ['SELECT', 'SELECT']}, {...draft, table: {...draft.table, oid: '0'}}])
    expect(() => validateCommand('postgres.roles.tablePrivileges.preview', input)).toThrow();
  const apply = {connectionId: 'saved', database: 'qa', token: '0550f154-5fc9-4447-a835-fd56f9e9a17f', confirmed: true};
  expect(validateCommand('postgres.roles.tablePrivileges.apply', apply)).toEqual(apply);
  expect(() => validateCommand('postgres.roles.tablePrivileges.apply', {...apply, privileges: ['SELECT']})).toThrow();
});

it('数据库和 Schema 授权只能使用各自的权限，数据库目标绑定当前库', () => {
  const draft = {connectionId: 'saved', database: '租户 QA', role: {oid: '42', name: '受权者'}, action: 'grantOption'};
  const database = {...draft, object: {kind: 'database', oid: '101', name: draft.database}, privileges: ['CONNECT', 'TEMPORARY']};
  const schema = {...draft, object: {kind: 'schema', oid: '102', name: '数据"区'}, privileges: ['USAGE', 'CREATE']};
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', database)).toEqual(database);
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', schema)).toEqual(schema);
  for (const input of [{...database, privileges: ['USAGE']}, {...schema, privileges: ['CONNECT']}, {...schema, privileges: ['CREATE', 'CREATE']},
    {...database, object: {...database.object, name: '其他数据库'}}, {...schema, sql: 'GRANT ALL'}, {...schema, cascade: true}])
    expect(() => validateCommand('postgres.roles.scopedPrivileges.preview', input)).toThrow();
});

it('列授权绑定关系和属性编号，只接受明确且互异的列与权限组合', () => {
  const column = {number: 3, name: '公开 "标题"'};
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '读者'},
    table: {oid: '100', schema: 'public', name: '文档'}, action: 'revokeOption',
    changes: [{column, privilege: 'SELECT'}, {column, privilege: 'UPDATE'}]};
  expect(validateCommand('postgres.roles.columnPrivileges.preview', draft)).toEqual(draft);
  for (const value of [{...draft, changes: []}, {...draft, changes: [draft.changes[0], draft.changes[0]]},
    {...draft, changes: [{column, privilege: 'DELETE'}]}, {...draft, changes: [{column: {...column, number: 0}, privilege: 'SELECT'}]},
    {...draft, sql: 'GRANT ALL'}]) expect(() => validateCommand('postgres.roles.columnPrivileges.preview', value)).toThrow();
  const detail = {connectionId: 'saved', taskId: 'read', kind: 'detail', role: draft.role,
    scope: {schema: 'public', relation: '文档', columns: {relationOid: '100', after: 3}}};
  expect(validateCommand('postgres.roles.read', detail)).toEqual(detail);
  expect(() => validateCommand('postgres.roles.read', {...detail, scope: {...detail.scope, relation: undefined}})).toThrow();
});

it('序列授权只接受精确 Schema、序列 OID 和序列权限', () => {
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '应用角色'}, action: 'grant',
    object: {kind: 'sequence', schema: '租户 QA', oid: '102', name: '订单"编号'}, privileges: ['USAGE', 'SELECT', 'UPDATE']};
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', draft)).toEqual(draft);
  for (const input of [{...draft, privileges: ['CREATE']}, {...draft, privileges: ['USAGE', 'USAGE']},
    {...draft, object: {...draft.object, schema: undefined}}, {...draft, object: {...draft.object, oid: '0'}},
    {...draft, object: {...draft.object, kind: 'schema'}}, {...draft, cascade: true}])
    expect(() => validateCommand('postgres.roles.scopedPrivileges.preview', input)).toThrow();
});

it('例程授权只接受 OID 和 EXECUTE，PUBLIC 不能获得转授选项', () => {
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '应用角色'}, action: 'revoke',
    object: {kind: 'routine', schema: '租户 QA', oid: '102', name: '同名例程'}, privileges: ['EXECUTE']};
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', draft)).toEqual(draft);
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', {...draft, recipient: 'public'})).toEqual({...draft, recipient: 'public'});
  for (const input of [{...draft, privileges: ['USAGE']}, {...draft, recipient: 'public', action: 'grantOption'},
    {...draft, recipient: 'public', action: 'revokeOption'}, {...draft, recipient: 'PUBLIC'},
    {...draft, object: {...draft.object, signature: 'foo(int)'}}])
    expect(() => validateCommand('postgres.roles.scopedPrivileges.preview', input)).toThrow();
  const read = {connectionId: 'saved', taskId: 'read', kind: 'detail', role: draft.role,
    scope: {schema: draft.object.schema, routine: draft.object.name}};
  expect(validateCommand('postgres.roles.read', read)).toEqual(read);
  expect(() => validateCommand('postgres.roles.read', {...read, scope: {...read.scope, relation: 'relation'}})).toThrow();
});

it('数据库和 Schema 的 PUBLIC 只允许授予和撤销适用权限', () => {
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '应用角色'}, action: 'revoke', recipient: 'public'};
  const database = {...draft, object: {kind: 'database', oid: '101', name: 'qa'}, privileges: ['CONNECT', 'TEMPORARY']};
  const schema = {...draft, object: {kind: 'schema', oid: '102', name: 'public'}, privileges: ['USAGE', 'CREATE']};
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', database)).toEqual(database);
  expect(validateCommand('postgres.roles.scopedPrivileges.preview', {...schema, action: 'grant'})).toEqual({...schema, action: 'grant'});
  for (const input of [{...database, action: 'grantOption'}, {...schema, action: 'revokeOption'}, {...database, privileges: ['USAGE']},
    {...schema, privileges: ['CONNECT']}, {...database, object: {...database.object, name: 'other'}}])
    expect(() => validateCommand('postgres.roles.scopedPrivileges.preview', input)).toThrow();
});

it('表、列和序列的 PUBLIC 只接受普通授予及撤销', () => {
  const base = {connectionId: 'saved', database: 'qa', role: {oid: '42', name: '应用角色'}, action: 'grant', recipient: 'public'};
  const table = {oid: '101', schema: 'qa', name: 'record'};
  const entries = [
    ['postgres.roles.tablePrivileges.preview', {...base, table, privileges: ['SELECT']}],
    ['postgres.roles.columnPrivileges.preview', {...base, table, changes: [{column: {number: 1, name: 'id'}, privilege: 'SELECT'}]}],
    ['postgres.roles.scopedPrivileges.preview', {...base, object: {...table, kind: 'sequence'}, privileges: ['USAGE']}],
  ] as const;
  for (const [command, draft] of entries) {
    expect(validateCommand(command, draft)).toEqual(draft);
    expect(validateCommand(command, {...draft, action: 'revoke'})).toEqual({...draft, action: 'revoke'});
    for (const input of [{...draft, action: 'grantOption'}, {...draft, action: 'revokeOption'}, {...draft, recipient: 'PUBLIC'}])
      expect(() => validateCommand(command, input)).toThrow();
  }
});

it('角色属性修改绑定角色和原属性摘要，仅接收明确可编辑字段', () => {
  const draft = {connectionId: 'saved', database: 'qa', role: {oid: '102', name: '现有角色'}, stamp: 'a'.repeat(64),
    patch: {login: false, inherit: false, connectionLimit: 4, validUntil: '2098-06-07T08:09:00.000Z'}};
  expect(validateCommand('postgres.roles.attributes.preview', draft)).toEqual(draft);
  expect(validateCommand('postgres.roles.attributes.preview', {...draft, patch: {validUntil: 'infinity'}})).toMatchObject({patch: {validUntil: 'infinity'}});
  for (const input of [{...draft, stamp: 'x'}, {...draft, patch: {}}, {...draft, patch: {connectionLimit: -2}},
    {...draft, patch: {validUntil: '-infinity'}}, {...draft, patch: {password: '合成密码'}}, {...draft, sql: 'ALTER ROLE r NOLOGIN'}])
    expect(() => validateCommand('postgres.roles.attributes.preview', input)).toThrow();
  expect(() => validateCommand('postgres.roles.attributes.apply', {connectionId: 'saved', database: 'qa',
    token: '0550f154-5fc9-4447-a835-fd56f9e9a17f', confirmed: true, patch: draft.patch})).toThrow();
});
