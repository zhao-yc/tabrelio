import { queryBuilderJoinZh } from './queryBuilderJoin.zh-CN';

export const postgresQueryBuilderZh = {
  ...queryBuilderJoinZh,
  title: 'PostgreSQL 查询构建器',
  hint: '从当前数据库的用户 schema 选择表或视图，再设置输出字段和条件。',
  catalogue: '读取表和视图', schema: '来源 schema', allSchemas: '所有 schema', search: '搜索表和视图',
  source: '查询来源', chooseSource: '请选择表或视图', empty: '当前目录没有匹配的表或视图。',
  read: '读取来源结构', back: '返回新建查询', changeSource: '重新选择来源',
  loading: '正在读取 PostgreSQL 目录…', checking: '正在重新核对 PostgreSQL 来源…',
  stale: 'PostgreSQL 连接、来源或原标签已变化，请重新打开查询构建器。',
  columns: '输出字段', choose: (name: string) => `选择输出字段 ${name}`, all: '全选输出字段', none: '清空输出字段',
  noColumns: '至少选择一个输出字段。', filter: '查询筛选', sort: '配置多列排序',
  sorted: (count: number) => `已配置 ${count} 项排序`, sortHint: '按顺序配置 ORDER BY，可分别指定 NULL 的位置。',
  sortTies: '若前面的字段有并列值，可追加字段确定顺序。',
  distinct: '去重完整输出行（DISTINCT）', limit: '结果行数上限', limitHint: '留空时 SQL 不带 LIMIT。填写 1～1000000 的整数。',
  invalidLimit: '结果行数上限须为 1～1000000 的整数。', preview: '预览 SQL', open: '打开为独立查询',
  tabs: '标签数量已达上限，请先关闭部分标签。',
  inspection: (rows: number) => `在独立只读事务中预览最多 ${rows} 行。估算计划由 PostgreSQL 返回。`,
  inspectLabels: { region: 'PostgreSQL 查询检查', rows: '预览数据', explain: '查看估算计划', working: '正在检查 PostgreSQL 查询…' },
  queryTitle: (name: string) => `${name} · PostgreSQL 查询`,
} as const;
