export const sqlClipboardStackZh = {
  title: 'SQL 剪贴板栈',
  hint: '保留本次运行中从查询编辑器复制或剪切的最近 12 项。选中一项可替换原选区或插入原光标。',
  empty: '还没有从查询编辑器复制或剪切的文本。',
  choose: '选择要粘贴的文本',
  item: (index: number, preview: string) => `${index} · ${preview}`,
  paste: '粘贴所选文本',
  clear: '清空剪贴板栈',
  stale: '原查询编辑器或选区已变化，请重新打开剪贴板栈。',
  single: '请将光标或选区缩减为一处，再从剪贴板栈粘贴。',
} as const;
