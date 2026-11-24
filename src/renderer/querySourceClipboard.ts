import { maxClipboardCharacters, writeTableClipboardEvent } from './gridClipboard';
import { zh } from './locales/zh-CN';

/** 复制已核验的原语句，仅写入纯文本，超出预算时不复制部分正文。 */
export function copyQuerySourceSql(sql: string, current: () => boolean): void {
  if (sql.length > maxClipboardCharacters) throw Error(zh.clipboard.copySizeLimit);
  writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
}
