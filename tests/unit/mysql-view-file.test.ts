import { describe, expect, it } from 'vitest';
import { exportMysqlViewFileQuery, mysqlViewDraftQuery, mysqlNewViewHeader, mysqlViewFileQuery, replaceMysqlViewFileQuery } from '../../src/shared/mysqlViewFile';

describe('MySQL 和 MariaDB 视图文件草稿', () => {
  it('在单条 CTE 中保留注释、字符串和原始换行，名称独立引用', () => {
    const query = "-- 定义\nWITH q AS (SELECT ';?' AS `列`) SELECT `列` FROM q -- 尾注释";
    expect(mysqlViewFileQuery(query + '\n;')).toBe(query);
    expect(mysqlNewViewHeader('原.库', '带`` 名')).toBe('CREATE VIEW `原.库`.`带```` 名` AS\n');
  });

  it('替换查询时按词法定位 AS 和 CHECK OPTION，保留目标、列清单和安全属性', () => {
    const head = 'CREATE OR REPLACE ALGORITHM=MERGE DEFINER=`AS`@`%` SQL SECURITY INVOKER VIEW `库`.`视图` (`old`) AS';
    const ddl = head + " SELECT 'WITH CHECK OPTION' AS `old` WITH LOCAL CHECK OPTION";
    const query = mysqlViewFileQuery("SELECT 'new' AS old -- 新定义\n;");
    expect(replaceMysqlViewFileQuery(ddl, '库', '视图', query))
      .toBe(head + "\nSELECT 'new' AS old -- 新定义\nWITH LOCAL CHECK OPTION\n;");
  });

  it.each([
    'SELECT 1; DROP VIEW v',
    'DELIMITER $$\nSELECT 1$$',
    'SELECT 1 INTO OUTFILE \'/tmp/example\'',
    'SELECT ? AS value',
    'SELECT :arg AS value',
    'SELECT 1 /*! UNION SELECT 2 */',
    'SELECT 1 /*M! UNION SELECT 2 */',
    'SELECT id FROM t WITH CHECK OPTION',
    'WITH q AS (SELECT 1) DELETE FROM t',
    'SELECT 1; /* 未关闭注释',
    'CREATE VIEW v AS SELECT 1',
    "SELECT 'escape\\' AS x",
  ])('拒绝无法限定为一条定义查询的文件 %s', sql => {
    expect(() => mysqlViewFileQuery(sql)).toThrow(/视图|SQL 文件/);
  });

  it('从完整草稿另存可再次载入的查询，保留末尾注释并剥离定义属性', () => {
    const head = 'ALTER ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `库`.`视图` (`列`) AS';
    const query = "SELECT 'WITH CHECK OPTION' -- 草稿";
    const saved = exportMysqlViewFileQuery(head + '\n' + query + '\nWITH LOCAL CHECK OPTION;', '库', '视图');
    expect(saved).toBe(query + '\n;');
    expect(mysqlViewFileQuery(saved)).toBe(query);
    expect(() => exportMysqlViewFileQuery(head + ' SELECT 1 INTO @v', '库', '视图')).toThrow(/SQL 文件/);
    expect(() => exportMysqlViewFileQuery(head + ' SELECT 1', '库', '另一视图')).toThrow(/无法确认/);
  });

  it('拒绝不匹配的库、目标名和额外语句', () => {
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `别库`.`视图` AS SELECT 1', '库', '视图', 'SELECT 2')).toThrow(/无法确认/);
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `同名` AS SELECT 1; SELECT 2', '库', '同名', 'SELECT 2')).toThrow(/无法确认/);
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `别名` AS SELECT 1', '库', '视图', 'SELECT 2')).toThrow(/无法确认/);
  });
});

describe('MySQL 和 MariaDB 视图查询提取', () => {
  const input = { connectionId: 'connection', database: '库', name: '视图', mode: 'rows' as const };
  it('保留 CTE、显式列名、排序和分页，去掉 DDL 与 CHECK OPTION', () => {
    const query = 'WITH c AS (SELECT 1 AS n) SELECT n, n FROM c ORDER BY n LIMIT 3';
    const sql = 'ALTER ALGORITHM=MERGE DEFINER=CURRENT_USER() SQL SECURITY INVOKER VIEW `库`.`视图` (`甲`, `乙`) AS\n' +
      query + '\nWITH LOCAL CHECK OPTION;';
    expect(mysqlViewDraftQuery({ ...input, sql }, false, false)).toEqual({ query, aliases: ['甲', '乙'] });
  });

  it('按原连接的 ANSI_QUOTES 和 NO_BACKSLASH_ESCAPES 解读视图及查询', () => {
    const sql = `CREATE VIEW "视图" AS SELECT '\\' AS c;`;
    expect(mysqlViewDraftQuery({ ...input, sql }, true, true).query).toBe(`SELECT '\\' AS c`);
    expect(() => mysqlViewDraftQuery({ ...input, sql }, false, false)).toThrow(/无法确认/);
  });

  it.each([
    'CREATE VIEW `别库`.`视图` AS SELECT 1',
    'CREATE VIEW `视图` AS SELECT 1; DROP VIEW `视图`',
    'CREATE VIEW `视图` AS SELECT 1 INTO DUMPFILE \'tmp\'',
    'CREATE VIEW `视图` AS SELECT (@v := 1)',
    'CREATE VIEW `视图` AS SELECT 1 /*M! INTO OUTFILE \'tmp\' */',
    'CREATE VIEW `视图` AS WITH c AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM c)',
  ])('拒绝目标不符或非只读定义 %s', sql => {
    expect(() => mysqlViewDraftQuery({ ...input, sql }, false, false)).toThrow(/无法确认|视图预览需要/);
  });
});
