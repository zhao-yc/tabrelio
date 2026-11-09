import { describe, expect, it } from 'vitest';
import { sqliteLastPagePosition, sqliteTablePageSchema } from '../../src/shared/sqliteTableBrowse';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';

const base = { connectionId: 'file', database: 'main', table: '中文"表🚢', taskId: 'read', offset: 0, limit: 100, mode: 'and', filters: [], sort: [] };
/** 严格IPC只接收结构化条件，不接受SQL或文件能力，也不会借用网络表协议。 */
describe('SQLite表浏览严格合同及动态类型条件', () => {
  it('查询副本只接受当前执行中唯一的原行序号', () => {
    const queryRecord = { sessionId: 'session', taskId: 'execution', operation: 'duplicate', rowIndices: [9, 2] };
    const input = { ...base, editing: true, limit: 2, queryRecord };
    expect(sqliteTablePageSchema.parse(input).queryRecord).toEqual(queryRecord);
    for (const patch of [{ editing: false }, { limit: 1 }, { queryRecord: { ...queryRecord, rowIndices: [9, 9] } },
      { queryRecord: { ...queryRecord, rowIndex: 0 } }, { queryRecord: { ...queryRecord, operation: 'insert' } }])
      expect(sqliteTablePageSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('查询新增只接受本次执行身份和编辑请求，不能夹带原行、筛选或分页', () => {
    const queryRecord = { sessionId: 'session', taskId: 'execution', operation: 'insert' };
    const input = { ...base, editing: true, limit: 1, queryRecord };
    expect(sqliteTablePageSchema.parse(input).queryRecord).toEqual(queryRecord);
    for (const patch of [{ editing: false }, { limit: 2 }, { offset: 1 }, { lastPage: true },
      { queryRecord: { ...queryRecord, rowIndex: 0 } }, { queryRecord: { ...queryRecord, rowIndices: [] } },
      { filters: [{ column: 'x', operator: 'isNull' }] }, { sort: [{ column: 'x', direction: 'asc' }] }])
      expect(sqliteTablePageSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('查询原记录批量读取只接收唯一原行序号和对应的准确数量', () => {
    const queryRecord = { sessionId: 'session', taskId: 'execution', rowIndices: [9, 2] };
    const selection = { ...base, editing: true, offset: 0, limit: 2, queryRecord };
    expect(sqliteTablePageSchema.parse(selection).queryRecord).toEqual(queryRecord);
    for (const patch of [{ limit: 1 }, { offset: 1 }, { editing: false }, { lastPage: true },
      { queryRecord: { ...queryRecord, rowIndex: 0 } },
      { queryRecord: { ...queryRecord, rowIndices: [9, 9] } },
      { queryRecord: { ...queryRecord, rowIndices: Array.from({ length: 101 }, (_, i) => i) }, limit: 101 }])
      expect(sqliteTablePageSchema.safeParse({ ...selection, ...patch }).success).toBe(false);
  });
  it('只公开明确main页请求，拒绝原始SQL/路径/凭据和其它数据库', () => {
    expect(publicCommands['sqlite.tablePage']).toBe(true); expect(validateCommand('sqlite.tablePage', base)).toEqual(base);
    for (const value of [{ ...base, database: 'other' }, { ...base, sql: 'DELETE FROM subject' }, { ...base, filePath: '外部文件' }, { ...base, profile: { dialect: 'sqlite' } }, { ...base, offset: -1 }, { ...base, offset: 1000000001 }, { ...base, limit: 1001 }]) expect(sqliteTablePageSchema.safeParse(value).success).toBe(false);
  });
  it('只读定位仅接受一个原查询行，不与其它行定位或筛选混用', () => {
    const queryRecord = { sessionId: 'session', taskId: 'execution', rowIndex: 9 };
    const selection = { ...base, limit: 1, queryRecord };
    expect(validateCommand('sqlite.tablePage', selection)).toEqual(selection);
    for (const patch of [{ limit: 2 }, { offset: 1 }, { searchRecordRef: 'd616897e-495d-4930-b36d-2dacbf2bf5bf' },
      { queryRecord: { sessionId: 'session', taskId: 'execution', rowIndices: [9] } },
      { filters: [{ column: 'x', operator: 'isNull' }] }, { queryRecord: { ...queryRecord, value: '猜测外键' } }])
      expect(sqliteTablePageSchema.safeParse({ ...selection, ...patch }).success).toBe(false);
  });
  it('末页仅接受明确模式，行数换算保留空集、整页和偏移边界', () => {
    expect(validateCommand('sqlite.tablePage', { ...base, lastPage: true })).toEqual({ ...base, lastPage: true });
    for (const patch of [{ offset: 1, lastPage: true }, { lastPage: false }, { matchingRows: '100', lastPage: true }]) expect(sqliteTablePageSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    expect(sqliteLastPagePosition('0', 5)).toEqual({ offset: 0, rows: 0 });
    expect(sqliteLastPagePosition('10', 5)).toEqual({ offset: 5, rows: 5 });
    expect(sqliteLastPagePosition('11', 5)).toEqual({ offset: 10, rows: 1 });
    expect(sqliteLastPagePosition('1000000001', 1)).toEqual({ offset: 1000000000, rows: 1 });
    expect(() => sqliteLastPagePosition('9223372036854775807', 5)).toThrow('偏移范围');
  });
  it('类型和值必须显式匹配，NULL无值、二进制完整字节，排序列唯一且有界', () => {
    for (const value of [{ column: 'x', operator: 'eq' }, { column: 'x', operator: 'isNull', value: { kind: 'text', value: '' } }, { column: 'x', operator: 'contains', value: { kind: 'integer', value: '1' } }, { column: 'x', operator: 'gt', value: { kind: 'blob', value: '00ff' } }, { column: 'x', operator: 'eq', value: { kind: 'blob', value: '0' } }]) expect(sqliteTablePageSchema.safeParse({ ...base, filters: [value] }).success).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, filters: [{ column: 'x', operator: 'isNull' }, { column: 'x', operator: 'eq', value: { kind: 'blob', value: '' } }] }).success).toBe(true);
    expect(sqliteTablePageSchema.safeParse({ ...base, sort: [{ column: 'x', direction: 'asc' }, { column: 'x', direction: 'desc' }] }).success).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, filters: Array.from({ length: 33 }, () => ({ column: 'x', operator: 'notNull' })) }).success).toBe(false);
  });
  it('有符号64位边界保留原文，有限REAL与有效Unicode受控，文本NUL仍为合法参数', () => {
    const check = (kind: string, value: string) => sqliteTablePageSchema.safeParse({ ...base, filters: [{ column: 'x', operator: 'eq', value: { kind, value } }] }).success;
    for (const value of ['9223372036854775807', '-9223372036854775808', '-0']) expect(check('integer', value)).toBe(true);
    for (const value of ['9223372036854775808', '-9223372036854775809', '1.0', '01', '9'.repeat(1000)]) expect(check('integer', value)).toBe(false);
    for (const value of ['-.5', '+1.25e2', '-0']) expect(check('real', value)).toBe(true);
    for (const value of ['Infinity', 'NaN', '1e999', '1;DROP TABLE x']) expect(check('real', value)).toBe(false);
    expect(check('text', '中文\0🚢')).toBe(true); expect(check('text', '\ud800')).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, table: '\udc00' }).success).toBe(false);
  });
});
