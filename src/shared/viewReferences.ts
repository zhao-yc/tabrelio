import { sqliteDefinitionTokens } from './sqliteCompletionAnalysis';
import { foldSqliteCompletionName } from './sqliteCompletion';

export interface ViewReference { database: string; table: string; }
interface Token { kind: 'word' | 'number' | 'identifier' | 'string' | 'symbol' | 'executable'; value: string; }
export const viewReferenceLimits = { depth: 64, references: 32768 } as const;
const key = (value: ViewReference) => JSON.stringify([value.database, value.table]);
const word = (token: Token | undefined, value?: string) => token?.kind === 'word' && (value === undefined || token.value.toUpperCase() === value);
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const named = (token: Token | undefined) => token?.kind === 'word' || token?.kind === 'identifier';
const sqliteClauses = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT']);
const clauses = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'PROCEDURE', 'INTO', 'FOR', 'LOCK', 'WINDOW', 'QUALIFY', 'UNION', 'EXCEPT', 'INTERSECT']);
const joinWords = new Set(['JOIN', 'INNER', 'CROSS', 'LEFT', 'RIGHT', 'NATURAL', 'STRAIGHT_JOIN']);

/** 只解析服务器已接受的SELECT关系语法；表达式中的列、别名和文字不充当表名，未知关系语法拒绝证明。 */
class ViewReferences {
  private readonly pairs = new Map<number, number>();
  private readonly refs = new Map<string, ViewReference>();
  constructor(private readonly tokens: Token[], private readonly database: string, private readonly sqlite = false) {
    const stack: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind === 'executable' || tokens[i].value === ';' && tokens[i].kind === 'symbol') throw Error('视图含不受控可执行内容或语句分隔符');
      if (symbol(tokens[i], '(') && tokens[i].kind === 'symbol') { if (stack.length >= viewReferenceLimits.depth) throw Error('视图嵌套超过证明预算'); stack.push(i); }
      if (symbol(tokens[i], ')') && tokens[i].kind === 'symbol') { const start = stack.pop(); if (start === undefined) throw Error('视图括号不完整'); this.pairs.set(start, i); }
    }
    if (stack.length) throw Error('视图括号不完整');
  }
  private fold(name: string): string { return this.sqlite ? foldSqliteCompletionName(name) : name.toLowerCase(); }
  private isName(token: Token | undefined): boolean { return named(token) || this.sqlite && token?.kind === 'string'; }
  private isJoin(token: Token | undefined): boolean {
    return token?.kind === 'word' && (joinWords.has(token.value.toUpperCase()) || this.sqlite && word(token, 'FULL'));
  }
  /** 只剥覆盖整个候选范围的括号；“((SELECT...) / 2)”仍是表达式而非整段子查询。 */
  private queryLike(start: number, end: number): boolean {
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    return !!(word(this.tokens[start], 'SELECT') || word(this.tokens[start], 'WITH') || this.sqlite && word(this.tokens[start], 'VALUES'));
  }
  /** SQLite 正文可以引用同级前向 CTE，MySQL 系列仍按声明顺序授权。 */
  private query(start: number, end: number, inherited: ReadonlySet<string>, depth: number): void {
    if (depth > viewReferenceLimits.depth) throw Error('视图查询嵌套超过证明预算');
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    let i = start; const scope = new Set(inherited), local = new Set<string>();
    if (word(this.tokens[i], 'WITH')) {
      i++; const recursive = word(this.tokens[i], 'RECURSIVE'); if (recursive) i++;
      const declarations: { id: string; start: number; end: number }[] = [];
      while (i < end) {
        const name = this.tokens[i++]; if (!this.isName(name) || local.has(this.fold(name.value))) throw Error('视图CTE声明不能唯一证明'); const id = this.fold(name.value); local.add(id);
        if (symbol(this.tokens[i], '(')) { const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图CTE列名不完整'); for (let j = i + 1; j < close; j++) if (!this.isName(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图CTE列名语法未知'); i = close + 1; }
        if (!word(this.tokens[i++], 'AS')) throw Error('视图CTE正文语法未知');
        if (this.sqlite && word(this.tokens[i], 'NOT')) {
          i++;
          if (!word(this.tokens[i], 'MATERIALIZED')) throw Error('视图CTE物化提示未知');
        }
        if (this.sqlite && word(this.tokens[i], 'MATERIALIZED')) i++;
        if (!symbol(this.tokens[i], '(')) throw Error('视图CTE正文语法未知');
        const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图CTE正文不完整');
        declarations.push({ id, start: i + 1, end: close });
        i = close + 1;
        if (!symbol(this.tokens[i], ',')) break; i++;
      }
      if (this.sqlite) for (const id of local) scope.add(id);
      for (const declaration of declarations) {
        const bodyScope = new Set(scope);
        if (recursive) bodyScope.add(declaration.id);
        this.query(declaration.start, declaration.end, bodyScope, depth + 1);
        scope.add(declaration.id);
      }
    }
    // UNION等集合两侧均独立解析，不能只证明第一个SELECT。
    let part = i;
    for (; i < end; i++) {
      if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
      if (word(this.tokens[i]) && ['UNION', 'EXCEPT', 'INTERSECT'].includes(this.tokens[i].value.toUpperCase())) {
        this.select(part, i, scope, depth); i++; if (word(this.tokens[i], 'ALL') || word(this.tokens[i], 'DISTINCT')) i++; part = i; i--;
      }
    }
    this.select(part, end, scope, depth);
  }
  /** 表达式只递归完整子查询；FROM出现在EXTRACT、字符串或注释中不成为关系。 */
  private expression(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    if (depth > viewReferenceLimits.depth) throw Error('视图表达式超过证明预算');
    let first = start, candidateEnd = end; while (symbol(this.tokens[first], '(') && this.pairs.get(first) === candidateEnd - 1) { first++; candidateEnd--; }
    if (word(this.tokens[first], 'TABLE') || word(this.tokens[first], 'VALUES')) throw Error('视图表达式含尚未证明的查询构造');
    for (let i = start; i < end; i++) {
      if (!symbol(this.tokens[i], '(') || this.tokens[i].kind !== 'symbol') continue;
      const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图表达式括号范围未知');
      if (this.queryLike(i + 1, close)) this.query(i + 1, close, scope, depth + 1);
      else this.expression(i + 1, close, scope, depth + 1);
      i = close;
    }
  }
  private select(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    // 集合查询允许最后一个括号primary后带整体ORDER/LIMIT，尾部不能被并入SELECT正文或静默丢弃。
    if (symbol(this.tokens[start], '(')) {
      const close = this.pairs.get(start); if (close === undefined || close >= end) throw Error('视图括号查询范围未知');
      this.query(start + 1, close, scope, depth + 1); this.queryTail(close + 1, end, scope, depth + 1); return;
    }
    if (this.sqlite && word(this.tokens[start], 'VALUES')) {
      if (!symbol(this.tokens[start + 1], '(')) throw Error('视图VALUES正文未知');
      this.expression(start + 1, end, scope, depth + 1);
      return;
    }
    if (!word(this.tokens[start], 'SELECT')) throw Error('视图查询不是已证明的SELECT');
    let from = -1, stop = end;
    for (let i = start + 1; i < end; i++) {
      if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
      if (word(this.tokens[i], 'FROM')) { if (from !== -1) throw Error('视图存在未知多重FROM'); from = i; }
      else if (from !== -1 && word(this.tokens[i]) && (this.sqlite ? sqliteClauses : clauses).has(this.tokens[i].value.toUpperCase())) { stop = i; break; }
      else if (word(this.tokens[i], 'INTO') || word(this.tokens[i], 'PROCEDURE')) throw Error('视图含不支持的SELECT副作用语法');
    }
    this.expression(start + 1, from === -1 ? end : from, scope, depth + 1);
    if (from !== -1) { if (stop === from + 1) throw Error('视图FROM为空'); this.relations(from + 1, stop, scope, depth + 1); this.expression(stop, end, scope, depth + 1); }
    // SELECT后半部若出现另一裸SELECT/FROM，不能当普通表达式忽略。
    for (let i = from === -1 ? start + 1 : stop; i < end; i++) { if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; } if (word(this.tokens[i], 'WITH') && word(this.tokens[i + 1], 'ROLLUP')) { i++; continue; } if (word(this.tokens[i], 'FROM') || word(this.tokens[i], 'SELECT') || word(this.tokens[i], 'WITH') || word(this.tokens[i], 'INTO') || word(this.tokens[i], 'PROCEDURE')) throw Error('视图SELECT尾部语法尚未证明'); }
  }
  /** 括号查询的外层尾部只接受完整ORDER BY和整数LIMIT；排序表达式中的子查询仍递归收集。 */
  private queryTail(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    let i = start;
    if (word(this.tokens[i], 'ORDER')) {
      i++; if (!word(this.tokens[i++], 'BY')) throw Error('视图集合排序缺少BY'); const expression = i;
      for (; i < end; i++) {
        if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
        if (word(this.tokens[i], 'LIMIT')) break;
        if (word(this.tokens[i]) && ['SELECT', 'WITH', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'JOIN', 'INTO', 'PROCEDURE', 'FOR', 'LOCK'].includes(this.tokens[i].value.toUpperCase())) throw Error('视图集合排序存在未知语法');
      }
      if (expression === i) throw Error('视图集合排序为空'); this.expression(expression, i, scope, depth + 1);
    }
    if (word(this.tokens[i], 'LIMIT')) {
      const integer = (token: Token | undefined) => token?.kind === 'number' && /^\d+$/.test(token.value);
      i++; if (!integer(this.tokens[i++])) throw Error('视图集合LIMIT未知');
      if (symbol(this.tokens[i], ',') || word(this.tokens[i], 'OFFSET')) { i++; if (!integer(this.tokens[i++])) throw Error('视图集合LIMIT偏移未知'); }
    }
    if (i !== end) throw Error('视图括号查询尾部尚未完整证明');
  }
  private relations(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    if (depth > viewReferenceLimits.depth) throw Error('视图关系嵌套超过证明预算');
    let i = start, needRelation = true;
    while (i < end) {
      if (needRelation) {
        if (symbol(this.tokens[i], '(')) {
          const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图派生关系范围未知');
          if (this.queryLike(i + 1, close)) this.query(i + 1, close, scope, depth + 1); else this.relations(i + 1, close, scope, depth + 1);
          i = close + 1;
        } else {
          const first = this.tokens[i++]; if (!this.isName(first) || word(first) && ['LATERAL', 'JSON_TABLE', 'SELECT', 'WITH'].includes(first.value.toUpperCase())) throw Error('视图含未知表函数或关系语法');
          let database = this.database, table = first.value, qualifiedName = false;
          if (symbol(this.tokens[i], '.')) { qualifiedName = true; database = table; const second = this.tokens[++i]; if (!this.isName(second)) throw Error('视图限定关系名称未知'); table = second.value; i++; }
          if (symbol(this.tokens[i], '(') || symbol(this.tokens[i], '.')) throw Error('视图表函数或多段限定名尚未证明');
          if (qualifiedName || !scope.has(this.fold(table)) && (this.sqlite || !word(first, 'DUAL'))) { const value = { database, table }; this.refs.set(key(value), value); if (this.refs.size > viewReferenceLimits.references) throw Error('视图引用超过证明预算'); }
        }
        if (word(this.tokens[i], 'AS')) { i++; if (!this.isName(this.tokens[i])) throw Error('视图关系别名缺失'); i++; }
        else if (this.tokens[i]?.kind === 'identifier' || this.sqlite && this.tokens[i]?.kind === 'string' ||
            word(this.tokens[i]) && !this.isJoin(this.tokens[i]) && !['ON', 'USING', 'USE', 'FORCE', 'IGNORE', 'PARTITION'].includes(this.tokens[i].value.toUpperCase()) &&
            !(this.sqlite && (word(this.tokens[i], 'INDEXED') || word(this.tokens[i], 'NOT')))) i++;
        if (this.sqlite && word(this.tokens[i], 'INDEXED')) {
          if (!word(this.tokens[++i], 'BY') || !this.isName(this.tokens[++i])) throw Error('视图索引提示未知');
          i++;
        } else if (this.sqlite && word(this.tokens[i], 'NOT')) {
          if (!word(this.tokens[++i], 'INDEXED')) throw Error('视图索引提示未知');
          i++;
        }
        // 分区/索引提示不是额外数据源，但必须完整消费其受控语法。
        while (word(this.tokens[i]) && ['USE', 'FORCE', 'IGNORE'].includes(this.tokens[i].value.toUpperCase())) { i++; if (!word(this.tokens[i], 'INDEX') && !word(this.tokens[i], 'KEY')) throw Error('视图索引提示未知'); i++; if (word(this.tokens[i], 'FOR')) { i++; if (word(this.tokens[i], 'JOIN')) i++; else if (word(this.tokens[i], 'ORDER') || word(this.tokens[i], 'GROUP')) { i++; if (!word(this.tokens[i++], 'BY')) throw Error('视图索引提示未知'); } else throw Error('视图索引提示未知'); } if (!symbol(this.tokens[i], '(')) throw Error('视图索引提示不完整'); const close = this.pairs.get(i)!; for (let j = i + 1; j < close; j++) if (!named(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图索引提示未知'); i = close + 1; }
        needRelation = false; continue;
      }
      if (symbol(this.tokens[i], ',')) { i++; needRelation = true; continue; }
      if (this.isJoin(this.tokens[i])) {
        if (word(this.tokens[i], 'STRAIGHT_JOIN') || word(this.tokens[i], 'JOIN')) i++;
        else { if (word(this.tokens[i], 'NATURAL')) i++; if (word(this.tokens[i]) && (['INNER', 'CROSS', 'LEFT', 'RIGHT'].includes(this.tokens[i].value.toUpperCase()) || this.sqlite && word(this.tokens[i], 'FULL'))) i++; if (word(this.tokens[i], 'OUTER')) i++; if (!word(this.tokens[i++], 'JOIN')) throw Error('视图JOIN语法未知'); }
        needRelation = true; continue;
      }
      if (word(this.tokens[i], 'USING')) { i++; if (!symbol(this.tokens[i], '(')) throw Error('视图USING范围未知'); const close = this.pairs.get(i)!; for (let j = i + 1; j < close; j++) if (!named(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图USING列语法未知'); i = close + 1; continue; }
      if (word(this.tokens[i], 'ON')) {
        const from = ++i; for (; i < end; i++) { if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; } if (symbol(this.tokens[i], ',') || this.isJoin(this.tokens[i]) && !symbol(this.tokens[i + 1], '(')) break; }
        if (from === i) throw Error('视图ON条件为空'); this.expression(from, i, scope, depth + 1); continue;
      }
      throw Error('视图关系语法尚未完整证明');
    }
    if (needRelation) throw Error('视图缺少关系来源');
  }
  read(): ViewReference[] { if (!this.tokens.length) throw Error('视图定义为空'); this.query(0, this.tokens.length, new Set(), 0); return [...this.refs.values()]; }
}

export function readViewReferences(tokens: Token[], database: string): ViewReference[] {
  return new ViewReferences(tokens, database).read();
}

/** 解析 SQLite 已保存的视图查询，标识符规则与关系扫描使用同一方言。 */
export function sqliteViewReferences(query: string): ViewReference[] {
  const tokens: Token[] = sqliteDefinitionTokens(query).map(token => ({
    value: token.value,
    kind: token.kind === 'id' ? token.quoted ? 'identifier' : 'word' : token.kind === 'parameter' ? 'executable' : token.kind,
  }));
  return new ViewReferences(tokens, 'main', true).read();
}
