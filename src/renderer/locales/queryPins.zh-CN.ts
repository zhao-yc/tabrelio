export const queryPinsZh = {
  rename: '重命名固定结果',
  name: '固定结果名称',
  invalid: '名称不能为空，最多 256 个 UTF-8 字节，且不能包含控制字符。',
  stale: '原固定结果已变化，请重新打开重命名窗口。',
  elapsed: (ms: number) => `执行耗时 ${Number(ms.toFixed(2))} ms`,
} as const;
