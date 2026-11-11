export const sidebarLocateZh = {
  action: '在对象树中定位当前标签',
  unavailable: '当前标签没有可定位的连接或表',
  closing: '连接正在收尾，请稍后定位。',
  missingDatabase: (name: string) => '原连接的可见目录中没有数据库「' + name + '」。',
  missingRelation: (name: string) => '原数据库的可见目录中没有唯一匹配的表或视图「' + name + '」。',
} as const;
