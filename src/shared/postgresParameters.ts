import { queryParameterLimits } from './queryParameters';
import { currentPostgresStatement, splitPostgresParameterSql, type PostgresStatement } from './postgresSql';

/** 每条命名语句独立编号，跨工作表的同名值共用一次输入。 */
export function postgresParameterPlan(source: readonly PostgresStatement[]) {
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
      // 两侧留空格，防止参数编号与相邻数字或标识符连成一个词法单元。
      sql += statement.sql.slice(from, token.start) + ' $' + position + ' ';
      from = token.end;
    }
    return { statement, sql: sql + statement.sql.slice(from), names: [...positions.keys()] };
  });
  return { statements, names: [...names] };
}

/** 识别与执行共用同一计划；保留原始语句范围供结果、历史和错误定位使用。 */
export function postgresParameterStatement(sql: string, standardStrings: boolean, offset?: number) {
  const statements = offset === undefined ? splitPostgresParameterSql(sql, standardStrings) :
    [currentPostgresStatement(sql, offset, standardStrings, true)];
  if (statements.length !== 1) throw Error('PostgreSQL 参数执行一次只接受一条语句');
  return postgresParameterPlan(statements).statements[0];
}
