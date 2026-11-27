import { describe, expect, it } from 'vitest';
import { mysqlNamedParameterCompletion, mysqlNamedParameterHover, mysqlParameterEditorMode, mysqlParameterTarget } from '../../src/renderer/mysqlNamedParameterEditor';

const mysql = mysqlParameterEditorMode('mysql');
const mariaUnknown = mysqlParameterEditorMode('mariadb');
const maria = { ...mariaUnknown, bracketQuotes: false as const };
const mssql = { ...maria, bracketQuotes: true };

function marked(sql: string) {
  const offset = sql.indexOf('|'), source = sql.replace('|', '');
  return { source, target: mysqlParameterTarget(source, offset)! };
}
function complete(sql: string, mode = mysql) {
  const { source, target } = marked(sql);
  return mysqlNamedParameterCompletion(source, target, mode).map(item => item.label);
}
function hover(sql: string, mode = mysql) {
  const { source, target } = marked(sql);
  return mysqlNamedParameterHover(source, target, mode);
}

describe('MySQL 和 MariaDB 命名参数编辑', () => {
  it('按语句优先补全两种同名绑定并保留输入的写法与大小写', () => {
    expect(complete('SELECT :Shared, :same;\nSELECT [$Scope], :S|')).toEqual([':Scope', ':Shared']);
    expect(complete('SELECT :Shared, :same, [$S|];')).toEqual(['[$Shared]']);
    expect(complete('SELECT :Shared, [$|]')).toEqual(['[$Shared]']);
    expect(complete("SELECT :Shared, '[$S|]'")).toEqual([]);
  });

  it('用真实分隔符定位语句，并排除字符串、注释和分隔符本身', () => {
    const sql = "DELIMITER :done\nSELECT ':shared', :sha|red, [$shared] /* :shared */ :done\nSELECT :shared :done";
    expect(hover(sql)).toEqual({ statementCount: 2, draftCount: 3 });
    expect(hover('DELIMITER :done\nSELECT 1 :do|ne')).toBeUndefined();
    expect(complete('DELIMITER :done\nSELECT :double :do|ne')).toEqual([]);
  });

  it('根据 MariaDB 会话区分方括号标识符，模式未知时拒绝歧义', () => {
    expect(hover('SELECT [$sh|ared], :shared;', maria)).toEqual({ statementCount: 2, draftCount: 2 });
    expect(hover('SELECT [$sh|ared], :shared;', mssql)).toBeUndefined();
    expect(hover('SELECT [$shared], :sh|ared;', mssql)).toEqual({ statementCount: 1, draftCount: 1 });
    expect(hover('SELECT [$sh|ared], :shared;', mariaUnknown)).toBeUndefined();
    expect(hover("SET sql_mode='MSSQL'; SELECT [$sh|ared], :shared;", maria)).toBeUndefined();
    expect(hover('CALL external_setup(); SELECT :sh|ared;', maria)).toEqual({ statementCount: 1, draftCount: 1 });
  });
});
