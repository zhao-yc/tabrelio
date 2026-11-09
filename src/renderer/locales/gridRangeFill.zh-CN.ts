export const gridRangeFillZh = {
  open: '填充选区',
  stage: '暂存选区填充',
  value: '填充值',
  kind: '填充值类型',
  text: '文本',
  null: 'SQL NULL',
  integer: '整数',
  real: '浮点数',
  scope: (rows: number, columns: number) => `当前选区 ${rows} 行 × ${columns} 列`,
  stale: '选区或表页已变化，请重新选择。',
  target: '选区含待删除记录、定位键或不支持此值的字段，整块填充已停止。',
} as const;
