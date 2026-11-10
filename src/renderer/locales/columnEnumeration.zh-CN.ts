export const columnEnumerationZh = {
  choose: '选择字段成员',
  enum: 'ENUM 成员',
  set: 'SET 成员',
  filter: '搜索成员',
  empty: '（空字符串）',
  unknown: '请选择已声明的成员',
  unknownSet: '当前文本无法与成员一一对应，请使用文本输入。',
  raw: '文本输入',
  previous: '上一页成员',
  next: '下一页成员',
  position: (page: number, pages: number) => `第 ${page} / ${pages} 页`,
} as const;
