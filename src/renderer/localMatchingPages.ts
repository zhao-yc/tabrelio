export const matchingPageLimit = 8;

/** 仅跳过没有命中和失败明细的批次。停读保留最后一次成功返回的游标。 */
export async function readMatchingPages<Page extends { cursor?: string; failures: readonly unknown[]; stoppedOnError: boolean }>(
  read: () => Promise<Page | undefined>, hasMatches: (page: Page) => boolean, stopped: () => boolean,
): Promise<'paused' | 'limit' | undefined> {
  for (let count = 0; count < matchingPageLimit; count++) {
    const page = await read();
    if (!page?.cursor || page.failures.length || page.stoppedOnError || hasMatches(page)) return;
    if (stopped()) return 'paused';
  }
  return 'limit';
}
