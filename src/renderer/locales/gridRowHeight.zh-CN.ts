export const gridRowHeightZh = {
  label: '数据行高',
  options: { 24: '紧凑（24 像素）', 32: '标准（32 像素）', 56: '宽松（56 像素，可换行）' },
  exact: '自定义行高（像素）',
  custom: (height: number) => `自定义（${height} 像素）`,
  range: (min: number, max: number) => `请输入 ${min}～${max} 之间的整数。`,
  apply: '应用自定义行高',
};
