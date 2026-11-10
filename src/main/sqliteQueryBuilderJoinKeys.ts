import { createHash } from 'node:crypto';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { queryBuilderForeignKeyChoiceSchema, queryBuilderForeignKeyLimit, type QueryBuilderForeignKeyChoice } from '../shared/queryBuilderJoin';
import { sqliteIncomingColumns } from '../shared/sqliteIncoming';
import type { SqliteQueryBuilderSource } from '../shared/sqliteQueryBuilder';
import { sqliteRelationshipName as fold, type SqliteRelationshipTable } from '../shared/sqliteRelationships';
import { readSqliteRelationshipTable } from './sqliteRelationships';
import type { SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 在构建器现有只读快照中匹配两侧目录；隐式父列沿用完整主键顺序。 */
export async function readSqliteQueryBuilderJoinKeys(driver: SqliteDriverSession, control: SqliteTableBrowseControl,
  earlier: readonly SqliteQueryBuilderSource[], next: SqliteQueryBuilderSource): Promise<QueryBuilderForeignKeyChoice[]> {
  if (next.target.kind !== 'table' || /^sqlite_/i.test(next.target.table)) return [];
  const right = await readSqliteRelationshipTable(driver, next.target.table, control, next.schemaKey);
  const tables = new Map([[right.name, right]]);
  const visible = (table: SqliteRelationshipTable) => new Map(table.columns.filter(column => column.hidden !== 1).map(column => [fold(column.name), column.name]));
  const choices: QueryBuilderForeignKeyChoice[] = [];
  function append(source: number, left: SqliteRelationshipTable, direction: QueryBuilderForeignKeyChoice['direction']) {
    const [child, parent] = direction === 'outgoing' ? [left, right] : [right, left];
    const childNames = visible(child), parentNames = visible(parent);
    for (const constraint of child.foreignKeys) {
      if (fold(constraint.referencedTable) !== fold(parent.name)) continue;
      const referenced = sqliteIncomingColumns(parent, constraint);
      if (!referenced) continue;
      const pairs = constraint.columns.map((name, i) => {
        const childName = childNames.get(fold(name)), parentName = parentNames.get(fold(referenced[i]));
        return direction === 'outgoing' ? { left: childName, right: parentName } : { left: parentName, right: childName };
      });
      const key = createHash('sha256').update(JSON.stringify([next.schemaKey, source, direction, constraint.ordinal, pairs])).digest('hex');
      const choice = queryBuilderForeignKeyChoiceSchema.safeParse({ source, direction, key, label: '#' + constraint.ordinal, pairs });
      if (!choice.success) continue;
      if (choices.length >= queryBuilderForeignKeyLimit) throw Error('匹配的 SQLite 外键超过读取预算。');
      choices.push(choice.data);
    }
  }
  for (const [index, { target, schemaKey }] of earlier.entries()) {
    if (target.kind !== 'table' || /^sqlite_/i.test(target.table)) continue;
    let left = tables.get(target.table);
    if (!left) {
      left = await readSqliteRelationshipTable(driver, target.table, control, schemaKey);
      tables.set(target.table, left);
    }
    append(index, left, 'outgoing');
    append(index, left, 'incoming');
  }
  return choices;
}
