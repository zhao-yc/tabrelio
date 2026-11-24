export const gridRangeExportZh = {
  action: '导出选区',
  txt: '另存选区为 TXT', txtFilename: '选区.txt',
  txtSaved: (name: string, rows: number) => `已保存 ${rows} 行选区到 ${name}`,
  png: '保存为 PNG', pngSaving: '正在保存 PNG…',
  pngHint: '图片包含可见列名和选区行。长内容以省略号显示。',
  pngSaved: (name: string) => `已保存选区图片 ${name}`,
  summary: (rows: number, columns: number) => `将导出选区内的 ${rows} 行 × ${columns} 列。`,
  scope: '仅导出打开窗口时选区内的值。可编辑表页包含可见的本地草稿，待删除记录不参与。',
  empty: '选区中没有可导出的数据。',
  limit: '选区超过文件导出的行列上限。',
  missing: '选区含尚未赋值的 DEFAULT 单元格，无法导出。',
  stale: '选区已变化，请重新选择后导出。',
} as const;
