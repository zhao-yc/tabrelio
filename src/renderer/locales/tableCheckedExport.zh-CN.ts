export const tableCheckedExportZh = {
  region: '跨页勾选导出',
  collect: '收集本页勾选',
  replace: '更新本页收集',
  export: '导出已收集记录',
  clear: '清空已收集记录',
  exportRows: (count: number) => '已收集的 ' + count + ' 行',
  exportScope: '导出各页收集时的可见列和原始值，按页码与页内显示顺序排列。',
  summary: (pages: number, rows: number) => '已收集 ' + pages + ' 页、' + rows + ' 条记录',
  hint: '按当前可见列收集原始记录。重新收集同一页会替换该页，空勾选会移除该页。不同页来自各次读取。',
  clean: '请先处理记录草稿，再收集或导出。',
  invalid: '本页勾选或列布局已变化，请重新勾选。',
} as const;
