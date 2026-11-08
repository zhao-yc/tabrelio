import { postgresDatabaseBackupPickToolTitle, postgresDatabaseBackupTitle, postgresNativeBackupScopeLimit } from '../../shared/postgresDatabaseBackup';

export const postgresDatabaseBackupZh = {
  title: postgresDatabaseBackupTitle, tool: postgresDatabaseBackupPickToolTitle,
  connection: '来源连接', database: '来源数据库', choose: '选择备份文件', start: '确认并开始备份', close: '关闭',
  cancel: '取消备份', running: '正在从同一只读快照生成备份', cancelling: '正在等待备份进程及连接结束',
  scope: '使用本机 PostgreSQL 安装中的 pg_dump，将所选范围保存为 UTF-8 SQL 或自定义归档。建议使用与源库相同主版本的 pg_dump。',
  selection: '备份范围', full: '整个数据库', selectedSchemas: '指定 Schema', selectedRelations: '指定表及关系',
  schemaPicker: {
    title: '选择 Schema', refresh: '刷新 Schema 目录', loading: '正在读取 Schema', empty: '当前账号没有可选 Schema。',
    count: (count: number) => '已选择 ' + count + ' 个 Schema（最多 ' + postgresNativeBackupScopeLimit + ' 个）',
    search: '筛选 Schema 名称', noMatches: '没有匹配的 Schema。',
    hint: '指定 Schema 时，请另行准备所需的跨 Schema 依赖和 PostgreSQL 大对象。',
  },
  relationPicker: {
    title: '选择表及关系', refresh: '刷新对象目录', loading: '正在读取可备份对象', empty: '当前账号没有可选对象。',
    count: (count: number) => '已选择 ' + count + ' 个对象（最多 ' + postgresNativeBackupScopeLimit + ' 个）',
    search: '筛选限定名或对象类型', noMatches: '没有匹配的对象。',
    hint: '可跨 Schema 选择。请按需单独勾选子分区，并在目标库准备好所需 Schema 和其他依赖。',
  },
  relationKinds: { r: '表', p: '分区表', v: '视图', m: '物化视图', f: '外部表', S: '序列' }, leafPartition: '叶子分区',
  relationDataHint: '仅数据可选择有本地数据的表、叶子分区或序列。',
  previousPage: '上一页', nextPage: '下一页', page: (current: number, total: number) => '第 ' + current + ' / ' + total + ' 页',
  content: '备份内容', contents: { all: '结构及数据', schema: '仅结构', data: '仅数据' },
  dataHint: '仅数据备份需要恢复到已准备好相应结构的数据库。',
  format: '备份格式', sql: '纯文本 SQL', custom: 'PostgreSQL 自定义归档',
  customHint: '归档保留对象所有者及授权。可在「PostgreSQL 自定义归档」查看目录并导出恢复 SQL。',
  portable: '省略所有者和授权',
  portableHint: '迁往角色配置不同的服务器时可勾选。集群级角色及表空间定义需单独准备。',
  done: (bytes: number, version: string) => '已保存 ' + bytes.toLocaleString('zh-CN') + ' B · pg_dump ' + version,
  warnings: 'pg_dump 提示',
} as const;
