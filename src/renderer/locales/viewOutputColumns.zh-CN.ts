export const viewOutputColumnsZh = {
  title: '视图输出列名',
  hint: '列名按查询输出顺序对应。清空显式列名后沿用查询的列名。',
  partialHint: '列名从第一列起按查询输出顺序覆盖。未覆盖的列沿用查询列名。',
  tooMany: (count: number) => `当前预览有 ${count} 列，显式列名不能超过这个数量。`,
  unavailable: '请填写视图名称，并核对当前同名视图的完整 SQL 草稿。',
  add: '添加列名',
  fromPreview: '填入预览列名',
  clear: '清空显式列名',
  apply: '应用列名到 SQL',
  column: (index: number) => `第 ${index} 列名称`,
  remove: (index: number) => `移除第 ${index} 列名称`,
  countMismatch: (count: number) => `当前预览有 ${count} 列，请为每列填写一个名称，或清空显式列名。`,
} as const;
