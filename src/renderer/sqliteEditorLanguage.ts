import type { languages } from 'monaco-editor';
import { sqlite } from 'sql-formatter';

export const sqliteEditorLanguage = 'dbark-sqlite';
const options = sqlite.tokenizerOptions;
const keywords = [...new Set([
  options.reservedSelect, options.reservedClauses, options.reservedSetOperations,
  options.reservedJoins, options.reservedKeywordPhrases, options.reservedKeywords,
].flatMap(group => (group ?? []).flatMap(phrase => phrase.toLowerCase().split(/\s+/))))];
const builtins = [...options.reservedDataTypes, ...options.reservedFunctionNames];

/** SQLite 的块注释不嵌套，方括号标识符在第一个 ] 闭合，单引号不识别反斜杠转义。 */
const grammar: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sql',
  ignoreCase: true,
  keywords,
  builtins,
  tokenizer: {
    root: [
      [/[ \t\r\n\v\f]+/, 'white'],
      [/--.*/, 'comment'],
      [/\/\*/, { token: 'comment', next: '@comment' }],
      [/x'(?:[0-9a-f]{2})*'/, 'string.blob'],
      [/'/, { token: 'string', next: '@string' }],
      [/"/, { token: 'identifier', next: '@doubleQuote' }],
      [/`/, { token: 'identifier', next: '@backtick' }],
      [/\[/, { token: 'identifier', next: '@bracket' }],
      [/\?\d*|[:@][\w$\u0080-\uFFFF]+|\$[\w$\u0080-\uFFFF]+(?:::[\w$\u0080-\uFFFF]*)*(?:\([^\s)]*\))?/, 'variable'],
      [/0x[0-9a-f]+(?:_[0-9a-f]+)*/, 'number.hex'],
      [/(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:e[+-]?\d+(?:_\d+)*)?/, 'number'],
      [/[a-z_\u0080-\uFFFF][\w$\u0080-\uFFFF]*/, { cases: {
        '@keywords': 'keyword', '@builtins': 'predefined', '@default': 'identifier',
      } }],
      [/[()]/, '@brackets'],
      [/[;,.:]/, 'delimiter'],
      [/->>|->|\|\||<<|>>|<=|>=|<>|!=|==|[~+*/%&|<>=-]/, 'operator'],
    ],
    comment: [[/\*\//, { token: 'comment', next: '@pop' }], [/[^*]+|\*/, 'comment']],
    string: [[/''|[^']+/, 'string'], [/'/, { token: 'string', next: '@pop' }]],
    doubleQuote: [[/""|[^"]+/, 'identifier'], [/"/, { token: 'identifier', next: '@pop' }]],
    backtick: [[/``|[^`]+/, 'identifier'], [/`/, { token: 'identifier', next: '@pop' }]],
    bracket: [[/[^\]]+/, 'identifier'], [/\]/, { token: 'identifier', next: '@pop' }]],
  },
};

const registered = new WeakSet<object>();
/** 注册一次，SQLite 查询和只读预览共享显示规则，查询服务仍按各自模型绑定。 */
export function registerSqliteEditorLanguage(api: typeof languages): void {
  if (registered.has(api)) return;
  api.register({ id: sqliteEditorLanguage });
  api.setMonarchTokensProvider(sqliteEditorLanguage, grammar);
  api.setLanguageConfiguration(sqliteEditorLanguage, {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' },
      { open: "'", close: "'" }, { open: '`', close: '`' },
    ],
  });
  registered.add(api);
}
