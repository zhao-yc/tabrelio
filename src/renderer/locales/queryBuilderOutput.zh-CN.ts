export const queryBuilderOutputZh = {
  copy: '复制生成的 SQL',
  copied: '已复制当前预览 SQL。',
  save: '保存 SQL 到查询库',
  name: '查询库名称',
  confirm: '保存为新查询',
  hint: '保存当前 SQL、连接和数据库。需要保留可编辑的构建步骤时，请另存查询设计。',
  saved: (name: string) => '已保存到查询库：' + name,
} as const;
