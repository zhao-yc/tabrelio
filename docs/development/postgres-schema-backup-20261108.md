# PostgreSQL 按 Schema 备份

打开「工具 → PostgreSQL 数据库备份」，选择来源连接和数据库。备份范围可保留为整个数据库，也可切换到「指定 Schema」并勾选一个或多个 Schema。名称筛选保留已勾选项。选中的名称按原名匹配，每次最多选择 64 个。

备份内容可选结构及数据、仅结构或仅数据，三种模式都可保存为 UTF-8 SQL 或 PostgreSQL 自定义归档。纯文本 SQL 可省略对象所有者和授权。恢复拆分备份时先恢复结构，再把仅数据文件回放到匹配的结构。指定 Schema 时需另外准备未选中的依赖、大对象及所需集群角色。 [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) · [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)

选择保存文件后，改变来源、范围、内容或格式需要重新选择文件。开始备份时在 pg_dump 导入的只读快照中复核已选 Schema 身份与权限。备份结束并确认原快照事务已收尾后，客户端才发布输出文件。

## 验收记录

2026-11-08，macOS arm64 源码构建通过运行时检查、类型检查和构建，61 项相关单测通过。WIN11-TEST 当时不可达，本轮改用 macOS 完成 Electron 验收。Windows、安装包和其他 PostgreSQL 版本待验。

使用 Server-200 上的隔离 PostgreSQL 18.6 实例，配合原生 `pg_dump` 和 `pg_restore` 18.6，通过 5 项 Electron 实库测试。指定 Schema 用例验证了名称筛选保留勾选、含通配符和双引号的名称精确匹配、结构与数据 SQL 依次恢复、自定义归档独立恢复、未选 Schema 排除，以及更改文件选项或同名替换 Schema 时保留原文件。旧用例回归了整库备份、SSH 与 TLS、SQL 和自定义归档恢复及取消。两项旧用例更新了回执标点预期，仍核对 `COMMIT`。

验收退出码为 0，隔离容器和 SSH 隧道已清理，残留测试会话与新增临时凭据及恢复目录均为 0。
