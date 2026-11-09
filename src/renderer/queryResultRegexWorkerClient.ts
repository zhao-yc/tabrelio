import { queryResultRegexLimits as limits, type QueryResultRegexInput, type QueryResultRegexResult } from './queryResultRegexProtocol';

type WorkerPort = Pick<Worker, 'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'>;
interface Batch { id: number; input: QueryResultRegexInput; resolve(result: QueryResultRegexResult): void; }

/** 一个查找占用一个线程，分批往返。改条件、失效或超时立即终止原线程。 */
export class QueryResultRegexWorkerClient {
  private worker?: WorkerPort;
  private pending?: Batch;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private disposed = false;
  private sequence = 0;
  constructor(private readonly create: () => WorkerPort) {}

  run(input: QueryResultRegexInput): Promise<QueryResultRegexResult> {
    if (this.disposed || this.pending) return Promise.resolve({ status: 'cancelled' });
    return new Promise(resolve => {
      this.pending = { id: ++this.sequence, input, resolve };
      try {
        if (this.worker) { this.send(); return; }
        const worker = this.create();
        this.worker = worker;
        this.timer = setTimeout(() => this.finish({ status: 'timeout' }), limits.startupMs);
        worker.onmessage = event => {
          const batch = this.pending, value = event.data;
          if (!batch || this.worker !== worker) return;
          if (!this.ready && value?.ready === true) { this.ready = true; this.send(); return; }
          const result = value?.result;
          if (!this.ready || value?.id !== batch.id) { this.finish({ status: 'worker' }); return; }
          if (result?.status === 'invalid') { this.finish({ status: 'invalid' }); return; }
          if (result?.status !== 'ready' || !Array.isArray(result.hits) || result.hits.length !== batch.input.values.length ||
            Array.from(result.hits).some(hit => typeof hit !== 'boolean')) { this.finish({ status: 'worker' }); return; }
          this.finish({ status: 'ready', hits: result.hits });
        };
        worker.onerror = event => { event.preventDefault(); this.finish({ status: 'worker' }); };
        worker.onmessageerror = () => this.finish({ status: 'worker' });
      } catch { this.finish({ status: 'worker' }); }
    });
  }

  private send(): void {
    const batch = this.pending;
    if (!batch || !this.worker) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish({ status: 'timeout' }), limits.timeoutMs);
    try { this.worker.postMessage({ id: batch.id, input: batch.input }); }
    catch { this.finish({ status: 'worker' }); }
  }

  private finish(result: QueryResultRegexResult): void {
    const batch = this.pending;
    this.pending = undefined;
    clearTimeout(this.timer);
    if (result.status !== 'ready') {
      this.disposed = true;
      const worker = this.worker;
      this.worker = undefined;
      if (worker) {
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
        try { worker.terminate(); } catch { result = { status: 'worker' }; }
      }
    }
    batch?.resolve(result);
  }

  dispose(): void { this.finish({ status: 'cancelled' }); }
}
