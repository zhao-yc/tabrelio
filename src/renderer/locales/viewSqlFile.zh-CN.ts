export const viewSqlFileZh = {
  save: '另存定义为 SQL',
  filename: (name: string) => name ? `视图-${name}.sql` : '视图定义.sql',
  saved: (name: string) => `已保存视图定义到 ${name}`,
  open: '从 SQL 文件载入定义',
  replace: '用文件内容替换当前视图定义？',
  confirmReplace: '替换定义草稿',
  keep: '保留当前定义',
  postgresHint: '选择包含一条定义查询的 SQL 文件。载入后可编辑，再预览 SQL。',
  mysqlHint: '选择包含一条 SELECT 定义查询的 SQL 文件，名称和视图属性沿用当前草稿。',
  sqliteHint: '选择包含与当前视图同名的 CREATE VIEW 的 SQL 文件。载入后可编辑，再预览 SQL。',
  sqliteTarget: 'SQL 文件须包含一条与当前视图准确同名的 CREATE VIEW。',
  sqliteLimit: 'SQLite 视图定义超过 2 MiB。',
} as const;
