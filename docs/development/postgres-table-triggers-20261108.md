# PostgreSQL 表触发器

在表页或对象右键菜单打开「查看结构 → 触发器」，可以查看真实定义、触发模式和来源。约束、系统内部及分区继承的触发器保留只读。可管理的普通表提供「管理触发器」。

## 创建

1. 选择「创建触发器」，填写名称、操作前或操作后，以及行级或语句级。
2. 勾选一个或多个 INSERT、UPDATE、DELETE、TRUNCATE 事件。TRUNCATE 使用语句级。UPDATE 可限定字段，留空时适用于所有 UPDATE。
3. 填写现有函数的 schema 和名称。函数须声明为零参数并返回 `trigger`。可选的文字参数按顺序传给函数中的 `TG_ARGV`。
4. 按需填写 WHEN 条件，例如 `NEW.amount > 0`。预览检查语法与函数身份，确认时由 PostgreSQL 校验事件、列引用及条件。
5. 点击「预览触发器 SQL」，核对表、事件和函数，再确认提交。

预览只读取目录并解析 SQL。触发器在之后匹配事件的操作中生效。[PostgreSQL CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)

## 管理

可以重命名、切换触发模式或受限删除。正常模式在 origin/local 会话触发，副本模式在 replica 会话触发，始终模式在两类会话都触发，禁用模式不触发。删除须单独确认。删除触发器不会删除它引用的函数。[PostgreSQL pg_trigger](https://www.postgresql.org/docs/18/catalog-pg-trigger.html) · [PostgreSQL ALTER TRIGGER](https://www.postgresql.org/docs/18/sql-altertrigger.html)

提交时锁定原表，重新核对表与触发器身份，确认提交前回读实际目录。遇到同名替换或原结构变化时应刷新后重新预览。

## 修改定义

PostgreSQL 14 及更新版本可在「管理触发器 → 修改触发器定义」载入当前时机、事件、UPDATE 字段、WHEN 条件、函数和文字参数。修改后核对 `CREATE OR REPLACE TRIGGER` 预览。提交保留原触发器 OID 和注释，并在同一事务恢复原触发模式。与扩展绑定的定义保持只读。[PostgreSQL 14 CREATE TRIGGER](https://www.postgresql.org/docs/14/sql-createtrigger.html)

创建和修改单事件 AFTER 触发器时可以填写 OLD TABLE 或 NEW TABLE 别名，让触发函数读取整条语句影响的行。INSERT 只支持 NEW TABLE，DELETE 只支持 OLD TABLE，UPDATE 可同时使用两者。使用过渡表时，UPDATE 须覆盖所有字段。界面载入原别名后允许保留、修改或清除。

## 创建和管理验收

- macOS arm64 原生运行时检查、类型检查、构建和 88 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 通过 16 项 Electron 源码用例及 4 项实库集成用例。用独立连接验证四种模式、UPDATE 字段、WHEN、含引号和反斜杠的文字参数、原 OID 重命名和受限删除。错误函数在预览拒绝，无法解析的条件引用使提交回滚。锁等待期间同名替换被拦截。
- 首轮原生测试的禁用选项断言误报。改为直接读取原生 `disabled` 属性后通过。两轮隔离实例均在客户连接归零后清理。
- WIN11-TEST 不可达，本轮未派发。Windows 原生窗口、安装包和其他 PostgreSQL 版本待验。

## 定义替换验收

- macOS arm64 原生运行时、严格类型检查、构建和 138 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 通过 18 项 Electron 用例和 4 项实库集成用例。独立连接核对原 OID、禁用模式、注释、空参数、多行参数及末尾反斜杠，确认更新后的条件与函数实际生效。过渡表的旧行和新行被触发函数读取，非法替换回滚并保留原定义。
- Windows 原生窗口、安装包及 PostgreSQL 14–17 实例待验。WIN11-TEST 不可达，本轮未派发。
