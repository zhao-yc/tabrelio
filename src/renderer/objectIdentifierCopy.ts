import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';
import { completionIdentifier, quoteCompletionIdentifier } from '../shared/completionLexical';
import { parsePostgresCatalogName, postgresIdentifier } from '../shared/postgresSql';
import { quoteSqliteIdentifier } from '../shared/sqliteReadSql';
import { maxClipboardCharacters } from './gridClipboard';

function copyableName(value: string): boolean {
  return !!value && value.length <= maxClipboardCharacters && !/[\0\ud800-\udfff]/u.test(value);
}

/** 从原目录对象提取名称，限定名按方言逐段引用，名称自身的点号保持原样。 */
export function objectIdentifierCopy(dialect: ConnectionProfile['dialect'], database: string, object: DatabaseObject):
{ plain: string; qualified?: string } | undefined {
  if (!copyableName(object.name)) return;
  const { kind } = object;
  if (dialect === 'postgresql') {
    const routine = kind === 'procedure' || kind === 'function';
    if (!routine && kind !== 'table' && kind !== 'view' && kind !== 'sequence') return;
    const parsed = parsePostgresCatalogName(object.name, routine);
    if (!parsed || !copyableName(parsed.name) || !copyableName(parsed.schema)) return;
    return { plain: parsed.name, qualified: postgresIdentifier(parsed.schema) + '.' + postgresIdentifier(parsed.name) };
  }
  if (dialect === 'sqlite') {
    if (database !== 'main' || (kind !== 'table' && kind !== 'view' && kind !== 'trigger')) return;
    const qualified = quoteSqliteIdentifier(database) + '.' + quoteSqliteIdentifier(object.name);
    return { plain: object.name, ...(qualified.length <= maxClipboardCharacters ? { qualified } : {}) };
  }
  if (kind === 'sequence') return;
  const qualified = completionIdentifier(database) && completionIdentifier(object.name)
    ? quoteCompletionIdentifier(database) + '.' + quoteCompletionIdentifier(object.name) : undefined;
  return { plain: object.name, qualified };
}
