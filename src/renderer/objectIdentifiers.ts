import type { ConnectionProfile } from '../shared/contracts';
import { completionIdentifier, quoteCompletionIdentifier } from '../shared/completionLexical';
import { postgresIdentifier } from '../shared/postgresSql';
import { quoteSqliteIdentifier } from '../shared/sqliteReadSql';
import type { WorkbenchTarget } from '../shared/workbench';
import { invoke } from './lib';
import { objectInformationZh as text } from './locales/objectInformation.zh-CN';
import { objectIdentifierCopy } from './objectIdentifierCopy';

type RelationTarget = Extract<WorkbenchTarget, { name: string }> & { kind: 'table' | 'view' };
export type IdentifierTarget = Extract<WorkbenchTarget, { kind: 'database' }> | RelationTarget;
export type IdentifierEntry = { name: string; sql?: string } & ({ relation: RelationTarget } | { type: string });
export interface ObjectIdentifiers { identifiers: IdentifierEntry[]; }

export function supportsObjectIdentifiers(profile: ConnectionProfile, target: WorkbenchTarget | { kind: 'connection'; connectionId: string }): target is IdentifierTarget {
  return (target.kind === 'database' || target.kind === 'table' || target.kind === 'view') &&
    (profile.dialect !== 'sqlite' || target.database === 'main');
}

function columnSql(dialect: ConnectionProfile['dialect'], name: string): string | undefined {
  if (!name || /[\0\ud800-\udfff]/u.test(name)) return;
  if (dialect === 'postgresql') return postgresIdentifier(name);
  if (dialect === 'sqlite') return quoteSqliteIdentifier(name);
  return completionIdentifier(name) ? quoteCompletionIdentifier(name) : undefined;
}

/** 目录只绑定明确选择的连接和库。字段读取重新核对实际种类，防止同名视图接管表行。 */
export async function readObjectIdentifiers(profile: ConnectionProfile, target: IdentifierTarget,
  current: () => boolean): Promise<ObjectIdentifiers | undefined> {
  const { connectionId, database, kind } = target;
  const { dialect } = profile;
  if (dialect !== 'sqlite' && (kind === 'database' || dialect !== 'postgresql')) await invoke('connections.open', { id: connectionId });
  if (!current()) return;
  if (kind === 'database') {
    const objects = await invoke('metadata.objects', { connectionId, database });
    return { identifiers: objects.flatMap(object => object.kind === 'table' || object.kind === 'view' ? [{
      name: object.name, sql: objectIdentifierCopy(dialect, database, object)?.qualified,
      relation: { connectionId, database, kind: object.kind, name: object.name },
    }] : []) };
  }
  const request = { connectionId, database, table: target.name };
  let columns: readonly { name: string; type: string }[];
  if (dialect === 'postgresql') {
    const result = await invoke('postgres.structure.read', request);
    if (postgresIdentifier(result.schema) + '.' + postgresIdentifier(result.name) !== target.name ||
        (kind === 'view') !== (result.kind === 'v' || result.kind === 'm')) throw Error(text.identifierChanged);
    columns = result.columns;
  } else if (dialect === 'sqlite') {
    const result = await invoke('sqlite.queryBuilder.describe', { ...request, database: 'main', kind });
    if (result.target.table !== target.name || result.target.kind !== kind || result.target.connectionId !== connectionId ||
        result.target.database !== database) throw Error(text.identifierChanged);
    columns = result.columns.map(column => ({ name: column.name, type: column.declaredType }));
  } else {
    const result = await invoke('metadata.table', request);
    if (result.database !== database || result.name !== target.name || result.objectKind !== kind) throw Error(text.identifierChanged);
    columns = result.columns;
  }
  return { identifiers: columns.map(({ name, type }) => ({ name, type, sql: columnSql(dialect, name) })) };
}
