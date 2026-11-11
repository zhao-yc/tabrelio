export const htmlCellPreviewZh = {
  open: '网页预览',
  close: '收起网页预览',
  field: (name: string) => `网页预览 · ${name}`,
  frame: '单元格 HTML 内容',
  hint: '静态预览支持排版和内嵌图片。脚本、外链和表单已停用。',
  bytes: '网页预览最多读取 256 KiB 的 HTML。',
  structure: 'HTML 结构超过网页预览预算。',
  unavailable: '当前 HTML 无法生成网页预览。',
} as const;
