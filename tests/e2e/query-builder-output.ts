import { expect, type Locator } from '@playwright/test';
import { queryBuilderOutputZh as text } from '../../src/renderer/locales/queryBuilderOutput.zh-CN';

/** 只捕获本窗口的复制事件，系统剪贴板始终保持原内容。 */
export async function expectCopiedBuilderSql(builder: Locator, sql: string) {
  const page = builder.page();
  await builder.evaluate(element => {
    if (Object.hasOwn(document, 'execCommand')) throw Error('已有其它复制捕获');
    const packets: Record<string, string>[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
      if (command !== 'copy' || !element.isConnected) throw Error('复制不属于当前构建器');
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      packets.push(Object.fromEntries(data.types.map(type => [type, data.getData(type)])));
      return true;
    } });
    Object.assign(globalThis, { readBuilderCopy: () => packets });
  });
  try {
    await builder.getByRole('button', { name: text.copy, exact: true }).click();
    await expect(builder.getByText(text.copied, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (globalThis as typeof globalThis & {
      readBuilderCopy(): Record<string, string>[];
    }).readBuilderCopy())).toEqual([{ 'text/plain': sql }]);
  } finally {
    await page.evaluate(() => { Reflect.deleteProperty(document, 'execCommand'); Reflect.deleteProperty(globalThis, 'readBuilderCopy'); });
  }
}
