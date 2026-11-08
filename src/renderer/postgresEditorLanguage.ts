import type { languages } from 'monaco-editor';
import { postgresql } from 'sql-formatter';

const standardLanguage = 'dbark-postgresql';
const escapeLanguage = 'dbark-postgresql-backslash';
export const postgresEditorLanguages = [standardLanguage, escapeLanguage] as const;

const pg = postgresql.tokenizerOptions;
const keywords = new Set([
  pg.reservedSelect, pg.reservedClauses, pg.reservedSetOperations,
  pg.reservedJoins, pg.reservedKeywordPhrases, pg.reservedKeywords,
].flatMap(group => (group ?? []).flatMap(phrase => phrase.toLowerCase().split(/\s+/))));
const builtins = new Set([...pg.reservedDataTypes, ...pg.reservedFunctionNames].map(word => word.toLowerCase()));

type Quote = { kind: 'quote'; delimiter: "'" | '"'; backslash: boolean };
type Mode = { kind: 'root' } | { kind: 'comment'; depth: number } | { kind: 'dollar'; tag: string } |
  Quote | { kind: 'continuation'; backslash: boolean };

/** Monaco 会缓存逐行状态。状态不可变且按内容比较，局部编辑后可在恢复同一词法边界时停止重算。 */
class LineState implements languages.IState {
  constructor(readonly mode: Mode) {}
  clone() { return this; }
  equals(other: languages.IState): boolean {
    if (!(other instanceof LineState)) return false;
    const left = this.mode, right = other.mode;
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
      case 'dollar': return right.kind === 'dollar' && left.tag === right.tag;
      case 'comment': return right.kind === 'comment' && left.depth === right.depth;
      case 'quote': return right.kind === 'quote' && left.delimiter === right.delimiter && left.backslash === right.backslash;
      case 'continuation': return right.kind === 'continuation' && left.backslash === right.backslash;
      case 'root': return true;
    }
  }
}

const root = { kind: 'root' } as const;
const initial = new LineState(root);
const whitespace = /[ \t\r\n\f\v]+/;
const identifier = /[a-zA-Z_\u0080-\uFFFF][\w$\u0080-\uFFFF]*/;
const dollar = /\$(?:[a-zA-Z_\u0080-\uFFFF][a-zA-Z_0-9\u0080-\uFFFF]*)?\$/;
const basedNumber = /0(?:[xX]_?[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*|[oO]_?[0-7]+(?:_[0-7]+)*|[bB]_?[01]+(?:_[01]+)*)/;
const decimal = /(?:\d+(?:_\d+)*(?:\.(?!\.)(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?/;

/** 只为编辑器着色，逐行保留字符串和嵌套注释状态，不调用查询引擎或修改模型。 */
export function postgresEditorTokens(standardStrings: boolean): languages.TokensProvider {
  const token = new RegExp([whitespace, /--|\/\*/, /[eEbBxXnN]'|[uU]&['"]|['"]/, dollar, /\$[0-9]+/,
    identifier, basedNumber, decimal, /::|./].map(pattern => pattern.source).join('|'), 'y');
  const comment = /\/\*|\*\//g;
  return {
    getInitialState: () => initial,
    tokenize(line, state) {
      let mode = state instanceof LineState ? state.mode : root;
      let continuation = mode.kind === 'continuation' ? mode.backslash : undefined;
      if (mode.kind === 'continuation') mode = root;
      let pending = continuation;
      let offset = 0;
      const tokens: languages.IToken[] = [];
      function mark(scope: string) {
        const scopes = scope ? scope + '.sql' : '';
        if (tokens.at(-1)?.scopes !== scopes) tokens.push({ startIndex: offset, scopes });
      }
      while (offset < line.length) {
        if (mode.kind === 'dollar') {
          mark('string');
          // 标签逐字匹配，大小写不同的标签和函数体内其它标签均留在原字符串内。
          const close = line.indexOf(mode.tag, offset);
          if (close < 0) break;
          offset = close + mode.tag.length;
          mode = root;
        } else if (mode.kind === 'comment') {
          mark('comment');
          comment.lastIndex = offset;
          let depth = mode.depth;
          while (depth) {
            const match = comment.exec(line);
            if (!match) break;
            depth += match[0] === '/*' ? 1 : -1;
          }
          if (depth) { mode = { kind: 'comment', depth }; break; }
          offset = comment.lastIndex;
          mode = root;
        } else if (mode.kind === 'quote') {
          mark(mode.delimiter === "'" ? 'string' : 'identifier');
          while (offset < line.length) {
            const char = line[offset++];
            if (char === '\\' && mode.backslash) { offset++; continue; }
            if (char !== mode.delimiter) continue;
            if (line[offset] === char) { offset++; continue; }
            if (char === "'") pending = mode.backslash;
            mode = root;
            break;
          }
        } else {
          token.lastIndex = offset;
          const raw = token.exec(line)?.[0] ?? line[offset];
          const quote = raw.at(-1);
          if (whitespace.test(raw[0])) mark('white');
          else if (raw === '--') { mark('comment'); break; }
          else {
            const continued = continuation;
            continuation = pending = undefined;
            if (raw === '/*') {
              mark('comment');
              mode = { kind: 'comment', depth: 1 };
            } else if (quote === "'" || quote === '"') {
              mark(quote === "'" ? 'string' : 'identifier');
              const backslash = quote === "'" && (raw === "'" ? (continued ?? !standardStrings) : /^e/i.test(raw) || /^n/i.test(raw) && !standardStrings);
              mode = { kind: 'quote', delimiter: quote, backslash };
            } else if (raw.startsWith('$') && raw.endsWith('$') && raw.length > 1) {
              mark('string');
              mode = { kind: 'dollar', tag: raw };
            } else if (/^\$\d/.test(raw)) mark('variable');
            else if (/^(?:\d|\.\d)/.test(raw)) mark('number');
            else if (/^[a-zA-Z_\u0080-\uFFFF]/.test(raw)) {
              const word = raw.toLowerCase();
              mark(keywords.has(word) ? 'keyword' : builtins.has(word) ? 'predefined' : 'identifier');
            } else if ('[](){}.,;:'.includes(raw)) mark('delimiter');
            else if (raw === '::' || /^[+*/<>=~!@#%^&|`?\-]$/.test(raw)) mark('operator');
            else mark('');
          }
          offset += raw.length;
        }
      }
      if (mode.kind === 'root' && pending !== undefined) mode = { kind: 'continuation', backslash: pending };
      return { tokens, endState: mode.kind === 'root' ? initial : new LineState(mode) };
    },
  };
}

export function postgresEditorLanguage(standardStrings?: boolean) {
  return standardStrings === false ? escapeLanguage : standardLanguage;
}

const registered = new WeakSet<object>();
/** 两个会话模式使用独立语言 ID，不让另一标签的字符串设置改变当前编辑器。 */
export function registerPostgresEditorLanguages(api: typeof languages): void {
  if (registered.has(api)) return;
  for (const id of postgresEditorLanguages) {
    api.register({ id });
    api.setTokensProvider(id, postgresEditorTokens(id === standardLanguage));
    const brackets: [string, string][] = [['{', '}'], ['[', ']'], ['(', ')']];
    api.setLanguageConfiguration(id, {
      comments: { lineComment: '--', blockComment: ['/*', '*/'] },
      brackets,
      autoClosingPairs: [...brackets.map(([open, close]) => ({ open, close })), { open: '"', close: '"' }, { open: "'", close: "'" }],
    });
  }
  registered.add(api);
}
