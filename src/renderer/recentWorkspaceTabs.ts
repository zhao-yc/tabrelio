import type { TabOrderRef } from './tabOrder';

/** 只记活标签令牌，防止关闭后重用同一 ID 的新页被误认成访问历史。 */
export function rememberWorkspaceTab(
  history: readonly TabOrderRef[],
  tabs: readonly TabOrderRef[],
  activeTabId?: string,
): readonly TabOrderRef[] {
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  if (!active) return history.length ? [] : history;
  const liveTokens = new Set(tabs.map(tab => tab.token));
  const next = [active, ...history.filter(tab => tab.token !== active.token && liveTokens.has(tab.token))];
  return next.length === history.length && next.every((tab, index) => tab.token === history[index].token) ? history : next;
}
