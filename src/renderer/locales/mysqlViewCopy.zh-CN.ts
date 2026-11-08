export const mysqlViewCopyZh = {
  open: '另存为新视图',
  title: '另存 MySQL / MariaDB 视图',
  source: (database: string, name: string) => `原视图 ${database} / ${name}`,
  name: '新视图名称',
  hint: '在同一数据库用当前草稿创建新视图。查询、列清单和定义者等属性会一并保留。创建需要当前账号具备相应权限。',
  stale: '原视图草稿或连接已变化，请返回后重新打开。',
  preview: '预览新视图 SQL',
  review: '核对目标与 SQL。重名时服务器会拒绝创建。',
  apply: '确认创建新视图',
  back: '返回原视图草稿',
  saved: (name: string) => `已创建视图 ${name}`,
} as const;
