export const recordNavigatorZh = {
  title: '本页记录导航',
  columns: '导航摘要字段',
  column: (index: number) => `摘要字段 ${index + 1}`,
  none: '不显示',
  unnamed: '（未命名字段）',
  previous: '上一组记录',
  next: '下一组记录',
  range: (first: number, last: number, count: number) => `${first}–${last} / ${count}`,
  row: (index: number) => `第 ${index + 1} 条`,
  stageRow: (index: number) => `暂存并查看第 ${index + 1} 条`,
  empty: '（空字符串）',
  unavailable: '此记录不可切换',
};
