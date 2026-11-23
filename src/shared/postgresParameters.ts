import { queryParameterLimits } from './queryParameters';
import { currentPostgresStatement, splitPostgresParameterSql, type PostgresStatement } from './postgresSql';

/** 保持协议参数与相邻文字的词法边界，错误位置换算也使用相同替换长度。 */
function wireParameter(position: number): string {
  return ' $' + position + ' ';
}

/** 每条命名语句独立编号，跨工作表的同名值共用一次输入。 */
export function postgresParameterPlan(source: readonly PostgresStatement[]) {
  if (!source.length) throw Error('PostgreSQL 参数执行需要至少一条语句');
  if (source.some(statement => statement.keyword === 'COPY'))
    throw Error('PostgreSQL COPY 数据流需要专用导入导出接口');
  const names = new Set<string>();
  const hasNamed = source.some(statement => statement.namedParameters?.length);
  if (hasNamed && source.some(statement => statement.parameters.length))
    throw Error('同一次 PostgreSQL 参数操作须统一使用 [$name] 或 $1、$2，不能混用');
  const statements = source.map(statement => {
    const tokens = statement.namedParameters;
    if (!tokens?.length) {
      if (statement.parameters.some((position, index) => position !== index + 1))
        throw Error('每条 PostgreSQL 查询的位置参数必须从 $1 连续编号');
      const positions = statement.parameters.map(position => 'p' + position);
      for (const name of positions) names.add(name);
      return { statement, sql: statement.sql, names: positions };
    }
    const positions = new Map<string, number>();
    let sql = '', from = 0;
    for (const token of tokens) {
      let position = positions.get(token.name);
      if (position === undefined) {
        position = positions.size + 1;
        positions.set(token.name, position);
        names.add(token.name);
        if (names.size > queryParameterLimits.names) throw Error('PostgreSQL 参数不能超过 200 个');
      }
      sql += statement.sql.slice(from, token.start) + wireParameter(position);
      from = token.end;
    }
    return { statement, sql: sql + statement.sql.slice(from), names: [...positions.keys()] };
  });
  return { statements, names: [...names] };
}

/** 用原词法标记回推协议区间，命中生成参数时选中完整模板。无需保留绑定值或第二份偏移表。 */
export function postgresParameterErrorRange(plan: ReturnType<typeof postgresParameterPlan>['statements'][number],
  range: {start: number; end: number}): {start: number; end: number} {
  const {namedParameters} = plan.statement;
  if (!namedParameters?.length) return range;
  const positions = new Map(plan.names.map((name, index) => [name, index + 1]));
  let delta = 0;
  for (const token of namedParameters) {
    const start = token.start + delta;
    if (range.start < start) break;
    const length = wireParameter(positions.get(token.name)!).length;
    if (range.start < start + length) return {start: token.start, end: token.end};
    delta += length - (token.end - token.start);
  }
  return {start: range.start - delta, end: range.end - delta};
}

/** 参数表单和执行共用原会话词法，保留完整脚本或光标处原语句的 UTF-16 范围。 */
export function postgresQueryParameterSource(sql: string, standardStrings: boolean, offset?: number) {
  return offset === undefined ? splitPostgresParameterSql(sql, standardStrings) :
    [currentPostgresStatement(sql, offset, standardStrings, true)];
}

/** 会话改变字符串模式后，只核对下一条已确认范围；不读入或发送范围之外的正文。 */
export function postgresParameterBoundaryMatches(source: string, from: number, expected: PostgresStatement, standardStrings: boolean): boolean {
  try {
    const [actual] = splitPostgresParameterSql(source.slice(from, expected.end + 1), standardStrings, true);
    return !!actual && actual.start + from === expected.start && actual.end + from === expected.end &&
      JSON.stringify(actual.parameters) === JSON.stringify(expected.parameters) &&
      JSON.stringify(actual.namedParameters) === JSON.stringify(expected.namedParameters);
  } catch { return false; }
}
