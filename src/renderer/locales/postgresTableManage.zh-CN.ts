import { postgresViewManageZh } from './postgresViewManage.zh-CN';

export const postgresTableManageZh = {
  ...postgresViewManageZh,
  title: '管理表',
  rename: '重命名表',
  drop: '删除表',
  name: '新表名',
  renameHint: '在同一 schema 内重命名，保留原表、数据和依赖。',
  dropHint: '删除会移除表结构和全部数据。PostgreSQL 会拒绝存在阻止删除的依赖的操作。',
  preview: '预览表操作',
  sql: '表操作 SQL',
  acknowledge: '输入原表名确认删除',
  unknown: '操作结果未确认，请先在原数据库核对表。',
} as const;
