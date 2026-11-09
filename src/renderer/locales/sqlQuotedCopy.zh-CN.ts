export const sqlQuotedCopyZh = {
  title: '带引号复制 SQL',
  hint: '把选区转换为代码字符串。复制前可核对引号、反斜杠及换行的转义结果。',
  format: '字符串格式',
  formats: { javascript: 'JavaScript / TypeScript', python: 'Python', java: 'Java' },
  preview: '字符串预览',
  copy: '复制字符串',
  copied: '已复制带引号的 SQL。',
  select: '请先选中一段连续 SQL。',
  tooLarge: '所选 SQL 超过 16,000 个 UTF-16 单元，请缩小选区。',
  stale: '原查询编辑器或选区已变化，请重新选择后复制。',
  unavailable: '剪贴板写入失败，请重试复制。',
} as const;
