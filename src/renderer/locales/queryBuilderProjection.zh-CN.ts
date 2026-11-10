export const queryBuilderProjectionZh = {
  order: '调整输出顺序和别名',
  hint: '按列表顺序输出字段。留空时使用默认列名；别名最多 63 个 UTF-8 字节。',
  alias: (name: string) => '输出别名 ' + name,
  earlier: (name: string) => '上移输出字段 ' + name,
  later: (name: string) => '下移输出字段 ' + name,
} as const;
