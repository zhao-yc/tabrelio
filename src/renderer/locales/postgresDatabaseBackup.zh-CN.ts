import { postgresDatabaseBackupPickToolTitle, postgresDatabaseBackupTitle } from '../../shared/postgresDatabaseBackup';

export const postgresDatabaseBackupZh = {
  title: postgresDatabaseBackupTitle, tool: postgresDatabaseBackupPickToolTitle,
  connection: '来源连接', database: '来源数据库', choose: '选择备份文件', start: '确认并开始备份', close: '关闭',
  cancel: '取消备份', running: '正在从同一只读快照生成备份', cancelling: '正在等待备份进程及连接结束',
  scope: '使用本机 PostgreSQL 安装中的 pg_dump，将所选范围保存为 UTF-8 SQL 或自定义归档。建议使用与源库相同主版本的 pg_dump。',
  selection: '备份范围', full: '整个数据库', selectedSchemas: '指定 Schema',
  schemaList: '选择 Schema', refreshSchemas: '刷新 Schema 目录', loadingSchemas: '正在读取 Schema',
  emptySchemas: '当前账号没有可选 Schema。', selectedCount: (count: number) => '已选择 ' + count + ' 个 Schema（最多 64 个）',
  schemaSearch: '筛选 Schema 名称', noMatchingSchemas: '没有匹配的 Schema。',
  schemaHint: '指定 Schema 时，请另行准备所需的跨 Schema 依赖和 PostgreSQL 大对象。',
  content: '备份内容', contents: { all: '结构及数据', schema: '仅结构', data: '仅数据' },
  dataHint: '仅数据备份需要恢复到已准备好相应结构的数据库。',
  format: '备份格式', sql: '纯文本 SQL', custom: 'PostgreSQL 自定义归档',
  customHint: '归档保留对象所有者及授权。可在「PostgreSQL 自定义归档」查看目录并导出恢复 SQL。',
  portable: '省略所有者和授权',
  portableHint: '迁往角色配置不同的服务器时可勾选。集群级角色及表空间定义需单独准备。',
  done: (bytes: number, version: string) => '已保存 ' + bytes.toLocaleString('zh-CN') + ' B · pg_dump ' + version,
  warnings: 'pg_dump 提示',
} as const;
