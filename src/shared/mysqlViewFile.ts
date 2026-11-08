import { z } from 'zod';
import { completionIdentifier, mysqlDefinitionTokens, quoteCompletionIdentifier, type CompletionToken } from './completionLexical';

const limit = 128 * 1024;
export const mysqlViewSampleRows = 100;
export const mysqlViewQueryInspectSchema = z.object({
  connectionId: z.string().min(1).max(128),
  database: z.string().refine(completionIdentifier),
  name: z.string().refine(completionIdentifier),
  sql: z.string().min(1).max(limit),
  mode: z.enum(['rows', 'explain']),
}).strict();
export type MysqlViewQueryInspectInput = z.infer<typeof mysqlViewQueryInspectSchema>;

export const mysqlViewAttributeOptions = {
  algorithm: ['UNDEFINED', 'MERGE', 'TEMPTABLE'],
  security: ['DEFINER', 'INVOKER'],
  check: ['NONE', 'LOCAL', 'CASCADED'],
} as const;
type MysqlViewAttributes = { [K in keyof typeof mysqlViewAttributeOptions]: (typeof mysqlViewAttributeOptions)[K][number] };
export type MysqlViewAttributeChange = { [K in keyof MysqlViewAttributes]: { key: K; value: MysqlViewAttributes[K] } }[keyof MysqlViewAttributes];

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
function commonSql<T extends string | MysqlViewAttributes>(build: (ansiQuotes: boolean, noBackslashEscapes: boolean) => T, message: string): T {
  const value = build(false, false);
  const comparable = (item: T) => typeof item === 'string' ? item : JSON.stringify(item);
  const expected = comparable(value);
  if (comparable(build(true, false)) !== expected || comparable(build(false, true)) !== expected ||
      comparable(build(true, true)) !== expected) throw Error(message);
  return value;
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

// 视图文件替换和预览复用同一目标绑定，列清单和安全属性以原 DDL 为准。
function mysqlViewParts(source: string, database: string, view: string, quotes: boolean, escapes: boolean) {
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
  const verb = word(tokens[at++]);
  if (verb !== 'CREATE' && verb !== 'ALTER') throw Error(invalidDraft);
  if (verb === 'CREATE' && word(tokens[at]) === 'OR') { at++; expectWord('REPLACE'); }
  const algorithmAt = at;
  let algorithm: CompletionToken | undefined;
  if (word(tokens[at]) === 'ALGORITHM') {
    at++; expectSymbol('=');
    algorithm = tokens[at++];
    if (!mysqlViewAttributeOptions.algorithm.some(value => value === word(algorithm))) throw Error(invalidDraft);
  }
  if (word(tokens[at]) === 'DEFINER') {
    at++; expectSymbol('=');
    const implicitAccount = ['CURRENT_USER', 'CURRENT_ROLE'].includes(word(tokens[at]));
    expectAccount();
    if (symbol(tokens[at], '@')) { at++; expectAccount(); }
    else if (implicitAccount && symbol(tokens[at], '(')) { at++; expectSymbol(')'); }
  }
  let security: CompletionToken | undefined;
  if (word(tokens[at]) === 'SQL') {
    at++; expectWord('SECURITY');
    security = tokens[at++];
    if (!mysqlViewAttributeOptions.security.some(value => value === word(security))) throw Error(invalidDraft);
  }
  const securityAt = at;
  expectWord('VIEW');
  if (verb === 'CREATE' && word(tokens[at]) === 'IF') { at++; expectWord('NOT'); expectWord('EXISTS'); }
  let target = expectName();
  if (symbol(tokens[at], '.')) {
    if (target !== database) throw Error(invalidDraft);
    at++; target = expectName();
  }
  if (target !== view) throw Error(invalidDraft);
  const targetToken = tokens[at - 1];
  const aliases: string[] = [];
  if (symbol(tokens[at], '(')) {
    do { at++; aliases.push(expectName()); } while (symbol(tokens[at], ','));
    expectSymbol(')');
  }
  expectWord('AS');
  if (!tokens[at]) throw Error(invalidDraft);
  const option = checkOption(tokens);
  const checkTokens = option ? tokens.slice(tokens.lastIndexOf(option)) : [];
  return { statement, aliases, headerEnd: tokens[at - 1].end, bodyTokens: tokens.slice(at), option,
    targetToken, algorithm, algorithmAt: tokens[algorithmAt].start, security, securityAt: tokens[securityAt].start, checkTokens };
}

type ViewParts = ReturnType<typeof mysqlViewParts>;

function viewAttributes(parts: ViewParts): MysqlViewAttributes {
  const algorithm = mysqlViewAttributeOptions.algorithm.find(value => value === word(parts.algorithm)) ?? 'UNDEFINED';
  const security = word(parts.security) === 'INVOKER' ? 'INVOKER' : 'DEFINER';
  const check = parts.option ? word(parts.checkTokens[1]) === 'LOCAL' ? 'LOCAL' : 'CASCADED' : 'NONE';
  return { algorithm, security, check };
}

/** 读取当前同名草稿中的属性，缺省值按 MySQL 和 MariaDB 的 DDL 语义展示。 */
export function mysqlViewDraftAttributes(source: string, database: string, view: string): MysqlViewAttributes {
  return commonSql((quotes, escapes) => viewAttributes(mysqlViewParts(source, database, view, quotes, escapes)), invalidDraft);
}

/** 只改动所选属性的关键字，定义者、列清单、查询正文和原注释继续沿用。 */
export function changeMysqlViewDraftAttribute(source: string, database: string, view: string, change: MysqlViewAttributeChange): string {
  if (!mysqlViewAttributeOptions[change.key].some(value => value === change.value)) throw Error(invalidDraft);
  return commonSql((quotes, escapes) => {
    const parts = mysqlViewParts(source, database, view, quotes, escapes);
    if (viewAttributes(parts)[change.key] === change.value) return source;
    const replace = (at: number, end: number, value: string) => source.slice(0, at) + value + source.slice(end);
    if (change.key === 'algorithm') {
      const token = parts.algorithm;
      return token ? replace(token.start, token.end, change.value) :
        replace(parts.algorithmAt, parts.algorithmAt, 'ALGORITHM=' + change.value + ' ');
    }
    if (change.key === 'security') {
      const token = parts.security;
      return token ? replace(token.start, token.end, change.value) :
        replace(parts.securityAt, parts.securityAt, 'SQL SECURITY ' + change.value + ' ');
    }
    if (change.value === 'NONE') {
      // 从后往前删除关键字，保留子句中夹着的注释及原有行结束符。
      return parts.checkTokens.reduceRight((sql, token) => sql.slice(0, token.start) + sql.slice(token.end), source);
    }
    if (!parts.option) {
      const at = parts.statement.end;
      return replace(at, at, '\nWITH ' + change.value + ' CHECK OPTION\n');
    }
    const scope = parts.checkTokens[1];
    return parts.checkTokens.length === 4 ? replace(scope.start, scope.end, change.value) :
      replace(parts.option.end, parts.option.end, ' ' + change.value);
  }, invalidDraft);
}

/** 新建视图改名只替换匹配的目标标识符，已经编辑的定义及属性保留。 */
export function renameMysqlViewDraft(source: string, database: string, view: string, next: string): string {
  if (!completionIdentifier(next)) throw Error('视图名称必须为 1～64 个有效字符。');
  return commonSql((quotes, escapes) => {
    const { targetToken } = mysqlViewParts(source, database, view, quotes, escapes);
    return source.slice(0, targetToken.start) + quoteCompletionIdentifier(next) + source.slice(targetToken.end);
  }, invalidDraft);
}

/** 仅定位视图头与尾，保留 SHOW CREATE 或当前草稿中完整的安全属性和列清单。 */
export function replaceMysqlViewFileQuery(source: string, database: string, view: string, query: string): string {
  return commonSql((quotes, escapes) => {
    const { statement, headerEnd, option } = mysqlViewParts(source, database, view, quotes, escapes);
    const suffix = option ? source.slice(option.start, statement.end).trimEnd() + '\n' : '';
    return source.slice(statement.start, headerEnd) + '\n' + query + '\n' + suffix + ';';
  }, invalidDraft);
}

/** 另存文件只携带查询。用导入所需的四种词法模式核对正文边界，确保文件可重新载入。 */
export function exportMysqlViewFileQuery(source: string, database: string, view: string): string {
  const query = commonSql((quotes, escapes) => {
    const { statement, headerEnd, option } = mysqlViewParts(source, database, view, quotes, escapes);
    return source.slice(headerEnd, option?.start ?? statement.end).trim();
  }, invalidDraft);
  const file = query + '\n;';
  mysqlViewFileQuery(file);
  return file;
}

/** 按实际读取连接的引号模式提取单条查询，保留排序和外层 LIMIT。DDL 从不发给预览连接。 */
export function mysqlViewDraftQuery(input: MysqlViewQueryInspectInput, ansiQuotes: boolean, noBackslashEscapes: boolean) {
  if (new TextEncoder().encode(input.sql).length > limit) throw Error('视图定义草稿超过 128 KiB。');
  const { statement, aliases, headerEnd, bodyTokens, option } =
    mysqlViewParts(input.sql, input.database, input.name, ansiQuotes, noBackslashEscapes);
  const tokens = option ? bodyTokens.filter(token => token.start < option.start) : bodyTokens;
  const first = word(tokens[0]);
  const cteCommand = first === 'WITH' && tokens.find(token =>
    token.depth === 0 && ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(word(token)));
  if ((first !== 'SELECT' && word(cteCommand || undefined) !== 'SELECT') ||
      tokens.some(token => symbol(token, '?') || symbol(token, ':') || word(token) === 'INTO'))
    throw Error('视图预览需要一条不带参数、变量赋值或 INTO 的 SELECT 查询。');
  return { query: input.sql.slice(headerEnd, option?.start ?? statement.end).trim(), aliases };
}
