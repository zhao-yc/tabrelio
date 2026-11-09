export const mysqlResultOriginsZh = {
  open: '查看结果列来源',
  title: 'MySQL／MariaDB 结果列来源',
  hint: '按原结果列顺序显示服务器报告的库、表和字段。表达式或缺少来源的列显示为「—」。打开来源对象会从独立连接读取当前目录。',
  position: '序号', resultColumn: '结果列名', database: '来源库', table: '来源表',
  column: '来源字段', action: '操作', unavailable: '—',
  temporary: '会话临时表', unverified: '无法确认可打开',
  openObject: '打开来源对象',
  openLabel: (name: string, position: number) => `打开来源对象 ${name}（第 ${position} 列）`,
  stale: '原查询结果或连接已变化，请重新查看来源。',
  loading: '正在核对来源对象…',
  full: '标签已达到 100 个，请先关闭不需要的标签。',
} as const;
