export const viewQueryInspectZh = {
  region: '视图定义检查',
  rows: '预览数据',
  explain: '查看估算计划',
  postgresHint: (limit: number) => `在独立只读事务中预览最多 ${limit} 行。请用 schema 限定对象名，定义中的函数按当前连接权限运行。`,
  mysqlHint: (limit: number) => `在当前数据库的独立只读事务中最多预览 ${limit} 行。查询及其中的函数按当前连接身份运行。`,
  sqliteHint: (limit: number) => `使用只读文件连接，最多显示 ${limit} 行。请先核对完整的 CREATE VIEW 定义。`,
  working: '正在检查视图定义…',
  count: (count: number) => `已返回 ${count} 行`,
  truncated: (count: number) => `已显示 ${count} 行，结果已达预览上限`,
} as const;
