export const gridRangeExportZh = {
  action: '导出选区',
  summary: (rows: number, columns: number) => `将导出选区内的 ${rows} 行 × ${columns} 列。`,
  scope: '仅导出打开窗口时选区内的值，包括可见的本地草稿。待删除记录不参与。',
  empty: '选区中没有可导出的数据。',
  limit: '选区超过文件导出的行列上限。',
  missing: '选区含尚未赋值的 DEFAULT 单元格，无法导出。',
  stale: '选区已变化，请重新选择后导出。',
} as const;
