import { describe, expect, it } from 'vitest';
import { queryViewDefinition } from '../../src/renderer/queryViewDraft';

describe('从查询编辑器生成普通视图草稿', () => {
  it.each(['sqlite', 'mysql', 'mariadb', 'postgresql'] as const)('%s 取光标所在的单条查询', dialect => {
    const selected = "SELECT 'a;😀' AS value";
    const script = 'SELECT 1;\n' + selected + ';\nSELECT 3;';
    expect(queryViewDefinition(script, dialect, script.indexOf(' AS '))).toBe(selected + '\n');
    expect(() => queryViewDefinition(script, dialect)).toThrow();
  });

  it.each(['sqlite', 'mysql', 'mariadb', 'postgresql'] as const)('%s 保留 CTE、引号及末尾行注释', dialect => {
    const source = "WITH source AS (SELECT ';' AS note) SELECT note AS \"INTO\" FROM source -- 末尾分号;";
    expect(queryViewDefinition(source, dialect)).toBe(source + '\n');
  });

  it('SQLite 允许 CTE 查询调用 replace 函数', () => {
    const query = "WITH first AS (VALUES ('a')), second(value) AS (SELECT * FROM first) SELECT replace(value, 'a', 'b') FROM second";
    expect(queryViewDefinition(query, 'sqlite')).toBe(query + '\n');
  });

  it.each([
    ['sqlite', 'SELECT ?1'],
    ['sqlite', 'SELECT :sample'],
    ['sqlite', 'WITH sample AS (SELECT 1) UPDATE data SET id = 1'],
    ['mysql', 'SELECT :sample'],
    ['mysql', "SELECT 1 INTO OUTFILE '/tmp/sample'"],
    ['mariadb', 'SELECT ?'],
    ['postgresql', 'SELECT $1'],
    ['postgresql', 'SELECT 1 INTO sample'],
    ['postgresql', 'WITH changes AS (DELETE FROM data RETURNING id) SELECT id FROM changes'],
  ] as const)('%s 拒绝不能作为普通视图的语句 %s', (dialect, source) => {
    expect(() => queryViewDefinition(source, dialect)).toThrow();
  });
});
