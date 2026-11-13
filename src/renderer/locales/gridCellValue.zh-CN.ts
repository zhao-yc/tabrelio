export const gridCellValueZh = {
  open: '查看单元格值',
  title: (column: string) => `单元格值 · ${column}`,
  content: '单元格文本',
  close: '关闭单元格值',
  copy: '复制完整原文',
  copied: '已复制单元格完整原文。',
  nullValue: 'SQL NULL',
  defaultValue: 'DEFAULT（未填写）',
  emptyValue: '空字符串',
  previous: '上一段',
  next: '下一段',
  position: '单元格文本分段位置',
} as const;
