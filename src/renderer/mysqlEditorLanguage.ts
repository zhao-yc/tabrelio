import type { languages } from 'monaco-editor';
import { mariadb, mysql } from 'sql-formatter';
import type { SqlLexicalMode } from '../shared/queryParameters';

export type MysqlEditorDialect = 'mysql' | 'mariadb';
export type MysqlEditorMode = Partial<Pick<SqlLexicalMode, 'ansiQuotes' | 'noBackslashEscapes'>>;
const ids = (dialect: MysqlEditorDialect) => [
  'dbark-' + dialect, 'dbark-' + dialect + '-ansi',
  'dbark-' + dialect + '-literal', 'dbark-' + dialect + '-ansi-literal',
] as const;
export const mysqlEditorLanguages = { mysql: ids('mysql'), mariadb: ids('mariadb') };

export function mysqlEditorLanguage(dialect: MysqlEditorDialect, mode?: MysqlEditorMode): string {
  return mysqlEditorLanguages[dialect][Number(mode?.ansiQuotes === true) + 2 * Number(mode?.noBackslashEscapes === true)];
}

function commentRules(scope: string): languages.IMonarchLanguageRule[] {
  return [[/\*\//, { token: scope, next: '@pop' }], [/[^*]+|\*/, scope]];
}

/** 双引号在 ANSI_QUOTES 下是名称；反斜杠转义只用于允许转义的字符串。 */
function stringRules(quote: "'" | '"', noBackslashEscapes: boolean): languages.IMonarchLanguageRule[] {
  const doubled = quote === "'" ? /''/ : /""/;
  const closing = quote === "'" ? /'/ : /"/;
  const plain = quote === "'"
    ? (noBackslashEscapes ? /[^']+/ : /[^'\\]+/)
    : (noBackslashEscapes ? /[^"]+/ : /[^"\\]+/);
  const escape: languages.IMonarchLanguageRule[] = noBackslashEscapes ? [] : [[/\\.?/, 'string.escape']];
  return [[doubled, 'string'], [closing, { token: 'string', next: '@pop' }], ...escape, [plain, 'string']];
}

/** 只做显示分类，条件注释保留版本前缀，不推断服务端会执行其中的正文。 */
function grammar(dialect: MysqlEditorDialect, mode: SqlLexicalMode): languages.IMonarchLanguage {
  const options = (dialect === 'mariadb' ? mariadb : mysql).tokenizerOptions;
  const keywords = [...new Set([
    options.reservedSelect, options.reservedClauses, options.reservedSetOperations,
    options.reservedJoins, options.reservedKeywordPhrases, options.reservedKeywords,
  ].flatMap(group => (group ?? []).flatMap(phrase => phrase.toLowerCase().split(/\s+/))))];
  // 关键字忽略大小写，MariaDB 的 M! 条件注释前缀仍按字面识别。
  const familyComment: languages.IMonarchLanguageRule[] = dialect === 'mariadb'
    ? [[new RegExp('/\\*(?-i:M)!'), { token: 'comment.conditional', next: '@conditional' }]] : [];
  return {
    defaultToken: '',
    tokenPostfix: '.sql',
    ignoreCase: true,
    keywords,
    builtins: [...options.reservedDataTypes, ...options.reservedFunctionNames],
    tokenizer: {
      root: [
        [/^[ \t]*DELIMITER[ \t]+[^\s"'`\\]{1,16}[ \t]*$/, 'keyword.directive'],
        [/[ \t\r\n\v\f]+/, 'white'],
        [/#.*|--(?=[\x00-\x20\x7f]|$).*/, 'comment'],
        ...familyComment,
        [/\/\*!/, { token: 'comment.conditional', next: '@conditional' }],
        [/\/\*\+/, { token: 'comment.hint', next: '@hint' }],
        [/\/\*/, { token: 'comment', next: '@comment' }],
        [/x'(?:[0-9a-f]{2})*'|b'[01]*'/, 'string.binary'],
        [/n?'/, { token: 'string', next: '@singleString' }],
        [/"/, mode.ansiQuotes ? { token: 'identifier', next: '@doubleIdentifier' } : { token: 'string', next: '@doubleString' }],
        [/`/, { token: 'identifier', next: '@backtick' }],
        [/@{1,2}[\w.$\u0080-\uFFFF]+|:[a-z_\u0080-\uFFFF][\w\u0080-\uFFFF]*|\?/, 'variable'],
        [/(?:0x[0-9a-f]+|0b[01]+)(?![a-z0-9_$\u0080-\uFFFF])/, 'number.hex'],
        [/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?![a-z0-9_$\u0080-\uFFFF])/, 'number'],
        [/[\w$\u0080-\uFFFF]+/, { cases: { '@keywords': 'keyword', '@builtins': 'predefined', '@default': 'identifier' } }],
        [/[()]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
        [/<=>|->>|->|:=|<=|>=|<>|!=|<<|>>|&&|\|\||[~+*/%&|<>=!^-]/, 'operator'],
      ],
      comment: commentRules('comment'),
      conditional: commentRules('comment.conditional'),
      hint: commentRules('comment.hint'),
      singleString: stringRules("'", mode.noBackslashEscapes),
      doubleString: stringRules('"', mode.noBackslashEscapes),
      doubleIdentifier: [[/""|[^"]+/, 'identifier'], [/"/, { token: 'identifier', next: '@pop' }]],
      backtick: [[/``|[^`]+/, 'identifier'], [/`/, { token: 'identifier', next: '@pop' }]],
    },
  };
}

const registered = new WeakMap<object, Set<MysqlEditorDialect>>();
/** 语言 ID 同时绑定引擎与两个模式位，查询会话切换着色无需替换编辑器模型。 */
export function registerMysqlEditorLanguages(api: typeof languages, dialect: MysqlEditorDialect): void {
  const seen = registered.get(api) ?? new Set();
  if (seen.has(dialect)) return;
  for (const [index, id] of mysqlEditorLanguages[dialect].entries()) {
    api.register({ id });
    api.setMonarchTokensProvider(id, grammar(dialect, { ansiQuotes: !!(index & 1), noBackslashEscapes: !!(index & 2) }));
    api.setLanguageConfiguration(id, {
      comments: { lineComment: '--', blockComment: ['/*', '*/'] },
      brackets: [['(', ')'], ['[', ']'], ['{', '}']],
      autoClosingPairs: [
        { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
        { open: '"', close: '"' }, { open: "'", close: "'" }, { open: '`', close: '`' },
      ],
    });
  }
  seen.add(dialect);
  registered.set(api, seen);
}
