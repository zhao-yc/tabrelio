import { postgresParameterErrorRange, type postgresParameterPlan } from '../../shared/postgresParameters';
import type { QueryFailureSourceRange } from '../../shared/queryFailure';

/** 原连接 ErrorResponse 经过脱敏后只保留自有 SQLSTATE，不读取外来访问器。 */
export function postgresQuerySqlState(error: Error): string | undefined {
  const field = Object.getOwnPropertyDescriptor(error, 'postgresSqlState');
  return field && 'value' in field && typeof field.value === 'string' && /^[0-9A-Z]{5}$/.test(field.value) ? field.value : undefined;
}

/** 仅原查询已收到 ReadyForQuery 的普通服务端错误可继续；取消、断线与资源故障停止。 */
export function canContinuePostgresQueryError(error: Error, state: {broken: boolean; transactionKnown: boolean}, cancelled: boolean): boolean {
  const code = postgresQuerySqlState(error);
  return !cancelled && !state.broken && state.transactionKnown && !!code &&
    !['00', '01', '02', '08', '53', '54', '57', '58', 'XX'].includes(code.slice(0, 2));
}

/** 参数服务端详情可能包含绑定原值；所有执行模式使用同一无值错误提示。 */
export function postgresQueryErrorMessage(error: Error, parameterized: boolean): string {
  const code = postgresQuerySqlState(error);
  return parameterized ? 'PostgreSQL参数查询未完成' + (code ? '（SQLSTATE ' + code + '）' : '') : error.message || 'PostgreSQL语句未完成';
}

/** ErrorResponse P 从 1 开始按 Unicode 字符计数。转换为编辑器范围，保留 EOF 和参数原文边界。 */
export function postgresErrorSourceRange(error: Error, sql: string, base: number, statement: QueryFailureSourceRange,
  parameterPlan?: ReturnType<typeof postgresParameterPlan>['statements'][number]): QueryFailureSourceRange | undefined {
  const field = Object.getOwnPropertyDescriptor(error, 'postgresQueryPosition');
  if (!field || !('value' in field) || !Number.isSafeInteger(field.value) || field.value < 1 || field.value > sql.length + 1) return;
  let offset = 0, remaining = field.value - 1;
  while (remaining > 0 && offset < sql.length) {
    offset += sql.codePointAt(offset)! > 0xffff ? 2 : 1;
    remaining--;
  }
  if (remaining) return;
  const start = sql[offset] === '\n' && sql[offset - 1] === '\r' ? offset - 1 : offset;
  const end = start === sql.length ? start : start + (sql.startsWith('\r\n', start) || sql.codePointAt(start)! > 0xffff ? 2 : 1);
  const original = parameterPlan ? postgresParameterErrorRange(parameterPlan, {start, end}) : {start, end};
  const range = {start: base + original.start, end: base + original.end};
  if (range.start >= statement.start && range.end <= statement.end) return range;
}
