export const postgresSchemaManageZh = {
  title: '管理 PostgreSQL Schema', operation: '操作', source: '原 Schema', name: 'Schema 名称',
  actions: { create: '新建 Schema', rename: '重命名', comment: '编辑注释', owner: '转移所有者', drop: '删除 Schema' },
  owner: '所有者', newOwner: '目标所有者', comment: '注释', usage: 'USAGE 权限', create: 'CREATE 权限',
  yes: '有', no: '无', empty: '当前角色没有可见的用户 Schema。', refresh: '刷新目录', close: '关闭',
  preview: '预览 Schema SQL', apply: '确认提交 Schema 操作', sql: '实际提交 SQL', back: '返回修改',
  renameTabs: '请先关闭原 Schema 及目标名称下的表或视图标签，再提交。查询标签中的 SQL 保留原文。',
  dropConfirm: '输入原 Schema 名称确认删除', dropHint: '删除使用 RESTRICT。有依赖对象时 PostgreSQL 会拒绝操作。',
  ownerHint: '转移所有者后，原账号的管理权限可能变化。请输入数据库中的准确角色名。',
  createOwnerHint: '所有者留空时使用当前角色。', unknown: '提交结果待核对。请关闭窗口并重新读取原数据库的 Schema 目录。',
  changed: '原连接或数据库已变化，请重新打开 Schema 管理。', discard: '放弃未提交的 Schema 修改？',
} as const;
