import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LocalStore } from '../../src/main/storage';
import { SavedQueryExternalEdit } from '../../src/main/savedQueryExternalEdit';
import { parseSavedQueryRecord } from '../../src/main/savedQuerySearchMatch';
import { validateCommand } from '../../src/shared/validation';

it('外部编辑原子替换副本可读，仅确认同一版本后写回原记录并保留分组', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tabrelio-saved-query-unit-'));
  const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
  const forbidden = () => { throw Error('外部编辑不需要连接凭据'); };
  const store = await LocalStore.open(join(dir, 'prefs.sqlite'), wasm, { available: () => false, encrypt: forbidden, decrypt: forbidden });
  try {
    const original = { id: 'original', name: '带分组的原查询', connectionId: 'missing-connection', database: '旧库', databaseContext: { state: 'unknown' as const }, sql: '\uFEFFSELECT 1;\r\n-- 中文', updatedAt: '2025-01-01T00:00:00.000Z' };
    store.saveQuery(original);
    const read = () => store.querySearchRaw(original.id)!;
    const ref = () => ({ id: original.id, digest: createHash('sha256').update(read()).digest('hex') });
    const group = store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'create', name: '原分组', parentId: null } });
    store.applyQueryOrganization({ expectedRevision: group.revision, operation: { kind: 'moveQueries', queries: [ref()], groupId: group.groups[0].id } });
    const launch = vi.fn(async () => true);
    const service = new SavedQueryExternalEdit({
      temp: dir, prepare: async () => launch,
      read: source => { if (source.digest !== ref().digest) throw Error('摘要已变化'); return parseSavedQueryRecord(source.id, read()); },
      update: (source, sql, check) => store.updateSavedQueryExternal(source, sql, check),
    });
    const scope = { document: {}, assertCurrent: () => {} };
    const session = await service.start(ref(), scope);
    expect(launch).toHaveBeenCalledExactlyOnceWith(session.path);
    expect((await service.preview(session.sessionId, scope)).changed).toBe(false);
    await expect(service.preview(session.sessionId, { ...scope, document: {} })).rejects.toThrow('会话已失效');
    expect(() => validateCommand('queries.externalApply', { sessionId: session.sessionId, previewId: session.sessionId, sql: '恶意 SQL' })).toThrow();

    const replacement = session.path + '.new';
    await writeFile(replacement, 'SELECT 2;\r\n-- 原子替换');
    await rename(replacement, session.path);
    const preview = await service.preview(session.sessionId, scope);
    expect(preview.changed).toBe(true);
    await writeFile(session.path, 'SELECT 3;\n-- 迟到编辑');
    await expect(service.apply(session.sessionId, preview.previewId, scope)).rejects.toThrow('预览后发生变化');
    expect(JSON.parse(read())).toEqual(original);

    const next = await service.preview(session.sessionId, scope);
    const concurrent = { ...original, name: '并发改名' };
    store.saveQuery(concurrent);
    await expect(service.apply(session.sessionId, next.previewId, scope)).rejects.toThrow('原保存查询已修改');
    expect(JSON.parse(read())).toEqual(concurrent);
    await service.keep(session.sessionId, scope);
    expect(await readFile(session.path, 'utf8')).toBe('SELECT 3;\n-- 迟到编辑');

    const latest = await service.start(ref(), scope);
    const sql = 'SELECT 4;\r\n-- 核对精确全文';
    await writeFile(latest.path, sql);
    const reviewed = await service.preview(latest.sessionId, scope);
    expect(await service.apply(latest.sessionId, reviewed.previewId, scope)).toEqual({ cleanupPending: false });
    expect(JSON.parse(read())).toEqual({ ...concurrent, sql, updatedAt: expect.any(String) });
    expect(store.queryOrganization().groups[0]).toMatchObject({ id: group.groups[0].id, count: 1 });
    await expect(readFile(latest.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
