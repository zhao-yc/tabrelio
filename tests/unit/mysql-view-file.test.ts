import { describe, expect, it } from 'vitest';
import { mysqlNewViewHeader, mysqlViewFileQuery, replaceMysqlViewFileQuery } from '../../src/shared/mysqlViewFile';

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

  it('拒绝不匹配的库、目标名和额外语句', () => {
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `别库`.`视图` AS SELECT 1', '库', '视图', 'SELECT 2')).toThrow(/无法确认/);
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `同名` AS SELECT 1; SELECT 2', '库', '同名', 'SELECT 2')).toThrow(/无法确认/);
    expect(() => replaceMysqlViewFileQuery('CREATE VIEW `别名` AS SELECT 1', '库', '视图', 'SELECT 2')).toThrow(/无法确认/);
  });
});
