export const queryBuilderSummaryZh = {
  enabled: '生成分组聚合查询', title: '分组与聚合', sort: '汇总输出排序',
  count: 'COUNT(*) · 行数', unnamed: '未命名聚合',
  having: 'HAVING 聚合后筛选', havingGroups: '组合 HAVING 条件',
  havingHint: '按分组字段或聚合结果筛选，先于汇总排序和行数限制生效。',
  havingStale: 'HAVING 条件引用的汇总输出已移除，请重选或删除该条件。',
  missingOutput: '已移除的汇总输出',
  hint: 'WHERE 先筛选原行，再按分组字段汇总。只添加聚合项可汇总全部匹配行。函数的类型、数值转换和空值行为由数据库决定。切回明细会恢复原选列和排序。',
} as const;
