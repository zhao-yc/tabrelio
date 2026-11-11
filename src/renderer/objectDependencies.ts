import type { ConnectionProfile } from '../shared/contracts';
import type { WorkbenchTarget } from '../shared/workbench';
import { assertSqliteIncomingOutput } from '../shared/sqliteIncoming';
import { incomingReferenceMessages } from '../shared/incomingReferences';
import { assertObjectDefinitionOutput, objectDefinitionInputSchema, objectDefinitionTaskPrefix } from '../shared/objectDefinition';
import type { PostgresDependencyRelation } from '../shared/postgresDependencies';
import { postgresIdentifier } from '../shared/postgresSql';
import { invoke, uid } from './lib';
import { objectInformationZh as text } from './locales/objectInformation.zh-CN';
import { postgresDependenciesZh as postgresText } from './locales/postgresDependencies.zh-CN';
import { viewDependenciesZh as viewText } from './locales/viewDependencies.zh-CN';
import { tableElementsZh } from './locales/tableElements.zh-CN';

type Target = Extract<WorkbenchTarget, { name: string }>;
export type DependencyDefinitionTarget =
  | { database: string; relation: PostgresDependencyRelation }
  | { database: string; name: string; expectedKind?: 'table' | 'view' };
export type ObjectDependencyEntry = { identity: string; detail?: string; mapping?: string[]; definition?: DependencyDefinitionTarget };
export interface ObjectDependencies {
  references: ObjectDependencyEntry[];
  referencedBy: ObjectDependencyEntry[];
  notices: string[];
  referencesUnknown?: boolean;
  page?: { digest: string; nextCursor?: string };
}

export function supportsObjectDependencies(profile: ConnectionProfile, target: WorkbenchTarget): target is Target {
  if (profile.dialect === 'postgresql') return target.kind !== 'database' && target.kind !== 'trigger' && target.kind !== 'event';
  return (target.kind === 'table' || target.kind === 'view') && (profile.dialect !== 'sqlite' || target.database === 'main');
}

function foreignKey(database: string, name: string, constraint: string, local: string[], remote?: string[] | null,
  fallback: string = tableElementsZh.implicitPrimary): ObjectDependencyEntry {
  return { identity: `${database} / ${name}`, detail: constraint,
    definition: { database, name, expectedKind: 'table' },
    mapping: local.map((column, index) => `${column} → ${remote?.[index] ?? fallback}`) };
}

/** 复用各方言的只读目录。外键页沿原游标读取，例程第二步必须仍属于原对象。 */
export async function readObjectDependencies(profile: ConnectionProfile, target: Target, options: {
  current(): boolean;
  ownTask(id: string): void;
  cursor?: string;
  digest?: string;
}): Promise<ObjectDependencies | undefined> {
  const { connectionId, database, name, kind } = target;
  if (profile.dialect === 'postgresql') {
    const relation = async () => {
      if (kind !== 'function' && kind !== 'procedure') return invoke('postgres.structure.dependencies', { connectionId, database, table: name });
      const routine = { connectionId, database, name, kind };
      const info = await invoke('postgres.routine.read', routine);
      if (options.current()) return invoke('postgres.routine.dependencies', { ...routine, stamp: info.stamp });
    };
    const result = await relation();
    if (!result) return;
    const mapped = (direction: 'references' | 'referencedBy') => result.entries.filter(entry => entry.direction === direction).map(entry => ({
      identity: entry.identity ?? postgresText.hidden,
      ...(entry.relation && { definition: { database, relation: entry.relation } }),
      detail: [entry.kind && ((postgresText.kinds as Readonly<Record<string, string>>)[entry.kind] ?? entry.kind),
        (postgresText.types as Readonly<Record<string, string>>)[entry.type] ?? entry.type].filter(Boolean).join(' · '),
    }));
    return { references: mapped('references'), referencedBy: mapped('referencedBy'),
      notices: [postgresText.hint, ...(kind === 'function' || kind === 'procedure' ? [postgresText.routineHint] : []),
        ...(result.limited ? [postgresText.limited] : [])] };
  }
  if (kind === 'view') {
    const result = profile.dialect === 'sqlite'
      ? await invoke('sqlite.view.dependencies', { connectionId, database: 'main', name })
      : await invoke('mysql.view.dependencies', { connectionId, database, name });
    const display = (rows: typeof result.referenced, expectedKind?: 'view') => rows.map(row => ({
      identity: `${row.database} / ${row.name}`, definition: { ...row, expectedKind },
    }));
    return { references: display(result.referenced), referencedBy: display(result.referencing, 'view'), referencesUnknown: result.referencedUnknown,
      notices: [result.source === 'catalogue' ? viewText.catalogue : viewText.definitions,
        ...(result.skipped ? [viewText.skipped(result.skipped)] : []), ...(result.truncated ? [viewText.truncated] : [])] };
  }
  const taskId = uid();
  options.ownTask(taskId);
  if (profile.dialect === 'sqlite') {
    const request = { connectionId, database: 'main', table: name, taskId, incoming: 'catalog' } as const;
    const result = assertSqliteIncomingOutput(await invoke('sqlite.incomingPage', request), request);
    return {
      references: result.source.foreignKeys.map(key => foreignKey(database, key.referencedTable, tableElementsZh.ordinal(key.ordinal), key.columns, key.referencedColumns)),
      referencedBy: result.references.map(({ table, key, referencedColumns }) =>
        foreignKey(database, table, tableElementsZh.ordinal(key.ordinal), key.columns, referencedColumns, text.unknownParentColumn)),
      notices: [text.sqliteForeignKeyScope],
    };
  }
  const result = await invoke('table.incomingReferences', { connectionId, database, table: name, taskId,
    ...(options.cursor ? { cursor: options.cursor } : {}) });
  if (options.digest && result.sourceDigest !== options.digest) throw Error(incomingReferenceMessages.stale);
  return {
    references: result.source.foreignKeys.map(key => foreignKey(key.referencedDatabase, key.referencedTable, key.name, key.columns, key.referencedColumns)),
    referencedBy: result.relations.map(({ database, table, foreignKey: key }) => foreignKey(database, table, key.name, key.columns, key.referencedColumns)),
    notices: [text.mysqlForeignKeyScope],
    page: { digest: result.sourceDigest, nextCursor: result.nextCursor },
  };
}

/** 从目录行的结构化身份读取定义；不从显示名称猜目标或沿用活动查询会话。 */
export async function readDependencyDefinition(profile: ConnectionProfile, target: DependencyDefinitionTarget,
  ownTask: (id: string) => void): Promise<string> {
  if ('relation' in target && profile.dialect === 'postgresql') {
    const { relation, database } = target;
    return invoke('postgres.structure.definition', {
      connectionId: profile.id, database,
      name: postgresIdentifier(relation.schema) + '.' + postgresIdentifier(relation.name),
      kind: relation.kind === 'v' || relation.kind === 'm' ? 'view' : 'table',
      expectedRelation: { oid: relation.oid, kind: relation.kind },
    });
  }
  if ('relation' in target || profile.dialect === 'postgresql') throw Error(viewText.kindChanged);
  const input = objectDefinitionInputSchema.parse({
    connectionId: profile.id, database: target.database, table: target.name, taskId: objectDefinitionTaskPrefix + uid(),
  });
  ownTask(input.taskId);
  const output = await invoke('query.objectDefinition', input);
  assertObjectDefinitionOutput(output, input, profile.dialect);
  if (target.expectedKind && output.kind !== target.expectedKind) throw Error(viewText.kindChanged);
  return output.ddl;
}
