const navicatParameter = /^\[\$([A-Za-z_][A-Za-z0-9_]{0,63})\]/;

/** 只匹配调用方已确认处于 SQL 正文的参数起点，读取长度由参数名上限限定。 */
export function navicatParameterNameAt(sql: string, start: number): string | undefined {
  return navicatParameter.exec(sql.slice(start, start + 67))?.[1];
}
