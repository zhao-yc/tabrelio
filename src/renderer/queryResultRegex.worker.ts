import { queryResultRegexLimits, type QueryResultRegexInput, type QueryResultRegexResult } from './queryResultRegexProtocol';

/** 用户正则只在线程里编译和匹配。每格只回传一个布尔值，零宽命中也无需反复推进。 */
self.onmessage = (event: MessageEvent<{ id: number; input: QueryResultRegexInput }>) => {
  const { id, input } = event.data ?? {};
  let units = 0;
  if (!Number.isSafeInteger(id) || typeof input?.query !== 'string' || !input.query || input.query.length > 256 ||
    typeof input.caseSensitive !== 'boolean' || !Array.isArray(input.values) || input.values.length > queryResultRegexLimits.batchCells ||
    input.values.some(value => value !== null && (typeof value !== 'string' || (units += value.length) > queryResultRegexLimits.valueUnits))) {
    self.postMessage({ id, result: { status: 'worker' } });
    return;
  }
  let result: QueryResultRegexResult;
  try {
    const expression = new RegExp(input.query, input.caseSensitive ? 'u' : 'iu');
    result = { status: 'ready', hits: input.values.map(value => value !== null && expression.test(value)) };
  } catch { result = { status: 'invalid' }; }
  self.postMessage({ id, result });
};
self.postMessage({ ready: true });
