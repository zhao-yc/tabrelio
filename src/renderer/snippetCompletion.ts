import { signatureLexicalContext } from '../shared/completionLexical';
import { postgresSqlContentStart, splitPostgresSql } from '../shared/postgresSql';
import type { ConnectionProfile, SqlSnippet } from '../shared/contracts';
import { SNIPPET_LIMITS } from '../shared/snippets';
import { invoke } from './lib';
import { zh } from './locales/zh-CN';

const editableTemplates = new WeakMap<SqlSnippet, string>();
const escapeTemplate = (value: string) => value.replace(/[\\$}]/g, character => '\\' + character);

/** 预览和插入共用正文。只有本地内置对象可携带 Tab 字段，复制或导入后按普通文本处理。 */
function builtin(dialect: ConnectionProfile['dialect'], id: string, name: string, description: string, group: string = zh.snippets.builtin) {
  return (parts: TemplateStringsArray, ...fields: string[]): SqlSnippet => {
    // 方言转换只作用于受控模板的固定文本；字段不包含引号。
    const literals = parts.map(part => dialect === 'postgresql' || dialect === 'sqlite' ? part.replaceAll('`', '"') : part);
    if (dialect === 'sqlite' && id === 'builtin-explain') literals[0] = literals[0].replace(/^EXPLAIN\n/, 'EXPLAIN QUERY PLAN\n');
    let sql = literals[0], insertion = escapeTemplate(literals[0]);
    const positions = new Map<string, number>();
    for (const [index, value] of fields.entries()) {
      // 同一模板内重复的字段联动编辑，如 SELECT、WHERE、ORDER BY 里的主键名。
      const position = positions.get(value) ?? positions.size + 1;
      positions.set(value, position);
      sql += value + literals[index + 1];
      insertion += '${' + position + ':' + escapeTemplate(value) + '}' + escapeTemplate(literals[index + 1]);
    }
    const snippet = Object.freeze({id, name, group, description, sql, updatedAt: ''});
    editableTemplates.set(snippet, insertion + '$0');
    return snippet;
  };
}

export function builtinSnippetInsertion(snippet: SqlSnippet): string | undefined {
  return editableTemplates.get(snippet);
}

function templatesFor(dialect: ConnectionProfile['dialect']): SqlSnippet[] {
  const text = zh.snippets;
  const parameterHelp = dialect === 'sqlite' ? text.parameterSqlite
    : dialect === 'mariadb' ? text.parameterMariaDb : text.parameterDescription;
  const select = builtin(dialect, 'builtin-select', text.selectColumns, text.selectDescription)
    `SELECT \`${'id'}\`, \`${'name'}\`
FROM \`${'your_table'}\`
WHERE \`${'id'}\` > ${'0'}
ORDER BY \`${'id'}\`
LIMIT ${'100'};`;
  const count = builtin(dialect, 'builtin-count', text.countName, text.countDescription)
    `SELECT \`${'category'}\`, COUNT(*) AS \`${'record_count'}\`
FROM \`${'your_table'}\`
GROUP BY \`${'category'}\`
ORDER BY \`${'record_count'}\` DESC;`;
  const explain = builtin(dialect, 'builtin-explain', text.explainName, text.explainDescription)
    `EXPLAIN
SELECT *
FROM \`${'your_table'}\`
WHERE \`${'id'}\` = ${'1'};`;
  const result = builtin(dialect, 'builtin-result-title', text.resultTitleName, text.resultTitleDescription, text.queryTemplateGroup)
    `-- NAME:${'查询结果'}
${'SELECT 1 AS value;'}`;
  const parameter = builtin(dialect, 'builtin-named-parameter', text.parameterName, parameterHelp, text.queryTemplateGroup)
    `SELECT [$${'value'}] AS ${'result'};`;
  return [select, count, explain, result, parameter];
}

export const snippetTemplates = templatesFor('mysql');
const mariadbTemplates = templatesFor('mariadb'), postgresTemplates = templatesFor('postgresql'), sqliteTemplates = templatesFor('sqlite');
/** 方言模板使用稳定对象，模态重渲染后仍能识别只读的内置记录。 */
export function snippetTemplatesForDialect(dialect?: ConnectionProfile['dialect']): SqlSnippet[] {
  return dialect === 'postgresql' ? postgresTemplates : dialect === 'sqlite' ? sqliteTemplates
    : dialect === 'mariadb' ? mariadbTemplates : snippetTemplates;
}

/** 共享本窗口的单次本地读取；写入后的旧回包不能再次发布。 */
export function createSnippetCatalog(read: () => Promise<SqlSnippet[]>) {
  let pending: Promise<SqlSnippet[] | undefined> | undefined;
  return {
    list() {
      if (pending) return pending;
      const request: Promise<SqlSnippet[] | undefined> = read().then(rows => pending === request ? rows : undefined, () => {
        if (pending === request) pending = undefined;
        return undefined;
      });
      return pending = request;
    },
    invalidate() { pending = undefined; },
  };
}
export const snippetCatalog = createSnippetCatalog(() => invoke('snippets.list', {}));

/** 先用当前行提取名称前缀，避免每次按键都扫描完整文档。 */
export function snippetPrefix(beforeCursor: string): string | undefined {
  const value = /(?:^|;)[ \t]*([\p{L}_][\p{L}\p{N}_]*)$/u.exec(beforeCursor)?.[1];
  return value && value.length >= 2 && value.length <= SNIPPET_LIMITS.name ? value : undefined;
}

/** 只替换独立语句中的完整前缀，避免在注释、字符串或现有语句内部插入。 */
export function snippetAtStatementStart(source: string, offset: number, prefix: string, dialect: ConnectionProfile['dialect'], standardStrings?: boolean): boolean {
  if (dialect === 'postgresql') {
    if (source.length > 65_536 || !Number.isInteger(offset) || offset < prefix.length || offset > source.length ||
        /[A-Za-z_0-9$\u0080-\uFFFF]/.test(source[offset] ?? '')) return false;
    // 复用执行扫描器，不把 dollar 正文、嵌套注释或转义字符串中的分号误认成边界。
    // 离线没有会话模式时，两种字符串模式都必须确认原前缀是独立语句。
    return (standardStrings === undefined ? [true, false] : [standardStrings]).every(mode => {
      try {
        const before = source.slice(0, offset), statement = splitPostgresSql(before, mode).at(-1);
        if (!statement) return false;
        const start = statement.start + postgresSqlContentStart(statement.sql);
        return start === offset - prefix.length && source.slice(start, offset) === prefix && statement.end === offset;
      } catch { return false; }
    });
  }
  const context = signatureLexicalContext(source, offset, dialect);
  if (context.status !== 'ready' || context.tokens.length !== 1) return false;
  const [token] = context.tokens;
  return token.kind === 'word' && token.start === offset - prefix.length && token.end === offset && token.value === prefix;
}

/** 同名片段保留各自分组；最多返回 20 条，避免宽前缀展开整个片段库。 */
export function matchSnippetPrefix(rows: readonly SqlSnippet[], prefix: string, dialect: ConnectionProfile['dialect']): SqlSnippet[] {
  const needle = prefix.toLowerCase();
  const matches = [...rows, ...snippetTemplatesForDialect(dialect)].filter(item => item.name.toLowerCase().startsWith(needle));
  return matches.sort((left, right) => Number(right.name.toLowerCase() === needle) - Number(left.name.toLowerCase() === needle)).slice(0, 20);
}
