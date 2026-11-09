export const deleteSqlCopyZh = {
  action: '复制为 DELETE SQL',
  hint: '根据当前记录或本页勾选记录的完整原主键生成 DELETE 文本。选中记录有草稿时拒绝复制。',
  copied: '已复制 DELETE SQL，请核对后手动执行',
  open: '打开 DELETE 草稿',
  openHint: '按完整原主键打开独立的 DELETE 查询草稿，可核对后手动执行。',
  queryTitle: (table: string) => table + ' · DELETE 草稿',
} as const;
