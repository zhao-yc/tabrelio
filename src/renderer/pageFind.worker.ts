import { postgresTableLimits } from '../shared/postgresTableLimits';
import { assertPageFindTransfer, findPageCellsInWorker, pageFindLimits, previewPageReplacementInWorker, previewTextReplacementInWorker } from './pageFindReplace';
import type { PageFindRequest, PageFindResult } from './pageFindWorkerClient';
import { tableGridZh as text } from './locales/tableGrid.zh-CN';

/** 线程只接收有界本地页面，不访问网络、数据库、IPC 或凭据；主线程负责实际终止时限。 */
self.onmessage = (event: MessageEvent<{ id: number; request: PageFindRequest }>) => {
  const { id, request } = event.data ?? {};
  let result: PageFindResult;
  try {
    if (!Number.isSafeInteger(id) || id < 1 || !request || !['find', 'preview', 'previewText'].includes(request.operation) || !Array.isArray(request.rows) || !Array.isArray(request.keys) || request.keys.some(key => typeof key !== 'string') || !Number.isSafeInteger(request.generation)) throw new Error(text.budget);
    const options = request.options;
    if (!options || !['text', 'empty', 'null', 'default'].includes(options.kind) || typeof options.query !== 'string' || options.query.length > pageFindLimits.query || typeof options.caseSensitive !== 'boolean' || typeof options.wholeCell !== 'boolean' || (options.regex !== undefined && typeof options.regex !== 'boolean') || (options.captureReplacement !== undefined && typeof options.captureReplacement !== 'boolean') || (options.column !== undefined && typeof options.column !== 'string')) throw new Error(text.budget);
    if (options.edge !== undefined && (options.edge !== 'start' && options.edge !== 'end' || options.wholeCell || options.kind !== 'text')) throw new Error(text.budget);
    assertPageFindTransfer(request);
    if (request.operation === 'find') result = { status: 'ready', operation: 'find', matches: findPageCellsInWorker(request.rows, request.keys, options) };
    else {
      if (typeof request.replacement !== 'string' || request.replacement.length > pageFindLimits.replacement) throw new Error(text.budget);
      if (request.operation === 'previewText') {
        result = { status: 'ready', operation: 'previewText', patches: previewTextReplacementInWorker(request.rows, request.keys, options, request.replacement, postgresTableLimits, request.only) };
      } else {
        if (!request.info) throw new Error(text.budget);
        result = { status: 'ready', operation: 'preview', preview: previewPageReplacementInWorker(request.rows, request.keys, options, request.replacement, request.info, request.generation, request.only) };
      }
    }
    assertPageFindTransfer(result);
  } catch (reason) { result = { status: 'blocked', reason: 'invalid', message: reason instanceof Error ? reason.message : text.workerFailed }; }
  self.postMessage({ id, result });
};
self.postMessage({ type: 'dbark-page-find-ready', version: 1 });
