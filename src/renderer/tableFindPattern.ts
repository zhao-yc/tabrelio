export type TableFindEdge = 'start' | 'end';

/** 在线程内把位置约束加入模式本身，后缀即使与更早匹配重叠也能命中。 */
export function tableFindPattern(options: { query: string; caseSensitive: boolean; wholeCell: boolean; regex?: boolean; edge?: TableFindEdge }): RegExp {
  const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 用绝对结束断言保留末尾换行，非捕获分组保持替换所用的捕获组编号。
  const start = options.wholeCell || options.edge === 'start' ? '^' : '';
  const end = options.wholeCell || options.edge === 'end' ? '(?![\\s\\S])' : '';
  return new RegExp(start || end ? `${start}(?:${source})${end}` : source, options.caseSensitive ? 'gu' : 'giu');
}
