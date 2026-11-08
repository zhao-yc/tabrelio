# PostgreSQL 子分区维护

打开分区父表的「查看结构」，点击「管理 PostgreSQL 子分区」。目录展示父表分区键、直接子分区的完整名称、边界、关系类型和分离状态。子分区本身是分区父表时，可打开它的结构继续管理下一层。

- 新建子分区时选择目标 Schema、填写新表名和边界。边界表单跟随父表的 RANGE、LIST 或 HASH 策略。
- 挂接已有表时填写准确的 Schema、表名和边界。可选普通表或分区父表，外部表在目录中只读。PostgreSQL 会检查现有数据与父表定义，可能扫描目标表和默认分区。
- 分离时选择直接子分区，预览并确认。原子表名称、OID 和数据保留，父表查询移除该分区的行。

提交会锁定原父表和已有目标表。应用先复核锁后的原身份、边界和权限，再在一个事务内核对挂接结果。同名替换、并发分离待完成或目录已变化时，需要刷新并重新预览。结果待核对时，返回结构重新打开目录。 [CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html) · [ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)

## 验证

- macOS arm64 的 Node.js 与 SQLite 运行时检查、类型检查、构建及 144 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 的 30 项 Electron 用例通过。独立连接核对新建子分区的路由、跨 Schema 挂接后父表读到既有数据，以及分离后原表 OID 和数据保留。另核对已有越界行阻止挂接、预览后同名替换被拒绝和令牌仅消费一次。
- 4 项实库集成回归通过。隔离测试的客户连接归零，SSH 隧道关闭，测试容器已清理。
- WIN11-TEST 不可达，本轮使用 macOS arm64。Windows 原生窗口、安装包、其他 PostgreSQL 版本及其他关系组合待验。
