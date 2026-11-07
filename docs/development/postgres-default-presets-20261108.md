# PostgreSQL 字段默认值

在「新建 PostgreSQL 表」配置字段，或从表页进入「查看结构 → 编辑字段」。新增字段可以直接选默认值。修改已有普通字段时，选择「修改默认值」和原字段，核对当前表达式后选择替换值或「清除默认值」。点击「加入改动」，预览并确认整批 SQL。

| 字段类型 | 服务器默认值 | 写入表达式 |
| --- | --- | --- |
| `date` | 当前日期 | `CURRENT_DATE` |
| `timestamp`、`timestamptz` | 当前时间 | `CURRENT_TIMESTAMP` |
| `uuid` | 随机 UUID v4，PostgreSQL 13+ | `pg_catalog.gen_random_uuid()` |
| `uuid` | 时间有序 UUID v7，PostgreSQL 18+ | `pg_catalog.uuidv7()` |

字段仍可使用文字默认值。修改或清除已有列的默认值会影响随后使用该默认值的写入，已保存的值保持原样。新增带默认值的列时，PostgreSQL 可能为已有行填值或重写表，耗时取决于表达式与表大小。标识列和生成列由 PostgreSQL 管理。字段编辑器显示当前表达式，并通过固定选项配置上述函数。[PostgreSQL 默认值](https://www.postgresql.org/docs/18/ddl-default.html) · [PostgreSQL UUID 函数](https://www.postgresql.org/docs/18/functions-uuid.html)

UUID 函数由目标库检查是否存在并允许当前账号执行。预览阶段只读目录。确认后再次检查权限，在同一事务中回读实际列默认表达式。表达式与预览不符时回滚。UUID 使用 `pg_catalog` 限定名，用户 schema 中的同名函数不参与解析。

## 验证

- macOS arm64 使用 Node.js 24.17.0，原生运行时门槛、类型检查、构建及 81 项相关单元测试通过。
- Server-200 隔离 PostgreSQL 18.6 通过 12 项 Electron 源码用例。覆盖建表、新增、替换和清除默认值，独立连接插入确认 UUID 版本、日期、带时区时间戳及带精度的无时区时间戳。另验证权限撤销时在 DDL 前拒绝，以及事件触发器替换默认表达式时回滚。
- 另通过 3 项实库集成用例，覆盖建表、复制表与表页读写。隔离实例在零客户连接后关闭回环转发并清理容器。
- 新增原生用例首次类型检查发现测试夹具的字面量类型被扩宽，已修正并重新通过检查。
- WIN11-TEST 不可达，本轮未派发。Windows 原生窗口、安装包及较低版本 PostgreSQL 待验。
