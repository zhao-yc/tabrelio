export const updateSqlCopyZh = {
  action: '复制为 UPDATE SQL',
  hint: '按本页勾选或当前记录的完整原主键生成 UPDATE，赋值使用已加载的普通非键字段。请先处理所选行草稿。',
  target: '需要具有完整主键及普通非键字段的当前实体表，且已加载原值。',
  copied: '已复制 UPDATE SQL',
} as const;
