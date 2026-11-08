export const gridCellFileZh = {
  action: '另存当前单元格',
  hint: '只保存活动格。文本使用 UTF-8，二进制保留原字节。NULL 和未填值不可保存。',
  noValue: '当前单元格没有可保存的值。',
  saved: (bytes: number) => `已保存单元格文件（${bytes} 字节）。`,
};
