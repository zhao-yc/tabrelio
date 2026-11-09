import type { Locator, Page } from '@playwright/test';

export async function gridCellCenter(cell: Locator) {
  const box = await cell.boundingBox();
  if (!box) throw Error('数据格未显示');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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

/** 隔离系统剪贴板，只向当前数据格派发粘贴事件。 */
export function pasteGridRangeClipboard(page: Page, value: string) {
  return page.evaluate(text => {
    const active = document.activeElement;
    if (active?.getAttribute('role') !== 'gridcell') throw Error('粘贴前未聚焦数据格');
    const data = new DataTransfer();
    data.setData('text/plain', text);
    active.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, value);
}
