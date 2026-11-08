# MySQL 和 MariaDB 指定表 ZIP 归档

在「工具 → MySQL／MariaDB 数据库备份」选择「指定 InnoDB 表」，勾选表并选择「结构及数据」「仅结构」或「仅数据」，再把格式设为「tabrelio ZIP 归档」。归档保存原生工具生成的 SQL、表名、内容范围、可见对象和 SHA-256 校验信息。指定表采用第三版清单，原有整库归档继续读取第一版和第二版清单。 [MySQL mysqldump 文档](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) · [MariaDB mariadb-dump 文档](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

从「打开数据库备份归档」选择 ZIP，可校验字节、检查 SQL 对象或导出原始 SQL。直接恢复指定表时，选择实际连接和一个现有目标库，点击「检查目标」。恢复结构时可以保留已有对象，条件是目录可见性已确认，且归档中的表名和触发器名可用。详见[在已有库中恢复缺失表](mysql-archive-restore-missing-tables-20261108.md)。仅数据时，检查要求所选同名 InnoDB 表均可见，目标列、键和约束仍需匹配。仅数据脚本以 INSERT 写入，已有触发器会照常运行。目标仍需通过既有的版本和事件调度器检查。

恢复前会重新验证归档完整性，并在执行连接上复查目标数据库和目录。确认只对已检查的连接和目标库有效。请使用可信归档，并结合 SQL 核对未选中的依赖、DEFINER 和其他跨库引用。恢复以实际账号权限执行，失败或取消后可能保留此前已提交的变更。

## 验收记录

2026-11-08，macOS arm64 源码通过运行时检查、类型检查、构建和 244 项相关单测。Server-200 隔离 MySQL 8.4.11 和 MariaDB 11.4.13 通过 3 项 Electron 实库用例，另有 1 项离线窗口回归，均无跳过或重试。

第三版清单上线时，双库均验证了归档的生成和校验、完整和拆分恢复、仅数据 SQL 对象检查，以及不同目标库中的精确数值、二进制、NULL 和触发器。缺少目标表时拦截仅数据恢复。原指定表 SQL、第一版旧归档、第二版整库 ZIP、SSH 转发和取消通过回归。

两个隔离容器、SSH 转发、测试会话和临时凭据目录已核对清理。WIN11-TEST 当时不可达，Windows、安装包、其他服务器版本和指定表 ZIP 的 SSH／TLS 组合待验。
