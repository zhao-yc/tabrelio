import type { SqliteDriverSession } from '../engine/sqlite/session';
import { foldSqliteCompletionName as fold } from '../shared/sqliteCompletion';
import { sqliteViewDraftQuery } from '../shared/sqliteObjects';
import type { SqliteViewDependenciesInput, ViewDependencies } from '../shared/viewDependencies';
import { sqliteViewReferences } from '../shared/viewReferences';

const viewLimit = 4096, edgeLimit = 1024, definitionBytes = 256 * 1024;

/** 一条目录查询提供同一读取快照。目标排首位，截断时仍可独立分析其出向关系。 */
export async function readSqliteViewDependencies(driver: SqliteDriverSession, input: SqliteViewDependenciesInput, check: () => void): Promise<ViewDependencies> {
  if (!driver.readOnly) throw Error('SQLite 视图依赖需要独立只读连接');
  const result: ViewDependencies = { source: 'definitions', referenced: [], referencing: [], skipped: 0, referencedUnknown: false, truncated: false };
  const target = fold(input.name);
  let found = false;
  const outcome = await driver.execute(`
    SELECT name, CASE WHEN length(CAST(sql AS BLOB)) <= ${definitionBytes} THEN sql END
    FROM main.sqlite_schema WHERE type = 'view'
    ORDER BY CASE WHEN name = ? COLLATE NOCASE THEN 0 ELSE 1 END, name COLLATE BINARY
    LIMIT ${viewLimit + 1}
  `, {
    parameters: [input.name], maxRows: viewLimit, maxBytes: 8 * 1024 * 1024, batchRows: 16,
    statementTimeoutMs: 5000, onBatch(batch) {
      check();
      for (const [name, definition] of batch.rows) {
        if (typeof name !== 'string' || definition !== null && typeof definition !== 'string') throw Error('SQLite 视图目录回包无效');
        const isTarget = fold(name) === target;
        if (isTarget) found = true;
        let refs;
        try {
          if (definition === null) throw Error('定义不可读取');
          const parsed = sqliteViewDraftQuery(definition, name);
          refs = sqliteViewReferences(parsed.query);
          if (refs.some(ref => fold(ref.database) !== 'main')) throw Error('引用了其他 SQLite schema');
        } catch {
          if (isTarget) result.referencedUnknown = true;
          else result.skipped++;
          continue;
        }
        if (isTarget) {
          const unique = new Map(refs.map(ref => [fold(ref.table), { database: 'main', name: ref.table }]));
          result.referenced = [...unique.values()].slice(0, edgeLimit);
          if (unique.size > edgeLimit) result.truncated = true;
        } else if (refs.some(ref => fold(ref.table) === target)) {
          if (result.referencing.length === edgeLimit) result.truncated = true;
          else result.referencing.push({ database: 'main', name });
        }
      }
    },
  });
  check();
  if (outcome.statements.length !== 1 || outcome.transaction) throw Error('SQLite 未确认独立视图目录读取');
  if (!found) throw Error('SQLite 原视图已不存在');
  result.truncated ||= outcome.statements[0].truncated;
  return result;
}
