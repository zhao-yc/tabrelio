export interface TableReadStatement {
  sql: string;
  clipped: boolean;
}

/** 只接收绑定参数之前的真实模板，限制每页随结果传回的展示文本。 */
export function tableReadStatements(...sql: string[]): TableReadStatement[] {
  const limit = 8192;
  return sql.map(text => {
    const end = text.length > limit && /[\uD800-\uDBFF]/u.test(text[limit - 1]) ? limit - 1 : limit;
    return { sql: text.slice(0, end), clipped: text.length > end };
  });
}
