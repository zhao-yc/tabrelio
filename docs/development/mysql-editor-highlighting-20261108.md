# MySQL 与 MariaDB SQL 着色

MySQL 和 MariaDB 查询及带方言标识的 SQL 预览使用各自的着色规则。可识别反引号名称、十六进制和位字面量、会话变量以及客户端 `DELIMITER` 行。连续两个减号后有空白或控制字符时识别为行注释，`1--2` 按运算符着色。版本注释及优化器提示保留各自的词法标记，实际执行条件由服务端处理。[MySQL 注释语法](https://dev.mysql.com/doc/refman/8.4/en/comments.html) · [MariaDB 注释语法](https://mariadb.com/docs/server/reference/sql-statements/comment-syntax)

空闲查询用原会话已知的模式位为整份草稿着色。双引号在 `ANSI_QUOTES` 下按标识符着色，`NO_BACKSLASH_ESCAPES` 下字符串中的反斜杠按普通字符着色。未知模式位使用默认规则。着色切换保留模型和 SQL 正文，使用已有协议缓存，无需额外连接或执行探测 SQL。[MySQL 字符串规则](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)

## 验证

- macOS 严格类型检查、构建和 208 项定向测试通过。补齐旧切库测试桩的模态选择器及连接修订依赖。
- macOS Electron 分别连接 Server-200 的 MySQL 8.4.11 与 MariaDB 11.4.13 隔离库。两库各验证四种模式组合、原模型及草稿隔离、注释和客户端指令的着色，以及切换后的真实目录补全。查询历史仅有显式执行的四条会话模式设置。容器、匿名卷和隧道已清理。
- 另通过 SQLite 着色与折叠、MySQL／MariaDB／SQLite 参数提示两项离线原生回归。Windows 测试机不可达，本轮未验安装包。
