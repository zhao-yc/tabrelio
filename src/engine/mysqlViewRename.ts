import { createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { renameMysqlViewDraft } from '../shared/mysqlViewFile';
import { mysqlViewRenameSql, type MysqlViewRenameTarget, type MysqlViewRenameResult } from '../shared/mysqlViewRename';
import { objectDefinitionDdl } from '../shared/objectDefinition';
import { readMysqlViewDependencies } from './mysqlViewDependencies';
import { qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

async function readDefinition(context: StructureTaskContext, database: string, name: string) {
  const { rows } = await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW CREATE VIEW ' + qualified(database, name));
  const row = rows[0];
  const ddl = row?.['Create View'], charset = row?.character_set_client, collation = row?.collation_connection;
  if (rows.length !== 1 || row.View !== name || !objectDefinitionDdl(ddl) ||
      typeof charset !== 'string' || typeof collation !== 'string') throw Error('无法确认准确的原生视图定义');
  return { ddl, charset, collation };
}

const hex = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;

/** 复用可见依赖目录；拒绝已知引用及扫描不完整的结果。服务器仍负责目标占用与权限检查。 */
async function occupied(context: StructureTaskContext, database: string, name: string) {
  const { rows } = await structureTaskQuery<{ occupied: number }[]>(context, `SELECT 1 AS occupied FROM information_schema.TABLES
    WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${hex(database)} AS BINARY)
      AND IF(@@lower_case_table_names=0, CAST(TABLE_NAME AS BINARY)=CAST(${hex(name)} AS BINARY),
        CAST(LOWER(TABLE_NAME) AS BINARY)=CAST(LOWER(${hex(name)}) AS BINARY)) LIMIT 1`);
  return rows.length !== 0;
}

async function inspect(context: StructureTaskContext, target: MysqlViewRenameTarget, server: string) {
  const { database, name, newName } = target;
  const before = await readDefinition(context, database, name);
  const deps = await readMysqlViewDependencies(context, target);
  if (deps.referencing.length) throw Error('当前视图有可见引用，请先处理依赖');
  if (deps.source !== 'catalogue' || deps.truncated || deps.skipped || deps.referencedUnknown)
    throw Error('当前服务器无法提供完整的可见视图依赖目录');
  if (await occupied(context, database, newName)) throw Error('同库目标名称已被占用');
  const expected = { ...before, ddl: renameMysqlViewDraft(before.ddl, database, name, newName) };
  return { expected, sourceDdl: before.ddl, stamp: createHash('sha256').update(JSON.stringify([server, before])).digest('hex') };
}

async function prepareSession(context: StructureTaskContext) {
  const { rows } = await structureTaskQuery<{ version: string; uuid: string }[]>(context, 'SELECT VERSION() AS version, @@server_uuid AS uuid');
  const version = /^(8)\.(0|4)\.(\d+)(?:$|[-.])/.exec(rows[0]?.version ?? '');
  if (context.managed.status.dialect !== 'mysql' || !version || version[2] === '0' && Number(version[3]) < 13)
    throw Error('视图改名需要支持写锁下原生重命名的 MySQL 8.0.13 及以上 8.0 或 8.4');
  await structureTaskQuery(context, 'SET SESSION sql_quote_show_create = 1');
  if (!/^[a-f0-9-]{36}$/i.test(rows[0]?.uuid ?? '')) throw Error('无法确认 MySQL 服务器身份');
  return rows[0].uuid;
}

export async function previewMysqlViewRename(context: StructureTaskContext, target: MysqlViewRenameTarget) {
  const server = await prepareSession(context);
  const { stamp, sourceDdl } = await inspect(context, target, server);
  return { stamp, sourceDdl, sql: mysqlViewRenameSql(target) };
}

/** 私有会话先锁住原名称，再在锁内确认它仍是原视图，避免把外部替换的表改名。 */
export async function applyMysqlViewRename(context: StructureTaskContext, target: MysqlViewRenameTarget, stamp: string): Promise<MysqlViewRenameResult> {
  const server = await prepareSession(context);
  await structureTaskQuery(context, 'SET SESSION lock_wait_timeout = 5');
  await structureTaskQuery(context, 'LOCK TABLES ' + qualified(target.database, target.name) + ' WRITE');
  try {
    const checked = await inspect(context, target, server);
    if (checked.stamp !== stamp) throw Error('原视图定义已变化，请重新读取和预览');
    const { rows } = await structureTaskQuery<ResultSetHeader>(context, mysqlViewRenameSql(target));
    if (rows.affectedRows !== 0 || rows.warningStatus !== 0) return { verified: false };
    try {
      const actual = await readDefinition(context, target.database, target.newName);
      return { verified: JSON.stringify(actual) === JSON.stringify(checked.expected) && !await occupied(context, target.database, target.name) };
    } catch { return { verified: false }; }
  } finally {
    await structureTaskQuery(context, 'UNLOCK TABLES');
  }
}
