# PostgreSQL 表管理

从表记录页或对象目录打开「查看结构 → 管理表」。窗口按当前连接身份显示可执行的操作。普通表、分区父表和分区子表可在同一个 schema 内改名。执行者需要拥有表及 schema 的 CREATE 权限。核对新名称和 SQL，再点击「确认重命名」。成功后按新名称打开记录页，原表的数据、OID 和数据库依赖保留。若旧表已有收藏且新名称没有冲突，收藏会迁移并保留自定义标签。[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)

普通非分区表的表所有者或 schema 所有者可选择「删除表」。核对 `DROP TABLE … RESTRICT`，输入原表名再确认。删除移除表结构及数据。若视图、外键等对象阻止删除，PostgreSQL 会拒绝并回滚。分区父表和子表的操作列表仅提供改名。[PostgreSQL DROP TABLE](https://www.postgresql.org/docs/18/sql-droptable.html)

提交前会检查同一表及拟用名称下的标签页，发现草稿或正在运行的操作会停止。预览只读，单次确认先在同一事务内解析原关系以持有锁，再复核原表 OID 与管理权限。DDL 执行后还会核对目录，确认成功才提交。遇到未知回执时，先从原数据库核对关系，确认后再决定下一步。

## 移动到其他 schema

在「查看结构 → 管理表」选择「移动到其他 schema」。执行者须拥有原表，目标列表只显示当前角色有 USAGE 和 CREATE 权限的其他 schema。核对 `ALTER TABLE … SET SCHEMA` 以及预览列出的随迁索引、约束和拥有的序列，然后确认。表、记录、视图依赖与外键关联保留原身份。分区父表与子表可分别移动，分区关联保留。[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)

预览会检查目标同名关系或类型。提交时重新核对原表 OID、随迁对象和目标 schema OID，再验证原表及随迁对象已到达目标位置。成功后按新位置打开记录页，符合迁移条件的收藏也会更新。原名或目标名有草稿或活动任务时，先处理这些标签页。

## 编辑表和字段注释

在普通表或分区表的「查看结构」中点击「编辑表和字段注释」。选择表或字段后会载入注释原文。可以依次修改多项，切换时保留草稿。清空文本会移除注释，点击「恢复此项原文」可撤回当前项。分区父表与子表的注释分别编辑。[PostgreSQL COMMENT](https://www.postgresql.org/docs/18/sql-comment.html)

核对整批 SQL 后点击「确认保存注释」。执行者须拥有表并具备取得表锁的权限。提交先获取 SHARE UPDATE EXCLUSIVE 锁，再核对原表、字段号和注释原文。若其他会话已修改原文，需刷新结构后重新编辑。事务提交前会回读本批注释。每批最多修改 64 列及表注释，文本合计最多 128 KiB。[PostgreSQL LOCK](https://www.postgresql.org/docs/18/sql-lock.html)

## 管理标识列

在「查看结构 → 管理标识列」选择字段。普通的非空整数列可启用标识属性，填写序列起始值并选择 ALWAYS 或 BY DEFAULT。ALWAYS 通常由服务器生成，显式值须使用 PostgreSQL 的覆盖语法。BY DEFAULT 接受手工提供的值。已有默认值或生成表达式的字段须先处理原配置。PostgreSQL 17 及以上的分区表从父表管理继承到分区的标识属性。[PostgreSQL 标识列](https://www.postgresql.org/docs/18/ddl-identity-columns.html)

已有标识列可切换生成模式、重启取号或移除标识属性。重启值留空时采用原序列起始值，填写时应避开已有键值。移除会删除关联序列，保留字段和已有记录。核对 SQL 并确认后，客户端锁定原表并核对字段及关联序列。重启提交前还会回读实际下一次分配状态。[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)

## 清空数据

在「查看结构 → 管理表」选择「清空数据」。默认保留序列进度。选择「重置拥有的序列」时，预览会列出关联序列，执行者须拥有这些序列。普通表和分区子表只处理所选关系。选择分区父表时，预览会列出整棵分区子树，执行者须对范围内的表都有 TRUNCATE 权限。核对 SQL 和范围后，输入目标表名并确认。[PostgreSQL TRUNCATE](https://www.postgresql.org/docs/18/sql-truncate.html)

清空使用 RESTRICT。有阻止清空的外键时，记录和序列保持原值。操作会运行数据库上的 ON TRUNCATE 触发器。清空范围支持最多 128 张表和 128 个待重置序列，分区范围须包含普通表存储。

确认后，客户端先锁定已预览的关系，再核对分区范围、权限和序列归属。范围变化时需要重新预览。提交前校验原关系及待重置序列的存储变更。成功后刷新范围内无草稿的记录页，保留标签和收藏。[PostgreSQL LOCK](https://www.postgresql.org/docs/18/sql-lock.html)

## 表重命名与删除验证

macOS arm64 运行时检查、严格类型检查、构建和 70 项相关单测通过。Server-200 的隔离 PostgreSQL 18.6 通过 2 项 Electron 原生用例与 1 项表页实库回归。独立连接确认原 OID、数据和视图依赖在改名后保留，RESTRICT 删除在有依赖时回滚。原生用例还核对草稿保护、收藏迁移、分区关系、schema 所有者的删除权限，以及等锁期间同名替换导致的提交前拒绝。

首轮原生用例在操作下拉框定位超时。补齐可访问名称后按原门槛复验。隔离转发及容器已清理，未残留客户端连接。Windows 测试会话不可达，Windows、安装包及其他 PostgreSQL 版本待验。

## 清空数据验证

macOS arm64 运行时检查、类型检查、构建及 71 项相关单测通过。Server-200 隔离 PostgreSQL 18.6 通过 4 项 Electron 用例及 1 项表页实库回归。实测两种序列策略、触发器、外键回滚、原标签刷新、授权清空、分区和传统继承范围，以及等锁期间同名替换。隔离连接、转发及容器已清理。Windows 测试会话不可达，Windows、安装包和其他 PostgreSQL 版本待验。

## 跨 schema 移动验证

macOS arm64 运行时检查、类型检查、构建及 72 项相关单测通过。Server-200 隔离 PostgreSQL 18.6 通过 6 项 Electron 用例及 1 项表页实库回归。独立连接核对了含引号名称、随迁索引和约束、序列进度、原外键和视图依赖，以及分区父子表分别移动。原生界面核对了冲突提示和收藏往返迁移。

随迁对象、源表或目标 schema 在确认时发生变化，旧预览会被拒绝。测试还在 ALTER 已发出后替换目标 schema，提交前 OID 核验触发回滚。隔离连接、转发及容器已清理。Windows 测试会话不可达，Windows、安装包和其他 PostgreSQL 版本待验。

## 注释编辑验证

macOS arm64 运行时检查、类型检查、构建和 73 项相关单测通过。Server-200 隔离 PostgreSQL 18.6 通过 8 项 Electron 用例及 1 项表页实库回归。独立连接核对了表与多列同批保存、原文恢复、清空字段注释、多行文字与特殊字符原样保存，以及表 OID 和记录保持。等锁期间的并发修改被保留，第二条注释语句失败时整批回滚。分区父表与子表注释分别核对。

首轮构建发现新增的隔离级别标志类型被推宽，修正后通过类型检查和构建。隔离客户端连接、转发和容器已清理。Windows 测试会话不可达，Windows、安装包和其他 PostgreSQL 版本待验。

## 标识列验证

macOS arm64 运行时检查、类型检查、构建及 74 项相关单测通过。Server-200 隔离 PostgreSQL 18.6 通过 10 项 Electron 用例及 1 项表页实库回归。实测启用标识列、两种生成模式、超过 JavaScript 安全整数的起始及重启值、移除关联序列和分区继承。原记录、字段和表身份均经回读。

等锁期间的序列参数改动使旧预览失效。事务内重启后若异常取号，最终状态不符会回滚。首轮类型检查发现字段切换缺少空选择保护，修正后构建通过。隔离连接、转发及容器已清理。Windows 测试会话不可达，Windows、安装包及其他 PostgreSQL 版本待验。
