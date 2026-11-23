import { expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor';
import { analyzeStatementNavigation, validStatementNavigationResult, type StatementNavigationResult } from '../../src/shared/statementNavigation';
import { sqlStatementFoldingProvider, statementFoldingRanges } from '../../src/renderer/sqlStatementFolding';

/** 用原 UTF-16 偏移模拟 Monaco 模型，仅替换界面与线程端口。 */
function model(source: string) {
  const lines = source.split('\r\n');
  let version = 1;
  return {
    port: {
      getValue: () => source, getValueLength: () => source.length, getLineCount: () => lines.length,
      getVersionId: () => version, isDisposed: () => false,
      getPositionAt: (offset: number) => {
        const before = source.slice(0, offset).split('\r\n');
        return { lineNumber: before.length, column: before.at(-1)!.length + 1 };
      },
      getLineContent: (line: number) => lines[line - 1],
    } as editor.ITextModel,
    change: () => { version++; },
  };
}

it('按完整多行语句折叠，保留同行的后续语句及分隔符指令', () => {
  const source = "DELIMITER $$\r\nCREATE PROCEDURE p() BEGIN\r\nSELECT '😀;';\r\nEND$$\r\nDELIMITER ;\r\nSELECT\r\n1\r\n; SELECT 2;";
  const result = analyzeStatementNavigation(source, 'mysql');
  if (result.status !== 'ready') throw Error('测试脚本不能分段');
  expect(statementFoldingRanges(model(source).port, result.statements, source, 'mysql')).toEqual([{ start: 2, end: 4 }, { start: 6, end: 7 }]);
});

it('PostgreSQL 从语句正文开始折叠，保留前导注释和末行的相邻 SQL', () => {
  const source = "SELECT 0;\r\n/* 外层 /* 内层; */ */\r\nDO $body$\r\nBEGIN\r\n  PERFORM 42;\r\nEND;\r\n$body$; SELECT '相邻语句';";
  const result = analyzeStatementNavigation(source, 'postgresql');
  if (result.status !== 'ready') throw Error('测试脚本不能分段');
  expect(statementFoldingRanges(model(source).port, result.statements, source, 'postgresql')).toEqual([{ start: 3, end: 6 }]);
});

it.each(['mysql', 'mariadb', 'sqlite', 'postgresql'] as const)('%s 保留 CTE 和嵌套调用的闭括号行', dialect => {
  const source = ['WITH', '  subject AS (', '    SELECT COALESCE(', "      '文字 ) 🚢',", '      1',
    '    ) AS id', '  ), next_cte AS (SELECT 2)', 'SELECT id FROM subject;'].join('\r\n');
  const result = analyzeStatementNavigation(source, dialect, {}, true);
  if (result.status !== 'ready') throw Error('测试脚本不能分段');
  expect(validStatementNavigationResult(result, source)).toBe(true);
  expect(result.blocks?.map(block => source.slice(block.start, block.end))).toEqual([
    '(\r\n    SELECT COALESCE(\r\n      \'文字 ) 🚢\',\r\n      1\r\n    ) AS id\r\n  )',
    '(\r\n      \'文字 ) 🚢\',\r\n      1\r\n    )',
  ]);
  expect(statementFoldingRanges(model(source).port, result.statements, source, dialect, result.blocks)).toEqual([
    { start: 1, end: 8 }, { start: 2, end: 6 }, { start: 3, end: 5 },
  ]);
});

it('括号配对忽略 PostgreSQL dollar quote、嵌套注释和 SQLite 方括号引用', () => {
  const postgres = "SELECT\r\n  $body$(\r\n)字面\r\n$body$,\r\n  /* ( /* 嵌套 */ ) */ (\r\n    1\r\n  );";
  const pg = analyzeStatementNavigation(postgres, 'postgresql', {}, true);
  expect(pg).toMatchObject({ status: 'ready', blocks: [{ start: postgres.indexOf('(\r\n    1'), end: postgres.lastIndexOf(')') + 1 }] });
  const sqlite = 'SELECT\r\n  [a(\r\n) b], (\r\n     1 --)\r\n  );';
  const sq = analyzeStatementNavigation(sqlite, 'sqlite', {}, true);
  expect(sq).toMatchObject({ status: 'ready', blocks: [{ start: sqlite.indexOf('(\r\n     1'), end: sqlite.lastIndexOf(')') + 1 }] });
});

it('块边界有歧义时保留原语句范围，且伪造范围不能越过括号或语句', () => {
  const source = "SELECT 'x\\'(\r\n  1\r\n) -- 合上'";
  const offline = analyzeStatementNavigation(source, 'mysql', {}, true);
  const known = analyzeStatementNavigation(source, 'mysql', { noBackslashEscapes: true }, true);
  expect(offline).toMatchObject({ status: 'ready', blocks: [] });
  expect(known).toMatchObject({ status: 'ready', blocks: [{ start: source.indexOf('('), end: source.indexOf(')') + 1 }] });
  if (known.status !== 'ready') throw Error('测试脚本不能分段');
  expect(validStatementNavigationResult({ ...known, blocks: [{ start: 0, end: source.indexOf(')') + 1 }] }, source)).toBe(false);
  const joined = 'SELECT (\r\n  1\r\n); SELECT (\r\n  2\r\n);';
  const valid = analyzeStatementNavigation(joined, 'sqlite', {}, true);
  expect(validStatementNavigationResult({ ...valid, blocks: [{ start: joined.indexOf('('), end: joined.lastIndexOf(')') + 1 }] }, joined)).toBe(false);
});

it('PostgreSQL 折叠根据会话模式快照取范围，旧提供器失效后不提交迟到范围', async () => {
  const source = ["SELECT 'a\\';", 'SELECT', '  2;', "-- close '", ';', 'SELECT 3;'].join('\r\n');
  const fixture = model(source), instance = { getModel: () => fixture.port };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  let active = true;
  let finish!: (result: StatementNavigationResult) => void;
  const analyze = vi.fn().mockImplementationOnce(() => new Promise<StatementNavigationResult>(resolve => { finish = resolve; }))
    .mockImplementation(async (...args: Parameters<typeof analyzeStatementNavigation>) => analyzeStatementNavigation(...args));
  const old = sqlStatementFoldingProvider(instance, 'postgresql', { analyze }, () => active, { noBackslashEscapes: true });
  const pending = old.provideFoldingRanges(fixture.port, {}, token);
  active = false;
  finish(analyzeStatementNavigation(source, 'postgresql', { noBackslashEscapes: true }));
  expect(await pending).toBeUndefined();
  const off = sqlStatementFoldingProvider(instance, 'postgresql', { analyze }, () => true, { noBackslashEscapes: false });
  expect(await off.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 1, end: 5 }]);
  const on = sqlStatementFoldingProvider(instance, 'postgresql', { analyze }, () => true, { noBackslashEscapes: true });
  expect(await on.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 2, end: 3 }]);
  const offline = sqlStatementFoldingProvider(instance, 'postgresql', { analyze }, () => true);
  expect(await offline.provideFoldingRanges(fixture.port, {}, token)).toBeUndefined();
});

it('精确模型可复用同版本范围，变更期间的回包不能成为折叠范围', async () => {
  const source = 'SELECT\r\n1;';
  const fixture = model(source);
  let finish!: (value: StatementNavigationResult) => void;
  const result = analyzeStatementNavigation(source, 'sqlite');
  const analyze = vi.fn().mockImplementationOnce(() => new Promise<StatementNavigationResult>(resolve => { finish = resolve; })).mockResolvedValue(result);
  const provider = sqlStatementFoldingProvider({ getModel: () => fixture.port }, 'sqlite', { analyze }, () => true);
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  expect(await provider.provideFoldingRanges(model(source).port, {}, token)).toBeUndefined();
  const old = provider.provideFoldingRanges(fixture.port, {}, token);
  fixture.change();
  finish(result);
  expect(await old).toBeUndefined();
  expect(await provider.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 1, end: 2 }]);
  expect(await provider.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 1, end: 2 }]);
  expect(analyze).toHaveBeenCalledTimes(2);
});
