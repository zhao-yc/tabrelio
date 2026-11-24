export const mysqlDataTransferZh = {
  source: '源端', target: '目标端', connection: '连接', database: '数据库',
  load: '读取源表', tables: '选择要传输的表', mode: '传输内容', structure: '仅结构', all: '结构及数据',
  preview: '预览传输', apply: '确认传输', stop: '停止任务', close: '关闭',
  limits: '支持相同服务器系列和主次版本的普通 InnoDB 表，每批最多 32 张表、10,000 行和 16 MiB 编码数据。',
  targetHint: '输入目标数据库名', acknowledge: '确认在目标库创建所选表',
  consequences: '目标同名对象会阻止传输。建表各自提交，数据在一个事务中验证并提交。',
  noTables: '源库无可选的 InnoDB 表', sql: '查看建表 SQL',
  completed: '传输完成，目标已回读核对', incomplete: '传输未全部完成', unknown: '部分结果需到目标库核对',
  pending: '未创建', submitted: '已发送建表，待核对', created: '已创建', rows: (count: number) => '已提交 ' + count + ' 行',
  invalid: '请填写准确的连接与数据库，选择要传输的表。',
};
