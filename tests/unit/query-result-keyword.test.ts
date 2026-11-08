import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultKeywordZh as text } from '../../src/renderer/locales/queryResultKeyword.zh-CN';
import { prepareQueryResultOrganization } from '../../src/renderer/queryResultHistory';
import { matchQueryResultKeyword, projectQueryResultKeyword, queryResultKeywordLimits } from '../../src/renderer/queryResultKeyword';

function result(rows: QueryResult['rows'], sqlite = false): QueryResult {
  return { columns: ['name', 'value'].map(key => ({ key, name: '同名', type: sqlite ? 'SQLITE' : 'VAR_STRING' })),
    rows, truncated: true, elapsedMs: 1, statement: 'SELECT fixture' };
}

describe('查询结果关键字筛选', () => {
  it('搜索可见列的完整标量原文，保持字面匹配、数值精度及原行身份', () => {
    const source = result([
      { name: '🚢'.repeat(200) + 'İtem%_', value: '9007199254740993' },
      { name: true, value: null }, { name: false, value: { type: 'binary', base64: 'aXRlbQ==' } },
      { name: 107, value: 'NULL' }, { name: 'ItemXY', value: 'item%_' },
    ]);
    const names = [source.columns[0]];
    expect([...matchQueryResultKeyword(source, names, 'İTEM%_')]).toEqual([source.rows[0]]);
    expect([...matchQueryResultKeyword(source, names, 'RUE')]).toEqual([source.rows[1]]);
    expect([...matchQueryResultKeyword(source, names, '07')]).toEqual([source.rows[3]]);
    expect([...matchQueryResultKeyword(source, source.columns, 'NULL')]).toEqual([source.rows[3]]);
    expect([...matchQueryResultKeyword(source, source.columns, '9007199254740993')]).toEqual([source.rows[0]]);
    expect([...matchQueryResultKeyword(source, names, 'aXRlbQ')]).toEqual([]);
  });

  it('保持现有排序、条件和 SQLite 逐行存储类型，也能返回零行', () => {
    const source = result([{ name: 'Hit', value: '2' }, { name: 'skip', value: '2' },
      { name: 'HIT', value: '2' }, { name: 'hit drop', value: '3' }], true);
    source.sqliteStorage = { version: 1, rows: ['ti', 'tt', 'tr', 'ti'] };
    const organization = prepareQueryResultOrganization(source, [], source.columns, {
      expression: { mode: 'AND', children: [{ column: 'name', sqliteType: 'text', operator: 'notContains', value: 'drop' }] },
      sort: [{ column: 'name', direction: 'ASC' }],
    });
    const organized = organization.sorter.view(organization.sortBinding)!.result;
    const matches = matchQueryResultKeyword(source, source.columns, 'hit');
    const visible = projectQueryResultKeyword(organized, matches);
    expect(visible.rows[0]).toBe(source.rows[2]);
    expect(visible.rows[1]).toBe(source.rows[0]);
    expect(visible.sqliteStorage?.rows).toEqual(['tr', 'ti']);
    expect(visible.truncated).toBe(true);
    expect(visible.statement).toBe(source.statement);
    expect(organized.sqliteStorage?.rows).toEqual(['tr', 'ti', 'tt']);
    expect(projectQueryResultKeyword(organized, new Set()).sqliteStorage?.rows).toEqual([]);
  });

  it('拒绝超出预算的快照或关键字，不调用单元格访问器', () => {
    const source = result([{ name: 'x'.repeat(queryResultKeywordLimits.units + 1), value: null }]);
    expect(() => matchQueryResultKeyword(source, source.columns, 'x')).toThrow(text.budget);
    expect(() => matchQueryResultKeyword(source, source.columns, 'x'.repeat(queryResultKeywordLimits.needle + 1))).toThrow(text.budget);
    expect(() => matchQueryResultKeyword({ ...source, rows: new Array(queryResultKeywordLimits.cells) }, source.columns, 'x')).toThrow(text.budget);
    const row = Object.defineProperty({}, 'name', { get: () => { throw Error('不应执行访问器'); } });
    expect(() => matchQueryResultKeyword({ ...source, rows: [row] }, source.columns, 'x')).toThrow(text.invalid);
  });
});
