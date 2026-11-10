export interface TableReadStatement {
  sql: string;
  clipped: boolean;
}

export type RecordTableRead = (sql: string) => void;
export type ReceiveTableReadFailure = (statements: TableReadStatement[]) => void;

/** 只由实际读取路径签发，普通错误消息及原因沿原路径交付，不进入历史。 */
export class TableReadFailure extends Error {
  constructor(reason: unknown, readonly statements: TableReadStatement[]) {
    super(reason instanceof Error ? reason.message : '表页读取未完成', { cause: reason });
  }
}

/** 单次请求仅记录计数与分页投递，保留驱动降级重试，目录和绑定参数不会进入这里。 */
export async function withTableReadTrace<T>(enabled: boolean | undefined, read: (record?: RecordTableRead) => Promise<T>): Promise<T> {
  if (!enabled) return read();
  const attempts: string[] = [];
  try { return await read(sql => { if (attempts.length < 4) attempts.push(sql); }); }
  catch (reason) {
    if (!attempts.length) throw reason;
    throw new TableReadFailure(reason, tableReadStatements(...attempts));
  }
}

/** 只接收绑定参数之前的真实模板，限制每页随结果传回的展示文本。 */
export function tableReadStatements(...sql: string[]): TableReadStatement[] {
  const limit = 8192;
  return sql.map(text => {
    const end = text.length > limit && /[\uD800-\uDBFF]/u.test(text[limit - 1]) ? limit - 1 : limit;
    return { sql: text.slice(0, end), clipped: text.length > end };
  });
}
