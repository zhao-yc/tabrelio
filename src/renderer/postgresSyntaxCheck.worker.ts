import { loadModule } from 'libpg-query';
import wasm from 'libpg-query/wasm/libpg-query.wasm?url&inline';
import { checkPostgresSyntax } from '../shared/postgresSyntaxCheck';

// WASM 随应用打包，线程无需请求外部地址，也不能访问查询会话或凭据。
const bytes = Uint8Array.from(atob(wasm.slice(wasm.indexOf(',') + 1)), value => value.charCodeAt(0));
void loadModule({ wasm: bytes }).then(
  () => self.postMessage({ type: 'dbark-postgres-syntax-ready', version: 1 }),
  () => self.postMessage({ type: 'dbark-postgres-syntax-unavailable', version: 1 }),
);

self.onmessage = (event: MessageEvent<{id: number; source: string; mode?: {noBackslashEscapes?: boolean}}>) => {
  const input = event.data;
  if (input?.id !== 1) return;
  self.postMessage({ id: input.id, result: checkPostgresSyntax(input.source, input.mode?.noBackslashEscapes) });
};
