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

/** 保留真实菜单和复制处理，只隔离系统写入。 */
export async function readGridMenuClipboard(page: Page, action: Locator) {
  const capture = await page.evaluateHandle(() => {
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand'), transfers: DataTransfer[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
      if (command !== 'copy') throw Error('本例仅允许复制');
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      transfers.push(data);
      return true;
    } });
    return {
      transfers, restore() {
        if (previous) Object.defineProperty(document, 'execCommand', previous);
        else Reflect.deleteProperty(document, 'execCommand');
      },
    };
  });
  try {
    await action.click();
    return await capture.evaluate(({ transfers }) => {
      if (transfers.length !== 1) throw Error('未捕获到一次准确的菜单复制');
      return { text: transfers[0].getData('text/plain'), typed: transfers[0].getData('application/x-dbark-cells'),
        sqlite: transfers[0].getData('application/x-dbark-sqlite-cells') };
    });
  } finally {
    await capture.evaluate(port => port.restore());
    await capture.dispose();
  }
}
