/** 查询复制只新建独立草稿，不经过系统剪贴板或保存查询来源。 */
export const queryDuplicateZh = {
  action: '复制为新查询', hint: '复制当前 SQL 和明确数据库上下文，另建未保存的独立查询', suffix: '（副本）',
  targetAction: '在指定连接打开副本', targetHint: '只复制当前 SQL。选定连接和数据库后打开独立草稿，由你决定何时执行。',
  targetConnection: '目标连接', targetDatabase: '目标数据库', targetPlaceholder: '请选择目标连接',
  targetNoDatabase: '留空表示不选择默认数据库', targetRead: '读取目标库列表', targetOpen: '打开查询副本',
  targetChanged: '目标连接已变化，请重新选择。', targetDatabaseInvalid: '目标数据库名称无效。',
  selection: '从选区打开新查询', selectionHint: '将当前选中的 SQL 原文放入独立查询草稿，沿用原连接和数据库',
  selectionSuffix: '（选区）', selectionRequired: '请选择一段非空 SQL，再打开新查询。',
  statementHint: '按光标定位语句并打开独立草稿，沿用原连接和数据库',
  statementSuffix: '（当前语句）',
  statementsSuffix: '（勾选语句）',
  unavailable: '当前查询不可复制，请等待编辑器就绪并确认连接仍有效。',
  changed: '原查询、连接或编辑器已变化，本次未新建查询，请重新复制。',
  contextUnknown: '当前默认库尚未明确，请先确认数据库上下文再复制查询。',
  tooLarge: '当前 SQL 超过查询草稿大小限制，未新建查询。',
  tooMany: '查询标签数量已达上限，请先关闭不需要的标签。',
} as const;
