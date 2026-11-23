import { foldingStatementTokens, type CompletionLexicalMode } from './completionLexical';
import { scanPostgresFormattingTokens } from './postgresSql';
import { completionLimits } from './sqlCompletion';

export interface SqlFoldingBlock { start: number; end: number; }
type Dialect = 'mysql' | 'mariadb' | 'sqlite' | 'postgresql';
type SymbolToken = { start: number; end: number; kind: string };

/** 仅完整配对且中间有可收起行的括号块参与折叠。 */
function pairedBlocks(source: string, tokens: SymbolToken[] | undefined): SqlFoldingBlock[] | undefined {
  if (!tokens) return;
  const openings: { start: number; line: number }[] = [], blocks: SqlFoldingBlock[] = [];
  let line = 0, newline = source.indexOf('\n');
  for (const { start, end, kind } of tokens) {
    if (kind !== 'symbol' || end !== start + 1 || (source[start] !== '(' && source[start] !== ')')) continue;
    while (newline >= 0 && newline < start) { line++; newline = source.indexOf('\n', newline + 1); }
    if (source[start] === '(') {
      if (openings.length >= completionLimits.depth) return;
      openings.push({ start, line });
    } else {
      const opening = openings.pop();
      if (!opening) return;
      if (line - opening.line >= 2) blocks.push({ start: opening.start, end });
    }
  }
  if (!openings.length) return blocks.sort((left, right) => left.start - right.start);
}

/** 会话模式未知时比较可能的括号位置，保留可确认的整条语句折叠。 */
export function sqlFoldingBlocks(source: string, dialect: Dialect, mode: CompletionLexicalMode): SqlFoldingBlock[] {
  if (!source.includes('(') || !source.includes('\n')) return [];
  try {
    const modes: [boolean, boolean][] = [];
    const quotes = dialect === 'mysql' || dialect === 'mariadb' ? mode.ansiQuotes === undefined ? [false, true] : [mode.ansiQuotes] : [false];
    const escapes = dialect === 'sqlite' ? [true] : mode.noBackslashEscapes === undefined ? [false, true] : [mode.noBackslashEscapes];
    for (const quote of quotes) for (const escape of escapes) modes.push([quote, escape]);
    let verified: SqlFoldingBlock[] | undefined;
    for (const [ansiQuotes, noBackslashEscapes] of modes) {
      const tokens = dialect === 'postgresql' ? scanPostgresFormattingTokens(source, completionLimits.tokens, noBackslashEscapes)
        : foldingStatementTokens(source, dialect, ansiQuotes, noBackslashEscapes);
      const blocks = pairedBlocks(source, tokens);
      if (!blocks || verified && (verified.length !== blocks.length || verified.some((block, index) => block.start !== blocks[index].start || block.end !== blocks[index].end))) return [];
      verified = blocks;
    }
    return verified ?? [];
  } catch {
    return [];
  }
}
