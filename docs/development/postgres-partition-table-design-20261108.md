# PostgreSQL 分区建表

在连接树的 PostgreSQL 数据库菜单选择「新建表」，填写父表字段后选择「分区策略」。分区键按勾选顺序排列。初始子分区和父表使用同一个目标 Schema。

- RANGE 支持单字段或多字段上下界。下界包含、上界不包含。每个位置可填写文字值，或选择 MINVALUE、MAXVALUE。日期推荐 ISO 格式，带时区的时间可填明确偏移量。
- LIST 只使用一个分区键。逐项填写分区值，或勾选 NULL。空字符串和 NULL 分开处理。
- HASH 可使用多个分区键。每个子分区填写正整数模数和小于模数的非负余数。使用相同模数并覆盖全部余数可匹配所有行。
- RANGE 和 LIST 可添加一个默认分区，接收没有匹配显式边界的行。父表主键必须包含全部分区键。

先预览父表和子分区的 SQL，再确认创建。预览阶段只读目录并使用服务器解析 SQL。应用时重新检查名称与权限，事务内核对父表策略、分区键顺序、子分区归属及默认分区标志。预检会拒绝已占用的名称，执行时出现边界重叠或值类型无效等错误会回滚整批。若建表回执待核对，先刷新原数据库目录。 [PostgreSQL 分区](https://www.postgresql.org/docs/18/ddl-partitioning.html) · [CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html)

## 验证

- macOS arm64 的 Node.js 与 SQLite 运行时检查、类型检查、构建及 144 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 的 28 项 Electron 用例通过。独立连接核对 RANGE 的上下界和默认分区、LIST 的带引号值、空字符串和 NULL，以及双键 HASH 的键顺序和 100 行实际分布。重叠的 RANGE 子分区被拒绝，父表和两个子分区均回滚。
- 4 项实库集成回归通过。三轮隔离实例均在客户连接归零后关闭隧道并清理容器。
- 首轮补齐分区策略下拉框的明确无障碍标签。后续让新增用例核零自己的父表和子分区，原 Schema 菜单回归沿原断言复验通过。
- WIN11-TEST 不可达，本轮使用 macOS arm64。Windows 原生窗口、安装包及其他 PostgreSQL 版本待验。
