/** 编辑器和原生绑定入口使用同一套 ASCII 名称规则。 */
export const sqliteBindName = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** SQLite 也能把紧邻的扩展后缀纳入参数名，客户端只提供原生 :name 形式。 */
export function sqliteNamedBindAt(source: string, start: number, end: number): string | undefined {
  if (source[start] !== ':' || source[start - 1] === ':' || source[end] === ':' || source[end] === '(') return;
  const name = source.slice(start + 1, end);
  return sqliteBindName.test(name) ? name : undefined;
}
