import { completionIdentifier, mysqlDefinitionTokens, quoteCompletionIdentifier, type CompletionToken } from './completionLexical';

const limit = 128 * 1024;
const invalidQuery = 'SQL 文件须包含一条不带参数或 CHECK OPTION 的 SELECT 查询。';
const invalidDraft = '当前视图 DDL 的语句边界、目标或属性无法确认，请重新打开视图定义。';
const word = (token: CompletionToken | undefined) => token?.kind === 'word' ? token.value.toUpperCase() : '';
const symbol = (token: CompletionToken | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const name = (token: CompletionToken | undefined) => token?.kind === 'word' || token?.kind === 'identifier' ? token.value : undefined;

/** CHECK OPTION 只从末尾的外层关键字读取，正文的注释和引用名不参与匹配。 */
function checkOption(tokens: CompletionToken[]) {
  const tail = tokens.slice(-4);
  if (tail.at(-2)?.depth !== 0 || tail.at(-1)?.depth !== 0 ||
      word(tail.at(-2)) !== 'CHECK' || word(tail.at(-1)) !== 'OPTION') return;
  const at = ['LOCAL', 'CASCADED'].includes(word(tail.at(-3))) ? -4 : -3;
  const withToken = tail.at(at);
  if (withToken?.depth === 0 && word(withToken) === 'WITH') return withToken;
}

/** 引号模式取决于执行连接。四种模式必须得到同一草稿，才能保留准确的语句边界。 */
function commonSql(build: (ansiQuotes: boolean, noBackslashEscapes: boolean) => string, message: string): string {
  const sql = build(false, false);
  if (build(true, false) !== sql || build(false, true) !== sql || build(true, true) !== sql) throw Error(message);
  return sql;
}

export function mysqlViewFileQuery(source: string): string {
  if (new TextEncoder().encode(source).length > limit) throw Error('视图定义文件超过 128 KiB。');
  return commonSql((quotes, escapes) => {
    const result = mysqlDefinitionTokens(source, quotes, escapes);
    const first = word(result?.tokens[0]);
    if (!result || !['SELECT', 'WITH'].includes(first) ||
        first === 'WITH' && !result.tokens.some(token => token.depth === 0 && word(token) === 'SELECT') ||
        checkOption(result.tokens) ||
        result.tokens.some(token => symbol(token, '?') || symbol(token, ':') || token.depth === 0 && word(token) === 'INTO'))
      throw Error(invalidQuery);
    return source.slice(result.statement.start, result.statement.end).trim();
  }, invalidQuery);
}

/** 文件不提供视图名称。新建使用 CREATE VIEW，保留数据库的同名拒绝。 */
export function mysqlNewViewHeader(database: string, view: string): string {
  return 'CREATE VIEW ' + quoteCompletionIdentifier(database) + '.' + quoteCompletionIdentifier(view) + ' AS\n';
}

/** 仅定位视图头与尾，保留 SHOW CREATE 或当前草稿中完整的安全属性和列清单。 */
export function replaceMysqlViewFileQuery(source: string, database: string, view: string, query: string): string {
  return commonSql((quotes, escapes) => {
    const result = mysqlDefinitionTokens(source, quotes, escapes);
    if (!result) throw Error(invalidDraft);
    const { tokens, statement } = result;
    let at = 0;
    const expectWord = (value: string) => { if (word(tokens[at++]) !== value) throw Error(invalidDraft); };
    const expectSymbol = (value: string) => { if (!symbol(tokens[at++], value)) throw Error(invalidDraft); };
    const expectName = () => {
      const value = name(tokens[at++]);
      if (!completionIdentifier(value)) throw Error(invalidDraft);
      return value;
    };
    const expectAccount = () => {
      if (!['string', 'word', 'identifier', 'number'].includes(tokens[at++]?.kind ?? '')) throw Error(invalidDraft);
    };
    expectWord('CREATE');
    if (word(tokens[at]) === 'OR') { at++; expectWord('REPLACE'); }
    if (word(tokens[at]) === 'ALGORITHM') {
      at++; expectSymbol('=');
      if (!['UNDEFINED', 'MERGE', 'TEMPTABLE'].includes(word(tokens[at++]))) throw Error(invalidDraft);
    }
    if (word(tokens[at]) === 'DEFINER') {
      at++; expectSymbol('=');
      const currentUser = word(tokens[at]) === 'CURRENT_USER';
      expectAccount();
      if (symbol(tokens[at], '@')) { at++; expectAccount(); }
      else if (!currentUser) throw Error(invalidDraft);
      else if (symbol(tokens[at], '(')) { at++; expectSymbol(')'); }
    }
    if (word(tokens[at]) === 'SQL') {
      at++; expectWord('SECURITY');
      if (!['DEFINER', 'INVOKER'].includes(word(tokens[at++]))) throw Error(invalidDraft);
    }
    expectWord('VIEW');
    let target = expectName();
    if (symbol(tokens[at], '.')) {
      if (target !== database) throw Error(invalidDraft);
      at++; target = expectName();
    }
    if (target !== view) throw Error(invalidDraft);
    if (symbol(tokens[at], '(')) {
      do { at++; expectName(); } while (symbol(tokens[at], ','));
      expectSymbol(')');
    }
    expectWord('AS');
    if (!tokens[at]) throw Error(invalidDraft);
    const option = checkOption(tokens);
    const suffix = option ? source.slice(option.start, statement.end).trimEnd() + '\n' : '';
    return source.slice(statement.start, tokens[at - 1].end) + '\n' + query + '\n' + suffix + ';';
  }, invalidDraft);
}
