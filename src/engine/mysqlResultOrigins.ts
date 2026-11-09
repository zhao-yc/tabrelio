import type { FieldPacket } from 'mysql2';
import type { QueryResult } from '../shared/contracts';
import type { MysqlResultColumnOrigin, MysqlResultOriginTarget } from '../shared/mysqlResultOrigins';
import type { SessionObjectSnapshot } from '../shared/sessionObjects';
import { completionIdentifier } from '../shared/completionLexical';
import { completionQuery } from './completionQuery';
import type { StructureTaskContext } from './structureDefinition';
import type { ManagedConnection } from './connection';
import { tableDefinitionPrefix } from './tableColumnDefinition';

/** CALL 等语句可以在返回结果前创建临时表，仍显示协议名称但不签发跳转。 */
export function mysqlResultOriginCatalogAllowed(managed: ManagedConnection, sql: string): boolean {
  if (!managed.queryRowContext || managed.sqlMode === undefined) return false;
  const modes = managed.sqlMode.split(',');
  try {
    const [first] = tableDefinitionPrefix(sql, { dialect: managed.status.dialect,
      mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } }, 1);
    return first?.kind === 'word' && ['SELECT', 'WITH', 'TABLE'].includes(first.value.toUpperCase());
  } catch { return false; }
}

/** 只读取协议中的原名称，计算列、别名及不完整的协议字段均不能补造来源。 */
export function captureMysqlResultOrigins(fields: readonly FieldPacket[], directory: SessionObjectSnapshot | undefined,
  catalogAllowed: boolean): MysqlResultColumnOrigin[] {
  const canonical = (name: string) => directory?.caseMode ? name.toLowerCase() : name;
  const targetKey = (database: string, table: string) => JSON.stringify([canonical(database), canonical(table)]);
  const objects = new Map(directory?.objects.map(object => [targetKey(object.database, object.name), object]));
  return fields.map(field => {
    const database = field.schema ?? field.db, table = field.orgTable, column = field.orgName;
    if (!completionIdentifier(database) || !completionIdentifier(table) || !completionIdentifier(column)) return null;
    const object = objects.get(targetKey(database, table));
    const scope = object?.known ? 'temporary' : catalogAllowed && directory && !directory.uncertain && !object ? 'catalog' : 'unverified';
    return { database, table, column, scope };
  });
}

/** 独立元数据预算不占用原数据结果预算。以结果对象对齐可避免失败语句或被丢弃的结果集错位。 */
export class MysqlResultOrigins {
  private readonly byResult = new WeakMap<QueryResult, MysqlResultColumnOrigin[]>();
  private remaining = 512 * 1024;

  record(result: QueryResult, fields: FieldPacket[], directory: SessionObjectSnapshot | undefined, catalogAllowed: boolean): void {
    if (!this.remaining || fields.length !== result.columns.length || !fields.length || fields.length > 4096) return;
    const origins = captureMysqlResultOrigins(fields, directory, catalogAllowed);
    if (!origins.some(Boolean)) return;
    const bytes = Buffer.byteLength(JSON.stringify(origins));
    if (bytes <= this.remaining) { this.byResult.set(result, origins); this.remaining -= bytes; }
  }

  finish(results: QueryResult[], canOpen: boolean): (MysqlResultColumnOrigin[] | null)[] | undefined {
    const aligned = results.map(result => {
      const origins = this.byResult.get(result);
      return !origins ? null : canOpen ? origins : origins.map(origin => origin?.scope === 'catalog' ? { ...origin, scope: 'unverified' as const } : origin);
    });
    return aligned.some(Boolean) ? aligned : undefined;
  }
}

/** 目录只核对原始库、对象及列的准确名称，视图可打开，来源不存在或无权查看则拒绝。 */
export async function readMysqlResultOrigin(context: StructureTaskContext, source: MysqlResultOriginTarget) {
  const { rows } = await completionQuery<{ objectKind: string }[]>(context.managed, context,
    `SELECT t.TABLE_TYPE AS objectKind FROM information_schema.TABLES t
      JOIN information_schema.COLUMNS c ON BINARY c.TABLE_SCHEMA = BINARY t.TABLE_SCHEMA AND BINARY c.TABLE_NAME = BINARY t.TABLE_NAME
      WHERE BINARY t.TABLE_SCHEMA = BINARY ? AND BINARY t.TABLE_NAME = BINARY ? AND BINARY c.COLUMN_NAME = BINARY ?
        AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW') LIMIT 2`, [source.database, source.table, source.column]);
  context.checkCancelled();
  if (rows.length !== 1 || !['BASE TABLE', 'VIEW'].includes(rows[0].objectKind)) throw Error('结果列的来源对象或字段已变化，或当前账号无权查看');
  return { database: source.database, table: source.table };
}
