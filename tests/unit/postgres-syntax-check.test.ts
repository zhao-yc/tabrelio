import { beforeAll, describe, expect, it } from 'vitest';
import { loadModule } from 'libpg-query';
import { checkPostgresSyntax } from '../../src/shared/postgresSyntaxCheck';
import { validSqlSyntaxCheckResult } from '../../src/shared/sqlSyntaxCheck';

beforeAll(() => loadModule());

describe('PostgreSQL 本地语法检查', () => {
  it('按原生语法计数，保留 SQL 例程体和注释内的分号', () => {
    const sql = "/* /* 分号; */ */ CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; END;\n" +
      "DO $body$ BEGIN RAISE NOTICE ';'; END $body$;\nSELECT [$named]::int, '[$ignored]', $$[$ignored]$$;";
    expect(checkPostgresSyntax(sql)).toEqual({ status: 'ready', statementCount: 3, issues: [] });
    expect(checkPostgresSyntax('SELECT $201, [$named];')).toEqual({ status: 'ready', statementCount: 1, issues: [] });
    expect(checkPostgresSyntax('-- 中文😀\r\n/* ; */;;')).toEqual({ status: 'ready', statementCount: 0, issues: [] });
  });

  it('把 Unicode、CRLF 和参数后的诊断定位到原词', () => {
    const sql = "SELECT '中文😀';\r\nSELECT [$needle], FROM t;";
    const start = sql.indexOf('FROM');
    const result = checkPostgresSyntax(sql);
    expect(result).toEqual({ status: 'ready', statementCount: 0, issues: [{ start, end: start + 4, code: 'syntax' }] });
    expect(validSqlSyntaxCheckResult(result, sql)).toBe(true);
    const namePosition = 'CREATE TABLE [$table] (id int);';
    expect(checkPostgresSyntax(namePosition)).toEqual({ status: 'ready', statementCount: 0,
      issues: [{ start: 13, end: 21, code: 'syntax' }] });
    const incomplete = 'SELECT \r\n("中文😀" +';
    expect(checkPostgresSyntax(incomplete)).toEqual({ status: 'ready', statementCount: 0,
      issues: [{ start: incomplete.length, end: incomplete.length, code: 'incomplete' }] });
  });

  it('未知模式拒绝歧义，显式转义可离线检查', () => {
    const modeSensitive = "SELECT 'a\\'";
    expect(checkPostgresSyntax(modeSensitive)).toEqual({ status: 'blocked', reason: 'mode' });
    expect(checkPostgresSyntax(modeSensitive, false)).toEqual({ status: 'blocked', reason: 'mode' });
    expect(checkPostgresSyntax(modeSensitive, true)).toEqual({ status: 'ready', statementCount: 1, issues: [] });
    expect(checkPostgresSyntax("SET standard_conforming_strings TO off; " + modeSensitive, true))
      .toEqual({ status: 'blocked', reason: 'dynamic-mode' });
    expect(checkPostgresSyntax("SELECT E'a\\\\b', $$'[$ignored] \\x$$"))
      .toEqual({ status: 'ready', statementCount: 1, issues: [] });
  });

  it('定位未闭合词法，拒绝客户端命令、非法字符和超限脚本', () => {
    for (const [opening, code] of [["'未闭合", 'unclosed-string'], ['"未闭合', 'unclosed-identifier'],
      ['/* 未闭合', 'unclosed-comment'], ['$tag$未闭合', 'unclosed-string']]) {
      const sql = 'SELECT ' + opening;
      expect(checkPostgresSyntax(sql)).toEqual({ status: 'ready', statementCount: 0,
        issues: [{ start: 7, end: sql.length, code }] });
    }
    expect(checkPostgresSyntax('\\dt')).toEqual({ status: 'blocked', reason: 'client-command' });
    expect(checkPostgresSyntax('SELECT \0')).toEqual({ status: 'blocked', reason: 'input' });
    expect(checkPostgresSyntax(' '.repeat(262145))).toEqual({ status: 'blocked', reason: 'budget' });
    expect(checkPostgresSyntax('SELECT 1;'.repeat(257))).toEqual({ status: 'blocked', reason: 'budget' });
  });
});
