export const valueDistributionZh = {
  title: '类别分布', enable: '显示类别分布',
  value: '类别', count: '次数', percent: '占比', bar: '分布',
  totals: (rows: string, groups: string) => `匹配 ${rows} 行，共 ${groups} 组`,
  remainder: (rows: string, groups: string, percent: string) => `其余 ${groups} 组共 ${rows} 行，占 ${percent}`,
} as const;
