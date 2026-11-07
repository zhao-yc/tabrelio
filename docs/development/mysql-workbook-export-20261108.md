# 将 MySQL 或 MariaDB 的多个对象导出到同一本 Excel

在同一数据库的表或视图列表点击「导出多个对象到 Excel」，勾选 2 至 64 个 InnoDB 表或视图。每个对象占一张工作表，按勾选顺序排列。Excel 不允许的字符会替换，过长名称会截短，重名会加序号，空表仍保留标题。

导出完整可读取的行和字段。InnoDB 表共用同一可重复读只读快照，导出期间持有原对象的元数据锁。视图沿用当前账号可读取的定义及数据权限，视图访问的非事务数据源由其底层引擎决定。精确数值按文本输出，NULL 和 BLOB 沿用 tabrelio 可逆文本协议。

全部工作表读完且连接正常关闭后才替换目标文件。取消、字段超出 Excel 限制或读取失败时，保留原目标文件。当前入口覆盖同库对象的全量导出，逐对象筛选、投影和多个数据库的合并仍待接入。[Navicat 导出向导](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/export_wizard.html)
