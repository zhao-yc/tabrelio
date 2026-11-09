export const gridCsvClipboardZh = {
  action: '复制为 CSV',
  hint: '复制勾选记录，未勾选时复制当前记录。输出逗号分隔文本，含当前可见列的表头。',
  copied: '已复制记录 CSV',
  invalid: '当前记录或列已变化，或包含无法复制的 CSV 值。',
  defaultValue: '所选记录含尚未填写的默认字段，请填写后再复制为 CSV。',
} as const;
