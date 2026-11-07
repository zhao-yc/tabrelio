# 查看 PostgreSQL 角色与权限

从「工具 → PostgreSQL 角色与权限」打开窗口。选择已保存的 PostgreSQL 连接，按需填写数据库名，再点击「读取角色」。留空使用连接的默认数据库。角色目录可按名称片段搜索，每页最多 50 个角色。窗口同时显示登录角色和实际当前角色。

点击角色查看登录、超级用户、INHERIT、建库、建角色、复制、绕过行级安全、连接上限和密码有效期。直接获授的角色和直接成员分别列出，点击名称可以继续查看该角色。授权记录包含授权者和 ADMIN 选项。支持逐授权 INHERIT 与 SET 的服务器会返回对应值，旧目录缺少这些字段时显示「—」。每个方向最多显示 200 条，超限时窗口会标记。[PostgreSQL 角色目录](https://www.postgresql.org/docs/18/view-pg-roles.html) [角色成员目录](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html)

详情会显示角色在当前数据库的有效权限。填写准确的 schema 名和可选的表或视图名后，点击「检查对象权限」，查看各项权限及其转授权选项。输入名称时保留大小写和空格，无须加 SQL 引号。结果由 PostgreSQL 的权限查询函数计算，包含继承和 PUBLIC。表级权限、列级授权和 RLS 策略的实际过滤属于不同层次。窗口显示关系是否启用或强制 RLS。[PostgreSQL 权限查询函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

每次读取使用独立只读事务，不读密码或认证配置。界面不会更改角色或授权，任务历史只保留状态。Navicat 的信息窗格同样提供成员关系和权限查看。[Navicat 信息窗格](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/main_window.html#information-pane)
