export const localRenameZh = {
  unavailable: '请选择已确认的表别名、CTE、SQLite 命名窗口或查询命名参数。',
  collision: '新名称已在当前语句中使用，可能改变绑定，请换一个名称。',
  parameterCollision: '整份草稿中已有同名参数，请换一个名称。',
  parameterTemplate: '草稿中存在同名的 [$name] 模板，无法确定它的绑定含义。',
  parameterName: '参数名须为 1～64 位 ASCII 字母、数字或下划线，首字符须为字母或下划线。',
  unresolved: '当前语句存在未确认或不同作用域的同名词，无法保证完整重命名。',
  name: '名称不能为空、包含控制字符或超出当前方言的标识符范围。',
  stale: '编辑器、语句或连接上下文已改变，请重新按 F2。',
  dismiss: '关闭重命名提示',
} as const;
