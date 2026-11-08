import { describe, expect, it } from 'vitest';
import { postgresEditorTokens } from '../../src/renderer/postgresEditorLanguage';

function scopes(lines: string[], standard = true) {
  const provider = postgresEditorTokens(standard);
  let state = provider.getInitialState();
  return lines.map(line => {
    const result = provider.tokenize(line, state);
    state = result.endState.clone();
    return Object.fromEntries(result.tokens.map((token, index) => [
      line.slice(token.startIndex, result.tokens[index + 1]?.startIndex),
      token.scopes.split('.')[0],
    ]));
  });
}

describe('PostgreSQL 编辑器逐行词法', () => {
  it('多行 dollar 字符串按标签原样闭合，保留同一行后续 SQL', () => {
    expect(scopes([
      'DO $Body$BEGIN',
      '  -- 注释外观 $body$ 与 $inner$',
      'END$Body$; SeLeCt $1::int;',
      'select $$/*这里还是字符串*/$$;',
      'select $标记$正文$标记$, 列名$不是$标签;',
    ])).toEqual([
      { DO: 'keyword', ' ': 'white', '$Body$BEGIN': 'string' },
      { '  -- 注释外观 $body$ 与 $inner$': 'string' },
      { 'END$Body$': 'string', ';': 'delimiter', ' ': 'white', SeLeCt: 'keyword', '$1': 'variable', '::': 'operator', int: 'predefined' },
      { select: 'keyword', ' ': 'white', '$$/*这里还是字符串*/$$': 'string', ';': 'delimiter' },
      { select: 'keyword', ' ': 'white', '$标记$正文$标记$': 'string', ',': 'delimiter', '列名$不是$标签': 'identifier', ';': 'delimiter' },
    ]);
  });

  it('注释能嵌套，内部引号和标签不影响出栈，双引号仍为标识符', () => {
    expect(scopes([
      '/* 外层 /* 内层 $Body$',
      '   */ 外层尚未关闭 "',
      '*/ SELECT "带""引号", U&"d\\0061t" -- 真注释',
    ])).toEqual([
      { '/* 外层 /* 内层 $Body$': 'comment' },
      { '   */ 外层尚未关闭 "': 'comment' },
      { '*/': 'comment', ' ': 'white', SELECT: 'keyword', '"带""引号"': 'identifier', ',': 'delimiter', 'U&"d\\0061t"': 'identifier', '-- 真注释': 'comment' },
    ]);
  });

  it('普通引号按会话模式处理，E 字符串跨行续接沿用反斜杠规则', () => {
    const ordinary = "select 'a\\' -- 外观";
    expect(scopes([ordinary])[0]['-- 外观']).toBe('comment');
    expect(scopes([ordinary], false)[0]["'a\\' -- 外观"]).toBe('string');
    expect(scopes(["select E'a' -- 允许跨行续接", '', "  'b\\'c', B'0101', X'FA', 0o_1_755, 1.2e-4;"])[2]).toMatchObject({
      "'b\\'c'": 'string', "B'0101'": 'string', "X'FA'": 'string', '0o_1_755': 'number', '1.2e-4': 'number',
    });
  });

  it('行状态以标签和嵌套深度区分，关闭引号或注释后恢复初始状态', () => {
    const provider = postgresEditorTokens(true), initial = provider.getInitialState();
    const open = (source: string) => provider.tokenize(source, initial).endState;
    const body = open('$Body$');
    expect(body.equals(open('$Body$'))).toBe(true);
    expect(body.equals(open('$body$'))).toBe(false);
    expect(provider.tokenize('$body$', body).endState.equals(body)).toBe(true);
    expect(provider.tokenize('$Body$;', body).endState.equals(initial)).toBe(true);
    expect(open('/*').equals(open('/* /*'))).toBe(false);
    expect(provider.tokenize('*/ */', open('/* /*')).endState.equals(initial)).toBe(true);
  });
});
