export const postgresMaterializedColumnNamesZh = {
  title: '重命名物化视图列',
  hint: '按原列顺序填写新名称。重命名保留已存数据、索引及数据库依赖。',
  name: (column: string) => `列 ${column} 的新名称`,
  preview: '预览列重命名',
  sql: '物化视图列重命名 SQL',
  back: '返回编辑',
  apply: '确认重命名列',
  close: '关闭列名编辑',
  discard: '放弃尚未提交的物化视图列名修改？',
  unknown: '重命名结果未确认，请核对原物化视图的列名。',
} as const;
