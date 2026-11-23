import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits, sqliteCompletionOutputSchema, type SqliteCompletionEntry, type SqliteCompletionLookup, type SqliteCompletionOutput, type SqliteForeignKeySelection } from '../shared/sqliteCompletion';
import { inspectSqliteTableColumnCollations, sqliteTableRebuildPlanLimits } from '../shared/sqliteTableRebuildPlan';
import { sqliteDropObjectQuery } from './sqliteDropObjects';

interface CompletionControl { check(): void; sessionRevision?: number; }
/** 元数据读完和取消检查共用原driver，绝不创建查询任务、触碰事务边界或读取用户行值。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], control: CompletionControl, maxRows: number): Promise<{ rows: SqliteValue[][]; truncated: boolean }> {
  control.check(); const rows: SqliteValue[][] = [];
  // 原会话消费者不能抛取消异常：driver会把消费者失败翻译为interrupt；仅在完整短读终态后检查边界。
  const result = await driver.execute(sql, { parameters, maxRows, maxBytes: sqliteCompletionLimits.outputBytes, onBatch: batch => { rows.push(...batch.rows); } });
  control.check();
  if (result.statements.length !== 1) throw Error('SQLite补全固定读取未返回准确单语句终态');
  return { rows, truncated: result.statements.some(statement => statement.truncated) };
}
/** 原生schema cookie取前后两次；目录变化必须由调用方重新请求，不发布混合目录。 */
async function stamp(driver: SqliteDriverSession, control: CompletionControl): Promise<string> {
  const values: string[] = [];
  for (const schema of ['main', 'temp'] as const) {
    const result = await read(driver, 'PRAGMA ' + schema + '.schema_version', [], control, 1), value = result.rows[0]?.[0];
    if (result.truncated || result.rows.length !== 1 || !value || typeof value !== 'object' || value.type !== 'integer' || !/^-?\d{1,10}$/.test(value.value)) throw Error('SQLite补全schema版本无效');
    values.push(value.value);
  }
  return values.join(':');
}
/** 前缀用substr与绑定参数作字面比较；百分号、下划线及引号均没有模式或SQL语义。 */
const prefixSql = 'substr(name,1,length(?)) = ? COLLATE NOCASE';
const visibleSql = "type IN ('table','view','virtual') AND substr(name,1,7) COLLATE NOCASE <> 'sqlite_'";
// 只排除目录可直接验证的删列限制，完整约束和表达式依赖由 SQLite 在明确执行时检查。
const dropColumnSql = ` AND p.pk = 0 AND (p.hidden <> 0 OR EXISTS (SELECT 1 FROM pragma_table_xinfo(?,?) c WHERE c.hidden = 0 AND c.cid <> p.cid))
  AND NOT EXISTS (SELECT 1 FROM pragma_index_list(?,?) i JOIN pragma_index_xinfo(i.name,?) k ON k."key" = 1 WHERE k.cid = p.cid)`;

function supportsSqlite353(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return !!match && (Number(match[1]) > 3 || Number(match[1]) === 3 && Number(match[2]) >= 53);
}

function tableIdentity(driver: SqliteDriverSession, input: { schema?: 'main' | 'temp'; table: string }, control: CompletionControl, includeOptions = false) {
  // 先定位实际关系再看类型，避免临时视图或虚拟表遮蔽时误读 main 的目录。
  const scope = input.schema ? 'schema = ?' : "schema IN ('main','temp')";
  return read(driver, 'SELECT name,schema,type' + (includeOptions ? ',strict' : '') + ' FROM pragma_table_list() WHERE ' + scope + " AND name = ? COLLATE NOCASE ORDER BY schema DESC LIMIT 1", [...(input.schema ? [input.schema] : []), input.table], control, 1);
}

/** 只接受 SQLite 能用于外键的完整唯一键。读取原库目录和定义，不准备编辑器语句或读取业务行。 */
async function foreignKeyColumns(driver: SqliteDriverSession, table: string, schema: 'main' | 'temp',
  prefix: string, selection: SqliteForeignKeySelection, control: CompletionControl): Promise<{ rows: SqliteValue[][]; truncated: boolean }> {
  const { arity } = selection, used = selection.used.map(fold);
  if (used.length >= arity) return { rows: [], truncated: false };
  const xinfo = await read(driver, 'SELECT name,type,hidden,pk FROM pragma_table_xinfo(?,?) ORDER BY cid LIMIT 1025',
    [table, schema], control, sqliteTableRebuildPlanLimits.columns + 1);
  if (xinfo.truncated || xinfo.rows.length > sqliteTableRebuildPlanLimits.columns) return { rows: [], truncated: true };

  const list = await read(driver, `SELECT i.name AS key_name,i.origin,k.cid,k.name AS column_name,k.coll
    FROM pragma_index_list(?,?) i JOIN pragma_index_xinfo(i.name,?) k ON k."key" = 1
    WHERE i."unique" = 1 AND i.partial = 0 ORDER BY i.seq,k.seqno LIMIT 257`, [table, schema, schema], control, 257);
  const keys = list.rows.slice(0, sqliteCompletionLimits.entries), last = keys.at(-1)?.[0];
  let incomplete = list.truncated || list.rows.length > keys.length;
  // 原生目录截断时，末尾索引可能只收到部分列，不能把它当成较短的唯一键。
  const partialTail = list.truncated || list.rows.length > keys.length && list.rows[keys.length][0] === last;
  const complete = partialTail ? keys.filter(row => row[0] !== last) : keys;
  const indexes = new Map<string, SqliteValue[][]>();
  for (const row of complete) {
    if (typeof row[0] !== 'string') throw Error('SQLite外键索引目录无效');
    const index = indexes.get(row[0]);
    if (index) index.push(row);
    else indexes.set(row[0], [row]);
  }

  const eligible = new Set<string>();
  const primary = xinfo.rows.filter(row => typeof row[3] === 'object' && row[3]?.type === 'integer' && row[3].value !== '0');
  // 真正的 INTEGER PRIMARY KEY 是 rowid 别名且没有独立主键索引，包括行内 DESC 等特例的反面。
  const [columnName, declaredType] = primary[0] ?? [];
  if (arity === 1 && !incomplete && primary.length === 1 && typeof columnName === 'string' && typeof declaredType === 'string' &&
    fold(declaredType) === 'integer' && !complete.some(row => row[1] === 'pk')) eligible.add(fold(columnName));

  type KeyTerm = { name: string; collation: string };
  const possible: { terms: KeyTerm[]; remaining: KeyTerm[] }[] = [];
  for (const index of indexes.values()) {
    if (index.length !== arity) continue;
    const terms: KeyTerm[] = [];
    for (const [, , cid, name, collation] of index) {
      if (!cid || typeof cid !== 'object' || cid.type !== 'integer' || cid.value.startsWith('-') ||
        typeof name !== 'string' || typeof collation !== 'string') break;
      terms.push({ name: fold(name), collation: fold(collation) });
    }
    if (terms.length !== arity) continue;
    const remaining = [...terms];
    for (const name of used) {
      const matched = remaining.findIndex(term => term.name === name);
      if (matched < 0) break;
      remaining.splice(matched, 1);
    }
    if (remaining.length === arity - used.length) possible.push({ terms, remaining });
  }
  if (possible.length) {
    const ddl = await read(driver, `SELECT CASE WHEN length(CAST(sql AS BLOB)) <= 262144 THEN sql END FROM ${schema}.sqlite_schema
      WHERE type = 'table' AND name = ? COLLATE BINARY LIMIT 1`, [table], control, 1);
    const tableSql = ddl.rows[0]?.[0];
    if (ddl.truncated || typeof tableSql !== 'string') incomplete = true;
    else {
      try {
        const columns = xinfo.rows.map(([name, , hidden]) => {
          if (typeof name !== 'string' || !hidden || typeof hidden !== 'object' || hidden.type !== 'integer') throw Error('SQLite外键列目录无效');
          return { name, hidden: Number(hidden.value) };
        });
        const collations = inspectSqliteTableColumnCollations({ table, tableSql, columns });
        // 显式父列允许与索引顺序不同，但每个键项的比较规则必须来自对应列的声明。
        for (const { terms, remaining } of possible) if (terms.every(term => collations.get(term.name) === term.collation)) {
          for (const { name } of remaining) eligible.add(name);
        }
      } catch { incomplete = true; }
    }
  }
  const starts = fold(prefix);
  const rows = xinfo.rows.filter(([name]) => typeof name === 'string' && eligible.has(fold(name)) &&
    fold(name).startsWith(starts)).map(row => row.slice(0, 3));
  return { rows, truncated: incomplete };
}

const flag = (value: SqliteValue): boolean | undefined => value && typeof value === 'object' && value.type === 'integer' &&
  (value.value === '0' || value.value === '1') ? value.value === '1' : undefined;
const functionTypes = { s: 'scalar', a: 'aggregate', w: 'window' } as const;
const publicSqliteFunctions = new Set(['sqlite_compileoption_get', 'sqlite_compileoption_used', 'sqlite_offset', 'sqlite_source_id', 'sqlite_version']);
// SQLite 公共函数标志。允许索引使用确定性标量，但不建议只能在顶层调用的函数。
const sqliteDeterministic = 0x800, sqliteDirectOnly = 0x80000;

async function completionCollations(driver: SqliteDriverSession, input: { prefix: string; exact?: string }, control: CompletionControl) {
  // 查询原连接规则目录，不调用排序规则，也不执行编辑器里的表达式。
  const result = await read(driver, 'PRAGMA collation_list', [], control, sqliteCompletionLimits.entries + 1);
  const names = new Map<string, string>(), prefix = fold(input.prefix);
  const exact = input.exact === undefined ? undefined : fold(input.exact);
  for (const [, name] of result.rows.slice(0, sqliteCompletionLimits.entries)) {
    if (typeof name !== 'string') throw Error('SQLite补全排序规则目录无效');
    const key = fold(name);
    if (exact === undefined ? key.startsWith(prefix) : key === exact) names.set(key, name);
  }
  const entries = [...names.keys()].sort().map(key => ({ kind: 'collation' as const, name: names.get(key)! }));
  return { entries, incomplete: result.truncated || result.rows.length > sqliteCompletionLimits.entries };
}

/** 维护目标只读当前连接目录。精确查询保留占用名称的对象，避免把原语句解释成另一库的维护操作。 */
async function maintenanceObjects(driver: SqliteDriverSession, input: Extract<SqliteCompletionLookup, { kind: 'maintenance-objects' }>, control: CompletionControl) {
  const { schema, operation, exact, prefix } = input, fullName = exact === undefined ? undefined : fold(exact);
  const reindex = operation === 'reindex', modern = supportsSqlite353(driver.version);
  const entries: SqliteCompletionEntry[] = [];
  let incomplete = false;
  if (!schema && !reindex && (fullName === 'main' || fullName === 'temp')) return { entries, incomplete };
  if (!schema && reindex) {
    if (modern && (fullName === undefined ? 'expressions'.startsWith(fold(prefix)) : fullName === 'expressions')) {
      entries.push({ name: 'EXPRESSIONS', kind: 'maintenance-option' });
    }
    const collations = await completionCollations(driver, input, control);
    entries.push(...collations.entries);
    incomplete = collations.incomplete;
    // 非限定排序规则优先于表和索引。规则目录缺失时无法证明精确对象解析。
    if (exact !== undefined && (incomplete || collations.entries.length)) return { entries, incomplete };
  }
  const scope = schema ?? null;
  const match = exact === undefined ? prefixSql : 'name = ? COLLATE NOCASE';
  const parameters = exact === undefined ? [prefix, prefix] : [exact];
  const candidates = exact === undefined ? " AND type = 'table' AND substr(owner_name,1,7) COLLATE NOCASE <> 'sqlite_'" : '';
  const result = await read(driver, `WITH relations AS MATERIALIZED (
      SELECT name,schema,type FROM pragma_table_list() WHERE schema IN ('main','temp') AND (? IS NULL OR schema = ?)
    ), targets(name,schema,object,owner_name,type) AS (
      SELECT name,schema,'table',name,type FROM relations
      UNION ALL
      SELECT i.name,p.schema,'index',p.name,p.type FROM relations p CROSS JOIN pragma_index_list(p.name,p.schema) i
      WHERE p.type IN ('table','shadow')
    )
    SELECT name,schema,object,owner_name,type FROM targets WHERE ${match}${candidates}
    ORDER BY name COLLATE NOCASE,schema DESC,object LIMIT 257`, [scope, scope, ...parameters], control, 257);
  const targets = result.rows.map(([name, namespace, object, owner, type]) => {
    if (typeof name !== 'string' || namespace !== 'main' && namespace !== 'temp' ||
      object !== 'table' && object !== 'index' || typeof owner !== 'string' || typeof type !== 'string') throw Error('SQLite维护对象目录无效');
    const entry: Extract<SqliteCompletionEntry, { kind: 'maintenance-object' }> = {
      kind: 'maintenance-object', name, schema: namespace, object, ...(object === 'index' ? { owner } : {}),
    };
    return { entry, visible: type === 'table' && !fold(owner).startsWith('sqlite_') };
  });
  if (exact !== undefined) {
    const table = targets.find(target => target.entry.object === 'table'), index = targets.find(target => target.entry.object === 'index');
    // ANALYZE 先找索引，旧版 REINDEX 先找表。3.53 起 REINDEX 可以同时命中两个命名空间中的表和索引。
    for (const target of reindex ? modern ? [table, index] : [table ?? index] : [index ?? table]) {
      if (target?.visible) entries.push(target.entry);
    }
  } else {
    for (const target of targets) entries.push(target.entry);
  }
  const limit = sqliteCompletionLimits.entries;
  return { entries: entries.slice(0, limit), incomplete: incomplete || result.truncated || entries.length > limit };
}

/** 仅暴露main/temp用户关系；table_list的shadow标记不能靠名称猜测，temp命名空间优先遮蔽main。 */
export async function readSqliteCompletion(driver: SqliteDriverSession, input: SqliteCompletionLookup, control: CompletionControl): Promise<SqliteCompletionOutput> {
  const before = await stamp(driver, control), entries: SqliteCompletionEntry[] = []; let incomplete = false;
  let bytes = Buffer.byteLength(JSON.stringify({ entries: [], incomplete: false, stamp: before, ...(control.sessionRevision === undefined ? {} : { sessionRevision: control.sessionRevision }) }));
  /** 输出包装与UTF8转义也计入预算；字节先满时明确incomplete，不截断任何字段或谎报完整。 */
  const append = (entry: SqliteCompletionEntry): boolean => {
    const size = Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0);
    if (bytes + size > sqliteCompletionLimits.outputBytes) { incomplete = true; return false; }
    bytes += size; entries.push(entry); return true;
  };
  if (input.kind === 'relations') {
    const scope = input.schema ? 'schema = ?' : "schema IN ('main','temp') AND (schema = 'temp' OR NOT EXISTS (SELECT 1 FROM pragma_table_list() t WHERE t.schema = 'temp' AND t.name = p.name COLLATE NOCASE))";
    const visible = visibleSql + (input.triggerTarget === 'view' ? " AND type = 'view'" :
      input.indexTable || input.foreignKey || input.triggerTarget === 'table' ? " AND type = 'table'" : input.alterTable ? " AND type <> 'view'" : '');
    const result = await read(driver, 'SELECT name,type,schema FROM pragma_table_list() p WHERE ' + scope + ' AND ' + visible + ' AND ' + prefixSql + " ORDER BY schema DESC,name COLLATE NOCASE,name LIMIT 257", [...(input.schema ? [input.schema] : []), input.prefix, input.prefix], control, 257);
    incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
    for (const row of result.rows.slice(0, sqliteCompletionLimits.entries)) {
      if (typeof row[0] !== 'string' || !['table', 'view', 'virtual'].includes(row[1] as string) || !['main', 'temp'].includes(row[2] as string)) throw Error('SQLite补全关系目录无效');
      if (!append({ name: row[0], kind: row[1] === 'view' ? 'view' : 'table', schema: row[2] as 'main' | 'temp' })) break;
    }
  } else if (input.kind === 'columns') {
    // 先按原生命名空间规则定位，排除系统及shadow后才读取xinfo；显式schema永不查另一库。
    const found = await tableIdentity(driver, input, control);
    const target = found.rows[0];
    const table = target ? target[0] : input.table;
    const schema = target ? target[1] : input.schema ?? 'main';
    const allowed = input.indexTable || input.alterColumn || input.foreignKey ? target?.[2] === 'table' : target ? input.tableFunction ? target[2] === 'virtual' :
      ['table', 'view', 'virtual'].includes(target[2] as string) : input.tableFunction === true;
    if (allowed && typeof table === 'string' && !/^sqlite_/i.test(table) && (input.alterColumn !== 'nullability' || supportsSqlite353(driver.version))) {
      if (schema !== 'main' && schema !== 'temp') throw Error('SQLite补全字段所属库无效');
      // 自带表值模块通常不在 table_list 内。无同名关系遮蔽时只读 xinfo，不准备或执行原调用。
      const drop = input.alterColumn === 'drop';
      const result = typeof input.foreignKey === 'object' ? await foreignKeyColumns(driver, table, schema, input.prefix, input.foreignKey, control) :
        await read(driver, 'SELECT name,type,hidden FROM pragma_table_xinfo(?,?)' + (input.alterColumn ? ' p' : '') + ' WHERE ' + prefixSql +
        (input.alterColumn ? ' AND p.hidden <> 1' : '') + (drop ? dropColumnSql : '') + ' ORDER BY cid LIMIT 257',
      [table, schema, input.prefix, input.prefix, ...(drop ? [table, schema, table, schema, schema] : [])], control, 257);
      incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
      if (input.tableFunction && !target && !incomplete && !result.rows.length) {
        const available = input.prefix && await read(driver, 'SELECT 1 FROM pragma_table_xinfo(?,?) LIMIT 1', [table, schema], control, 1);
        incomplete = !available || !available.rows.length;
      }
      for (const row of result.rows.slice(0, sqliteCompletionLimits.entries)) {
        const hidden = row[2];
        if (typeof row[0] !== 'string' || typeof row[1] !== 'string' || !hidden || typeof hidden !== 'object' || hidden.type !== 'integer' || !['0', '1', '2', '3'].includes(hidden.value)) throw Error('SQLite补全字段目录无效');
        if (!append({ name: row[0], kind: 'column', schema, table, declaredType: row[1], generated: hidden.value === '2' || hidden.value === '3', hidden: hidden.value === '1' })) break;
      }
    } else if (input.tableFunction) incomplete = true;
  } else if (input.kind === 'indexes') {
    const { rows: [target] } = await tableIdentity(driver, input, control);
    if (target && target[2] === 'table') {
      const [table, schema] = target;
      if (typeof table !== 'string' || schema !== 'main' && schema !== 'temp') throw Error('SQLite补全索引所属表无效');
      if (!/^sqlite_/i.test(table)) {
        const result = await read(driver, 'SELECT name,"unique",origin,partial FROM pragma_index_list(?,?) WHERE ' + prefixSql + ' ORDER BY name COLLATE NOCASE,name LIMIT 257',
          [table, schema, input.prefix, input.prefix], control, 257);
        incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
        for (const [name, unique, origin, partial] of result.rows.slice(0, sqliteCompletionLimits.entries)) {
          const isUnique = flag(unique), isPartial = flag(partial);
          if (typeof name !== 'string' || origin !== 'c' && origin !== 'u' && origin !== 'pk' || isUnique === undefined || isPartial === undefined) throw Error('SQLite补全索引目录无效');
          if (!append({ kind: 'index', name, schema, table, origin, unique: isUnique, partial: isPartial })) break;
        }
      }
    }
  } else if (input.kind === 'functions') {
    // 直接 PRAGMA 不受同名临时表遮蔽。只从有界目录读取内置重载，不执行实际函数。
    const result = await read(driver, 'PRAGMA function_list', [], control, sqliteCompletionLimits.entries + 1);
    incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
    const prefix = fold(input.prefix);
    const functions = new Map<string, Extract<SqliteCompletionEntry, { kind: 'function' }>>();
    for (const [name, rawBuiltin, type, , rawArity, rawFlags] of result.rows.slice(0, sqliteCompletionLimits.entries)) {
      const builtin = flag(rawBuiltin);
      if (typeof name !== 'string' || builtin === undefined) throw Error('SQLite补全函数目录无效');
      if (!builtin || !name.startsWith(prefix) || !/^[a-z][a-z0-9_]*$/.test(name) || name === 'load_extension' ||
        name.startsWith('sqlite_') && !publicSqliteFunctions.has(name)) continue;
      if (input.deterministicOnly) {
        if (!rawFlags || typeof rawFlags !== 'object' || rawFlags.type !== 'integer') throw Error('SQLite补全函数标志无效');
        const flags = Number(rawFlags.value);
        if (type !== 's' || !(flags & sqliteDeterministic) || flags & sqliteDirectOnly) continue;
      }
      if (type !== 's' && type !== 'a' && type !== 'w' || !rawArity || typeof rawArity !== 'object' || rawArity.type !== 'integer') throw Error('SQLite补全函数签名无效');
      const arity = Number(rawArity.value);
      let entry = functions.get(name);
      if (!entry) { entry = { kind: 'function', name, signatures: [] }; functions.set(name, entry); }
      const signature = { arity, type: functionTypes[type] };
      if (!entry.signatures.some(current => current.arity === signature.arity && current.type === signature.type)) entry.signatures.push(signature);
    }
    for (const name of [...functions.keys()].sort()) {
      const entry = functions.get(name)!;
      entry.signatures.sort((a, b) => a.arity - b.arity);
      if (!append(entry)) break;
    }
  } else if (input.kind === 'drop-objects') {
    const { sql, parameters } = sqliteDropObjectQuery(input.object, input.schema, input.exact === undefined ? { prefix: input.prefix } : { exact: input.exact });
    const result = await read(driver, sql, parameters, control, 257);
    incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
    for (const [name, schema, owner] of result.rows.slice(0, sqliteCompletionLimits.entries)) {
      if (typeof name !== 'string' || schema !== 'main' && schema !== 'temp' || owner !== null && typeof owner !== 'string') throw Error('SQLite删除对象目录无效');
      if (!append({ kind: 'drop-object', object: input.object, name, schema, ...(owner === null ? {} : { owner }) })) break;
    }
  } else if (input.kind === 'maintenance-objects') {
    const result = await maintenanceObjects(driver, input, control);
    incomplete = result.incomplete;
    for (const entry of result.entries) if (!append(entry)) break;
  } else if (input.kind === 'trigger-owner') {
    // 先按原会话定位，再核对触发目标类型。同名临时对象遮蔽时不回退到主库。
    const { rows: [target] } = await tableIdentity(driver, input, control);
    if (target?.[2] === input.triggerTarget && typeof target[0] === 'string' && !/^sqlite_/i.test(target[0])) {
      const [name, schema] = target;
      if (typeof name !== 'string' || schema !== 'main' && schema !== 'temp') throw Error('SQLite触发目标目录无效');
      append({ kind: input.triggerTarget, name, schema });
    }
  } else if (input.kind === 'table-options') {
    const { rows: [target] } = await tableIdentity(driver, input, control, true);
    if (target?.[2] === 'table' && typeof target[0] === 'string' && !/^sqlite_/i.test(target[0])) {
      const [name, schema, , rawStrict] = target, strict = flag(rawStrict);
      if (typeof name !== 'string' || schema !== 'main' && schema !== 'temp' || strict === undefined) throw Error('SQLite表类型模式无效');
      append({ kind: 'table-options', name, schema, strict });
    }
  } else if (input.kind === 'collations') {
    const result = await completionCollations(driver, input, control);
    incomplete = result.incomplete;
    for (const entry of result.entries) if (!append(entry)) break;
  }
  const after = await stamp(driver, control); control.check();
  if (before !== after) throw Error('SQLite目录在补全读取期间变化，请重新触发');
  return sqliteCompletionOutputSchema.parse({ entries, incomplete, stamp: after, ...(control.sessionRevision === undefined ? {} : { sessionRevision: control.sessionRevision }) });
}
