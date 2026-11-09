export const gridRangePasteZh = {
  stale: '矩形选区已变化，请重新选择后粘贴。',
  limit: '矩形选区超过粘贴上限。',
  target: (rows: number, columns: number) => `目标选区 ${rows} 行 × ${columns} 列`,
  shape: (rows: number, columns: number) => `请粘贴与选区相同的 ${rows} 行 × ${columns} 列，或粘贴一个单元格。`,
} as const;
