import { describe, expect, it } from 'vitest';
import type { FieldPacket } from 'mysql2';
import type { ManagedConnection } from '../../src/engine/connection';
import type { QueryResult, TableInfo } from '../../src/shared/contracts';
import { mysqlQueryRelationSelect, mysqlQueryRelationSource, mysqlQueryRelationTarget } from '../../src/engine/mysqlQueryRelation';
import { SessionObjects } from '../../src/engine/sessionObjects';
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
    const page = { rows: [{ id: '9007199254740993', label: '原值' }], columns: [], page: 1, pageSize: 1, hasMore: false };
    expect(select.verify(page)).toEqual(page.rows[0]);
    expect(() => select.verify({ ...page, rows: [{ ...page.rows[0], label: '已修改' }] })).toThrow(/无法核验/);
    expect(() => mysqlQueryRelationSelect(source, { ...info, primaryKey: ['id', 'other'] }, 0)).toThrow(/无法核验/);
    const request = { connectionId: 'conn', sessionId: 'session', executionId: 'run', taskId: 'read', rowIndex: 0 };
    expect(validateCommand('mysql.queryRelation', request)).toEqual(request);
    for (const extra of [{ table: 't' }, { values: ['1'] }, { sql: 'SELECT id FROM t' }, { rowIndex: -1 }])
      expect(() => validateCommand('mysql.queryRelation', { ...request, ...extra })).toThrow();
  });
});
