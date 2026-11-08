export const mysqlViewAttributesZh = {
  title: '视图属性',
  algorithm: '处理算法',
  security: '安全模式',
  check: '写入检查范围',
  values: {
    UNDEFINED: 'UNDEFINED（由服务器决定）',
    MERGE: 'MERGE（合并查询）',
    TEMPTABLE: 'TEMPTABLE（临时表）',
    DEFINER: 'DEFINER（定义者）',
    INVOKER: 'INVOKER（调用者）',
    NONE: '无检查',
    LOCAL: 'LOCAL（当前视图）',
    CASCADED: 'CASCADED（包含底层视图）',
  },
  hint: '选择仅更新 SQL 草稿。写入检查适用于可更新视图，由服务器校验。',
  unavailable: '填写视图名称，并确保草稿是当前同名视图的一条 CREATE VIEW 或 ALTER VIEW 语句。',
} as const;
