export const tableElementsZh = {
  branch: (table: string) => '表结构 ' + table,
  expand: (table: string) => '展开表结构 ' + table,
  collapse: (table: string) => '收起表结构 ' + table,
  columns: '字段', indexes: '索引', foreignKeys: '外键',
  noElements: '此表没有此类元素', retry: '重新读取', loading: '正在读取表结构',
  ending: '连接正在收尾，请稍后重新读取表结构。',
  primary: '主键', generated: '生成列', unique: '唯一', partial: '部分索引',
  ordinal: (ordinal: number) => '外键 #' + ordinal,
  implicitPrimary: '目标主键', noDeclaredType: '未声明类型',
  design: '在设计器中定位', designNamed: (name: string) => '在设计器中定位 ' + name,
  missing: (name: string) => '最新目录中无法定位「' + name + '」，可刷新对象树核对。',
} as const;
