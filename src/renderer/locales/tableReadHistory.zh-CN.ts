export const tableReadHistoryZh = {
  title: '表页读取 SQL',
  scope: '本标签最近 30 次成功加载的分页语句及随页计数。参数值保持隐藏，关闭标签后清除。',
  empty: '当前标签暂无已加载的分页语句。',
  read: (position: number, rows: number) => `起始位置 ${position} · 返回 ${rows} 行`,
  clipped: '语句超出显示上限，当前显示前缀。',
  close: '关闭',
};
