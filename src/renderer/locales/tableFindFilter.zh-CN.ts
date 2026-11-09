export const tableFindFilterZh = {
  action: '将查找带入全表筛选',
  edge: '查找匹配位置',
  positions: { anywhere: '任意位置', start: '开头', end: '结尾' },
  hint: '先检查筛选草稿。明确应用后才会读取数据库中的记录。',
  sqliteHint: '先检查筛选草稿。文字条件只匹配实际存储为 TEXT 的值。明确应用后才会读取数据库中的记录。',
  unavailable: '请选择一列。支持 SQL NULL、空文本和区分大小写的字面文本查找。文本须能按原文比较。',
} as const;
