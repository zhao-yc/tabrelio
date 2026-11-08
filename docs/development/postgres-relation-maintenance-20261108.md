# PostgreSQL 日常关系维护

打开物理表或已填充物化视图的「查看结构」，点击「PostgreSQL 关系维护」。窗口显示最近一次手动 VACUUM、手动分析及两项计数。计数由 PostgreSQL 统计收集器维护，点击「刷新维护目录」可重新读取。

- 更新统计信息会运行 ANALYZE，为查询规划器更新目标关系统计。
- 普通 VACUUM 清理失效行版本并让原表复用空间，保留表尾空页。也可在同一条命令中更新统计。
- 重建表索引会显示目标索引并执行 REINDEX TABLE。重建可能阻塞目标表的写入及依赖相关索引的读取。

确认前可核对只读 SQL 预览。分析和重建在事务内固定原关系，重建后核对原索引 OID、新物理文件和有效状态。VACUUM 使用独立的事务外连接，另由短会话持有与普通 VACUUM 兼容的 ACCESS SHARE 锁，阻止目标关系改名或删除。执行前后分别核对关系和 Schema 身份。若期间出现目录变化、服务器警告、超时或断线，可能需要重新读取目录确认结果。每个预览只能提交一次。 [ANALYZE](https://www.postgresql.org/docs/18/sql-analyze.html) · [VACUUM](https://www.postgresql.org/docs/18/sql-vacuum.html) · [REINDEX](https://www.postgresql.org/docs/18/sql-reindex.html)

## 验证

- macOS arm64 的 Node.js 与 SQLite 原生运行时检查、类型检查、构建及 145 项相关单测通过。
- Server-200 隔离 PostgreSQL 18.6 的 32 项 Electron 用例通过。独立连接验证四种维护操作、手动计数、新索引文件与原 OID、原行数据逐行一致。另核对限权物化视图、VACUUM 等锁时的独立对象保护、预览后的同名替换拦截和一次性令牌。
- 4 项实库集成回归通过。两轮隔离测试均在客户连接归零后关闭隧道并清理测试容器。
- WIN11-TEST 不可达，本轮使用 macOS arm64。Windows 原生窗口、安装包及其他 PostgreSQL 版本待验。
