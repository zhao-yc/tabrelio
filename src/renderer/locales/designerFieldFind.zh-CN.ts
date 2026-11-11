export const designerFieldFindZh = {
  title: '查找字段', query: '字段名称', previous: '上一个字段', next: '下一个字段',
  close: '关闭字段查找', empty: '输入字段名称的一部分', none: '没有匹配的字段',
  count: (total: number, current: number) => current ? `第 ${current} / ${total} 个匹配字段` : `${total} 个匹配字段`,
} as const;
