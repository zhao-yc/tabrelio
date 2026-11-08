export const primaryKeyCopyZh = {
  action: '复制原主键查询 SQL',
  hint: '有勾选时按勾选行生成 SELECT，否则使用当前行。使用本页载入的原主键，不执行 SQL。',
  copied: '原主键查询 SQL 已复制。',
  target: '当前表页缺少完整的原主键目录，请刷新后重试。',
  selection: '请在当前已载入页选择有效行。',
  incomplete: '所选行缺少原主键值，整批未复制。',
  type: '原主键包含无法保真生成的值，整批未复制。',
  limit: '原主键查询超出行数或字节上限，整批未复制。',
} as const;
