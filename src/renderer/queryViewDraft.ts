import type * as monaco from 'monaco-editor';
import type { ConnectionProfile } from '../shared/contracts';
import { mysqlViewFileQuery } from '../shared/mysqlViewFile';
import { preparePostgresViewDefinition } from '../shared/postgresCreateView';
import { scanPostgresFormattingTokens } from '../shared/postgresSql';
import { sqliteDefinitionTokens } from '../shared/sqliteCompletionAnalysis';
import { analyzeStatementNavigation, currentNavigableStatement, statementNavigationLimits } from '../shared/statementNavigation';
import { queryViewDraftZh as text } from './locales/queryViewDraft.zh-CN';

export interface QueryViewDraft {
  tabId: string; connectionId: string; version: number; database: string; dialect: ConnectionProfile['dialect']; sql: string;
}
export interface ViewQuerySeed {
  sql: string;
  version: number;
  preferredSchema?: string;
  current?(): boolean;
  beforeApply?(): Promise<void>;
}

/** 仅选取原模型中的一条完整查询，使用设计器的词法规则，不借此验证权限或执行 SQL。 */
export function queryViewDefinition(source: string, dialect: QueryViewDraft['dialect'], offset?: number): string {
  try {
    const analysis = analyzeStatementNavigation(source, dialect);
    if (analysis.status !== 'ready') throw Error(text.invalid);
    const index = offset === undefined ? (analysis.statements.length === 1 ? 0 : -1)
      : currentNavigableStatement(source, analysis.statements, offset, dialect);
    const selected = analysis.statements[index];
    if (!selected) throw Error(text.invalid);
    const query = source.slice(selected.start, selected.end).trim();
    // 固定换行，避免设计器添加的分号被末尾行注释吞掉。
    if (dialect === 'mysql' || dialect === 'mariadb') return mysqlViewFileQuery(query) + '\n';
    if (dialect === 'sqlite') {
      const tokens = sqliteDefinitionTokens(query);
      const word = (token: (typeof tokens)[number] | undefined) => token?.kind === 'id' && !token.quoted ? token.value.toUpperCase() : '';
      const first = word(tokens[0]);
      // WITH 的主语句紧跟最后一个 CTE 的右括号。只判断起始动词，保留 replace() 等合法表达式。
      const main = first === 'WITH' ? tokens.find((token, index) => token.depth === 0 &&
        tokens[index - 1]?.kind === 'symbol' && tokens[index - 1].value === ')' &&
        ['SELECT', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(word(token))) : tokens[0];
      if (!['SELECT', 'VALUES'].includes(word(main))) throw Error(text.invalid);
      return query + '\n';
    }
    for (const mode of [true, false]) {
      const scanned = scanPostgresFormattingTokens(query, 20000, mode);
      if (!scanned) throw Error(text.invalid);
      const tokens = scanned.filter(token => token.kind !== 'comment').map(token => query.slice(token.start, token.end).toUpperCase());
      // INTO 创建新表。WITH 中出现写语句起始也不是普通视图定义。
      const writes = ['INSERT', 'UPDATE', 'DELETE', 'MERGE'];
      if (tokens.includes('INTO') || (tokens[0] === 'WITH' && tokens.some((token, index) =>
        writes.includes(token) && (tokens[index - 1] === '(' || tokens[index - 1] === ')')))) throw Error(text.invalid);
    }
    return preparePostgresViewDefinition(query) + '\n';
  } catch { throw Error(text.invalid); }
}

/** 显式选区优先，限制读取长度后才取得正文。多光标不拼接为一个视图。 */
export function queryViewFromEditor(editor: monaco.editor.IStandaloneCodeEditor | null | undefined, dialect: QueryViewDraft['dialect']): string {
  const model = editor?.getModel(), selections = editor?.getSelections();
  if (!model || model.isDisposed() || selections?.length !== 1) throw Error(text.invalid);
  const range = selections[0], limit = statementNavigationLimits.sourceUnits;
  if (!range.isEmpty()) {
    if (model.getValueLengthInRange(range) > limit) throw Error(text.invalid);
    return queryViewDefinition(model.getValueInRange(range), dialect);
  }
  if (model.getValueLength() > limit) throw Error(text.invalid);
  return queryViewDefinition(model.getValue(), dialect, model.getOffsetAt(range.getPosition()));
}
