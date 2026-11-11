import { queryParameterLimits, type QueryParameterNames } from '../../shared/queryParameters';
import { navicatParameterNameAt } from '../../shared/navicatParameter';
import { sqliteStatementRanges } from './currentStatement';

const identifierStart = (value: string) => /[A-Za-z_\u0080-\uFFFF]/.test(value);
const identifierPart = (value: string) => /[A-Za-z0-9_$\u0080-\uFFFF]/.test(value);

/** 完整 SQLite 词法先验证全文，显式模板模式才把 [$name] 转成等长的原生绑定。 */
export function sqliteParameterPlan(sql: string, navicat = false): {sql: string; names: string[]} {
  if (!sqliteStatementRanges(sql).length) throw Error('SQLite参数模板中没有可执行语句');
  const names = new Set<string>(), rewritten: string[] = [];
  let occurrences = 0, copied = 0;
  function add(name: string) {
    if (++occurrences > queryParameterLimits.occurrences) throw Error('SQLite值参数引用超过100000次预算');
    names.add(name);
    if (names.size > queryParameterLimits.names) throw Error('SQLite值参数不能超过200个');
  }
  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index + 2); index = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', index)) { const end = sql.indexOf('*/', index + 2); index = end + 2; continue; }
    if (navicat && character === '[' && sql[index + 1] === '$') {
      const name = navicatParameterNameAt(sql, index);
      if (name) {
        add(name);
        // 保留 UTF-8 与 UTF-16 偏移，空格同时隔开相邻 SQL 标记。
        rewritten.push(sql.slice(copied, index), ` :${name} `);
        copied = index += name.length + 3;
        continue;
      }
    }
    if (["'", '"', '`', '['].includes(character)) {
      const quote = character === '[' ? ']' : character; index++;
      while (index < sql.length) { if (sql[index] === quote) { if (quote !== ']' && sql[index + 1] === quote) index += 2; else { index++; break; } } else index++; }
      continue;
    }
    if (character === '?' || character === '@' || character === '$') throw Error('SQLite类型参数查询只接受 :name，不接受问号、@ 或 $ 参数');
    if (character === ':') {
      const start = ++index;
      while (index < sql.length && identifierPart(sql[index])) index++;
      const name = sql.slice(start, index);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || sql[index] === ':') throw Error('SQLite值参数名须为1～64位ASCII字母、数字或下划线，不能以数字开头或使用其他参数格式');
      add(name);
      continue;
    }
    // 普通标识符内部的美元符号是名称的一部分，不能把column$part误判为参数。
    if (identifierStart(character)) { index++; while (index < sql.length && identifierPart(sql[index])) index++; }
    else index++;
  }
  return {sql: rewritten.length ? rewritten.join('') + sql.slice(copied) : sql, names: [...names]};
}

/** 驱动只接受已经转换后的原生模板，并在 prepare 前复核全部绑定名称。 */
export function sqliteNamedParameterNames(sql: string): string[] {
  return sqliteParameterPlan(sql).names;
}

export function sqliteParameterInfo(sql: string, navicat = false): QueryParameterNames {
  return {dialect: 'sqlite', names: sqliteParameterPlan(sql, navicat).names, warnings: [], noBackslashEscapes: true,
    ansiQuotes: true, noBackslashEscapesKnown: true, ansiQuotesKnown: true, maxDecimalScale: 38, allowTimeEndpointFraction: true,
    ...(navicat ? {sqliteNavicatParameters: true} : {})};
}
