# 查看 PostgreSQL 角色与权限

从「工具 → PostgreSQL 角色与权限」打开窗口。选择已保存的 PostgreSQL 连接，按需填写数据库名，再点击「读取角色」。留空使用连接的默认数据库。角色目录可按名称片段搜索，每页最多 50 个角色。窗口同时显示登录角色和实际当前角色。

点击角色查看登录、超级用户、INHERIT、建库、建角色、复制、绕过行级安全、连接上限和密码有效期。直接获授的角色和直接成员分别列出，点击名称可以继续查看该角色。授权记录包含授权者和 ADMIN 选项。支持逐授权 INHERIT 与 SET 的服务器会返回对应值，旧目录缺少这些字段时显示「—」。每个方向最多显示 200 条，超限时窗口会标记。[PostgreSQL 角色目录](https://www.postgresql.org/docs/18/view-pg-roles.html) [角色成员目录](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html)

详情会显示角色在当前数据库的有效权限。填写准确的 schema 名和可选的表或视图名后，点击「检查对象权限」，查看各项权限及其转授权选项。输入名称时保留大小写和空格，无须加 SQL 引号。结果由 PostgreSQL 的权限查询函数计算，包含继承和 PUBLIC。表级权限、列级授权和 RLS 策略的实际过滤属于不同层次。窗口显示关系是否启用或强制 RLS。[PostgreSQL 权限查询函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

每次浏览读取使用独立只读事务，不读密码或认证配置，任务历史只保留状态。Navicat 的信息窗格同样提供成员关系和权限查看。[Navicat 信息窗格](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/main_window.html#information-pane)

## 授予或撤销直接成员关系

PostgreSQL 16 及以上可在角色详情点击「授予角色」。当前详情中的角色是成员。填写要授予的角色名称，并设置 ADMIN、INHERIT 和 SET 选项。普通执行者需要对获授角色拥有直接 ADMIN 选项；超级用户的新授权由服务器的引导超级用户作为授权者。预览会列出实际授权者、成员、角色和 SQL。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

在「直接获授的角色」或「直接成员」的对应行点击「撤销直接授权」，可撤销指定授权者留下的记录。预览只指向一条授权，执行使用 RESTRICT。有下游依赖时由服务器拒绝并回滚，其他授权者的记录仍可提供同一角色。[PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)

预览有效期为五分钟，确认后只能消费一次。提交前后复核角色 OID、授权来源和选项，登录角色及当前执行角色受保护。超级用户提交期间短暂锁定角色目录，普通 ADMIN 执行者使用 PostgreSQL 原生命令及前后目录核对。窗口区分已提交、已回滚、未发送和状态未知，状态未知时可重新读取目录。

## 新建角色

在 PostgreSQL 16 及以上的「角色与权限」窗口选择「新建角色」。角色名在服务器范围内唯一。可以创建 NOLOGIN 组角色、SCRAM 密码登录角色，或使用服务器现有认证规则的无密码登录角色。可配置 INHERIT、连接上限、建库与建角色权限，以及需要超级用户权限的角色属性。密码有效期使用 UTC。[PostgreSQL CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html)

预览核对当前执行角色、目标服务器和同名冲突。密码登录的 SQL 预览使用占位符。确认时输入两遍密码，客户端在内存中按 PostgreSQL SASLprep 与 SCRAM 规则生成带盐验证值，并只将验证值发送给服务器。密码和验证值均不写入客户端设置或查询历史。[PostgreSQL 密码认证](https://www.postgresql.org/docs/18/auth-password.html) [PostgreSQL SASL 认证](https://www.postgresql.org/docs/18/sasl-authentication.html)

确认后服务器在一个事务内创建并回读角色属性。旧预览发现同名角色时停止，提交成功后窗口刷新目录。后续可通过直接成员授权分配所需角色。

## 轮换当前登录密码

在角色窗口读取目录，点击「查看当前角色」→「轮换登录密码」。窗口确认当前角色与连接的登录身份一致后才显示入口。预览列出角色、所用数据库和脱敏 SQL。确认时输入两次新密码，客户端在内存中生成带盐的 SCRAM 验证值，服务器执行 `ALTER ROLE CURRENT_USER`。轮换作用于整台 PostgreSQL 服务器，并保留原密码有效期。预览有效期为五分钟，确认令牌只能使用一次。[PostgreSQL ALTER ROLE](https://www.postgresql.org/docs/18/sql-alterrole.html)

已提交后，可点击「编辑此连接的密码」，重新输入新密码、测试并保存。该入口沿用连接编辑的会话和凭据保护。已打开此连接的工作区标签时，请先按连接编辑页的提示处理查询、草稿和事务。轮换本身不会把输入填入连接配置。若提交状态未知，先用新的独立连接核对实际密码，再更新连接配置。

## 管理表和视图的直接权限

在角色详情填写准确的 schema 和表或视图名称，点击「检查对象权限」后打开「管理直接授权」。普通表、分区表和普通视图支持由对象所有者或超级用户修改所有者授予所选角色的直接权限。可以多选权限，一次授予权限、授予权限及转授选项、撤销直接权限或仅撤销转授选项。已有的直接权限在窗口内单独列出。PostgreSQL 17 起提供 MAINTAIN。有效权限还可能来自 PUBLIC、角色继承或其他授权者。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

撤销一律使用 RESTRICT。预览列出 PostgreSQL 会一并撤销或降级的同来源列权限。存在需要级联撤销的下游依赖时，服务器拒绝操作，整批回滚。[PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)

确认后使用短事务独占锁定原对象，再核对对象、角色和原 ACL。普通视图遵循 PostgreSQL 的递归锁定规则，锁等待超过五秒会结束操作。提交前比较表级和列级 ACL 的实际变化。关闭回执后重新读取有效权限。[PostgreSQL LOCK](https://www.postgresql.org/docs/18/sql-lock.html)

## 管理数据库与 Schema 的直接权限

在角色详情的「数据库有效权限」下点击「管理数据库直接授权」，可修改当前数据库的 CONNECT、CREATE 和 TEMPORARY。在「检查对象权限」填写 Schema 后，可用「管理 Schema 直接授权」修改 USAGE 和 CREATE。对象所有者与超级用户可以操作。若默认 `public` Schema 由 `pg_database_owner` 所有，当前数据库所有者也可以管理，预览会列出该实际授权者。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html) [PostgreSQL 预定义角色](https://www.postgresql.org/docs/18/predefined-roles.html)

可以多选授予、添加转授、仅撤销转授或撤销直接权限。撤销使用 RESTRICT，有下游依赖时整批回滚。撤销 CONNECT 影响新连接，已有会话可继续使用。角色仍可能通过 PUBLIC 或继承获得 CONNECT。Schema 的 USAGE 允许解析对象名称，访问表数据仍需相应的表权限。[PostgreSQL 权限](https://www.postgresql.org/docs/18/ddl-priv.html) [PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)

确认时核对原对象、角色、授权来源及系统目录行版本。事务提交前复核实际 ACL，确认目标目录行由本次事务写入。状态未知时通过重新读取目录与实际连接结果核对。

## 查看与管理列权限

在角色详情检查表或视图后点击「查看列权限」。目录按 PostgreSQL 属性编号分页，每页 32 列，展示 SELECT、INSERT、UPDATE 和 REFERENCES 的有效权限、所有者直接授权和转授状态。有效权限包含整表授权、PUBLIC 和继承。[PostgreSQL 权限查询函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

对象所有者或超级用户可在普通表、分区表和普通视图上点击「管理列级直接授权」，在当前页多选列与权限。预览会明确列名与操作，支持授予、授予及转授、撤销和仅撤销转授。确认时按原关系 OID、属性编号和原列名复核。列级撤销使用 RESTRICT，有下游依赖时整批回滚。已有整表授权仍可能提供同样的有效权限。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html) [PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)

## 查看与管理序列权限

在角色详情输入准确的 Schema 和序列名，点击「检查对象权限」可查看 USAGE、SELECT 和 UPDATE 的有效权限。对象所有者或超级用户可在「管理序列直接授权」查看所有者的直接授权，批量授予、撤销或调整转授选项。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

使用 `nextval` 生成默认值的插入，需要表上的 INSERT 和序列上的 USAGE 或 UPDATE。通常授予 USAGE 即可取号，UPDATE 还允许通过 `setval` 改值。授权预览和执行只处理权限目录，不读取或推进序列值。[PostgreSQL 序列函数](https://www.postgresql.org/docs/18/functions-sequence.html)

确认绑定数据库、Schema、序列 OID 和角色。提交前会核对实际序列目录行由本事务写入以及权限变化是否符合预览。撤销使用 RESTRICT，有下游依赖时整批回滚。

## 查看与管理例程执行权限

在角色详情输入准确的 Schema 与例程名，点击「查找同名例程」。窗口显示最多 50 个重载的完整输入类型签名，包括函数、存储过程、聚合函数和窗口函数，并分别列出角色有效权限、转授选项、所有者直接授权及 PUBLIC 执行权限。调用例程还需要相应 Schema 的 USAGE。[PostgreSQL 权限](https://www.postgresql.org/docs/18/ddl-priv.html)

对象所有者或超级用户可管理所选签名的 EXECUTE，分别授予或撤销指定角色的权限及转授选项。也可在独立的「管理 PUBLIC 执行权限」入口修改该签名对所有现有和未来角色的授权。PostgreSQL 通常会在创建例程时为 PUBLIC 提供 EXECUTE。撤销该授权后，仍拥有直接或继承权限的角色可以执行。[PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

预览由系统目录生成参数类型签名。确认时绑定原例程 OID 和所选角色，提交前复核原签名和实际 ACL 差异。撤销使用 RESTRICT，有下游依赖时整批回滚。[PostgreSQL REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)
