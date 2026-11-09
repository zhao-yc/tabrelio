export const sqliteResultOriginsZh = {
  open: '查看结果列来源',
  title: 'SQLite 结果列来源',
  hint: '按查询返回的列顺序显示 SQLite 报告的来源。计算列或无法定位的列显示为「—」。来源表页从数据库独立读取。',
  position: '序号',
  resultColumn: '结果列名',
  database: '来源库',
  table: '来源表',
  column: '来源字段',
  action: '操作',
  openTable: '打开来源表',
  tableLabel: (name: string, position: number) => `打开来源表 ${name}（第 ${position} 列）`,
  unavailable: '—',
} as const;
