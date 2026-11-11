import type { ConnectionProfile } from '../shared/contracts';
import { postgresIdentifier } from '../shared/postgresSql';
import type { PostgresStructureResult } from '../shared/postgresStructure';
import { captureSqliteRelationshipDiagram } from './sqliteRelationshipDiagram';
import { buildRelationshipDiagram, captureDiagramTable, relationshipDiagramLimits as limits, type DiagramTable, type RelationshipDiagram } from './relationshipDiagram';
import { relationshipDiagramZh as text } from './locales/relationshipDiagram.zh-CN';
import { invoke } from './lib';

const actions = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' } as const;

/** 使用目录中已确认的 schema 和关系名，点号及引号属于原标识符。 */
export function capturePostgresDiagramTable(result: PostgresStructureResult, database: string, table: string): DiagramTable {
  const qualified = (schema: string, name: string) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  if (result.database !== database || qualified(result.schema, result.name) !== table || !['r', 'p', 'f'].includes(result.kind)) throw Error(text.invalid);
  const primary = result.constraints.find(key => key.kind === 'p');
  if (primary && !primary.keyColumns?.length) throw Error(text.invalid);
  const columns = result.columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
  const known = new Set(columns.map(column => column.name));
  const primaryKey = primary?.keyColumns ?? [];
  if (primaryKey.some(name => !known.has(name))) throw Error(text.invalid);
  const foreignKeys = result.constraints.filter(key => key.kind === 'f').map(({ name, foreign }) => {
    if (!foreign?.pairs.length || foreign.pairs.some(pair => !known.has(pair.local))) throw Error(text.invalid);
    return { name, referencedDatabase: database, referencedTable: qualified(foreign.schema, foreign.table),
      columns: foreign.pairs.map(pair => pair.local), referencedColumns: foreign.pairs.map(pair => pair.remote),
      onUpdate: actions[foreign.onUpdate], onDelete: actions[foreign.onDelete] };
  });
  return { database, name: table, columns, primaryKey, foreignKeys };
}

interface DiagramRead {
  check(): void;
  task(id?: string): void;
  progress(done: number, total: number): void;
}

/** 逐次读取已选结构，所有表通过校验后才发布关系图。SQLite 的正式图读取共享一个快照。 */
export async function readObjectBrowserDiagram(profile: ConnectionProfile, database: string, names: readonly string[], control: DiagramRead): Promise<RelationshipDiagram> {
  if (!names.length || names.length > limits.tables || new Set(names).size !== names.length) throw Error(text.invalid);
  const connectionId = profile.id;
  control.check();
  async function withTask<T>(read: (taskId: string) => Promise<T>) {
    control.check();
    const id = crypto.randomUUID();
    control.task(id);
    try { return await read(id); }
    finally { control.task(undefined); }
  }
  if (profile.dialect === 'sqlite') {
    if (database !== 'main') throw Error(text.invalid);
    const table = names[0];
    const description = await invoke('sqlite.queryBuilder.describe', { connectionId, database, table, kind: 'table' });
    if (description.target.connectionId !== connectionId || description.target.database !== database ||
        description.target.table !== table || description.target.kind !== 'table') throw Error(text.invalid);
    return withTask(async taskId => {
      const request = { connectionId, database: 'main' as const, taskId, anchor: { table, schemaKey: description.schemaKey }, tables: [...names] };
      const result = await invoke('sqlite.relationships', request);
      control.check();
      return captureSqliteRelationshipDiagram(result, request);
    });
  }
  const tables: DiagramTable[] = [];
  control.progress(0, names.length);
  for (const name of names) {
    control.check();
    if (profile.dialect === 'postgresql') {
      const result = await invoke('postgres.structure.read', { connectionId, database, table: name });
      control.check();
      tables.push(capturePostgresDiagramTable(result, database, name));
    } else {
      const result = await withTask(taskId => invoke('metadata.table', { connectionId, database, table: name, taskId }));
      control.check();
      if (result.database !== database || result.name !== name) throw Error(text.invalid);
      tables.push(captureDiagramTable(result));
    }
    if (tables.reduce((sum, table) => sum + table.columns.length, 0) > limits.columns ||
        tables.reduce((sum, table) => sum + table.foreignKeys.length, 0) > limits.foreignKeys) throw Error(text.invalid);
    control.progress(tables.length, names.length);
  }
  return buildRelationshipDiagram(tables);
}
