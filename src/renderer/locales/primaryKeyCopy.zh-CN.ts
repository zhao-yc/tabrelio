export const primaryKeyCopyZh = {
  action: '复制原主键查询 SQL',
  open: '打开原主键查询草稿',
  openHint: '有勾选时使用本页勾选行，否则使用当前行。在原连接和数据库中打开可编辑的 SELECT 草稿。',
  queryTitle: (table: string) => table + ' · 原主键查询',
  tabs: '工作区已达到 100 个标签，请先关闭其他标签。',
  hint: '有勾选时按勾选行生成 SELECT，否则使用当前行。使用本页载入的原主键，不执行 SQL。',
  copied: '原主键查询 SQL 已复制。',
  target: '当前表页缺少完整的原主键目录，请刷新后重试。',
  selection: '请在当前已载入页选择有效行。',
  incomplete: '所选行缺少原主键值，无法生成整批查询 SQL。',
  type: '原主键包含无法保真生成的值，无法生成整批查询 SQL。',
  limit: '原主键查询超出行数或字节上限。',
} as const;
