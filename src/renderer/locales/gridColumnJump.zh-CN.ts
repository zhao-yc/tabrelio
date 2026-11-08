export const gridColumnJumpZh = {
  open: '跳到列',
  search: '搜索可见列',
  placeholder: '列名或 #序号',
  matches: '匹配列',
  choose: '请选择匹配列',
  none: '没有匹配的可见列',
  unnamed: '空列名',
  option: (position: number, name: string) => `#${position} · ${name}`,
  go: '定位列',
  close: '取消列定位',
} as const;
