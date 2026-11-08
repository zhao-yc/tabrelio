import type { MysqlSqlFileChooseInput, MysqlSqlFileInspection, MysqlSqlFileInspectionInput } from '../shared/mysqlSqlFile';
import { SqlScriptScanner } from '../shared/sqlScriptScanner';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import { mysqlDumpAssignmentTarget, mysqlDumpObjectName, mysqlDumpStatementTokens, mysqlDumpVersionNumber, mysqlDumpWord } from './databaseBackupSqlInventory';
import { MysqlSqlEncodingError, readMysqlSqlFile, type MysqlSqlFileSource } from './mysqlSqlFile';
import type { TableDefinitionToken } from './tableColumnDefinition';

type Mode = TableDefinitionContext['mode'] | null;
type Issue = NonNullable<MysqlSqlFileInspection['issue']>['reason'];
const fallback = { ansiQuotes: false, noBackslashEscapes: false };
const bufferLimit = 8 * 1024 * 1024;
const statementLimit = 500_000;
const databaseLimit = 20;
const structure = new Set(['CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE']);
const changes = new Set(['INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'LOAD']);
const destructive = new Set(['DROP', 'TRUNCATE', 'DELETE', 'REPLACE']);

function readMode(tokens: TableDefinitionToken[]): Mode {
  if (tokens.length !== 1 || tokens[0].kind !== 'string' || !/^[A-Z0-9_,]*$/i.test(tokens[0].value)) return null;
  const modes = tokens[0].value.toUpperCase().split(',');
  if (modes.some(mode => ['DB2', 'MAXDB', 'MSSQL', 'ORACLE', 'POSTGRESQL'].includes(mode))) return null;
  return { ansiQuotes: modes.includes('ANSI_QUOTES') || modes.includes('ANSI'), noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES') };
}

/** 原生转储会保存并恢复 SQL_MODE。复杂表达式退回多模式核对，避免猜测字符串边界。 */
function nextMode(tokens: TableDefinitionToken[], previous: Mode, saved: Map<string, Mode>): Mode {
  const parts: TableDefinitionToken[][] = [[]];
  for (const token of tokens.slice(1)) {
    if (token.kind === 'symbol' && token.value === ',') parts.push([]);
    else parts.at(-1)!.push(token);
  }
  let mode = previous;
  for (const part of parts) {
    const equal = part.findIndex(token => token.kind === 'symbol' && token.value === '=');
    const target = equal > 0 ? mysqlDumpAssignmentTarget(part.slice(0, equal)) : undefined;
    if (!target) {
      // SET NAMES、SET CHARACTER SET 不会修改两个字符串解析标志。
      if (!['NAMES', 'CHARACTER'].includes(mysqlDumpWord(part[0]))) mode = null;
      continue;
    }
    const rhs = part.slice(equal + 1), reference = mysqlDumpAssignmentTarget(rhs);
    const value = reference === 'SQL_MODE' ? mode : reference?.startsWith('@') ? saved.get(reference) ?? null : readMode(rhs);
    if (target === 'SQL_MODE') mode = value;
    else if (target.startsWith('@') && (saved.size < 64 || saved.has(target))) saved.set(target, value);
  }
  return mode;
}

function databaseAction(tokens: TableDefinitionToken[], verb: string): MysqlSqlFileInspection['databaseActions'][number] | undefined {
  let cursor = 1;
  if (verb !== 'USE') {
    if ((verb !== 'CREATE' && verb !== 'DROP') || !['DATABASE', 'SCHEMA'].includes(mysqlDumpWord(tokens[cursor++]))) return;
    if (mysqlDumpWord(tokens[cursor]) === 'IF') {
      if (verb === 'CREATE' && mysqlDumpWord(tokens[cursor + 1]) === 'NOT' && mysqlDumpWord(tokens[cursor + 2]) === 'EXISTS') cursor += 3;
      else if (verb === 'DROP' && mysqlDumpWord(tokens[cursor + 1]) === 'EXISTS') cursor += 2;
    }
  }
  if (verb !== 'CREATE' && tokens.length !== cursor + 1) return;
  const name = mysqlDumpObjectName(tokens[cursor]);
  if (name) return { action: verb === 'USE' ? 'use' : verb === 'CREATE' ? 'create' : 'drop', name };
}

/** 与实际执行共享流式解码和分隔符扫描，仅统计静态可见操作。 */
export async function inspectMysqlRestoreSql(source: MysqlSqlFileSource, encoding: MysqlSqlFileChooseInput['encoding'],
  { family, version }: Pick<MysqlSqlFileInspectionInput, 'family' | 'version'>, signal: AbortSignal, check: () => void): Promise<MysqlSqlFileInspection> {
  const report: MysqlSqlFileInspection = { statements: 0, structure: 0, changes: 0, destructive: 0, databaseActions: [], moreDatabases: false };
  const gate = mysqlDumpVersionNumber(version);
  if (gate === undefined) throw Error('请输入三段参考版本');
  const scanner = new SqlScriptScanner(false, false, false, false), saved = new Map<string, Mode>();
  let units = 0, mode: Mode = null;
  const stop = (reason: Issue) => { report.issue = { reason, nextStatement: report.statements + 1 }; };
  const drain = (chunk: string, final = false) => {
    units += chunk.length;
    if (units - scanner.retainedSourceOffset > bufferLimit) return stop('budget');
    try {
      for (let item = scanner.pushRanges(chunk, final, 1)[0]; item; item = scanner.pushRanges('', final, 1)[0]) {
        check();
        const context: TableDefinitionContext = { dialect: family, mode: mode ?? fallback };
        const tokens = mysqlDumpStatementTokens(item.sql, context, gate);
        if (!tokens.length) continue;
        const verb = mysqlDumpWord(tokens[0]);
        if (verb === 'SOURCE' || tokens[0].value === '\\') return stop('client');
        if (report.statements >= statementLimit) return stop('budget');
        const entry = databaseAction(tokens, verb);
        if (entry && !report.databaseActions.some(item => item.action === entry.action && item.name === entry.name)) {
          if (report.databaseActions.length < databaseLimit) report.databaseActions.push(entry);
          else report.moreDatabases = true;
        }
        if (structure.has(verb)) report.structure++;
        if (changes.has(verb)) report.changes++;
        if (destructive.has(verb)) report.destructive++;
        report.statements++;
        const previous = mode;
        if (verb === 'SET') mode = nextMode(mysqlDumpStatementTokens(item.sql, context, gate, true), mode, saved);
        else if (['CALL', 'EXECUTE'].includes(verb)) mode = null;
        if (mode !== previous) scanner.setMode(mode?.noBackslashEscapes ?? false, mode?.ansiQuotes ?? false, !!mode, !!mode);
      }
    } catch {
      stop(signal.aborted ? 'cancelled' : 'lexical');
    }
  };
  try {
    for await (const chunk of readMysqlSqlFile(source, encoding, family, check)) {
      drain(chunk);
      if (report.issue) return report;
    }
    drain('', true);
    check();
  } catch (reason) { stop(signal.aborted ? 'cancelled' : reason instanceof MysqlSqlEncodingError ? 'encoding' : 'file'); }
  return report;
}
