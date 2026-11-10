export const updateSqlCopyZh = {
  action: '复制为 UPDATE SQL',
  current: '复制当前行为 UPDATE SQL', selected: '复制选中行为 UPDATE SQL', range: '复制选区所在行为 UPDATE SQL',
  hint: '按本页勾选或当前记录的完整原主键生成 UPDATE，赋值使用已加载的普通非键字段。请先处理所选行草稿。',
  target: '需要具有完整主键及普通非键字段的当前实体表，且已加载原值。',
  copied: '已复制 UPDATE SQL',
  open: '打开 UPDATE 草稿',
  openHint: '用当前记录或本页勾选生成独立的 UPDATE 查询草稿，可核对后手动执行。',
  queryTitle: (table: string) => table + ' · UPDATE 草稿',
} as const;
