import { postgresQueryExportZh } from './postgresQueryExport.zh-CN';

export const sqliteQueryExportZh = {
  ...postgresQueryExportZh,
  title: 'SQLite 完整查询导出',
  scope: '将在独立的只读连接执行一条 SELECT 或 WITH 查询，读取已提交的数据。原查询窗口的临时表与未提交变更无法在此使用。',
  workbookScope: '将在独立只读连接执行 1 至 64 条 SELECT 或 WITH 查询。所有工作表共用同一份已提交数据快照，原会话临时表不随查询转移。',
  workbookHint: '每条查询按顺序写入一张工作表，空结果保留标题。各条查询可用 :name 绑定参数，同名复用同一个值。',
  formatHint: 'JSON 将数值写为字符串以保留精度，列名必须唯一。CSV 可保留重名列，Excel 会按列位置追加后缀。',
  insertFormat: 'SQLite INSERT SQL',
  insertDatabase: 'INSERT 目标数据库名',
  insertHint: '留空沿用结果列名。重名、空名或需改名时，填写全部目标字段。脚本写入文件，目标字段亲和性和约束在回放时生效。',
  parameterHint: '在查询中用 :name 表示一个值参数，重复名称共用一个值。',
  suggestedName: 'SQLite查询结果',
} as const;
