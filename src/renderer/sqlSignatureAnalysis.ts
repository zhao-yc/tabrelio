import { signatureLexicalContext, type CompletionLexicalMode, type CompletionToken } from '../shared/completionLexical';
import { sqlFunctionSignatures, type SqlFunctionSignature } from './locales/sqlSignatures.zh-CN';

export interface SqlSignatureAnalysis { readonly name: string; readonly open: number; readonly argument: number; readonly signatures: readonly SqlFunctionSignature[]; readonly activeSignature: number; readonly activeParameter: number; }
export interface SqlSignatureCall { readonly name: string; readonly nameStart: number; readonly open: number; readonly argument: number; readonly distinct: boolean; readonly empty: boolean; }
interface Frame { name?: string; nameStart: number; open: number; argument: number; call: boolean; distinct: boolean; special: boolean; empty: boolean; }
const groups = new Set(['IN', 'EXISTS', 'OVER', 'USING', 'AS', 'VALUES', 'SELECT', 'FILTER']);
const objects = new Set(['TABLE', 'VIEW', 'INDEX', 'FUNCTION', 'PROCEDURE', 'INTO', 'REFERENCES', 'CONSTRAINT']);
/** 只识别裸函数的逗号调用；复杂专用语法不冒充普通参数列表。 */
const special = new Set(['FROM', 'FOR', 'AS', 'ORDER', 'SEPARATOR']);
const word = (token: CompletionToken | undefined) => token?.kind === 'word' ? token.value.toUpperCase() : '';

/** 一次有界扫描定位当前调用，嵌套调用、子查询和字面量内的逗号不改变外层编号。 */
export function locateSqlSignatureCall(source: string, offset: number, dialect: 'mysql' | 'mariadb' | 'sqlite', mode: CompletionLexicalMode = {}): SqlSignatureCall | undefined {
  const context = signatureLexicalContext(source, offset, dialect, mode); if (context.status !== 'ready') return;
  const frames: Frame[] = [], levels = new Map<number, { cte: boolean; query: boolean }>(), tokens = context.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]; if (token.start >= offset) break;
    const key = word(token); let level = levels.get(token.depth); if (!level) { level = { cte: false, query: false }; levels.set(token.depth, level); }
    if (key === 'WITH') { level.cte = true; level.query = false; }
    if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(key) || dialect === 'sqlite' && key === 'VALUES') level.query = true;
    if (token.end > offset) break;
    if (token.kind === 'symbol' && token.value === '(') {
      const prior = tokens[i - 1], previous = tokens[i - 2], bare = word(prior), before = word(previous);
      const name = bare || (dialect === 'sqlite' && prior?.kind === 'identifier' ? prior.value.toUpperCase() : '');
      const call = !!prior && ['word', 'identifier'].includes(prior.kind) && !groups.has(bare);
      const ddl = objects.has(before) || before === 'EXISTS' && word(tokens[i - 3]) === 'NOT' && word(tokens[i - 4]) === 'IF' || level.cte && !level.query;
      const qualified = previous?.value === '.' || previous?.value === ':' || previous?.value === '@';
      levels.delete(token.depth + 1);
      const next = tokens[i + 1];
      frames.push({ ...(call && name && !ddl && !qualified ? { name } : {}), nameStart: prior?.start ?? token.start,
        open: token.start, argument: 0, call, distinct: word(next) === 'DISTINCT', special: false,
        empty: !next || next.kind === 'symbol' && next.value === ')' });
    } else if (token.kind === 'symbol' && token.value === ')') frames.pop();
    else if (token.kind === 'symbol' && token.value === ',') { const frame = frames.at(-1); if (frame) frame.argument++; }
    else if (key && special.has(key) && frames.at(-1)?.call) frames.at(-1)!.special = true;
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]; if (!frame.call) continue;
    // 未知或被限定的内层调用阻断外层猜测；不能把自定义函数当作同名内置函数。
    if (!frame.name || frame.special) return;
    const { name, nameStart, open, argument, distinct, empty } = frame;
    return { name, nameStart, open, argument, distinct, empty };
  }
}

/** 离线文案仅覆盖明确编入的内置语法。 */
export function localSqlSignature(call: SqlSignatureCall, dialect: 'mysql' | 'mariadb' | 'sqlite'): SqlSignatureAnalysis | undefined {
  const { name, open, argument, distinct } = call;
  const signatures = sqlFunctionSignatures(name, dialect)?.filter(value => name !== 'COUNT' || !!value.distinct === distinct);
  if (!signatures) return;
  const activeSignature = signatures.findIndex(value => value.variadic || argument < value.parameters.length);
  if (activeSignature < 0) return;
  return { name, open, argument, signatures, activeSignature, activeParameter: Math.min(argument, signatures[activeSignature].parameters.length - 1) };
}

export function analyzeSqlSignature(source: string, offset: number, dialect: 'mysql' | 'mariadb' | 'sqlite', mode: CompletionLexicalMode = {}): SqlSignatureAnalysis | undefined {
  const call = locateSqlSignatureCall(source, offset, dialect, mode);
  return call && localSqlSignature(call, dialect);
}
