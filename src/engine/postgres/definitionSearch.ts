import { structureSearchLimits, type PostgresDefinitionReadTarget } from '../../shared/databaseSearch';
import type { DatabaseSearchPattern } from '../../shared/databaseSearchPattern';
import { definitionTextWithinBudget } from '../../shared/definitionNavigation';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresStructureKind, type PostgresQueryObjectDefinition, type PostgresQueryObjectDefinitionInput,
  type PostgresStructureResult } from '../../shared/postgresStructure';
import { definitionNavigationResult, definitionRegexpMarkers } from '../definitionNavigation';
import type { PostgresConnection } from './connection';
import { readPostgresStructureFacts } from './relationStructure';
import { postgresRoutineSignatureSql, postgresRoutineVisibleSql } from './routine';

/** 规范专用短连接上的反编译上下文，保证搜索与重新打开使用同一种文本。 */
export async function preparePostgresSearchConnection(connection: PostgresConnection, database: string) {
  if (connection.database !== database) throw Error('PostgreSQL 搜索连接未绑定目标数据库');
  await connection.query(`SELECT pg_catalog.set_config('search_path', 'pg_catalog', false),
    pg_catalog.set_config('statement_timeout', '5s', false), pg_catalog.set_config('lock_timeout', '1s', false),
    pg_catalog.set_config('standard_conforming_strings', 'on', false),
    pg_catalog.set_config('default_transaction_read_only', 'on', false)`, undefined, { rows: 1, bytes: 1024 });
}

/** 表文本由已有关系目录生成。只读查看字段和表达式，不从表或所属序列读取数据。 */
function relationDefinition(output: PostgresStructureResult, temporary = false) {
  const name = postgresIdentifier(temporary ? 'pg_temp' : output.schema) + '.' + postgresIdentifier(output.name);
  const comments = output.columns.filter(column => column.comment !== null).map(column =>
    'COMMENT ON COLUMN ' + name + '.' + postgresIdentifier(column.name) + ' IS ' + postgresDdlLiteral(column.comment!) + ';');
  const view = output.kind === 'v' || output.kind === 'm';
  const type = output.kind === 'm' ? 'MATERIALIZED VIEW' : view ? 'VIEW' : output.kind === 'f' ? 'FOREIGN TABLE' : 'TABLE';
  const createType = temporary ? 'TEMPORARY ' + type : type;
  if (output.comment !== null) comments.push('COMMENT ON ' + type + ' ' + name + ' IS ' + postgresDdlLiteral(output.comment) + ';');
  const indexes = output.indexes.map(index => index.definition + ';');
  if (view) {
    if (!output.viewDefinition) throw Error('PostgreSQL 视图查询定义未完整返回');
    return [`CREATE ${createType} ${name} AS\n${output.viewDefinition}`, ...indexes, ...comments].join('\n\n');
  }
  const columns = output.columns.map(column => {
    let text = postgresIdentifier(column.name) + ' ' + column.type;
    if (column.collation) text += ' COLLATE ' + column.collation;
    if (column.identity) text += ' GENERATED ' + (column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT') + ' AS IDENTITY';
    else if (column.generationExpression !== null)
      text += ' GENERATED ALWAYS AS (' + column.generationExpression + ') ' + (column.generation === 'v' ? 'VIRTUAL' : 'STORED');
    else if (column.defaultExpression !== null) text += ' DEFAULT ' + column.defaultExpression;
    if (!column.nullable) text += ' NOT NULL';
    return text;
  });
  const constraints = output.constraints.map(item => 'CONSTRAINT ' + postgresIdentifier(item.name) + ' ' + item.definition);
  const declaration = `CREATE ${createType} ${name} (\n  ${[...columns, ...constraints].join(',\n  ')}\n)` +
    (output.partitionKey ? ' PARTITION BY ' + output.partitionKey : '') + ';';
  const bound = output.partitionBound?.split('\n').map(line => '-- ' + line).join('\n');
  return [declaration, ...(bound ? [bound] : []), ...indexes, ...comments].join('\n\n');
}

/** 先用原 search_path 和临时 schema 解析 OID，再在本次只读事务内规范目录反编译。 */
export async function readPostgresQueryObjectDefinition(connection: PostgresConnection, input: PostgresQueryObjectDefinitionInput): Promise<PostgresQueryObjectDefinition> {
  if (connection.database !== input.database) throw Error('PostgreSQL 定义连接未绑定目标数据库');
  const original = connection.state();
  if (!original.transactionKnown || original.transactionOpen) throw Error('对象定义需要已确认的空闲连接');
  const budget = () => ({ rows: 1, bytes: 8192 });
  const qualified = (input.schema ? postgresIdentifier(input.schema) + '.' : '') + postgresIdentifier(input.name);
  try {
    const began = await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined, budget());
    if (began.postgresCommand !== 'BEGIN' || !connection.state().transactionOpen) throw Error('对象定义只读事务未确认');
    await connection.query(`SELECT pg_catalog.set_config('statement_timeout', '5s', true),
      pg_catalog.set_config('lock_timeout', '1s', true), pg_catalog.set_config('standard_conforming_strings', 'on', true)`, undefined, budget());
    // 不先按关系权限或类型筛选候选，避免把搜索路径中被遮蔽的同名关系当成原对象。
    const resolved = await connection.query(`SELECT c.oid::pg_catalog.text, n.nspname::pg_catalog.text, c.relkind::pg_catalog.text,
      n.oid OPERATOR(pg_catalog.=) pg_catalog.pg_my_temp_schema(), c.relname::pg_catalog.text
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
      WHERE c.oid OPERATOR(pg_catalog.=) pg_catalog.to_regclass($1::pg_catalog.text)`, [qualified], budget());
    const row = resolved.rows[0];
    const kind = postgresStructureKind.safeParse(row?.c2);
    if (resolved.truncated || !row || typeof row.c0 !== 'string' || typeof row.c1 !== 'string' || !kind.success || row.c4 !== input.name)
      throw Error('当前搜索路径找不到可读取定义的表或视图');
    const temporary = row.c3 === 't';
    if (temporary && !input.sessionId || !temporary && (row.c1.startsWith('pg_') || row.c1 === 'information_schema'))
      throw Error('当前关系不支持此处的定义查看');
    if (input.schema && input.schema !== (temporary && input.schema === 'pg_temp' ? 'pg_temp' : row.c1))
      throw Error('PostgreSQL 定义对象已变化');

    await connection.query('SET LOCAL search_path = pg_catalog, pg_temp', undefined, budget());
    const { output, oid } = await readPostgresStructureFacts(connection, postgresIdentifier(row.c1) + '.' + postgresIdentifier(input.name), temporary);
    if (oid !== row.c0 || output.kind !== kind.data) throw Error('PostgreSQL 定义对象已变化');
    const ddl = relationDefinition(output, temporary);
    if (!ddl || !definitionTextWithinBudget(ddl)) throw Error('PostgreSQL 目录定义超过 2 MiB 或编码无效');
    return { status: 'ready', schema: temporary ? 'pg_temp' : output.schema, name: output.name, temporary, ddl };
  } finally {
    // 只有事务回到空闲才能交付定义，回滚失去确认时隔离该物理连接。
    try {
      if (connection.state().transactionOpen) {
        const rollback = await connection.query('ROLLBACK', undefined, budget());
        if (rollback.postgresCommand !== 'ROLLBACK') throw Error('对象定义只读事务未确认结束');
      }
      const state = connection.state();
      if (!state.transactionKnown || state.transactionOpen) throw Error('对象定义只读事务未确认结束');
    } catch (error) {
      connection.broken = true;
      connection.abort();
      throw error;
    }
  }
}

/** 用目录完整限定名及输入类型签名核对对象，只返回与搜索窗口相同的展示正文。 */
export async function readPostgresDefinitionText(connection: PostgresConnection, target: Omit<PostgresDefinitionReadTarget, 'connectionId'>) {
  if (connection.database !== target.database) throw Error('PostgreSQL 定义连接未绑定目标数据库');
  let source: string;
  if (target.kind === 'table' || target.kind === 'view') {
    const { output, oid } = await readPostgresStructureFacts(connection, target.name);
    const exact = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
    // 依赖行持有原目录身份，禁止同名重建的对象接管旧行。
    const expected = target.expectedRelation;
    if (exact !== target.name || (target.kind === 'view') !== (output.kind === 'v' || output.kind === 'm') ||
        expected && (oid !== expected.oid || output.kind !== expected.kind))
      throw Error('PostgreSQL 定义对象已变化');
    source = relationDefinition(output);
  } else {
    const result = await connection.query(`SELECT pg_catalog.pg_get_functiondef(p.oid), pg_catalog.obj_description(p.oid, 'pg_proc')
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = pg_catalog.to_regprocedure($1::text) AND ${postgresRoutineVisibleSql}
        AND ${postgresRoutineSignatureSql} COLLATE pg_catalog."C" = $1::text
        AND CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END = $2::text`,
      [target.name, target.kind], { rows: 2, bytes: structureSearchLimits.definitionBytes + 8192 });
    const row = result.rows[0];
    if (result.truncated) throw Error('PostgreSQL 例程定义超过 2 MiB');
    if (result.rows.length !== 1 || typeof row.c0 !== 'string' || (row.c1 !== null && typeof row.c1 !== 'string'))
      throw Error('PostgreSQL 例程不存在、已改名或当前角色不可见');
    source = row.c0 + (row.c1 === null ? '' : '\nCOMMENT ON ' + target.kind.toUpperCase() + ' ' + target.name + ' IS ' + postgresDdlLiteral(row.c1) + ';');
  }
  if (!source || !definitionTextWithinBudget(source)) throw Error('PostgreSQL 完整目录定义超过 2 MiB 或编码无效');
  return source;
}

/** 普通匹配保留百分号和下划线，大小写转换与正则均使用服务器语义。 */
export function postgresSearchPredicate(column: string, pattern: DatabaseSearchPattern) {
  const name = pattern.caseSensitive ? column : `pg_catalog.lower(${column})`;
  const value = pattern.caseSensitive ? '$1::text' : 'pg_catalog.lower($1::text)';
  return pattern.mode === 'regexp' ? `${column} ${pattern.caseSensitive ? '~' : '~*'} $1::text`
    : pattern.mode === 'whole' ? `${name} COLLATE pg_catalog."C" = ${value}`
    : pattern.mode === 'prefix' ? `pg_catalog.starts_with(${name}, ${value})`
    : `pg_catalog.strpos(${name}, ${value}) > 0`;
}

export async function matchPostgresDefinition(connection: PostgresConnection, source: string, pattern: DatabaseSearchPattern, check: () => void) {
  const folded = !pattern.caseSensitive && pattern.mode !== 'regexp';
  const result = await connection.query(`SELECT pg_catalog.char_length(definition_text)::text
    ${folded ? ', pg_catalog.lower(definition_text), pg_catalog.lower($1::text)' : ''}
    FROM (SELECT $2::text AS definition_text) AS body WHERE ${postgresSearchPredicate('definition_text', pattern)}`,
    [pattern.text, source], { rows: 1, bytes: 4 * 1024 * 1024 });
  if (result.truncated) throw Error('PostgreSQL 定义匹配回包超过预算');
  const match = result.rows[0];
  if (!match) return;
  const characters = Number(match.c0);
  if (!Number.isSafeInteger(characters) || characters < 1 || characters > structureSearchLimits.definitionBytes)
    throw Error('PostgreSQL 定义匹配长度无效');
  const markers = pattern.mode === 'regexp' ? definitionRegexpMarkers(source) : undefined;
  let marked;
  if (markers) {
    check();
    // 整组引用保留原文和捕获编号。仅位置查询失败时保留先前确认的对象命中。
    try {
      const located = await connection.query('SELECT pg_catalog.regexp_replace($1::text, $2::text, $3::text, $4::text)',
        [source, pattern.text, markers.start + '\\&' + markers.end, pattern.caseSensitive ? 'g' : 'gi'],
        { rows: 1, bytes: 3 * structureSearchLimits.definitionBytes + 1024 });
      if (!located.truncated && located.rows.length === 1) marked = located.rows[0].c0;
    } catch (reason) {
      if (connection.broken || !['57014', '42501'].includes((reason as { postgresSqlState?: string }).postgresSqlState ?? '')) throw reason;
    }
  }
  return { definitionCharacters: characters, definitionNavigation: definitionNavigationResult(source, pattern,
    markers ? { regexp: { ...markers, marked } } : { navigationText: match.c1, navigationNeedle: match.c2 }) };
}
