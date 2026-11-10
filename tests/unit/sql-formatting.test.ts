import { describe, expect, it } from 'vitest';
import { planSqlFormatting, prepareSqlFormattingRoles } from '../../src/renderer/sqlFormatting';
import { completionLimits } from '../../src/shared/sqlCompletion';

describe('括号内单行宽度', () => {
  const source = 'select * from t where id in (100,200,300);';
  it.each(['mysql', 'sqlite', 'postgresql'] as const)('%s 只在格式化时使用宽度，压缩结果与偏好无关', dialect => {
    const plan = (expressionWidth: number | undefined, mode: 'format' | 'compact' = 'format') => planSqlFormatting(source, 0, source.length, '\n', { dialect, expressionWidth }, mode)?.text;
    expect(plan(10)).toContain('id in (\n    100,\n    200,\n    300\n  )');
    expect(plan(200)).toContain('id in (100, 200, 300)');
    expect(plan(undefined)).toBe(plan(50));
    expect(plan(0)).toBe(plan(50));
    expect(plan(10, 'compact')).toBe(plan(200, 'compact'));
  });
  it('MySQL 关键字大写的格式化仍采用所选宽度', async () => {
    await prepareSqlFormattingRoles();
    const plan = planSqlFormatting(source, 0, source.length, '\n', { keywordCase: 'upper', expressionWidth: 10 });
    expect(plan?.text).toContain('WHERE\n  id IN (\n    100,');
  });
});

describe('压缩 SQL', () => {
  it('只压缩选区内部空白，保留两端、模式敏感间距和行注释 CRLF', () => {
    const prefix = 'select   0;\r\n', suffix = '\r\nselect   9;';
    const body = "  SeLeCt  count  (\r\n *  )   ,   'a  b' ; -- 原注释  \r\n   select    2;  ";
    const source = prefix + body + suffix, start = prefix.length, end = start + body.length;
    const text = "  SeLeCt count (*), 'a  b'; -- 原注释  \r\nselect 2;  ";
    expect(planSqlFormatting(source, start, end, '\r\n', { keywordCase: 'lower' }, 'compact')).toEqual({ start, end, text });
    expect(planSqlFormatting(text, 0, text.length, '\r\n', {}, 'compact')).toBeNull();
  });
  it('PostgreSQL 保留跨行续接字符串、嵌套注释与 dollar-quote 正文', () => {
    const source = "select  'one'\n  'two'   ,\n  $x$a  b\n c$x$   , array[  1 ] /* 外 /* 内 */ 层 */ ;";
    expect(planSqlFormatting(source, 0, source.length, '\n', { dialect: 'postgresql' }, 'compact')?.text)
      .toBe("select 'one'\n  'two', $x$a  b\n c$x$, array[1] /* 外 /* 内 */ 层 */;");
  });
  it('SQLite 保留方括号名称、blob 前缀与注释', () => {
    const source = "select  [a b]  ,  X'00ff'  -- 保留\n   from  t ;";
    expect(planSqlFormatting(source, 0, source.length, '\n', { dialect: 'sqlite' }, 'compact')?.text)
      .toBe("select [a b], X'00ff' -- 保留\nfrom t;");
  });
  it.each([
    ['mysql', 'select  1;\n SOURCE script.sql'],
    ['mysql', 'select  1\n\\G'],
    ['mysql', 'DELIMITER $$\nselect  1$$'],
    ['postgresql', 'COPY t FROM STDIN;\n1\n'],
    ['sqlite', 'select  1;\n.tables'],
  ] as const)('拒绝 %s 客户端脚本，不把指令移入同一行', (dialect, source) => {
    expect(() => planSqlFormatting(source, 0, source.length, '\n', { dialect }, 'compact')).toThrow('原文未改动');
  });
});

describe('选区格式化的原文与安全边界', () => {
  it.each([[1, true], [8, true], [4, false]] as const)('显式格式化使用宽度%s/空格%s，字面量原文不变且重复格式化不追加编辑', (tabSize, insertSpaces) => {
    const source = "select a,b,'🚢  原文' from 表 where id=1;", indentation = { tabSize, insertSpaces };
    const plan = planSqlFormatting(source, 0, source.length, '\n', indentation)!;
    expect(plan.text).toContain('\n' + (insertSpaces ? ' '.repeat(tabSize) : '\t') + 'a,'); expect(plan.text).toContain("'🚢  原文'"); expect(planSqlFormatting(plan.text, 0, plan.text.length, '\n', indentation)).toBeNull();
  });
  it('只排版选中SQL，Unicode、字符串、注释及选区外内容逐字不变', () => {
    const prefix = "select '🚢外面' as 前; -- 头部保持\n", body = "select 名称,'🚢  ; -- 字符串' as 标记 from 表 where 编号=1; -- 注释保持", suffix = "\nselect '尾部' as 后;";
    const source = prefix + body + suffix, plan = planSqlFormatting(source, prefix.length, prefix.length + body.length)!;
    expect(plan).not.toBeNull(); expect(plan.text).not.toBe(body); expect(plan.text).toContain("'🚢  ; -- 字符串'"); expect(plan.text).toContain('-- 注释保持');
    const next = source.slice(0, plan.start) + plan.text + source.slice(plan.end); expect(next.slice(0, prefix.length)).toBe(prefix); expect(next.slice(-suffix.length)).toBe(suffix);
  });
  it('保留选区两端空白，防止选区与外部token粘连', () => {
    const source = 'select a,b from 表 where id=1;', start = source.indexOf(' a'), end = source.indexOf(' where');
    const plan = planSqlFormatting(source, start, end)!; expect(plan.text.startsWith(' ')).toBe(true); expect(plan.text).toContain('from'); expect(source.slice(plan.end)).toBe(' where id=1;');
  });
  it('无选区的全文计划保留大小写及CRLF，重复排版不产生编辑', () => {
    const source = "select 名称,'🚢' from 表 where id=1;\r\n";
    const plan = planSqlFormatting(source, 0, source.length, '\r\n')!; expect(plan.text).toContain('\r\n'); expect(plan.text.replaceAll('\r\n', '')).not.toContain('\n');
    expect(planSqlFormatting(plan.text, 0, plan.text.length, '\r\n')).toBeNull(); expect(plan.text).toContain('select');
  });
  it('只选空白时不回退到全文', () => { expect(planSqlFormatting('select a,b;\n  \n', 12, 15)).toBeNull(); });
  it('原formatter不支持的语法返回固定错误，不把用户SQL放入异常', () => { const source = 'select [合成私有字段] from 表;'; expect(() => planSqlFormatting(source, 0, source.length)).toThrow('SQL 格式化失败，原文未改动。'); });
  it.each(["select '未闭合", 'select (1;', 'select 1);', 'select 1; /* 未闭合', "select 'a\\'b';", 'DELIMITER $$\nselect 1$$', 'select 1 /*!80000 + 1 */;', 'select /*+ MAX_EXECUTION_TIME(1) */ 1;', 'select /*M! 1 */ 1;', 'SET sql_mode=\'ANSI_QUOTES\'; select 1;', 'CREATE PROCEDURE p() BEGIN SELECT 1; END;'])('无法证明安全则原文不进入修改计划：%s', source => { expect(() => planSqlFormatting(source, 0, source.length)).toThrow(); });
  it.each([['select 名称 from 表;', 8, 9], ["select '字符串';", 9, 10], ['select 1; -- 注释文字', 13, 15]] as const)('不截断标识符、字符串或注释：%s', (source, start, end) => { expect(() => planSqlFormatting(source, start, end)).toThrow('完整文本范围'); });
  it('字符串和普通注释中的DELIMITER不是客户端指令', () => { const source = "select 'DELIMITER $$', 1,2; -- DELIMITER $$"; expect(planSqlFormatting(source, 0, source.length)?.text).toContain("'DELIMITER $$'"); });
  it('函数名称和左括号间的模式敏感空白不能被静默移除', () => { const source = 'select count ( * ) from 表;'; expect(() => planSqlFormatting(source, 0, source.length)).toThrow(); });
  it('拒绝超长源、过多token、过深括号、NUL及截断CRLF', () => {
    for (const source of ['x'.repeat(completionLimits.sourceUnits + 1), 'select ' + Array(9000).fill('1').join(',') + ';', 'select ' + '('.repeat(65) + '1' + ')'.repeat(65), 'select \0;']) expect(() => planSqlFormatting(source, 0, source.length)).toThrow();
    expect(() => planSqlFormatting('select 1;\r\nselect 2;', 0, 10)).toThrow();
  });
});

describe('PostgreSQL 格式化', () => {
  const preferences = { dialect: 'postgresql', tabSize: 4, insertSpaces: false } as const;

  it('沿用制表符和 CRLF，保留 dollar 正文、参数、类型转换和选区外原文', () => {
    const prefix = '-- 前缀\r\n', body = 'SeLeCt "MiX",$body$🚢;\r\n原文$body$,data->>\'id\',$12::bigint from "表";', suffix = '\r\n-- 后缀';
    const source = prefix + body + suffix;
    const plan = planSqlFormatting(source, prefix.length, prefix.length + body.length, '\r\n', preferences);
    expect(plan).toEqual({ start: prefix.length, end: prefix.length + body.length,
      text: 'SeLeCt\r\n\t"MiX",\r\n\t$body$🚢;\r\n原文$body$,\r\n\tdata ->> \'id\',\r\n\t$12::bigint\r\nfrom\r\n\t"表";' });
  });

  it('保留嵌套注释、转义字符串、数字和数组下标', () => {
    const source = "select 1 /* 外层 /* 内层 */ 结束 */ +2,E'it\\'s',0xF0,1.1e-2,1_000,arr[1:2] from t;";
    const text = planSqlFormatting(source, 0, source.length, '\n', preferences)?.text;
    expect(text).toContain("/* 外层 /* 内层 */ 结束 */ + 2,\n\tE'it\\'s',\n\t0xF0,\n\t1.1e-2,\n\t1_000,");
    expect(text).toMatch(/arr\[1\s*:\s*2\]/);
  });

  it.each(["select 'one'\n 'two';", 'select a*@b from t;', 'copy t from stdin;\n1\n2\n',
    "select 'a\\'b';", 'select arr[1;', 'select $未闭合$原文'])('拒绝无法证明保持词法的输入：%s', source => {
    expect(() => planSqlFormatting(source, 0, source.length, '\n', preferences)).toThrow('原文未改动');
  });

  it.each(['$12', '$tag$原文$tag$', 'U&"原名"', "E'\\n'", '1.25e-4', '->>', '/* 外 /* 内 */ 层 */'])('不能从词法单元中间选起：%s', token => {
    const source = 'select ' + token + ';';
    expect(() => planSqlFormatting(source, 'select '.length + 1, source.length, '\n', preferences)).toThrow('完整文本范围');
  });
});
