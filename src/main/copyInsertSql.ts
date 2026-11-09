import { buildCopyInsertSql } from '../shared/copyInsertSql';

export { buildCopyInsertSql } from '../shared/copyInsertSql';

/** 同步构建全部内容后只发起一次写入并返回原生完成结果；不读剪贴板、不访问连接或执行 SQL。 */
export function copyInsertSql(input: unknown, writeText: (sql: string) => void | Promise<void>): void | Promise<void> {
  const sql = buildCopyInsertSql(input);
  // Electron 的原生写入可能异步失败；返回同一个 Promise，由 IPC 如实报告，不提前宣告成功。
  return writeText(sql);
}
