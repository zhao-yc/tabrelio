# MySQL 和 MariaDB 原生指定表备份

打开「工具 → MySQL／MariaDB 数据库备份」，选择连接和来源库，将备份范围切换为「指定 InnoDB 表」。可按名称筛选并勾选同一库的最多 64 张表，支持无主键表。筛选或翻页会保留勾选。选择「结构及数据」「仅结构」或「仅数据」，再选择匹配来源系列和主版本的官方转储工具与 SQL 文件路径。

在「执行 MySQL／MariaDB SQL 文件」中选择已经存在的初始数据库，再执行备份。指定表脚本的表名按原名回放，恢复库由窗口选择。结构部分包含所选表的定义及触发器，数据部分使用带列名的 INSERT。恢复前请准备未选中的依赖，以及触发器所需的 DEFINER 账号和权限。仅数据需要匹配的目标表结构，已有触发器会随 INSERT 运行。需要回放原始记录并安装所选触发器时，可使用「结构及数据」一次生成。若执行遇到 DDL 或脚本内已有提交，恢复窗口会分别报告终态。 [MySQL mysqldump 文档](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) · [MariaDB mariadb-dump 文档](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

指定表备份要求来源账号可证明直接全局 SELECT 权限，包含结构时另需 TRIGGER。应用在转储前后核对所选表的目录记录和可见触发器，备份期间仍须避免并发结构操作。文件授权绑定库、表集合和内容，转储完整且来源任务已结算后才替换目标文件。指定表也可保存为 [ZIP 归档](mysql-selected-table-archive-20261108.md)。

## 验收记录

2026-11-08，macOS arm64 源码通过运行时检查、类型检查、构建和 241 项相关单测。Server-200 隔离 MySQL 8.4.11 与 MariaDB 11.4.13，使用 `mysqldump` 8.3.0 和 `mariadb-dump` 11.4.13，通过 3 项 Electron 实库测试，无跳过或重试。

双方言均从正式窗口生成三种范围，分别回放完整脚本及结构、数据拆分脚本。独立连接核对了无主键表、带反引号和前导短横线的表名、无符号 64 位最大整数、Unicode、NULL、二进制和触发器执行。未选表、视图和非 InnoDB 表均未进入脚本。改变已授权的内容范围或在备份前改名会被拒绝，保留原目标文件。首轮测试账号缺少原夹具触发器执行所需的 UPDATE 权限，换为写会话变量的触发器后验证了恢复和执行。

整库用例回归了双方言 SSH 转发、ZIP 校验和直接恢复、取消及旧归档回执。最终两个隔离容器、SSH 转发和临时凭据目录均核对清理，残余测试会话为 0。WIN11-TEST 当时不可达，Windows、安装包、其他服务器版本和指定表的 SSH／TLS 组合待验。
