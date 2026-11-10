export const tableReadHistoryZh = {
  title: '表页 SQL 历史',
  scope: '本标签最近 30 次分页读取和表格提交。写入模板记录投递尝试，事务结果以回执为准。参数值保持隐藏，关闭标签后清除。',
  empty: '当前标签暂无 SQL 历史。',
  read: (position: number, rows: number) => `起始位置 ${position} · 返回 ${rows} 行`,
  readFailed: '分页读取 · 未完成',
  clipped: '语句超出显示上限，当前显示前缀。',
  outcomes: {
    committed: '表格提交 · 已确认提交',
    'rolled-back': '表格提交 · 已确认回滚',
    'not-sent': '表格提交 · 未发送数据修改',
    unknown: '表格提交 · 结果待核对',
  },
  omitted: (count: number) => `已省略 ${count} 条批量语句，保留事务控制语句。`,
  close: '关闭',
};
