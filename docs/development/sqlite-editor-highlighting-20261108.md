# SQLite SQL 着色

打开 SQLite 查询或带方言标识的 SQL 预览即可看到 SQLite 着色。三种标识符引号、文本、BLOB、数字和绑定参数分别识别，支持 `?12`、`:名称`、`@名称` 及 `$scope::name(suffix)`。单引号文本内用两个单引号表示字面引号，反斜杠保持原样。[SQLite 表达式与字面量](https://www.sqlite.org/lang_expr.html)

SQLite 块注释在第一个闭合标记处结束。引号内的注释符号仍属于原标识符或文本。着色只读当前编辑器文本，切换到其他数据库标签时各自使用对应语法。查询补全、声明与引用、重命名、参数提示、片段及折叠继续走各自的编辑器入口。[SQLite 注释语法](https://www.sqlite.org/lang_comment.html)

## 验证

- macOS 严格类型检查、构建和 388 项定向单元测试通过。
- macOS Electron 4 项通过。专用 SQLite 文件用于核对实际渲染颜色、跨行词法、SQLite 与 MySQL 标签隔离、语句折叠，以及真实目录补全、声明与引用和重启。另验 SQLite、MySQL 和 MariaDB 的参数提示，以及 PostgreSQL 原着色。
- PostgreSQL 着色回归首轮等待颜色观察超时，保留失败记录，原断言复跑通过。Windows 测试机不可达，本轮未验安装包。
