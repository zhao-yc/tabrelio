# 查看 PostgreSQL 角色与权限

从「工具 → PostgreSQL 角色与权限」打开窗口。选择已保存的 PostgreSQL 连接，按需填写数据库名，再点击「读取角色」。留空使用连接的默认数据库。角色目录可按名称片段搜索，每页最多 50 个角色。窗口同时显示登录角色和实际当前角色。

点击角色查看登录、超级用户、INHERIT、建库、建角色、复制、绕过行级安全、连接上限和密码有效期。直接获授的角色和直接成员分别列出，点击名称可以继续查看该角色。授权记录包含授权者和 ADMIN 选项。支持逐授权 INHERIT 与 SET 的服务器会返回对应值，旧目录缺少这些字段时显示「—」。每个方向最多显示 200 条，超限时窗口会标记。[PostgreSQL 角色目录](https://www.postgresql.org/docs/18/view-pg-roles.html) [角色成员目录](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html)

详情会显示角色在当前数据库的有效权限。填写准确的 schema 名和可选的表或视图名后，点击「检查对象权限」，查看各项权限及其转授权选项。输入名称时保留大小写和空格，无须加 SQL 引号。结果由 PostgreSQL 的权限查询函数计算，包含继承和 PUBLIC。表级权限、列级授权和 RLS 策略的实际过滤属于不同层次。窗口显示关系是否启用或强制 RLS。[PostgreSQL 权限查询函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

每次浏览读取使用独立只读事务，不读密码或认证配置，任务历史只保留状态。Navicat 的信息窗格同样提供成员关系和权限查看。[Navicat 信息窗格](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/main_window.html#information-pane)

## 授予或撤销直接成员关系

PostgreSQL 16 及以上可在角色详情点击「授予角色」。当前详情中的角色是成员。填写要授予的角色名称，并设置 ADMIN、INHERIT 和 SET 选项。普通执行者需要对获授角色拥有直接 ADMIN 选项；超级用户的新授权由服务器的引导超级用户作为授权者。预览会列出实际授权者、成员、角色和 SQL。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

在「直接获授的角色」或「直接成员」的对应行点击「撤销直接授权」，可撤销指定授权者留下的记录。预览只指向一条授权，执行使用 RESTRICT。有下游依赖时由服务器拒绝并回滚，其他授权者的记录仍可提供同一角色。[PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)

预览有效期为五分钟，确认后只能消费一次。提交前后复核角色 OID、授权来源和选项，登录角色及当前执行角色受保护。超级用户提交期间短暂锁定角色目录，普通 ADMIN 执行者使用 PostgreSQL 原生命令及前后目录核对。窗口区分已提交、已回滚、未发送和状态未知，状态未知时可重新读取目录。
