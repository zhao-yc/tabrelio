export const localMatchingPagesZh = {
  nextMatching: '读取下一批匹配',
  nextMatchingHint: '跳过空批，遇到匹配或读取失败时停在该批。',
  matchingReading: '正在查找下一批匹配。',
  stopMatching: '停止连续读取',
  matchingStopping: '读完当前批次后停止。',
  matchingPaused: '已停止连续读取，可从当前位置继续。',
  matchingLimit: (count: number) => `已读取 ${count} 批，暂未匹配，可继续查找。`,
} as const;
