export const newTableColumnCopyZh = {
  action: '复制字段',
  label: (position: number) => `复制字段 ${position}`,
  hint: '复制字段配置到下一行。主键、唯一约束和自增标识保留在原字段上。',
} as const;
