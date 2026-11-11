import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';

export const objectInformationZh = {
  title: uiCommandLabels['object-information'],
  close: '关闭对象信息',
  modes: '信息类别',
  general: '常规',
  structure: '表结构',
  ddl: 'DDL',
  connection: '连接',
  database: '数据库',
  vendor: '数据库类型',
  group: '连接分组',
  select: '在对象树或对象列表中选择一项。',
  refresh: '刷新对象信息',
  find: '查找定义文本',
  noDefinition: '目录未返回对象定义。',
  loading: '正在读取对象信息…',
} as const;
