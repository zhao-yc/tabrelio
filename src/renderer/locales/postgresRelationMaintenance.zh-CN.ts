export const postgresRelationMaintenanceZh = {
  title: 'PostgreSQL 关系维护', operation: '维护操作',
  actions: { analyze: '更新统计信息', vacuum: '普通 VACUUM', vacuumAnalyze: 'VACUUM 并更新统计', reindex: '重建表索引' },
  hints: {
    analyze: '采样目标关系并更新查询规划器的统计信息。',
    vacuum: '清理已失效的行版本，让原表复用空间。另一会话持有对象锁，VACUUM 在事务外执行。',
    vacuumAnalyze: '清理已失效的行版本并更新统计。另一会话持有对象锁，VACUUM 在事务外执行。',
    reindex: '重建当前关系的索引。执行期间会阻塞写入，使用索引的读取也可能等待。',
  },
  lastVacuum: '上次手动 VACUUM', lastAnalyze: '上次手动分析', vacuumCount: '手动清理次数', analyzeCount: '手动分析次数',
  indexName: '索引名称', indexStatus: '状态', valid: '有效', invalid: '无效', noIndexes: '当前关系没有可重建的索引。',
  unavailable: '当前权限、关系状态或服务器版本未开放所选维护操作。',
  preview: '预览维护 SQL', apply: '确认执行维护', back: '返回结构', edit: '返回修改', refresh: '刷新维护目录',
  sql: '实际维护 SQL', discard: '放弃未提交的维护预览？',
  changed: '原连接已变化，请重新打开关系维护。',
  unknown: '维护结果待核对。请返回结构后重新查看统计和关系状态。',
} as const;
