# PostgreSQL 现有表导入多编码 CSV

打开 PostgreSQL 表页的「导入数据」，选择 CSV，并按文件来源选择读取方式。

- **PostgreSQL 原生 CSV**使用 UTF-8。未加引号的空字段表示 NULL，两个双引号表示空字符串，所有源列均需映射。
- **tabrelio CSV（多编码）**支持 UTF-8、UTF-16 LE 和 GB18030。`\N` 表示 NULL，空字段保留为空字符串，反斜线开头的文本按转义约定读取，二进制使用 `base64:` 前缀。可跳过不需要的源列。

设置分隔符和首行模式后选择文件。多编码方式检查完整文件、严格核验所选编码，提交时再核对文件字节指纹。核对映射后可追加，也可选可靠匹配键处理。类型转换、约束与事务结果由 PostgreSQL 确认。

新保存的 CSV 配置包含读取方式。tabrelio CSV 配置可在兼容的 MySQL、MariaDB 和 PostgreSQL 入口复用。没有读取方式标记的旧配置在 PostgreSQL 中按编码选择方式，UTF-8 使用原生 CSV，UTF-16 LE 和 GB18030 使用 tabrelio CSV。
