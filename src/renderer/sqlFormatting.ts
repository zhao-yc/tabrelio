import type * as monaco from 'monaco-editor';
import { format, formatDialect, mysql } from 'sql-formatter';
import { sqliteZh } from './locales/sqlite.zh-CN';
import { completionLimits } from '../shared/sqlCompletion';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';
import { editorIndentationOptions } from '../shared/editorIndentation';
import { readSqlKeywordCase, sqlKeywordRoleLimits } from '../shared/sqlKeywordCase';
import { scanPostgresFormattingTokens } from '../shared/postgresSql';

type RoleModule = typeof import('./sqlFormattingRoles');
let preparedRoles: RoleModule | undefined;
/** 仅显式大写/小写入口调用；模块加载成功前上层必须保留原模型/选区/owner，默认入口不调用。 */
export async function prepareSqlFormattingRoles(): Promise<void> { preparedRoles = await import('./sqlFormattingRoles'); }

export interface FormattingPreferences { tabSize?: unknown; insertSpaces?: unknown; keywordCase?: unknown; dialect?: 'mysql' | 'sqlite' | 'postgresql'; }
export type SqlFormattingMode = 'format' | 'compact';
type FormatterToken = Parameters<NonNullable<typeof mysql.tokenizerOptions.postProcess>>[0][number];
// 只列正式词法类型，不维护关键字单词表；函数/数据类型/变量/参数/标识符均不在其中。
const keywordTypes = new Set<string>(['RESERVED_KEYWORD', 'RESERVED_KEYWORD_PHRASE', 'RESERVED_SET_OPERATION', 'RESERVED_CLAUSE', 'RESERVED_SELECT', 'RESERVED_JOIN', 'CASE', 'END', 'WHEN', 'ELSE', 'THEN', 'LIMIT', 'BETWEEN', 'AND', 'OR', 'XOR']);
const functionNames = new Set(mysql.tokenizerOptions.reservedFunctionNames);

interface Atom { start: number; end: number; kind: string; raw: string; gapSensitive?: boolean; }
const whitespace = (char: string) => /[\t\n\r\f ]/.test(char);
const word = (char: string) => /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
const fail = (): never => { throw new Error(text.unsafe); };

/** 有界词法校验只用于确认排版未改变原始token，不把它当作SQL语法解析或执行器。 */
function atoms(source: string, ansiQuotes: boolean, noBackslashEscapes: boolean, sqlite = false): Atom[] {
  const out: Atom[] = []; let i = 0, depth = 0;
  while (i < source.length) {
    if (whitespace(source[i])) { i++; continue; }
    const start = i, char = source[i], next = source[i + 1]; let kind = 'symbol';
    if (!sqlite && char === '#' || char === '-' && next === '-' && (sqlite || /[\x00-\x20\x7f]/.test(source[i + 2] ?? ' '))) {
      kind = 'comment'; while (i < source.length && !/[\r\n]/.test(source[i])) i++;
    } else if (char === '/' && next === '*') {
      // 可执行注释及提示器具有独立语法；不能由普通formatter猜测其含义。
      if (/^(?:!|M!|\+)/i.test(source.slice(i + 2))) fail();
      const close = source.indexOf('*/', i + 2); if (close < 0) fail(); i = close + 2; kind = 'comment';
    } else if (sqlite && char === '[') {
      const close = source.indexOf(']', i + 1); if (close < 0) fail(); i = close + 1; kind = 'identifier';
    } else if (char === "'" || char === '"' || char === '`') {
      const identifier = char === '`' || char === '"' && ansiQuotes; kind = identifier ? 'identifier' : 'string'; i++; let closed = false;
      while (i < source.length) {
        const current = source[i++];
        if (current === char) { if (source[i] === char) i++; else { closed = true; break; } }
        else if (current === '\\' && !identifier && !noBackslashEscapes && i < source.length) i++;
      }
      if (!closed) fail();
    } else {
      const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (numeric && !word(source[i + numeric[0].length] ?? '')) { kind = 'number'; i += numeric[0].length; }
      else if (word(char)) { kind = 'word'; while (i < source.length && word(source[i])) i++; }
      else {
        const operator = /^(?:<=>|->>|->|:=|<=|>=|!=|<>|<<|>>|&&|\|\|)/.exec(source.slice(i)); i += operator?.[0].length ?? 1;
        if (char === '(' && ++depth > completionLimits.depth || char === ')' && --depth < 0) fail();
      }
    }
    const raw = source.slice(start, i), previous = out.at(-1);
    // 不支持的客户端/存储程序及模式变更脚本保守拒绝，包括未选中的上下文。
    if (kind === 'word' && /^(?:DELIMITER|PROCEDURE|FUNCTION|TRIGGER|EVENT|SQL_MODE)$/i.test(raw)) fail();
    // 命名参数/用户变量前缀同样不允许由排版拼接或拆开。
    const sensitive = previous && (['word', 'identifier'].includes(previous.kind) && raw === '(' || previous.kind === 'word' && kind === 'string' || [':', '@'].includes(previous.raw));
    out.push({ start, end: i, kind, raw, ...(sensitive ? { gapSensitive: start > previous.end } : {}) });
    if (out.length > completionLimits.tokens) throw new Error(text.limited);
  }
  if (depth !== 0) fail(); return out;
}

/** 通过公开方言postProcess取得原位置/正式类型，先执行依赖原后处理，不导入私有lexer。 */
function keywordCaseFormatting(source: string, start: number, end: number, original: string, options: { tabSize: number; insertSpaces: boolean }, keywordCase: 'upper' | 'lower', names: { start: number; end: number }[]) {
  let captured: FormatterToken[] | undefined;
  const dialect = { ...mysql, tokenizerOptions: { ...mysql.tokenizerOptions, postProcess(tokens: FormatterToken[]) {
    captured = mysql.tokenizerOptions.postProcess?.(tokens) ?? tokens; return captured;
  } } };
  const config = { tabWidth: options.tabSize, useTabs: !options.insertSpaces, keywordCase, identifierCase: 'preserve' as const, functionCase: 'preserve' as const, dataTypeCase: 'preserve' as const };
  // 全上下文取词法类型，避免把选中的t.order后半段或函数名当作孤立关键字。
  const trimmed = source.trim(), offset = source.length - source.trimStart().length;
  const whole = formatDialect(trimmed, { ...config, dialect });
  if (!captured || captured.length > completionLimits.tokens) return fail();
  const tokens = captured.filter(token => !['LINE_COMMENT', 'BLOCK_COMMENT'].includes(token.type));
  const eligible: { start: number; end: number }[] = []; let previousEnd = offset, nameIndex = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], from = offset + token.start, to = from + token.raw.length;
    if (!Number.isSafeInteger(from) || from < previousEnd || to > source.length || source.slice(from, to) !== token.raw) fail();
    previousEnd = to;
    if (!keywordTypes.has(token.type) || from < start || to > end) continue;
    while (nameIndex < names.length && names[nameIndex].end <= from) nameIndex++;
    if (names[nameIndex] && names[nameIndex].start < to && names[nameIndex].end > from) continue;
    const before = tokens[index - 1], after = tokens[index + 1];
    // 限定名称即使被词法器标为关键字也不能改；INSERT()等复用关键字的函数上下文不放宽。
    if (before?.type === 'PROPERTY_ACCESS_OPERATOR' || after?.type === 'PROPERTY_ACCESS_OPERATOR' || after?.type === 'OPEN_PAREN' && functionNames.has(token.text)) continue;
    eligible.push({ start: from, end: to });
  }
  const formatted = start === 0 && end === source.length ? whole : format(original.trim(), { ...config, language: 'mysql' });
  return { formatted, eligible };
}

/** 只接纳完整词法单元。COPY 数据区与客户端脚本中的换行可能有执行含义。 */
function postgresAtoms(source: string, standardStrings: boolean): Atom[] {
  let scanned;
  try { scanned = scanPostgresFormattingTokens(source, completionLimits.tokens, standardStrings); }
  catch { return fail(); }
  if (!scanned) return fail();
  const closing: string[] = [];
  let statementStart = true, copyStatement = false, previous = '';
  const tokens = scanned.map(token => {
    const raw = source.slice(token.start, token.end);
    if (raw === '(' || raw === '[') {
      closing.push(raw === '(' ? ')' : ']');
      if (closing.length > completionLimits.depth) throw Error(text.limited);
    } else if ((raw === ')' || raw === ']') && closing.pop() !== raw) fail();
    if (token.kind !== 'comment') {
      const word = token.kind === 'word' ? raw.toLowerCase() : '';
      if (statementStart) copyStatement = word === 'copy';
      if (copyStatement && !closing.length && previous === 'from' && word === 'stdin') fail();
      statementStart = raw === ';';
      previous = word;
    }
    return { ...token, raw };
  });
  if (closing.length) fail();
  return tokens;
}

/** 只压缩选区内两个完整单元之间的空白。行注释保留换行，字符串续行由原方言词法单元保护。 */
function compactSql(source: string, start: number, end: number, tokens: readonly Atom[], dialect: FormattingPreferences['dialect']): string {
  // 客户端命令可能依赖物理行边界，不能按服务端 SQL 的空白规则移动。
  for (const [index, token] of tokens.entries()) {
    if (token.kind === 'symbol' && token.raw === '\\') fail();
    const sqliteDot = dialect === 'sqlite' && token.raw === '.' && tokens[index + 1]?.kind === 'word';
    const mysqlCommand = dialect !== 'sqlite' && dialect !== 'postgresql' && token.kind === 'word'
      && /^(?:source|system|tee|notee|pager|nopager|charset|connect|prompt|quit|exit|help|status)$/i.test(token.raw);
    if (sqliteDot || mysqlCommand) {
      const gap = source.slice(tokens[index - 1]?.end ?? 0, token.start);
      if (index === 0 || /[\r\n][\t ]*$/.test(gap)) fail();
    }
  }
  const parts: string[] = [];
  let offset = start;
  for (let index = 1; index < tokens.length; index++) {
    const left = tokens[index - 1], right = tokens[index];
    if (left.start < start || right.end > end || left.end === right.start) continue;
    const gap = source.slice(left.end, right.start);
    if (!/^[\t\r\n\f ]+$/.test(gap)) continue;
    const lineComment = left.kind === 'comment' && /^(?:--|#)/.test(left.raw);
    const adjacentPunctuation = left.raw === '(' || left.raw === '[' || right.raw.length === 1 && ',;)]'.includes(right.raw);
    const separator = lineComment ? gap.match(/\r\n|\r|\n/)?.[0] ?? gap : adjacentPunctuation ? '' : ' ';
    if (gap === separator) continue;
    parts.push(source.slice(offset, left.end), separator);
    offset = right.start;
  }
  parts.push(source.slice(offset, end));
  return parts.join('');
}

/** 按方言检查原词法单元及敏感空白，修改模型前拒绝改变原文含义的结果。 */
export function planSqlFormatting(source: string, start: number, end: number, eol: string = '\n', indentation: FormattingPreferences = {}, mode: SqlFormattingMode = 'format'): { start: number; end: number; text: string } | null {
  const postgres = indentation.dialect === 'postgresql', sqlite = indentation.dialect === 'sqlite';
  const limit = postgres ? 64 * 1024 : completionLimits.sourceUnits;
  if (source.length > limit) throw new Error(text.limited);
  if (source.includes('\0') || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length || !['\n', '\r\n'].includes(eol)) fail();
  const scans = postgres ? [true, false].map(standard => (sql: string) => postgresAtoms(sql, standard)) :
    sqlite ? [(sql: string) => atoms(sql, true, true, true)] :
      [false, true].flatMap(ansi => [false, true].map(escapes => (sql: string) => atoms(sql, ansi, escapes)));
  const originalTokens = scans.map(scan => scan(source));
  for (const tokens of originalTokens) if (tokens.some(token => start > token.start && start < token.end || end > token.start && end < token.end)) throw new Error(text.selection);
  if (source[start - 1] === '\r' && source[start] === '\n' || source[end - 1] === '\r' && source[end] === '\n') throw new Error(text.selection);
  const original = source.slice(start, end), leading = /^[\t\n\r\f ]*/.exec(original)![0], trailing = /[\t\n\r\f ]*$/.exec(original)![0];
  if (!original.trim()) return null;
  let formatted: string, eligible: { start: number; end: number }[] = [];
  // 仅显式格式化时使用当前缩进；更改偏好本身从不改写SQL。
  const options = editorIndentationOptions(indentation.tabSize, indentation.insertSpaces);
  // PostgreSQL 沿用关键字原样。MySQL 的角色解析器不能证明 PostgreSQL 的名称位置。
  const keywordCase = postgres || mode === 'compact' ? 'preserve' : readSqlKeywordCase(indentation.keywordCase);
  // SQLite 尚无名称角色证明，显式大小写转换必须拒绝，不能借用 MySQL 解析器猜名称。
  if (sqlite && keywordCase !== 'preserve') throw Error(sqliteZh.formatCaseUnavailable);
  if (keywordCase !== 'preserve' && (source.length > sqlKeywordRoleLimits.sourceUnits || originalTokens[0].length > sqlKeywordRoleLimits.tokens)) throw Error(text.limited);
  if (mode === 'compact') {
    formatted = compactSql(source, start, end, originalTokens[0], indentation.dialect);
  } else try {
    if (keywordCase !== 'preserve') {
      const roles = preparedRoles; if (!roles) throw Error(text.unavailable);
      ({ formatted, eligible } = keywordCaseFormatting(source, start, end, original, options, keywordCase, roles.sqlFormattingNameRanges(source)));
    }
    else formatted = format(original.trim(), { language: indentation.dialect ?? 'mysql', tabWidth: options.tabSize, useTabs: !options.insertSpaces, keywordCase: 'preserve', identifierCase: 'preserve', functionCase: 'preserve', dataTypeCase: 'preserve' });
    formatted = formatted.trim().replace(/\r?\n/g, eol);
  }
  catch { throw new Error(text.failed); }
  const replacement = mode === 'compact' ? formatted : leading + formatted + trailing, next = source.slice(0, start) + replacement + source.slice(end);
  if (next.length > limit) throw new Error(text.limited);
  for (const [mode, scan] of scans.entries()) {
    const previous = originalTokens[mode], after = scan(next); if (after.length !== previous.length) fail(); let range = 0;
    for (let index = 0; index < previous.length; index++) {
      const before = previous[index], value = after[index];
      if (before.kind !== value.kind || before.gapSensitive !== value.gapSensitive) fail();
      if (before.raw === value.raw) continue;
      while (range < eligible.length && eligible[range].end <= before.start) range++;
      const owner = eligible[range];
      // 只允许ASCII原关键字原位精确转为所选大小写，防止依赖Unicode忽略大小写把长s等名称认成关键字；其余逐字比较。
      if (keywordCase === 'preserve' || before.kind !== 'word' || !/^[A-Za-z_]+$/.test(before.raw) || !owner || before.start < owner.start || before.end > owner.end || value.raw !== (keywordCase === 'upper' ? before.raw.toUpperCase() : before.raw.toLowerCase())) fail();
    }
  }
  return replacement === original ? null : { start, end, text: replacement };
}

/** 只用Monaco编辑事务改当前模型；两侧undo stop使一次撤销/重做与前后键入分离。 */
export function formatSqlEditor(editor: monaco.editor.IStandaloneCodeEditor, indentation: FormattingPreferences = {}, mode: SqlFormattingMode = 'format'): boolean {
  const model = editor.getModel(), selections = editor.getSelections();
  if (!model || model.isDisposed() || editor.getRawOptions().readOnly) throw new Error(text.unavailable);
  if (model.getValueLength() > completionLimits.sourceUnits) throw new Error(text.limited);
  if (!selections || selections.length !== 1) throw new Error(text.selection);
  const selection = selections[0], range = selection.isEmpty() ? model.getFullModelRange() : selection, version = model.getVersionId();
  const plan = planSqlFormatting(model.getValue(), model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition()), model.getEOL(), indentation, mode);
  if (!plan) return false;
  if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) throw new Error(text.unavailable);
  editor.pushUndoStop();
  const changed = editor.executeEdits(mode === 'compact' ? 'dbark-sql-compact' : 'dbark-sql-format', [{ range, text: plan.text, forceMoveMarkers: true }], inverse => inverse.map(({ range }) => {
    if (!selection.isEmpty()) return selection.setStartPosition(range.startLineNumber, range.startColumn).setEndPosition(range.endLineNumber, range.endColumn);
    // 全文替换后的末尾光标必须随事务写入历史，否则首次标记移动后 Redo 没有结束选区。
    // Selection 的 setter 保留方向；重复收敛到末尾，也覆盖全文缩短、旧光标晚于新末尾的情况。
    return selection.setEndPosition(range.endLineNumber, range.endColumn).setStartPosition(range.endLineNumber, range.endColumn).setEndPosition(range.endLineNumber, range.endColumn);
  }));
  editor.pushUndoStop(); if (!changed) throw new Error(text.unavailable); editor.focus(); return true;
}
