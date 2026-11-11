export const draftHistoryZh = {
  undo: '撤销上一步', redo: '重做下一步',
  discardRow: '放弃当前记录草稿',
  discardEntry: '放弃此记录草稿',
  discardRowHint: '恢复这一行的原值，或移除尚未提交的新增行。可撤销这一步。',
  postgresTitle: 'PostgreSQL 草稿历史',
  postgresLimit: '当前表页最多保留 100 步、8 MiB 内存历史。仅能恢复原页快照仍有效的草稿。',
  limit: '仅本页内存：最多100步、8 MiB历史；超限淘汰最早操作。',
  overflow: '此次操作超过历史容量，草稿已保留，之前的撤销和重做历史已清空。',
  changed: '页面草稿已变化，编辑历史已清空。',
  unavailable: '当前正在运行、编辑输入或显示窗口，暂不能撤销或重做。'
};
