import { describe, expect, it } from 'vitest';
import { sqliteViewReferences } from '../../src/shared/viewReferences';

const main = (...tables: string[]) => tables.map(table => ({ database: 'main', table }));

describe('SQLite 已保存视图的直接引用', () => {
  it('按 SQLite 同级作用域处理前向 CTE、VALUES 与物化提示', () => {
    expect(sqliteViewReferences(`
      WITH a AS NOT MATERIALIZED (SELECT * FROM B),
           b AS MATERIALIZED (VALUES ((SELECT id FROM "源表"))),
           unused AS (SELECT id FROM main.[a])
      SELECT * FROM a
    `)).toEqual(main('源表', 'a'));
  });

  it('保留嵌套查询与 SQLite 引号规则，不从字符串或注释推断表名', () => {
    expect(sqliteViewReferences(`
      SELECT (SELECT x FROM '单引号表'), '-- FROM unknown'
      FROM [主.表] AS p INDEXED BY [索引]
      FULL OUTER JOIN (SELECT x FROM \`其他表\` NOT INDEXED) AS q ON p.x = q.x
      --FROM hidden
    `)).toEqual(main('单引号表', '主.表', '其他表'));
  });

  it('拒绝关系边界未知的表值函数、参数和批处理', () => {
    expect(() => sqliteViewReferences("SELECT * FROM json_each('[]')")).toThrow('视图表函数');
    expect(() => sqliteViewReferences('SELECT :arg FROM t')).toThrow();
    expect(() => sqliteViewReferences('SELECT 1; SELECT * FROM t')).toThrow();
  });
});
