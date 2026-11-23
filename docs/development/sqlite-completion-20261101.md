# SQLite 查询编辑器元数据补全

## 使用与范围

SQLite 查询标签支持输入时建议及 `Ctrl+Space`：表、视图、字段、表别名，明确输出列的 CTE／派生表，以及 `main`／`temp` 限定。建议按准确名称使用 SQLite 双引号转义，以普通文本插入；同名字段保留各自别名限定。INSERT 字段清单、UPDATE 赋值左侧及 RETURNING 使用目标表字段。

`CREATE TRIGGER` 支持在 `ON` 后补全触发目标并悬停，普通触发器匹配普通表，`INSTEAD OF` 匹配视图。`UPDATE OF` 提供尚未填写的可更新列。`WHEN` 和动作表达式按事件提供 `NEW`、`OLD` 及其字段。各条动作复用普通 SQL 的表、字段及表达式补全，按顶层分号隔离，`CASE … END` 保留在所属表达式。持久触发器的动作读取所属库，临时触发器沿用原会话的对象解析规则。写入目标补入单段名称。同名查询来源优先匹配自身字段，缺少该列时回退到触发行。 [SQLite 触发器](https://www.sqlite.org/lang_createtrigger.html)

在触发器的 `ON` 目标、`WHEN` 子查询和当前动作中，可以查看实际表或视图的完整定义。未限定的永久触发器在同一目录读取中先确认触发归属，再定位动作对象。临时触发器的动作沿用当前会话。定义面板只读，按原编辑器模型和目录版本核对发布。 [SQLite 触发器动作约束](https://www.sqlite.org/lang_createtrigger.html)

SQLite 建表和加列时，`REFERENCES` 提供子表所在库的普通父表及父列候选和悬停。未限定的加列目标先按原会话定位子表，再读取同库父表。现有父表的列补全按子键列数、已填写的父列和列声明的排序规则，筛选可用的主键与完整唯一索引。复合键允许使用与索引不同的列顺序，并按索引实际包含的列次数提供重复列。表级 `FOREIGN KEY(…)` 的子列和新建表的自引用父列来自当前建表声明。手写父列仍可悬停查看目录，SQLite 在实际使用外键时执行最终校验。 [SQLite 外键](https://www.sqlite.org/foreignkeys.html#fk_indexes)

`CREATE TABLE` 的列定义和 `ALTER TABLE … ADD COLUMN` 支持声明类型补全和悬停。普通表候选显示类型亲和性，`STRICT` 表提供 SQLite 接受的六种类型，并说明 `ANY` 保留传入值的存储类型。建表模式取自声明末尾的 `STRICT` 选项，加列模式读取当前会话中实际目标表的选项，支持同名临时表遮蔽。补全替换同一行的完整类型词组，保留现有精度和列约束。 [SQLite STRICT 表](https://www.sqlite.org/stricttables.html) · [类型亲和性](https://www.sqlite.org/datatype3.html#affname)

`ALTER TABLE` 补全目标表并支持对象定义定位。普通表提供重命名、删列及 SQLite 3.53.0 起 `ALTER COLUMN` 的源列候选和悬停。虚拟表可参与表重命名，字段候选限定普通表。删列候选排除主键、索引直接引用的列及最后一个普通列，完整依赖在显式执行时由 SQLite 验证。`ADD COLUMN` 中的 `COLLATE` 沿用规则目录，新表名和新列名由用户输入。 [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)

`CREATE INDEX … ON` 补全可索引的普通表。根据索引名上的 `main` 或 `temp` 查找单段表名，未指定时遵循原会话的临时对象遮蔽。索引键和部分索引 `WHERE` 提供该表的列、确定性标量函数和排序规则，生成列也可用。键只接受未限定列名，部分索引谓词可限定同一张表。对象定位采用同一目标库，时间函数的输入仍由 SQLite 判断是否确定。 [SQLite 建索引](https://www.sqlite.org/lang_createindex.html) · [部分索引](https://www.sqlite.org/partialindex.html) · [确定性函数](https://www.sqlite.org/deterministic.html)

`CREATE VIEW … AS` 和 `CREATE TABLE … AS` 后可补全 `SELECT`、`WITH` 或 `VALUES`。查询体沿用字段、表、函数、索引和排序规则补全，以及悬停和对象定位。声明的目标名和视图列清单保留原文。永久视图将未限定来源解析到自身的 `main` 库，临时视图和查询建表沿用原会话的临时表优先规则。CTE 保留对未限定关系名的遮蔽优先级。 [SQLite CREATE VIEW](https://www.sqlite.org/lang_createview.html) · [SQLite CREATE TABLE AS](https://www.sqlite.org/lang_createtable.html#createtabas)

`COLLATE` 后可补全及悬停当前 SQLite 连接登记的排序规则。适用位置包括比较、分组、普通及复合查询排序、窗口、UPSERT 冲突目标，以及 `CREATE TABLE` 和 `CREATE INDEX` 的规则位置。候选整体替换规则名，兼容 SQLite 接受的引号写法。内置说明区分字节比较、ASCII 大小写折叠和忽略尾部空格。补全只读固定的 `PRAGMA collation_list`。 [SQLite 排序规则](https://www.sqlite.org/datatype3.html#collation) · [SQLite 排序规则目录](https://www.sqlite.org/pragma.html#pragma_collation_list)

输入内置函数名的一部分即可在常见表达式位置补全。候选读取实际 SQLite 运行时的 `function_list`，显示固定或可变参数个数。接受候选自动插入括号并进入参数位置，已有括号时只替换函数名。`HAVING` 可建议聚合，必须带 `OVER` 的内置窗口函数仅在普通 `SELECT` 输出和排序表达式中提供模板。悬停已写出的调用可查看目录签名。`VALUES` 中的函数补全独立于写入目标的列目录。 [SQLite 函数目录](https://www.sqlite.org/pragma.html#pragma_function_list) · [SQLite 窗口函数](https://www.sqlite.org/windowfunctions.html)

`EXPLAIN` 和 `EXPLAIN QUERY PLAN` 内的查询或写入语句沿用原补全作用域。`INDEXED BY` 只补全实际表的索引名，悬停显示所属命名空间、表、索引来源及唯一或部分属性。无显式命名空间时使用原会话的临时对象遮蔽规则，唯一约束等生成的索引也可选择。读取只传表名、命名空间和前缀，不准备编辑器内的 SQL。选中部分索引后由 SQLite 检查查询条件是否适用。 [SQLite INDEXED BY](https://www.sqlite.org/lang_indexedby.html) · [SQLite `index_list`](https://www.sqlite.org/pragma.html#pragma_index_list)

SQLite UPSERT 可补全 `ON CONFLICT` 的目标列表和索引谓词、`DO UPDATE SET` 的两侧及其 `WHERE`。赋值左侧支持列组并排除生成列、隐藏列。右侧和过滤条件可分别引用目标旧行和 `excluded` 待插入行，两者共享实际目标表的列目录。候选和悬停明确标注待插入行。实际目标名或别名为 `excluded` 时，沿用 SQLite 的优先级。`INSERT … SELECT` 的输入来源在进入冲突分支后退出作用域，`INSERT … RETURNING` 的限定名使用写入的实际表名。唯一索引匹配以 SQLite 执行结果为准。 [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html)

`UPDATE … FROM` 的赋值右侧和 `WHERE` 可使用目标与来源列，来源表之间的 `ON` 按连接范围解析。单一表值函数的实参可关联更新目标。`UPDATE` 的赋值列组使用可写列候选并排除生成列和隐藏列。`UPDATE` 和 `DELETE` 的过滤表达式支持按实际命名空间限定目标别名。它们的 `RETURNING` 按实际目标表名解析，相关子查询可同时使用其自身来源。 [SQLite UPDATE FROM](https://www.sqlite.org/lang_update.html#update_from) · [SQLite RETURNING](https://www.sqlite.org/lang_returning.html)

普通 `SELECT` 的 `ORDER BY`、`GROUP BY`、`HAVING` 和 `WHERE` 可补全及悬停当前查询块的输出别名。独立排序名称优先解析为输出别名。排序表达式、分组和过滤依次查当前查询块的来源列、输出别名和相关外层列。别名悬停显示来源说明，表达式类型标为未知。聚合、窗口函数及无法确认的函数按所在位置判断可用性。需先确认来源列时，目录缺失或无法判定隐式行号会限制别名候选。[SQLite SELECT](https://www.sqlite.org/lang_select.html#orderby) · [SQLite 名称解析源码](https://github.com/sqlite/sqlite/blob/version-3.53.0/src/resolve.c#L628)

`OVER 名称`、`OVER (名称 …)` 和 `WINDOW` 定义的继承位置可补全当前查询块的命名窗口。候选沿用声明的原始引号种类。SQLite 将未引用、双引号、反引号和方括号形式视为不同的窗口名。裸 `OVER` 可用带帧窗口，括号继承依据 `PARTITION BY`、`ORDER BY` 和帧限制筛选。窗口定义中的继承候选来自此前声明。窗口内部的分区和排序表达式仍可补全来源字段。[SQLite 窗口继承](https://www.sqlite.org/windowfunctions.html#window_chaining)

在窗口引用上按 F12 可跳到定义，Shift+F12 查看当前语句中的已解析引用，F2 可一次修改声明及可确认的引用并整体撤销。存在其他同名词或新名称冲突时，F2 保留原文。窗口名补全、导航、引用和重命名都由当前文本解析，不读取列目录、不创建会话、不执行 SQL。[SQLite 窗口定义语法](https://www.sqlite.org/syntax/window-defn.html)

CTE 和派生表的字段补全、悬停也能逐层展开 `SELECT *` 和 `SELECT 别名.*`。显式 CTE 列清单优先，复合定义沿用首分支输出。读取沿声明作用域追到原表、视图或表值函数，按投影顺序生成确定的重名后缀。已确认来源的字段悬停显示物理类型。循环引用、未命名表达式和不完整目录保留已确认的前序列并提示部分结果。外层 `USING`、复合排序星号及连接组字段复用这些局部输出，同一次补全共用来源目录。[SQLite WITH](https://www.sqlite.org/lang_with.html) · [SQLite 来源投影](https://www.sqlite.org/lang_select.html#fromclause)

尚无查询会话的草稿通过授权文件的独立只读连接读取目录，不创建查询会话。已有会话使用原物理连接，临时表遮蔽规则及未提交 DDL 保持；显式 `main`／`temp` 只读取指定命名空间。切换标签、修改正文、连接变更及模态会撤销旧结果。

补全支持复合查询各分支的字段作用域。末尾 `ORDER BY` 可补入各分支的明确输出名，也能按 `*`、`别名.*` 读取实际投影来源的列目录。嵌套连接的裸星号省略 `USING` 合并副本，成员限定星号保留 `id:2` 等实际输出名。星号保留生成列并排除虚拟表隐藏列。已知 CTE 和派生表的输出可直接展开，未知或歧义投影标记为部分候选。同一物理来源的重复星号共用目录读取。`LIMIT` 不读取分支字段目录。[SQLite 复合排序规则](https://www.sqlite.org/lang_select.html#orderby)

`JOIN … USING` 清单补全当前连接两侧共有的列，排除同一清单已经填写的项。累积左侧保留此前 `USING` 和 `NATURAL JOIN` 合并信息，含 `RIGHT` 或 `FULL JOIN` 的查询块按 SQLite 规则排除歧义列。

`JOIN … ON` 支持当前查询块的标量输出别名，来源列优先。内连接保留 SQLite 允许的后续来源引用。外连接的字段候选和声明跳转限定在当前连接输入，相关子查询继承这一范围。未限定悬停可用后续列目录消歧。外连接后还有表时，别名表达式须能确认只依赖当前输入，后续目录只用于判断同名冲突。隔离的括号连接组保留自己的作用域。[SQLite JOIN 语义](https://www.sqlite.org/lang_select.html#fromclause)

`json_each(...)`、`pragma_table_info(...)` 等表值调用使用 SQLite 原生列目录，支持字段补全、悬停、星号排序和 USING。补全请求只包含来源名、命名空间和前缀，调用正文及参数留在编辑器。未限定调用沿原会话解析同名对象，普通表或 CTE 遮蔽时停止返回列推断。实参位置可补前序来源和相关外层字段。ATTACH 数据库与复杂的无名或多层星号投影仍待扩展。

括号连接支持按成员别名补全和悬停。首个无修饰的括号组沿外层查询块解析，后置多来源组的 `ON` 和 `USING` 按嵌套查询解析，组外只显示成员投影中可见的字段。单来源组按 SQLite 规则保留或覆盖原别名。可展开的首组保留 `USING` 的合并状态和星号目录。[SQLite 来源语法](https://www.sqlite.org/syntax/table-or-subquery.html)

嵌套组作为外层 `USING` 的任一侧时，按成员列目录计算共有列和确定的重名后缀，如 `id:1`，并按 `RIGHT`、`FULL JOIN` 的规则排除歧义。组内 `NATURAL JOIN` 和先前的 `USING` 参与计算。目录超限、随机后缀和无法从目录确认的行号别名会标记为部分结果。[SQLite 3.53 列名解析源码](https://github.com/sqlite/sqlite/blob/version-3.53.0/src/select.c#L2203)

可先补入多来源连接组的别名，再补全或悬停 `组别名.字段`，包括确定的重名后缀。补全只读命中组的成员目录，跳过其他组及隐藏列。组别名与成员同名时，原始成员字段优先，随后匹配组输出名。悬停展示已确认的原列类型，合并列保留连接组来源说明。星号限定符沿用 SQLite 的成员名称规则。[SQLite 名称解析源码](https://github.com/sqlite/sqlite/blob/version-3.53.0/src/resolve.c#L335)

## 实现与资源边界

SQLite 使用独立词法分析 Worker，不复用 MySQL 解析器。SQL 正文只进入本地 Worker；新增 `sqlite.completion` IPC 仅接收已校验的连接／会话、任务编号、名称和前缀，不接收 SQL 或文件路径。元数据不写查询历史或持久任务。

读取采用固定的 [table_xinfo](https://www.sqlite.org/pragma.html#pragma_table_xinfo)／table_list 及 schema cookie；临时命名空间遵循 [SQLite 对象定位规则](https://www.sqlite.org/lang_naming.html)。前后 cookie、会话修订及模型版本任一变化均丢弃整组。原会话取消仅等待固定短读边界，不 interrupt／关闭会话或回滚用户事务；独立连接必须确认资源退出才交付。

预算保持：262144 UTF16 单位正文、16384 token、64 层、16 关系、256 候选及目录记录、2MiB 回包；Worker 启动最多8秒、分析最多1.5秒。取消／替换／卸载真实终止旧 Worker，后继等待原请求终态。

明确执行、计划、参数识别及事务只可接管本会话正在运行的准确补全短读：同步占排他用户意图，边界取消元数据并等待原终态后重新核对目标，再发送一次原动作；其它查询或事务仍立即互斥。等待期间取消用户任务不会发送 SQL，关闭／物理配置变化使交接失效，不自动重连或重放。

## 验证记录

2026-11-23 触发器对象定义增量。WIN11-TEST 不可达，本机 macOS arm64 使用 Node.js 24.17.0，原生运行时检查、严格类型检查、构建及 43 份套件的 1,157 项测试通过。Electron 定义专项整例 1 项通过，在原事务和同名临时表同时存在时，分别读取 `ON` 指定的主库表、隐式永久触发体的主库表与临时触发体命中的临时表，核对完整只读 DDL、原编辑器、事务与磁盘均保持。编辑器专项 17 项通过，原会话全流程回归 1 项在 108.8 秒通过。最终报告位于 `.cache/sqlite-trigger-definition/final/`。Windows 界面及安装包待验。

2026-11-23 触发体动作增量。WIN11-TEST 不可达，本机 macOS arm64 使用 Node.js 24.17.0，通过原生运行时、严格类型检查、构建和 41 份套件的 1,038 项测试。真实 SQLite 核对永久和临时触发器写入各自命中的同名表，核对 `NEW` 同名真实列优先和缺列回退。Electron 编辑器专项 17 项通过，实际补入 `UPDATE` 动作目标列，先回读触发器定义，再触发更新并核对日志前后值。原会话全流程回归 1 项在 108.4 秒通过。最终报告位于 `.cache/sqlite-trigger-body/final/`。Windows 界面及安装包待验。

2026-11-23 触发器增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 使用 Node.js 24.17.0，通过原生运行时、严格类型检查、构建及 41 份套件的 1,033 项测试。原生目录核对普通表、视图、虚拟表、同名临时视图与原事务。Electron 编辑器专项 16 项通过，实际补全目标表及 `NEW.value`，显式执行才创建触发器。独立探针实际执行更新并读回旧值 `旧`、新值 `新🚢`，验证其它列变动和同值赋值时日志为空，探针事务随后回滚。原会话全流程回归 1 项在 108.6 秒通过。报告位于 `.cache/sqlite-trigger-completion/accepted/`。Windows 界面及安装包待验。

2026-11-23 父键筛选增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 使用 Node.js 24.17.0，通过原生运行时检查、严格类型检查、构建和 55 份套件的 1,631 项测试。原生目录验证整数主键、普通唯一索引、生成列、复合反序和重复索引列，排除部分索引、表达式索引、排序规则不匹配及截断的复合键。核对了同名临时表和原事务。Electron 编辑器专项 14 项通过，前缀 `i` 保留父键 `id`，剔除普通列 `id_related`。原会话全流程回归 1 项在 109.1 秒通过。最终日志和报告位于 `.cache/sqlite-foreign-parent-keys/accepted/`。Windows 界面及安装包待验。

2026-11-23 外键增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 使用 Node.js 24.17.0，通过原生运行时、严格类型检查、源码构建和 40 份套件的 1,008 项测试。原生补全目录核对 `main`、`temp` 及同名视图与原事务。Electron 编辑器专项 14 项通过，建表补全父表并保留 `ON DELETE CASCADE`，加列补全父列。两例均在显式执行后独立读回外键定义，实际验证缺失父键被拒绝、有效父键可插入，探针事务已回滚。原会话全流程回归 1 项在 108.5 秒通过。原始日志和报告位于 `.cache/sqlite-foreign-key-completion/final/`。Windows 界面及安装包待验。

2026-11-23 列声明类型增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 使用 Node.js 24.17.0，通过原生运行时检查、严格类型检查、源码构建及 39 份相关套件的 995 项测试。原生目录用例核对同名临时表与主表的类型模式、视图过滤和原事务保持。Electron 编辑器专项 12 项通过，普通建表补入 `DOUBLE PRECISION` 后保留精度和 `NOT NULL`，严格表加列回读为 `ANY`。显式执行前磁盘、查询会话和历史均保持。全流程回归 1 项在 108.5 秒通过。多词类型首轮被编辑器二次筛选隐藏，修复后原断言通过。原始证据保存在 `.cache/sqlite-column-type-completion/verified/` 和 `.cache/sqlite-column-type-completion/final/`。Windows 界面和安装包待验。

2026-11-23 修改表增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 通过严格类型检查、源码构建及 38 份相关套件的 978 项。原生用例验证普通表与虚拟表的不同操作范围、同名临时表、主键与直接索引依赖筛选、最后一个普通列以及 SQLite 3.53 的空值约束字段。Electron 编辑器专项 10 项通过，重命名后原值保持，删列后目标列消失，其它列和值保持。显式执行前补全和悬停均为目录读取。全流程回归 1 项在 109.2 秒通过，对象定义专项 1 项读取未限定目标的实际临时表，原事务与磁盘保持。日志和报告保存在 `.cache/sqlite-alter-table-completion/verified/`。Windows 界面和安装包待验。

2026-11-23 建索引增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 通过严格类型检查、源码构建和 37 份相关套件的 958 项。原生用例核对普通表筛选、同名临时视图遮蔽、确定性函数过滤，并确认生成列的部分索引能被查询计划采用。Electron 编辑器专项 8 项通过。显式执行前没有创建索引，执行后回读了唯一性、部分索引标志和生成列键。全流程回归 1 项在 110.2 秒通过。对象定义专项 1 项通过，真实菜单在同名临时表与原事务下请求 `main.subject`，读取主表定义且原事务保持。日志和原始报告保存在 `.cache/sqlite-create-index-completion/verified/`。Windows 界面及安装包待验。

2026-11-23 查询建表与建视图增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 通过严格类型检查、源码构建和 36 份相关套件的 935 项。原生 SQLite 用例使用同名主表和临时表，核对永久视图、临时视图及查询建表的实际结果。Electron 编辑器专项 7 项通过。建视图草稿在补全和悬停阶段只读取 `main.subject` 的列目录，显式执行后在合成库回读了准确视图定义和值。既有编辑器全流程回归 1 项在原 120 秒门槛内通过，两次应用正常退出。对象定义专项 1 项通过，真实菜单在有同名临时表的原事务中请求 `main.subject`，显示永久表定义且保持事务与磁盘。日志和原始报告保存在 `.cache/sqlite-create-query-completion/verified/`。Windows 界面和安装包待验。

2026-11-23 排序规则增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 通过严格类型检查、源码构建和 28 份相关套件的 825 项。原生单元验证固定规则目录不受同名临时表遮蔽，原事务和目录修订保持。Electron 编辑器专项 6 项通过。`COLLATE` 只读取规则目录，接受 `NOCASE` 后显式执行复合查询，结果依次为 `a`、`Z`。补全和悬停期间数据库、会话和历史保持原状。既有全流程回归 1 项在 109.1 秒通过，两次应用均正常退出。初轮单元测试中，光标夹具误取了拼接运算符 `||` 的竖线，修正后通过。日志与报告保存在 `.cache/sqlite-collation-completion/`。Windows 界面和安装包待验。

2026-11-23 内置函数增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 通过严格类型检查、源码构建和 27 份相关套件的 789 项。原生单元套件核对重载、`PRAGMA function_list` 免受同名临时表遮蔽、原会话事务与修订保持。Electron 专项 5 项通过，其中接受 `json_extract` 后插入括号并将光标置于参数位置，悬停显示可变参数，显式执行返回 `7`，补全期间数据库、查询会话和历史保持原状。长回归前两轮分别停在手动输出别名补全、写入排序文本引起的自动请求。旧夹具先拒绝了新目录类型，补入的前缀白名单随后漏了自动请求。夹具按固定目录类型和有界前缀核验自动请求，保留手动补全的准确会话与前缀断言。最终长回归 1 项在原 120 秒门槛内通过，两次应用均正常退出。通过报告及首两轮原始记录和隔离配置保留在 `.cache/sqlite-function-completion/`。Windows 界面和安装包待验。

2026-11-23 索引与执行计划增量。WIN11-TEST 不可达，未派发任务。本机 macOS arm64 在修正首轮类型检查发现的光标范围遮蔽和测试路径类型后，通过严格类型检查、源码构建和 22 份相关套件的 678 项。Electron 编辑器专项 4 项通过。`INDEXED BY` 候选和悬停只读取 `main.subject` 的索引目录，显式执行前数据库、会话和历史保持原状，执行计划显示选定索引。既有补全回归 1 项通过，两次应用正常退出。日志和报告保存在忽略目录 `.cache/sqlite-index-completion/verified/`。Windows 界面及安装包待验。

2026-11-23 UPDATE FROM 与 DELETE RETURNING 增量。WIN11-TEST 不可达，本机 macOS arm64 的严格类型检查、源码构建和 21 份相关套件的 650 项通过。Electron 分别对 UPSERT、UPDATE FROM 和 DELETE RETURNING 验证候选插入、悬停和显式执行。三个用例在显式执行前保持文件及会话原状，执行后确认目标行和返回值。原 SQLite 补全 Electron 回归通过，两次应用均正常退出。通过记录位于忽略目录 `.cache/sqlite-dml-completion/verified/`。Windows 界面和安装包待验。

2026-11-23 UPSERT 增量。WIN11-TEST 不可达，本机 macOS arm64 严格类型、源码构建和 21 份相关套件的 645 项通过。Electron 专项用独立合成库验证 `excluded` 补全只读一次实际目标列目录，悬停标注待插入行，显式执行前保持会话和数据库原状。执行后返回拼接值和生成列值，普通同名表保持原值。原 SQLite 补全 Electron 专项串行回归通过。日志及报告位于忽略目录 `.cache/sqlite-upsert-completion/accepted/`。Windows 界面和安装包待验。

2026-11-23 `JOIN … ON` 增量。WIN11-TEST 不可达，本机 macOS arm64 严格类型、源码构建和 20 份相关套件的 634 项通过。原生 SQLite 用例核对内连接和外连接的后续来源规则、相关子查询及同名字段优先级。Electron 源码专项接受 `LEFT JOIN … ON` 的输出别名，只按前缀读取当前会话的三份来源列目录。显式执行分别返回命中的临时表值和未匹配行的空值，两次应用均正常退出。通过记录位于忽略目录 `.cache/sqlite-join-on/confirmed/`。Windows 界面和安装包待验。

2026-11-23 命名窗口增量。WIN11-TEST 不可达，本机 macOS arm64 严格类型、源码构建和 19 份相关套件的 621 项通过。Electron 源码专项在继承位置补入原样 `[w]`，显式执行返回 `1`、`2`，并核对 F12 定位、Shift+F12 引用和 F2 整组撤销／重做。名称操作未增加列目录读取，两次应用均正常退出。排序字段和真实帧的区分由原生 SQLite 用例补验。通过记录位于忽略目录 `.cache/sqlite-named-windows/accepted/`，先前停在光标核对的原件保留在 `final/` 和 `confirmed/`。Windows 界面和安装包待验。

2026-11-23 普通查询输出别名增量。WIN11-TEST 不可达，本机 macOS arm64 严格类型、源码构建和 17 份相关套件的 536 项通过。Electron 源码专项在 `GROUP BY`、`HAVING` 和 `ORDER BY` 接受别名，每次手动触发只读取一次 `main.subject` 列目录。显式执行返回 `high`、`one` 两行。独立排序别名的悬停不发起目录读取，两次应用均正常退出。日志和报告位于忽略目录 `.cache/sqlite-output-aliases/confirmed/`。Windows 界面和安装包待验。

2026-11-23 局部星号外层查询增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 严格类型、源码构建和 17 份相关套件的 509 项通过。Electron 源码专项分别在字段、`USING` 和复合 `ORDER BY` 接受 `main_marker:1`。每次补全只读取一次 `main.subject` 列目录。显式执行返回预期的两行升序结果，两次应用正常退出。日志和报告位于忽略目录 `.cache/sqlite-local-projection-outer/`。Windows 界面和安装包待验。

2026-11-23 CTE 与派生表星号增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 严格类型、源码构建和 17 份相关套件的 503 项通过。Electron 源码专项接受多层投影产生的 `main_marker:1`，补全只读取 `main.subject` 的列目录。显式执行返回预期的一行，两次应用正常退出。原生 SQLite 单元用例同时核对 `temp` 来源和声明类型悬停。日志和报告位于忽略目录 `.cache/sqlite-local-star-projection/`。Windows 界面和安装包待验。

2026-11-23 复合查询嵌套星号增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 严格类型、源码构建和 17 份相关套件的 498 项通过。Electron 源码专项在 `ORDER BY` 接受嵌套 `j.*` 产生的 `id:1`，补全只读取原会话的两个成员目录。显式执行返回预期的三行降序结果，两次应用正常退出。原生 SQLite 单元用例核对裸星号、成员星号、合并列、后缀及歧义。日志与报告位于忽略目录 `.cache/sqlite-compound-join-star/`。Windows 界面和安装包待验。

2026-11-23 多来源组别名增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 严格类型、源码构建和 17 份相关套件的 484 项通过。Electron 源码专项从组别名后接受 `value`，只读取该组两个成员目录。显式执行一次后，组别名与成员别名字段均返回相同的两行值，两次应用正常退出。原生 SQLite 单元验收覆盖重名后缀、真实声明类型及合并列悬停。日志和报告保存在忽略目录 `.cache/sqlite-group-alias/`。Windows 界面和安装包待验。

2026-11-23 嵌套组外层 `USING` 增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 严格类型、源码构建和 14 份相关套件的 392 项通过。Electron 源码专项接受 `id:1`，确认只在原会话读取成员列目录，显式执行一次返回两行，两次应用正常退出。首轮断言误把自动的 `j.key` 补全归入 `USING` 读取，保留现场后按请求范围校正，隔离复验 1 项通过。原始记录保存在忽略目录 `.cache/sqlite-grouped-using/`。Windows 界面和安装包待验。

2026-11-23 括号连接增量，WIN11-TEST 不可达，未派发任务。本机 macOS arm64 的严格类型、源码构建和 14 份相关套件的 381 项测试通过。Electron 源码专项 1 项通过，实际接受嵌套连接中的表值函数字段，显式执行一次返回两行，两次应用正常退出。隐藏列的组内外差异由合成内存 SQLite 验证。原始日志和报告保存在忽略目录 `.cache/sqlite-parenthesized-join/`。Windows 界面和安装包待验。

2026-11-23 表值函数增量，WIN11-TEST 不可达，未派发测试。本机 macOS arm64 使用 Node.js 24.17.0 跑过严格类型检查、源码构建和 9 份相关单元套件的 269 项测试，其中 31 项使用真实 SQLite。首轮 Electron 在沙箱内未启动，保留现场后在沙箱外使用独立临时配置运行专项，1 项通过。Monaco 接受 `json_each` 的 `value` 候选，补全期间未新增 SQL 执行、任务或历史，显式执行一次返回两行，两次应用退出均正常。日志和报告保存在忽略目录 `.cache/sqlite-table-function-native-macos/`。本轮使用源码应用及合成 SQLite 文件，Windows 界面和安装包待验。

WIN11-TEST 本轮不可达且未派发任务，按既有授权在本机 Windows 串行验证。仅独占合成 SQLite 文件及临时 profile，不使用 Server-200、剪贴板或已安装配置；原日志保存于忽略目录 `.cache/sqlite-completion-20261101/`。

最终相关154文件3063项通过，包括30项真实 SQLite 补全运行时、等待接管／取消／关闭及其它用户操作互斥；含真实分析器到候选生成的合流、既有 SQLite 浏览编辑与 MySQL 补全回归。RAM Monaco／Worker 端口单元不代替真实 CPU／窗口证据。初轮类型四处收窄错误修复后复验成功；会话交接修复后的最终完整严格类型 `typecheck-03` 和正式构建 `build-02` 均退出0，原4GiB预算保持。

原生首轮 `native-completion-01` 在50.7秒失败：已走过建议接受、Unicode、会话临时表、事务与候选撤销，但退出前 LF 预期与 Windows 模型 CRLF 不同，不能计为整例通过。原报告及准确临时目录保留；夹具改为读取实际模型 EOL／完整正文逐字核对持久化，后代仍完整设置对象比较，未改产品或门槛。首轮结束后未发现 Electron 进程，没有发送关闭／强停或清理命令，不补称正常退出。

旧原生当前语句和执行计划两例分别17.9／18.3秒通过，旧脚本保持。旧参数专项 `native-parameters-04` 按原120秒超时，首因未确认；报告、profile及数据库保留，未强停、清理或自动重试。无内容只读聚合仅显示3条已完成参数执行，不足以定位超时原因；宽泛设置摘要诊断被自动审批拒绝且未执行。随后仅为旧参数夹具添加固定阶段日志，不输出正文／参数，不修改保护、业务断言或时限。

最终 `native-completion-05` 在53.2秒通过，Root独立核对原报告：32次元数据请求，3份明确用户脚本、2个原会话；19个受观察SQLite进程均exit0、零kill，逐帧ACK及closed／closeAck齐全。27个真实分析Worker全部terminate一次，原事务／temp遮蔽／显式main和temp／另一标签及回滚后目录均准确；主文件完整定义和值保持。实际模型CRLF逐字持久化；两次正常客户端退出、独立重启零查询／零新session及准确目录清理闭合。

最终构建的新独立轮 `native-parameters-06` 在34.2秒通过，6次原参数执行、零守卫拒绝；两代exit0、第二代零参数执行及准确目录清理通过。不能据后轮成功反推原超时首因已确认，也不将其隐藏或改写为通过。

同一最终构建 `native-current-07`／`native-explain-08` 分别17.8／21.1秒通过，原脚本与业务断言逐字保持。最终补全、参数、当前语句及执行计划四项均两代正常退出并由原夹具核对准确临时目录清理；不是全量窗口或安装验收。

新增原生专项默认关闭及list单项注册均已实测，显式运行使用 `node scripts/sqlite-workspace-ci.mjs completion`，保持每例120秒、单 worker、零重试、trace关闭及失败保留现场。CI 增至 workspace11／management14共25项，原 job20分钟门不变。上述为Windows源码证据，非完整单元／全量窗口、Mac或安装证据；Windows／Mac两架构CI及安装各按实际后续报告验收，本轮不创建正式 Release。
