export const queryResultKeywordZh = {
  input: '按关键字筛选结果',
  apply: '筛选关键字',
  clear: '清除关键字',
  hint: '匹配可见列中已返回的文本、数字和布尔值，忽略大小写。仅筛选当前结果。',
  counts: (matched: number, total: number) => `关键字匹配 ${matched} / ${total} 行`,
  budget: '当前结果超出关键字筛选预算，请减少查询返回的行或可见列。',
  invalid: '当前结果无法按关键字筛选。',
} as const;
