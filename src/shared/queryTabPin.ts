/** 固定只属于查询标签，缺项兼容旧工作台；显式值必须是自有布尔字段。 */
export function assertQueryTabPinWrite(settings: { tabs?: unknown }): void {
  if (!Array.isArray(settings.tabs)) return;
  for (const tab of settings.tabs) {
    if (!tab || typeof tab !== 'object' || !('queryPinned' in tab)) continue;
    const pin = Object.getOwnPropertyDescriptor(tab, 'queryPinned');
    if (tab.kind !== 'query' || !pin?.enumerable || !('value' in pin) || typeof pin.value !== 'boolean') {
      throw Error('只有查询标签可以保存布尔固定状态');
    }
  }
}
