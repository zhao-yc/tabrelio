import { scanPostgresEditorTokens } from './postgresSql';

const statementWords = new Set(['SELECT', 'TABLE', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'RETURNING',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'COPY', 'CALL', 'DO', 'GRANT', 'REVOKE']);
const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** 目录片段必须能被括号完整包住。同表整行或限定引用可能随 INSERT 的目标别名改义。 */
export function postgresConflictExpression(value: unknown, relation: string): string | undefined {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000\uD800-\uDFFF]/u.test(value)) return;
  const expression = value.trim();
  const tokens = scanPostgresEditorTokens(expression, 512, true);
  if (!tokens?.length) return;
  if (expression.includes('\\') && JSON.stringify(tokens) !== JSON.stringify(scanPostgresEditorTokens(expression, 512, false))) return;
  const closes: string[] = [];
  for (const token of tokens) {
    if (token.open || token.kind === 'blocked' && token.text === 'comment') return;
    if (token.kind === 'word' && (statementWords.has(token.text.toUpperCase()) || fold(token.text) === relation) ||
        token.kind === 'identifier' && token.text === relation) return;
    if (token.kind !== 'punct') continue;
    if (token.text === '(' || token.text === '[') {
      if (closes.length === 24) return;
      closes.push(token.text === '(' ? ')' : ']');
    } else if (token.text === ')' || token.text === ']') {
      if (closes.pop() !== token.text) return;
    } else if (token.text === ';' || token.text === '\\' || token.text === ',' && !closes.length) return;
  }
  if (!closes.length) return expression;
}
