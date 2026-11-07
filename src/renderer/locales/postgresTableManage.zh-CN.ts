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
  truncate: '清空数据',
  truncateHint: '清空会移除所列关系的全部记录，并执行其 ON TRUNCATE 触发器。外键阻止清空时，事务会回滚。',
  identity: '序列处理',
  continue: '保留序列进度',
  restart: '重置拥有的序列',
  affectedTables: '清空范围',
  affectedSequences: '重置的序列',
  acknowledgeTruncate: '输入目标表名确认清空',
  confirmTruncate: '确认清空全部数据',
} as const;
