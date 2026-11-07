# PostgreSQL 扩展管理

在连接树右键点击 PostgreSQL 数据库，选择「管理 PostgreSQL 扩展」。可按名称和说明搜索。目录合并当前库已安装的扩展与服务器提供的扩展，显示当前版本、默认可用版本、Schema 和所有者。

- 安装时选择服务器提供的版本与目标 Schema。扩展有固定 Schema 时自动使用该名称。目录会显示前置扩展，缺少时先单独安装。
- 升级只列出从当前版本可达的版本，并显示服务器报告的脚本路径。迁移 Schema 适用于标记为可迁移的扩展，目标 Schema 需要 CREATE 权限。PostgreSQL 还可能按成员对象检查所有权，例如普通角色安装受信任扩展 hstore 后，部分成员函数仍由管理员拥有。
- 卸载前核对 SQL 并逐字输入扩展名称。卸载会移除扩展成员，可能删除成员表和数据。应用使用 RESTRICT，并拒绝目录中查到的显式自动依赖。内置的 plpgsql 保持只读。

安装和升级使用 PostgreSQL 服务器现有的扩展脚本。预览只读目录。应用绑定原数据库、原扩展身份、角色和一次性令牌，并在同一事务中核对实际版本、Schema 和所有者或卸载终态。遇到「提交结果待核对」先重新打开窗口读目录。[CREATE EXTENSION](https://www.postgresql.org/docs/18/sql-createextension.html) · [ALTER EXTENSION](https://www.postgresql.org/docs/18/sql-alterextension.html) · [DROP EXTENSION](https://www.postgresql.org/docs/18/sql-dropextension.html)

## 验证

- macOS arm64 的 Node.js 与 SQLite 运行时检查、类型检查、构建和 142 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 的 26 项 Electron 用例通过。普通角色安装 hstore 1.4 并升级到 1.8，普通角色迁移被服务器拒绝，隔离管理员迁移后扩展 OID 和函数行为保持。外部表依赖阻止卸载，移除依赖后卸载成功。另验证 plpgsql 保护、显式依赖拦截、逐字确认、同名替换和令牌一次性。
- 4 项实库集成回归通过。三轮隔离实例均在客户连接归零后关闭隧道并清理容器。
- 首轮定位到共享读取预算被驱动扣减，改为每次查询使用独立预算。第二轮记录到 hstore 成员函数的所有权要求，增加界面说明并用两种角色复验。
- WIN11-TEST 不可达，本轮使用 macOS arm64。Windows 原生窗口、安装包和其他 PostgreSQL 版本待验。
