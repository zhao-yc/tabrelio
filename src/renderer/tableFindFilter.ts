import type { FilterRule } from '../shared/contracts';
import type { PageFindOptions } from './pageFindReplace';

/** 只转换与原查找语义一致的单列条件。显示格式、正则与忽略大小写不交给服务器猜测。 */
export function tableFindFilterRule(
  options: Pick<PageFindOptions, 'query' | 'caseSensitive' | 'wholeCell' | 'regex' | 'edge'> & { kind: string },
  column: { name: string; type?: string } | undefined,
  dialect: 'mysql' | 'postgresql' | 'sqlite',
): FilterRule | undefined {
  if (!column) return;
  if (options.kind === 'null') return { column: column.name, operator: 'IS NULL' };
  const declaration = column.type ?? '';
  // PostgreSQL 定长字符转 text 会丢掉填充空格，不能与网格原文保证等值。
  const textColumn = dialect === 'sqlite' || (dialect === 'postgresql'
    ? /^(?:text|character varying|varchar)(?:\(\d+\))?$/i.test(declaration)
    : /^(?:varchar|tinytext|text|mediumtext|longtext)(?:\(\d+\))?$/i.test(declaration));
  if (!textColumn) return;
  if (options.kind === 'empty') return { column: column.name, operator: 'TEXT EQUALS', value: '' };
  if (options.kind !== 'text' || !options.caseSensitive || options.regex || !options.query ||
      /\p{Surrogate}/u.test(options.query) || dialect === 'postgresql' && options.query.includes('\0')) return;
  const operator = options.wholeCell ? 'TEXT EQUALS' : options.edge === 'start' ? 'STARTS WITH' : options.edge === 'end' ? 'ENDS WITH' : 'CONTAINS';
  return { column: column.name, operator, value: options.query };
}
