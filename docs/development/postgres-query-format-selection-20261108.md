# PostgreSQL 选区格式化

在 PostgreSQL 查询页选中要排版的 SQL，点击「格式化 PostgreSQL SQL」或按 Alt＋Shift＋F（macOS 为 Option＋Shift＋F）。选区外的正文逐字保留。没有选区时排版全文。格式化使用当前制表符和缩进宽度，关键字大小写保持原样。一次撤销可恢复格式化前的正文，一次重做可恢复排版。

排版保持模型换行符，核对原脚本和排版后脚本在两种 `standard_conforming_strings` 设置下的词法边界。被截断的词法单元、多个选区、词法边界会变化的跨行字符串或运算符，以及 `COPY FROM STDIN` 脚本会保留原文并提示。格式化仅编辑查询草稿。[PostgreSQL 词法规则](https://www.postgresql.org/docs/18/sql-syntax-lexical.html)

## 验证

- macOS 通过严格类型检查、构建及 256 项定向单元测试。补齐旧快捷键测试桩的模态选择器依赖。
- macOS Electron 离线测试 7 项通过。PostgreSQL 的按钮和快捷键均核对了真实选区、全文、单步撤销重做、草稿落盘、零新增查询任务及历史。危险跨行字符串保留原文。其余四项覆盖 MySQL 的排版与拒绝分支。首轮原生测试定位了旧历史菜单，保留失败记录，按当前菜单修正定位后复测通过。
- Windows 测试主机不可达。安装包及实库执行本轮未验证。
