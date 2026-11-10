export const sqlExpressionWidthLimits = { min: 1, max: 200, defaultWidth: 50 } as const;

export function isSqlExpressionWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= sqlExpressionWidthLimits.min && value <= sqlExpressionWidthLimits.max;
}

/** 旧配置缺项或值已损坏时采用格式器原默认值，读取本身不改配置。 */
export function readSqlExpressionWidth(value: unknown): number {
  return isSqlExpressionWidth(value) ? value : sqlExpressionWidthLimits.defaultWidth;
}

/** 区分旧客户端缺项和显式非法输入，存储与 IPC 共用同一约束。 */
export function assertSqlExpressionWidthWrite(settings: { sqlExpressionWidth?: unknown }): void {
  if (Object.hasOwn(settings, 'sqlExpressionWidth') && !isSqlExpressionWidth(settings.sqlExpressionWidth)) {
    throw Error('SQL 括号内单行宽度必须为 1 至 200 的整数');
  }
}
