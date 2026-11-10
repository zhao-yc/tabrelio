import { expect, it, vi } from 'vitest';
import { matchingPageLimit, readMatchingPages } from '../../src/renderer/localMatchingPages';

const empty = { cursor: 'cursor', hits: [] as string[], failures: [] as string[], stoppedOnError: false };
const hasMatches = (page: typeof empty) => page.hits.length > 0;

it('跳过空批并在首个有命中的批次停止', async () => {
  const read = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, hits: ['目标'] });
  await expect(readMatchingPages(read, hasMatches, () => false)).resolves.toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
});

it('失败明细、停止策略及末尾都直接结束', async () => {
  for (const page of [{ ...empty, failures: ['错误'] }, { ...empty, stoppedOnError: true }, { ...empty, cursor: undefined }, undefined]) {
    const read = vi.fn().mockResolvedValue(page);
    await expect(readMatchingPages(read, hasMatches, () => false)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  }
});

it('空批达到上限后退出，可按用户意图在当前批结束后暂停', async () => {
  const read = vi.fn().mockResolvedValue(empty);
  await expect(readMatchingPages(read, hasMatches, () => false)).resolves.toBe('limit');
  expect(read).toHaveBeenCalledTimes(matchingPageLimit);
  read.mockClear();
  await expect(readMatchingPages(read, hasMatches, () => true)).resolves.toBe('paused');
  expect(read).toHaveBeenCalledTimes(1);
});
