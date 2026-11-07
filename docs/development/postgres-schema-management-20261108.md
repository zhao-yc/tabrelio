# PostgreSQL Schema 管理

在连接树右键点击 PostgreSQL 数据库，选择「管理 PostgreSQL Schema」。窗口列出当前角色可见的用户 Schema、所有者、注释、USAGE 和 CREATE 权限。

- 新建时输入名称及可选注释。所有者留空时使用当前角色，也可填写现有角色名。
- 编辑注释时会载入原文。清空后提交可移除注释。转移所有者时，输入准确角色名并核对预览。
- 改名和删除前先关闭受影响 Schema 下的表页和视图页。原查询标签及 SQL 正文保留。提交后刷新原数据库目录，当前窗口中的旧对象链接退役。
- 删除需要输入准确原名，并使用 RESTRICT。有依赖对象时 PostgreSQL 会拒绝删除。public 的名称受到保护，系统 Schema 排除在管理列表之外。

预览阶段只读取目录。提交时重新确认数据库、原对象身份、权限和目标角色，并在事务内回读实际结果。名称已被占用、原对象被同名替换或权限发生变化时，先重新读取目录。[CREATE SCHEMA](https://www.postgresql.org/docs/18/sql-createschema.html) · [ALTER SCHEMA](https://www.postgresql.org/docs/18/sql-alterschema.html) · [DROP SCHEMA](https://www.postgresql.org/docs/18/sql-dropschema.html)

## 验证

- macOS arm64 原生运行时检查、类型检查、构建和 141 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 通过 22 项 Electron 用例及 4 项实库集成用例。独立连接确认注释逐字保留、指定所有者建 Schema、转移所有者、改名保留 OID 与表数据，以及非空 Schema 删除被拒绝。等锁期间的同名替换被拦截，原工作台表页和旧导航也经过验证。
- 首轮转移所有者时发现目标角色字段与窗口归属字段冲突。拆分字段后复验通过。两轮隔离实例均在客户连接归零后清理。
- WIN11-TEST 不可达，本轮未派发。Windows 原生窗口、安装包及其他 PostgreSQL 版本待验。
