import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FieldPacket } from 'mysql2';
import type { ManagedConnection } from '../../src/engine/connection';
import type { QueryResult, TableInfo } from '../../src/shared/contracts';
import { mysqlQueryEditRowDigest, mysqlQueryRelationSelect, mysqlQueryRelationSource, mysqlQueryRelationTarget } from '../../src/engine/mysqlQueryRelation';
import { SessionObjects } from '../../src/engine/sessionObjects';
import { buildChanges } from '../../src/engine/sql';
import { validateCommand } from '../../src/shared/validation';

const mode = { noBackslashEscapes: false, ansiQuotes: false };
const target = (sql: string) => mysqlQueryRelationTarget(sql, mode, 'mysql');
const result = { columns: [{ key: 'c0', name: '编号', type: 'LONGLONG' }, { key: 'c1', name: '名称', type: 'VARCHAR' }],
  rows: [{ c0: '9007199254740993', c1: '原值' }], truncated: false, elapsedMs: 0, statement: '' } satisfies QueryResult;
const fields = [{ schema: 'db', orgTable: 't', orgName: 'id', flags: 2 },
  { schema: 'db', orgTable: 't', orgName: 'label', flags: 0 }] as FieldPacket[];

describe('MySQL 查询关联原行', () => {
  it('只接受单表直接投影，真实来源由协议与原 SQL 共同核对', () => {
    expect(target('SELECT a.id AS 编号, a.label FROM `库.甲`.t AS a WHERE a.id=1 ORDER BY a.id'))
      .toEqual({ database: '库.甲', table: 't' });
    for (const sql of ['SELECT DISTINCT id FROM t', 'SELECT id FROM t JOIN u USING(id)', 'SELECT id FROM t, u',
      'SELECT id FROM t UNION SELECT id FROM u', 'SELECT id+1 AS id FROM t', 'SELECT id FROM t /*! FOR UPDATE */',
      'SELECT id FROM t INTO OUTFILE \'tmp\'', 'SELECT id FROM t WHERE @x:=id', 'SELECT id FROM t; SELECT 1'])
      expect(target(sql)).toBeUndefined();
  });

  it('临时表遮蔽或协议指向不同表时不提供回查', () => {
    const objects = new SessionObjects(0), managed = { queryRowContext: 'context', sessionObjects: objects } as ManagedConnection;
    const relation = { database: 'db', table: 't' };
    expect(mysqlQueryRelationSource(managed, relation, fields, result, 'run')?.columns).toEqual(['id', 'label']);
    expect(mysqlQueryRelationSource(managed, { ...relation, table: 'view' }, fields, result, 'run')).toBeUndefined();
    objects.observe('CREATE TEMPORARY TABLE t (id INT)', 'db', mode, 'mysql');
    expect(mysqlQueryRelationSource(managed, relation, fields, result, 'run')).toBeUndefined();
  });

  it('按完整主键精确绑定并重新核对原字段，SQL 入口拒绝调用方值和表名', () => {
    const info = { database: 'db', name: 't', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'],
      columns: [{ name: 'id', type: 'bigint' }, { name: 'label', type: 'varchar(50)' }] } as TableInfo;
    const source = { executionId: 'run', context: 'context', database: 'db', table: 't', columns: ['id', 'label'], result };
    const select = mysqlQueryRelationSelect(source, info, 0);
    expect(select.sql).toContain(' AS DECIMAL(65,0)');
    const lock = mysqlQueryRelationSelect(source, info, 0, true);
    expect(lock.sql).toBe(select.sql + ' FOR UPDATE');
    expect(mysqlQueryRelationSelect(source, info, 0, 'share').sql).toBe(select.sql + ' LOCK IN SHARE MODE');
    expect(lock.searchKey.params).toEqual(['9007199254740993', '9007199254740993']);
    const page = { rows: [{ id: '9007199254740993', label: '原值' }], columns: [], page: 1, pageSize: 1, hasMore: false };
    expect(select.verify(page)).toEqual(page.rows[0]);
    expect(() => select.verify({ ...page, rows: [{ ...page.rows[0], label: '已修改' }] })).toThrow(/无法核验/);
    expect(() => mysqlQueryRelationSelect(source, { ...info, primaryKey: ['id', 'other'] }, 0)).toThrow(/无法核验/);
    const request = { connectionId: 'conn', sessionId: 'session', executionId: 'run', taskId: 'read', rowIndex: 0 };
    expect(validateCommand('mysql.queryRelation', request)).toEqual(request);
    for (const extra of [{ table: 't' }, { values: ['1'] }, { sql: 'SELECT id FROM t' }, { rowIndex: -1 }])
      expect(() => validateCommand('mysql.queryRelation', { ...request, ...extra })).toThrow();
    expect(validateCommand('mysql.queryRecordEdit', request)).toEqual(request);
    expect(validateCommand('mysql.queryRecordEdit', { ...request, columnIndex: 0 })).toEqual({ ...request, columnIndex: 0 });
    for (const extra of [{ table: 't' }, { column: 'label' }, { columnIndex: -1 }, { columnIndex: 1.5 }])
      expect(() => validateCommand('mysql.queryRecordEdit', { ...request, ...extra })).toThrow();
    expect(() => validateCommand('mysql.queryRelation', { ...request, columnIndex: 0 })).toThrow();
  });

  it('编辑只接纳更新并核对未投影字段的完整原值', () => {
    const info = { columns: [{ name: 'id' }, { name: 'guard' }] } as TableInfo;
    const before = { id: '9007199254740993', guard: 1.0000000000000002 };
    expect(mysqlQueryEditRowDigest(info, before)).toBe(mysqlQueryEditRowDigest(info, { guard: before.guard, id: before.id }));
    expect(mysqlQueryEditRowDigest(info, before)).not.toBe(mysqlQueryEditRowDigest(info, { ...before, guard: 1.0000000000000004 }));
    expect(() => mysqlQueryEditRowDigest(info, { id: before.id })).toThrow();
    expect(() => mysqlQueryEditRowDigest(info, { ...before, extra: null })).toThrow();
    const update = { kind: 'update', before, values: { guard: 2 } };
    const input = { connectionId: 'conn', database: 'db', table: 't', queryRecord: { sessionId: 'session', token: randomUUID() }, changes: [update] };
    for (const command of ['table.preview', 'table.apply'] as const) {
      const request = command === 'table.apply' ? { ...input, taskId: 'submit', previewId: randomUUID() } : input;
      expect(validateCommand(command, request)).toEqual(request);
      for (const extra of [{ changes: Array.from({ length: 101 }, () => update) }, { changes: [{ kind: 'insert', values: { id: '1' } }] },
        { changes: [{ ...update, values: {} }] }, { searchRecordRef: randomUUID() }, { queryRecord: { ...input.queryRecord, table: 'forged' } }])
        expect(() => validateCommand(command, { ...request, ...extra })).toThrow();
    }
  });

  it('矩形编辑保留各原行的精确键并拒绝重复行列序号', () => {
    const request = { connectionId: 'conn', sessionId: 'session', executionId: 'run', taskId: 'read', rowIndices: [3, 0], columnIndices: [2, 1] };
    expect(validateCommand('mysql.queryBatchEdit', request)).toEqual(request);
    for (const extra of [{ rowIndices: [3, 3] }, { columnIndices: [2, 2] }, { rowIndex: 3 }, { table: 't' }])
      expect(() => validateCommand('mysql.queryBatchEdit', { ...request, ...extra })).toThrow();
    const info = { database: 'db', name: 't', engine: 'InnoDB', editableKey: ['id'],
      columns: [{ name: 'id', type: 'BIGINT' }, { name: 'v', type: 'VARCHAR(20)' }] } as TableInfo;
    const ids = ['9007199254740993', '9007199254740992'];
    const changes = ids.map(id => ({ kind: 'update' as const, before: { id, v: '原值' }, values: { v: '新值' } }));
    const searchKeys = ids.map(id => ({ sql: '`id` = CAST(? AS DECIMAL(65,0))', params: [id] }));
    expect(buildChanges(info, changes, { searchKeys }).statements.map(item => item.params)).toEqual(ids.map(id => ['新值', id, '原值']));
    expect(() => buildChanges(info, changes, { searchKeys: searchKeys.slice(1) })).toThrow('批量写入定位不完整');
  });

  it('删除请求按勾选行签发，预览与提交都拒绝混合操作和跨模式令牌', () => {
    const scope = { connectionId: 'conn', sessionId: 'session', executionId: 'run', taskId: 'read', rowIndices: [3, 0] };
    const deletion = { ...scope, operation: 'delete' };
    expect(validateCommand('mysql.queryBatchEdit', deletion)).toEqual(deletion);
    for (const extra of [{ columnIndices: [1] }, { rowIndices: [] }, { rowIndices: [0, 0] }, { operation: 'update' }])
      expect(() => validateCommand('mysql.queryBatchEdit', { ...deletion, ...extra })).toThrow();
    const change = { kind: 'delete', before: { id: '9007199254740993' } };
    const queryRecord = { sessionId: scope.sessionId, token: randomUUID(), operation: 'delete' };
    for (const command of ['table.preview', 'table.apply'] as const) {
      const request = { connectionId: scope.connectionId, database: 'db', table: 't', queryRecord, changes: [change],
        ...(command === 'table.apply' ? { taskId: 'apply', previewId: randomUUID() } : {}) };
      expect(validateCommand(command, request)).toEqual(request);
      expect(() => validateCommand(command, { ...request, queryRecord: { sessionId: scope.sessionId, token: queryRecord.token } })).toThrow();
      expect(() => validateCommand(command, { ...request, changes: [change, { ...change, kind: 'update', values: { id: '1' } }] })).toThrow();
    }
  });

  it('查询副本只允许明确授权的 INSERT，并允许全默认值草稿', () => {
    const scope = { connectionId: 'conn', sessionId: 'session', executionId: 'run', taskId: 'read', rowIndices: [3, 0], operation: 'insert' };
    expect(validateCommand('mysql.queryBatchEdit', scope)).toEqual(scope);
    expect(() => validateCommand('mysql.queryBatchEdit', { ...scope, columnIndices: [0] })).toThrow();
    const ref = { sessionId: scope.sessionId, token: randomUUID(), operation: 'insert' };
    const input = { connectionId: scope.connectionId, database: 'db', table: 't', queryRecord: ref, changes: [{ kind: 'insert', values: {} }] };
    expect(validateCommand('table.preview', input)).toEqual(input);
    expect(() => validateCommand('table.preview', { ...input, queryRecord: { ...ref, operation: 'delete' } })).toThrow();
  });
});
