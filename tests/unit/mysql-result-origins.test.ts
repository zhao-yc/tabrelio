import type { FieldPacket } from 'mysql2';
import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import { MysqlResultOrigins, captureMysqlResultOrigins } from '../../src/engine/mysqlResultOrigins';
import { SessionObjects } from '../../src/engine/sessionObjects';

const field = (name: string, database: string, table: string, column: string) =>
  ({ name, schema: database, table: 'alias', orgTable: table, orgName: column }) as FieldPacket;
const result = (fields: FieldPacket[]): QueryResult => ({ columns: fields.map((field, index) =>
  ({ key: 'c' + index, name: field.name, type: 'LONG' })), rows: [], statement: '', truncated: false, elapsedMs: 0 });

describe('MySQL 查询结果列来源', () => {
  it('按协议原库表及字段区分别名，标记临时和未确认来源', () => {
    const directory = new SessionObjects(1);
    directory.observe('CREATE TEMPORARY TABLE Temp (id INT)', 'DB', { ansiQuotes: false, noBackslashEscapes: false }, 'mysql');
    const fields = [field('重复', 'db', 'temp', 'id'), field('重复', 'second', 'base', 'code'), field('表达式', '', '', '')];
    expect(captureMysqlResultOrigins(fields, directory.snapshot(), true)).toEqual([
      { database: 'db', table: 'temp', column: 'id', scope: 'temporary' },
      { database: 'second', table: 'base', column: 'code', scope: 'catalog' }, null,
    ]);
    directory.invalidate();
    expect(captureMysqlResultOrigins(fields, directory.snapshot(), true).map(origin => origin?.scope)).toEqual(['unverified', 'unverified', undefined]);
  });

  it('只交付原执行已发布的结果集，行数据预算保持独立', () => {
    const fields = [field('别名', 'db', 't', 'id')], first = result(fields), discarded = result(fields), second = result(fields);
    const origins = new MysqlResultOrigins(), directory = new SessionObjects(0).snapshot();
    origins.record(first, fields, directory, true);
    origins.record(discarded, fields, directory, true);
    expect(origins.finish([first, second], false)).toEqual([[{ database: 'db', table: 't', column: 'id', scope: 'unverified' }], null]);
    expect(origins.finish([second], true)).toBeUndefined();
  });

  it('来源跳转只接收原会话和结果坐标', () => {
    const request = { connectionId: 'c', sessionId: 's', taskId: 'read', executionId: 'query', resultIndex: 0, columnIndex: 1 };
    expect(validateCommand('mysql.resultOriginOpen', request)).toEqual(request);
    for (const extra of [{ database: 'other' }, { table: 't' }, { column: 'id' }, { resultIndex: 200 }, { columnIndex: 4096 }])
      expect(() => validateCommand('mysql.resultOriginOpen', { ...request, ...extra })).toThrow();
  });
});
