import type { ConnectionProfile } from '../shared/contracts';
import { completionAliasIdentifier, quoteCompletionAlias } from '../shared/completionLexical';
import { postgresIdentifier } from '../shared/postgresSql';
import { quoteSqliteIdentifier } from '../shared/sqliteReadSql';
import { maxClipboardCharacters } from './gridClipboard';

/** 列名可能是结果别名。点号等字符属于一个名称，不能拆成库表路径或猜测原字段。 */
export function gridColumnName(name: string, dialect?: ConnectionProfile['dialect']): { plain: string; quoted?: string } | undefined {
  if (!name || name.length > maxClipboardCharacters || /[\0\ud800-\udfff]/u.test(name)) return;
  let quoted: string | undefined;
  if (dialect === 'postgresql') quoted = postgresIdentifier(name);
  if (dialect === 'sqlite') quoted = quoteSqliteIdentifier(name);
  if ((dialect === 'mysql' || dialect === 'mariadb') && completionAliasIdentifier(name)) quoted = quoteCompletionAlias(name);
  return { plain: name, ...(quoted && quoted.length <= maxClipboardCharacters ? { quoted } : {}) };
}
