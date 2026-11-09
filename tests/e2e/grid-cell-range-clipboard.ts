import type { Page } from '@playwright/test';

/** 在活动数据格走真实复制事件，只把系统写入替换为独立的 DataTransfer。 */
export function readGridRangeClipboard(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active?.getAttribute('role') !== 'gridcell') throw Error('复制前未聚焦数据格');
    const data = new DataTransfer();
    active.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return {
      text: data.getData('text/plain'),
      typed: data.getData('application/x-dbark-cells'),
      sqlite: data.getData('application/x-dbark-sqlite-cells'),
    };
  });
}
