export const gridRangePasteZh = {
  emptyGrid: '空数据网格',
  emptyGridPaste: '聚焦此处，按 Ctrl+V 或 ⌘V 粘贴新增记录。',
  stale: '矩形选区已变化，请重新选择后粘贴。',
  limit: '矩形选区超过粘贴上限。',
  target: (rows: number, columns: number) => `目标选区 ${rows} 行 × ${columns} 列`,
  shape: (rows: number, columns: number) => `请粘贴与选区相同的 ${rows} 行 × ${columns} 列，或粘贴一个单元格。`,
  appended: (count: number) => `已同时暂存 ${count} 条新增记录。`,
  appendPreview: (count: number) => `将同时暂存 ${count} 条新增记录。`,
  appendedRow: '新增记录',
  appendHint: '超出末页现有记录的行将暂存为新增记录。',
  draftLimit: '整批草稿超过提交上限。',
} as const;
