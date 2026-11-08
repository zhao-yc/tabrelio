import { describe, expect, it } from 'vitest';
import { changeMysqlViewDraftColumns, mysqlViewDraftColumns, changeMysqlViewDraftAttribute, copyMysqlViewDraft, exportMysqlViewFileQuery, mysqlViewDraftAttributes, renameMysqlViewDraft, mysqlViewDraftQuery, mysqlNewViewHeader, mysqlViewFileQuery, replaceMysqlViewFileQuery } from '../../src/shared/mysqlViewFile';

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

describe('MySQL 和 MariaDB 视图另存', () => {
  it.each([['CREATE OR REPLACE', ''], ['CREATE', ' IF NOT EXISTS'], ['ALTER', '']])(
    '用 %s 草稿生成普通 CREATE 并保留属性与正文', (verb, exists) => {
      const options = 'ALGORITHM=MERGE DEFINER=`原@人`@`%` SQL SECURITY INVOKER VIEW';
      const tail = " (`列`) AS SELECT id FROM `库`.`来源` WHERE id <> '原;视图' WITH LOCAL CHECK OPTION -- 尾注释";
      const sql = `${verb} ${options}${exists} \`原;视图\`${tail}`;
      expect(copyMysqlViewDraft(sql, '库', '原;视图', '新` 名')).toBe(
        'CREATE ' + options + ' `库`.`新`` 名`' + tail + '\n;',
      );
    },
  );

  it.each([
    'ALTER VIEW `不同库`.`视图` AS SELECT 1',
    'ALTER VIEW `错误目标` AS SELECT 1',
    'CREATE VIEW `视图` AS SELECT 1; DROP VIEW `视图`',
    'CREATE VIEW `视图` AS SELECT 1 /*M! DROP VIEW `视图` */',
    "CREATE VIEW `视图` AS SELECT 'escape\\' AS n",
  ])('拒绝边界不确定或源身份不符的草稿 %s', source => {
    expect(() => copyMysqlViewDraft(source, '库', '视图', '新视图')).toThrow(/无法确认/);
  });

  it('拒绝完全相同的目标', () => {
    expect(() => copyMysqlViewDraft('CREATE VIEW `视图` AS SELECT 1', '库', '视图', '视图')).toThrow(/不同/);
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

describe('MySQL 和 MariaDB 视图属性草稿', () => {
  const read = (sql: string) => mysqlViewDraftAttributes(sql, '库', '视图');
  const change = (sql: string, attribute: Parameters<typeof changeMysqlViewDraftAttribute>[3]) =>
    changeMysqlViewDraftAttribute(sql, '库', '视图', attribute);

  it('在缺省子句中按语法位置加入属性，尾注释之后的检查仍有效', () => {
    const source = 'CREATE /* 头 */ VIEW `库`.`视图` AS SELECT * FROM t -- 尾';
    expect(read(source)).toEqual({ algorithm: 'UNDEFINED', security: 'DEFINER', check: 'NONE' });
    let changed = change(source, { key: 'algorithm', value: 'MERGE' });
    changed = change(changed, { key: 'security', value: 'INVOKER' });
    changed = change(changed, { key: 'check', value: 'LOCAL' });
    expect(changed).toBe('CREATE /* 头 */ ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `库`.`视图` AS SELECT * FROM t -- 尾\nWITH LOCAL CHECK OPTION\n');
    expect(read(changed)).toEqual({ algorithm: 'MERGE', security: 'INVOKER', check: 'LOCAL' });
  });

  it('仅替换所选词法片段，保留带引号的定义者、列清单和所有注释', () => {
    const head = 'ALTER ALGORITHM /*a*/ = MERGE DEFINER=`one@two`@`%` SQL SECURITY /*b*/ INVOKER VIEW `库`.`视图` (`c`) AS';
    const body = ' SELECT n FROM t /*c*/';
    const source = head + body + ' WITH /*d*/ CHECK OPTION /*e*/;';
    expect(read(source).check).toBe('CASCADED');
    expect(change(source, { key: 'check', value: 'CASCADED' })).toBe(source);
    expect(change(source, { key: 'check', value: 'LOCAL' })).toBe(head + body + ' WITH LOCAL /*d*/ CHECK OPTION /*e*/;');
    expect(change(source, { key: 'check', value: 'NONE' })).toBe(head + body + '  /*d*/   /*e*/;');
    expect(change(source, { key: 'algorithm', value: 'TEMPTABLE' })).toBe(source.replace('MERGE', 'TEMPTABLE'));
    expect(change(source, { key: 'security', value: 'DEFINER' })).toBe(source.replace('/*b*/ INVOKER', '/*b*/ DEFINER'));
  });

  it('读写 MariaDB IF NOT EXISTS 和角色定义者，重命名后仍保留查询及选项', () => {
    const source = 'CREATE DEFINER=CURRENT_ROLE VIEW IF NOT EXISTS `库`.`视图` AS SELECT n FROM t WITH LOCAL CHECK OPTION;';
    const renamed = renameMysqlViewDraft(source, '库', '视图', '新`名称');
    expect(renamed).toBe(source.replace('`视图`', '`新``名称`'));
    expect(mysqlViewDraftAttributes(renamed, '库', '新`名称').check).toBe('LOCAL');
    expect(replaceMysqlViewFileQuery(renamed, '库', '新`名称', 'SELECT m FROM t')).toContain('WITH LOCAL CHECK OPTION');
  });

  it.each([
    'CREATE VIEW `别库`.`视图` AS SELECT 1',
    'CREATE VIEW `视图` AS SELECT 1; DROP VIEW `视图`',
    'CREATE VIEW `视图` AS SELECT 1 /*!50000 WITH CHECK OPTION */',
    'CREATE VIEW "视图" AS SELECT 1',
  ])('目标或语句边界不明时禁止生成属性 SQL %s', sql => {
    expect(() => change(sql, { key: 'check', value: 'LOCAL' })).toThrow(/无法确认/);
    expect(() => renameMysqlViewDraft(sql, '库', '视图', '新名称')).toThrow(/无法确认/);
  });
});

describe('MySQL 和 MariaDB 视图输出列名', () => {
  const source = 'CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `库`.`v` AS SELECT x, y FROM t WITH LOCAL CHECK OPTION;';
  const read = (sql: string) => mysqlViewDraftColumns(sql, '库', 'v');
  const change = (sql: string, names: string[]) => changeMysqlViewDraftColumns(sql, '库', 'v', names);

  it('只插入显式列清单，正确引用点、逗号、反引号和换行', () => {
    const names = ['甲,列.`名', '乙\n列'];
    const sql = change(source, names);
    expect(sql).toBe(source.replace('`v` AS', '`v` (`甲,列.``名`, `乙\n列`) AS'));
    expect(read(sql)).toEqual(names);
    expect(change(sql, names)).toBe(sql);
    expect(renameMysqlViewDraft(sql, '库', 'v', 'new')).toBe(sql.replace('`v`', '`new`'));
  });

  it('修改同数量列名时保留内部注释，清空紧接 AS 的列表时仍保留分隔', () => {
    const sql = 'ALTER VIEW `v`(a, /* 位置 */ `b`)AS SELECT x, y FROM t;';
    expect(change(sql, ['a', '新列'])).toBe(sql.replace('`b`', '`新列`'));
    expect(change(sql, [])).toBe('ALTER VIEW `v` AS SELECT x, y FROM t;');
    expect(read(change(sql, []))).toEqual([]);
  });

  it('拒绝无效名称、大小写重复和不相符的 DDL', () => {
    expect(() => change(source, ['a', 'A'])).toThrow('重复');
    for (const invalid of ['', 'x'.repeat(65), '尾空格 ', 'nul\0', '😀'])
      expect(() => change(source, [invalid])).toThrow('第 1 个列名');
    expect(() => change(source + 'DROP VIEW v;', ['x'])).toThrow('无法确认');
    expect(() => change(source.replace('`库`', '`别库`'), ['x'])).toThrow('无法确认');
  });
});
