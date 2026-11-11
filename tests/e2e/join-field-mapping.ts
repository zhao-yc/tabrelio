import { expect, type Locator } from '@playwright/test';
import { queryBuilderJoinZh as text } from '../../src/renderer/locales/queryBuilderJoin.zh-CN';

/** 在打开的关联面板选择具体来源。相同字段名按两侧及来源分别定位。 */
export async function linkJoinFields(step: Locator, source: number, left: string, right: string, method: 'drag' | 'keyboard') {
  const toggle = step.getByRole('button', { name: text.fieldMapping, exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const panel = step.getByRole('region', { name: text.fieldMapping, exact: true });
  await panel.getByRole('combobox', { name: text.mappingSource, exact: true }).selectOption(String(source));
  const from = panel.getByRole('group').nth(0).getByRole('button', { name: left, exact: true });
  const to = panel.getByRole('group').nth(1).getByRole('button', { name: right, exact: true });
  if (method === 'drag') await from.dragTo(to);
  else {
    await from.press('Enter');
    await expect(panel.getByRole('searchbox', { name: text.mappingRightSearch, exact: true })).toBeFocused();
    await to.press('Enter');
  }
  await expect(panel.getByRole('status')).toHaveText(text.mappingAdded(left, right));
  return panel;
}
