import { expect, page } from './desktop-fixture';

/** 在真实查询编辑器和持久化工作区中核对 SQL、原连接及新标签身份。 */
export async function expectPrimaryKeyQueryDraft(parentId: string, sql: string) {
  const editor = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await expect(editor).toBeVisible();
  await expect(editor).toBeEditable();
  await expect.poll(async () => {
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const parent = settings.tabs.find(tab => tab.id === parentId);
    const draft = settings.tabs.find(tab => tab.id === settings.activeTabId);
    if (!parent || !draft || !parent.database) return false;
    return draft.id !== parent.id && draft.kind === 'query' && draft.connectionId === parent.connectionId &&
      draft.database === parent.database && draft.databaseContext?.state === 'known' &&
      draft.databaseContext.database === parent.database && draft.sql === sql;
  }).toBe(true);
}
