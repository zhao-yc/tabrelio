export const mysqlQueryStatusZh = {
  collect: '采集执行状态',
  title: '执行状态',
  hint: '统计客户端发送和接收的 MySQL 协议字节，包含包头及实际收到的响应。耗时覆盖单条命令的收发，不包含会话准备或警告采集。',
  columns: ['语句序号', '状态', '耗时（ms）', '发送（字节）', '接收（字节）'],
  completed: '完成',
  failed: '失败',
  unavailable: '不可用',
  empty: '本次没有可显示的已发送命令。',
  cancelled: '任务已取消。以下保留已结束命令的状态和已观测到的流量。',
  interrupted: '任务异常结束。以下保留已结束命令的状态和已观测到的流量。',
  omitted: (count: number) => `另有 ${count} 条命令未列出。`,
  total: (sent: string, received: string) => `共发送 ${sent} 字节，接收 ${received} 字节`,
} as const;
