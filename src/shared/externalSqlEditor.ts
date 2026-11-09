export interface ExternalSqlEditorView {
  supported: boolean;
  path: string | null;
}

export const externalSqlEditorZh = {
  title: '外部 SQL 编辑器',
  choose: '选择外部编辑器',
  clear: '清除外部编辑器',
  close: '关闭',
  unconfigured: '尚未配置外部 SQL 编辑器。',
  configureFirst: '请先在「文件 → 外部 SQL 编辑器」选择应用。',
  unsupported: '当前系统不支持配置外部 SQL 编辑器。',
  invalid: '所选编辑器不可用。请在 macOS 选择 .app，或在 Windows 选择 .exe。',
  changed: '外部编辑器设置已变化，请重新发起操作。',
  launchFailed: '系统未能启动外部 SQL 编辑器，请检查应用或重新选择。',
  readFailed: '外部 SQL 编辑器设置读取失败。',
  saveFailed: '外部 SQL 编辑器设置保存失败。',
  hint: '设置只保存在本机。查询标签中的「用外部编辑器打开」会将已关联的磁盘文件交给所选应用。',
  draftHint: '标签草稿会继续保留。外部编辑完成后，可回到标签检查源文件变更。',
  requested: '已请求外部编辑器打开 SQL 文件。',
  picker: '选择用于打开 SQL 文件的外部编辑器',
} as const;
