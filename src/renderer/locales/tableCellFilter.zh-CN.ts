export const cellTextFilterLabels = {
  contains: '包含此文本', notContains: '不包含此文本',
  startsWith: '以此文本开头', notStartsWith: '不以此文本开头',
  endsWith: '以此文本结尾', notEndsWith: '不以此文本结尾',
} as const;

/** 表数据的快捷条件仅预填原值，实际读取仍走既有参数化分页。 */
export const tableCellFilterZh = {
  context: '单元格筛选',
  postgresStaged: '已带入单元格原值。先添加条件，再应用高级筛选。排除普通值时，NULL 不会匹配。',
  postgresReplacesQuick: '当前使用快捷筛选。应用高级筛选会替换快捷筛选。',
  equal: '按此单元格值筛选', exclude: '排除此单元格值',
  ...cellTextFilterLabels,
  containsRule: '文本包含（按字面）', notContainsRule: '文本不包含（按字面）',
  startsWithRule: '文本开头为（按字面）', notStartsWithRule: '文本开头不是（按字面）',
  endsWithRule: '文本结尾为（按字面）', notEndsWithRule: '文本结尾不是（按字面）',
  textEqualsRule: '整格文本等于（按字面）',
  hint: '选择单元格后带入条件草稿；审阅并添加条件才按当前全部／任一规则重新查询服务器。请先处理未提交数据和活动编辑器。',
  staged: '已带入单元格原值，可继续修改；添加条件后才读取服务器全表，采用当前全部／任一规则。NULL使用空值判断；普通不等于不包含NULL。',
  unavailable: '当前单元格、字段或原值已变化，不能带入筛选；请重新选择已加载的普通单元格。',
} as const;
