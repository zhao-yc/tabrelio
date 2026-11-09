import { afterEach, expect, it, vi } from 'vitest';
import { QueryResultFindScan } from '../../src/renderer/queryResultFind';
import { QueryResultRegexWorkerClient } from '../../src/renderer/queryResultRegexWorkerClient';
import { queryResultRegexLimits as limits } from '../../src/renderer/queryResultRegexProtocol';

function fixture() {
  const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() } as
    Pick<Worker, 'onmessage' | 'onerror' | 'onmessageerror'> & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };
  const client = new QueryResultRegexWorkerClient(() => worker);
  const receive = (data: unknown) => Reflect.apply(worker.onmessage!, worker, [{ data }]);
  return { worker, client, receive };
}
afterEach(() => vi.useRealTimers());

it('正则分批发送完整原值，后续批超时会清除已经找到的命中', async () => {
  vi.useFakeTimers();
  const { worker, client, receive } = fixture();
  const long = 'x'.repeat(40000);
  const scan = new QueryResultFindScan([{ a: '值', b: '不发送' }, { a: long, b: '不发送' }],
    [{ key: 'a', name: '甲', type: 'TEXT' }, { key: 'b', name: '乙', type: 'TEXT' }], '\\D', false, () => true, 'a', 'regex', client);
  const first = scan.stepRegex();
  expect(worker.postMessage).not.toHaveBeenCalled();
  receive({ ready: true });
  expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 1, input: { query: '\\D', caseSensitive: false, values: ['值'] } });
  receive({ id: 1, result: { status: 'ready', hits: [true] } });
  expect(await first).toMatchObject({ phase: 'searching', count: 1, scannedCells: 1 });
  const second = scan.stepRegex();
  expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 2, input: { query: '\\D', caseSensitive: false, values: [long] } });
  await vi.advanceTimersByTimeAsync(limits.timeoutMs);
  expect(await second).toMatchObject({ phase: 'regex-timeout', count: 0 });
  expect(scan.match(0)).toBeUndefined();
  expect(scan.hasMatch(0, 0)).toBe(false);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('取消后迟到回包不可恢复命中，超大值在发送线程前整份拒绝', async () => {
  const { worker, client, receive } = fixture();
  const columns = [{ key: 'a', name: '原值', type: 'TEXT' }];
  const scan = new QueryResultFindScan([{ a: null }, { a: '' }, { a: { type: 'binary', base64: '' } }], columns, '^$', true, () => true, 'a', 'regex', client);
  const pending = scan.stepRegex();
  receive({ ready: true });
  expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 1, input: { query: '^$', caseSensitive: true, values: [null, '', null] } });
  const late = worker.onmessage!;
  scan.cancel();
  Reflect.apply(late, worker, [{ data: { id: 1, result: { status: 'ready', hits: [false, true, false] } } }]);
  expect(await pending).toMatchObject({ phase: 'stopped', count: 0 });
  expect(worker.terminate).toHaveBeenCalledOnce();

  const oversize = fixture();
  const blocked = new QueryResultFindScan([{ a: 'x'.repeat(limits.valueUnits + 1) }], columns, '.', true, () => true, 'a', 'regex', oversize.client);
  expect(await blocked.stepRegex()).toMatchObject({ phase: 'regex-budget', count: 0 });
  expect(oversize.worker.postMessage).not.toHaveBeenCalled();
});
