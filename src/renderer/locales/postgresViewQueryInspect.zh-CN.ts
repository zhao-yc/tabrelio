export const postgresViewQueryInspectZh = {
  region: '视图定义检查',
  rows: '预览数据',
  explain: '查看估算计划',
  hint: (limit: number) => `在独立只读事务中预览最多 ${limit} 行。请用 schema 限定对象名，定义中的函数按当前连接权限运行。`,
  working: '正在检查视图定义…',
  count: (count: number) => `已返回 ${count} 行`,
  truncated: (count: number) => `已显示 ${count} 行，结果已达预览上限`,
} as const;
