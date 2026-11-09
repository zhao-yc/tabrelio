import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SavedQuery } from '../shared/contracts';
import { queryFileTextDifference } from '../shared/queryFileReload';
import { savedQueryExternalZh as text, type SavedQueryExternalPreview, type SavedQueryExternalReceipt, type SavedQueryExternalSession } from '../shared/savedQueryExternalEdit';
import type { SavedQueryReadTextInput } from '../shared/savedQuerySearch';
import { decodeQueryFile, encodeQueryFile, queryFileLimit, writeQueryFileBytes } from './queryFiles';
import { queryFileParent, readReloadableQueryFile, sameQueryFileParent, type QueryFileParentIdentity } from './queryFileReloadFiles';
import { queryFileIsMissing } from './queryFileSourceFiles';
import type { QueryFileSourceScope } from './queryFileSources';
import { externalSqlEditorZh } from '../shared/externalSqlEditor';

interface Session extends SavedQueryExternalSession {
  document: object;
  source: SavedQueryReadTextInput;
  parent: QueryFileParentIdentity;
  preview?: { id: string; digest: string };
  committed: boolean;
}
interface Host {
  temp: string;
  read(source: SavedQueryReadTextInput): SavedQuery;
  update(source: SavedQueryReadTextInput, sql: string, check: () => void): void;
  prepare(): Promise<(path: string) => Promise<boolean>>;
}

/** 单个本地编辑会话。只有私有目录及原查询摘要来自 Main，渲染层仅持不透明会话和预览编号。 */
export class SavedQueryExternalEdit {
  private active?: Session;
  private busy = false;

  constructor(private readonly host: Host) {}

  hasSession(): boolean { return !!this.active || this.busy; }

  /** 换页或渲染进程崩溃撤销写回授权。副本保留供外部编辑器另存。 */
  orphan(): void { this.active = undefined; }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw Error(text.busy);
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  async start(source: SavedQueryReadTextInput, scope: QueryFileSourceScope): Promise<SavedQueryExternalSession> {
    return this.run(async () => {
      scope.assertCurrent();
      if (this.active) throw Error(text.busy);
      const query = this.host.read(source), body = encodeQueryFile(query.sql, 'utf8');
      // 原 SQL 首字符为 U+FEFF 时额外标记文件 BOM，读回才能区分标记和正文。
      const bytes = query.sql.startsWith('\uFEFF') ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
      if (bytes.length > queryFileLimit) throw Error(text.startFailed);
      const launch = await this.host.prepare();
      scope.assertCurrent();
      let directory: string | undefined, launched = false;
      try {
        const temp = await realpath(this.host.temp);
        scope.assertCurrent();
        directory = await mkdtemp(join(temp, 'tabrelio-saved-query-'));
        const path = join(directory, '编辑副本.sql'), sessionId = randomUUID();
        const check = () => scope.assertCurrent();
        const parent = await queryFileParent(path, check);
        await writeQueryFileBytes(path, bytes, check);
        check();
        this.host.read(source);
        launched = await launch(path);
        if (!launched) throw Error(externalSqlEditorZh.launchFailed);
        check();
        this.active = { sessionId, name: query.name, path, source, document: scope.document, parent, committed: false };
        return { sessionId, name: query.name, path };
      } catch (error) {
        if (directory && !launched) await rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  private owned(id: string, scope: QueryFileSourceScope): Session {
    scope.assertCurrent();
    const session = this.active;
    if (!session || session.document !== scope.document || session.sessionId !== id) throw Error(text.expired);
    return session;
  }

  private async snapshot(session: Session, check: () => void) {
    try {
      const parent = await queryFileParent(session.path, check);
      if (!sameQueryFileParent(parent, session.parent)) throw Error(text.readFailed);
      const snapshot = await readReloadableQueryFile(session.path, check);
      if (!sameQueryFileParent(snapshot.parent, session.parent)) throw Error(text.readFailed);
      return snapshot;
    } catch { check(); throw Error(text.readFailed); }
  }

  async preview(id: string, scope: QueryFileSourceScope): Promise<SavedQueryExternalPreview> {
    return this.run(async () => {
      const session = this.owned(id, scope), check = () => { this.owned(id, scope); };
      if (session.committed) throw Error(text.expired);
      session.preview = undefined;
      const snapshot = await this.snapshot(session, check);
      const original = this.host.read(session.source).sql, next = decodeQueryFile(snapshot.bytes, 'utf8').sql;
      const previewId = randomUUID(), changed = original !== next;
      if (changed) session.preview = { id: previewId, digest: snapshot.digest };
      return { previewId, changed, difference: queryFileTextDifference(original, next) };
    });
  }

  async apply(id: string, previewId: string, scope: QueryFileSourceScope): Promise<SavedQueryExternalReceipt> {
    return this.run(async () => {
      const session = this.owned(id, scope), check = () => { this.owned(id, scope); };
      const preview = session.preview;
      if (session.committed || preview?.id !== previewId) throw Error(text.changed);
      session.preview = undefined;
      const snapshot = await this.snapshot(session, check);
      if (snapshot.digest !== preview.digest) throw Error(text.changed);
      this.host.update(session.source, decodeQueryFile(snapshot.bytes, 'utf8').sql, check);
      session.committed = true;
      // 已持久化后清理失败只能报告待清理，不能把成功回执改成可重试的写入失败。
      try { await this.clean(session, check); return { cleanupPending: false }; }
      catch { return { cleanupPending: true }; }
    });
  }

  async discard(id: string, scope: QueryFileSourceScope): Promise<void> {
    return this.run(async () => {
      const session = this.owned(id, scope);
      await this.clean(session, () => { this.owned(id, scope); });
    });
  }

  async keep(id: string, scope: QueryFileSourceScope): Promise<void> {
    return this.run(async () => { this.owned(id, scope); this.active = undefined; });
  }

  private async clean(session: Session, check: () => void): Promise<void> {
    try {
      const parent = await queryFileParent(session.path, check).catch(error => {
        if (queryFileIsMissing(error)) return undefined;
        throw error;
      });
      if (parent && !sameQueryFileParent(session.parent, parent)) throw Error(text.cleanupFailed);
      check();
      if (parent) await rm(dirname(session.path), { recursive: true, force: true });
      if (this.active === session) this.active = undefined;
    } catch { throw Error(text.cleanupFailed); }
  }
}
