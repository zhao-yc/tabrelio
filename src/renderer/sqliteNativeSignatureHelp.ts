import type { languages } from 'monaco-editor';
import type { SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';
import type { SqlSignatureCall } from './sqlSignatureAnalysis';
import { sqliteFunctionDetails, type SqliteCompletionDirectory } from './sqliteCompletionSuggestions';
import { sqliteCompletionZh as text } from './locales/sqliteCompletion.zh-CN';

const sqliteParameters: Readonly<Partial<Record<string, readonly string[]>>> = {
  json_extract: [text.signature.json, text.signature.path], jsonb_extract: [text.signature.json, text.signature.path],
  json_type: [text.signature.json, text.signature.path], json_valid: [text.signature.json, text.signature.flags],
};

/** 只读取原调用对应的内置目录项，采用 SQLite 表达式作用域及目录返回的重载。 */
export async function sqliteNativeSignatureHelp(
  call: SqlSignatureCall, analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory,
): Promise<languages.SignatureHelp | null> {
  const context = analysis.functions, name = call.name.toLowerCase();
  if (!context?.existingCall || analysis.target.prefix.toLowerCase() !== name || analysis.target.start !== call.nameStart || analysis.target.end > call.open) return null;
  const result = await directory.load({ kind: 'functions', prefix: name, ...(context.deterministicOnly ? { deterministicOnly: true } : {}) });
  const entry = result.entries.find(item => item.kind === 'function' && item.name === name);
  if (result.incomplete || entry?.kind !== 'function') return null;
  const details = sqliteFunctionDetails(entry, context.mode, context.deterministicOnly);
  if (!details) return null;
  const arities = [...new Set(details.signatures.filter(signature => !call.distinct ||
    !details.windowOnly && signature.type !== 'scalar' && signature.arity === 1).map(({ arity }) => arity))];
  const signatures: languages.SignatureInformation[] = [];
  for (const arity of arities.sort((left, right) => Number(left < 0) - Number(right < 0) || left - right)) {
    // SQLite 的 -3/-4 对应至少一/两个实参，-1 没有目录层的最少数量；-2 是查找哨兵。
    if (arity < -4 || arity === -2 || arity > 32 || arity === 0 && !call.empty || arity > 0 && call.argument >= arity) continue;
    const variadic = arity < 0, minimum = arity < -2 ? -arity - 2 : 0;
    const names = sqliteParameters[name];
    const count = variadic ? Math.max(1, minimum, names?.length ?? 0) : arity;
    let label = call.name + '(' + (call.distinct ? 'DISTINCT ' : '');
    const parameters = Array.from({ length: count }, (_, index) => {
      if (index) label += ', ';
      const start = label.length;
      label += names?.[index] ?? (variadic && count === 1 && !minimum ? text.signature.variadic : text.signature.parameter(index + 1));
      return { label: [start, label.length] as [number, number] };
    });
    if (variadic) label += ', …';
    label += ')';
    const documentation = [details.details[0], text.signature.catalog, ...(arity === 0 ? [text.signature.noArguments] : []),
      ...(minimum ? [text.signature.minimum(minimum)] : []), ...(details.windowOnly ? [text.signature.window] : [])].join('\n');
    signatures.push({ label, parameters, activeParameter: Math.max(0, Math.min(call.argument, count - 1)), documentation });
  }
  return signatures.length ? { signatures, activeSignature: 0, activeParameter: signatures[0].activeParameter ?? 0 } : null;
}
