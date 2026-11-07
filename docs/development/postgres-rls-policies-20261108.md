# PostgreSQL 行级安全

在表页或对象右键菜单打开「查看结构 → 行级安全」。这里显示表的启用与强制状态，以及每条策略的命令、组合方式、角色、条件和注释。管理入口适用于有权限的普通表和分区表。分区父表与子表按各自被访问的关系管理，提交只改变预览中指定的表。[PostgreSQL 行级安全](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

## 配置策略

1. 选择「创建策略」，填写名称，选择 ALL、SELECT、INSERT、UPDATE 或 DELETE。
2. 选择宽松或限制策略，并填写目标角色的准确名称。选择 PUBLIC 时，策略适用于所有角色。对象授权仍须按需配置。
3. 按命令填写 USING 或 WITH CHECK。USING 决定哪些现有行可见，WITH CHECK 决定允许写入的新值。ALL 和 UPDATE 缺少 WITH CHECK 时沿用 USING。
4. 预览并确认 SQL。已创建的策略在表启用行级安全后生效。[PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)

可以载入修改、重命名或受限删除策略。修改角色和已有条件使用 ALTER POLICY。改变命令、组合方式或清除原条件时，界面要求确认在同一事务重建并保留注释。带有扩展依赖或安全标签的策略保留原结构。[PostgreSQL ALTER POLICY](https://www.postgresql.org/docs/18/sql-alterpolicy.html)

## 设置表状态

在「设置行级安全状态」中独立设置启用和强制标记。没有适用的宽松策略时，受 RLS 约束的角色无法访问行。强制标记在启用时对表所有者生效。超级用户和具有 BYPASSRLS 的角色仍可绕过策略。[PostgreSQL 行级安全](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

预览只读目录并检查语法。提交会锁定原表，核对表、策略和角色身份，执行后回读目录并确认事务。语义错误或目录不符会回滚。

## 验证

- macOS arm64 原生运行时、类型检查、构建和 139 项相关单测通过。
- Server-200 的隔离 PostgreSQL 18.6 通过 20 项 Electron 用例和 4 项实库集成用例。分别以所有者和受限角色核对可见行、WITH CHECK 写入拒绝、默认拒绝及对所有者强制执行。验证父表与直查子表的区别、原位保留策略 OID、重建保留注释、错误重建回滚和锁后策略变更拦截。
- WIN11-TEST 不可达，本轮未派发。Windows 原生窗口、安装包和其他 PostgreSQL 版本待验。
