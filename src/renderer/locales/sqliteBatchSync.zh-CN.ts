export const sqliteBatchSyncZh = {
  title: 'SQLite 多表同步',
  hint: '重新读取所列的表对并沿用各表的匹配键与字段映射。所选差异在同一个右侧文件内提交。',
  preview: '预览多表同步',
  prepare: '正在重新读取两侧表并生成预览…',
  previewTitle: '多表同步预览',
  noChanges: '所选操作没有需要同步的差异。',
  back: '放弃同步预览',
  apply: '确认多表同步',
  working: '正在提交 SQLite 多表同步事务…',
  confirmed: 'SQLite 多表同步已确认提交',
};

export const postgresBatchSyncZh = {
  ...sqliteBatchSyncZh,
  title: 'PostgreSQL 多表同步',
  hint: '重新读取所列的表对并沿用各表的匹配键与字段映射。所选差异在同一个右侧数据库内提交。',
  working: '正在提交 PostgreSQL 多表同步事务…',
  confirmed: 'PostgreSQL 多表同步已确认提交',
};

export const mysqlBatchSyncZh = {
  ...sqliteBatchSyncZh,
  title: 'MySQL／MariaDB 多表同步',
  hint: '重新读取所列的 InnoDB 表对并沿用各表的匹配键与字段映射。所选差异在同一个右侧数据库内提交。',
  working: '正在提交 MySQL／MariaDB 多表同步事务…',
  confirmed: 'MySQL／MariaDB 多表同步已确认提交',
};
