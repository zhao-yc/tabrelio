import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { SavedQuery } from '../shared/contracts';
import { queryFileTextDifference } from '../shared/queryFileReload';
import { savedQueryExternalZh as text, type SavedQueryExternalPreview, type SavedQueryExternalReceipt, type SavedQueryExternalSession } from '../shared/savedQueryExternalEdit';
import { savedQueryReadTextSchema, type SavedQueryReadTextInput } from '../shared/savedQuerySearch';
import { decodeQueryFile, encodeQueryFile, queryFileLimit, writeQueryFileBytes } from './queryFiles';
import { queryFileParent, readReloadableQueryFile, sameQueryFileParent } from './queryFileReloadFiles';
import { queryFileIsMissing } from './queryFileSourceFiles';
import type { QueryFileSourceScope } from './queryFileSources';
import { externalSqlEditorZh } from '../shared/externalSqlEditor';

const copyName = '编辑副本.sql', directoryPrefix = 'tabrelio-saved-query-';
export const savedQueryExternalRecordSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(1024),
  path: z.string().max(32768).refine(isAbsolute),
  source: savedQueryReadTextSchema,
  parent: z.object({ path: z.string().max(32768).refine(isAbsolute), dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^[1-9]\d*$/) }).strict(),
  committed: z.boolean(),
}).strict().refine(record => record.path === join(record.parent.path, copyName)
  && basename(record.parent.path).startsWith(directoryPrefix)
  && /^[a-z\d]{6}$/i.test(basename(record.parent.path).slice(directoryPrefix.length)), text.readFailed);
export type SavedQueryExternalRecord = z.infer<typeof savedQueryExternalRecordSchema>;

interface Session extends SavedQueryExternalRecord {
  sessionId: string;
  document: object;
  preview?: { id: string; digest: string };
}
interface Host {
  temp: string;
  read(source: SavedQueryReadTextInput): SavedQuery;
  recovery(): SavedQueryExternalRecord | undefined;
  saveRecovery(record: SavedQueryExternalRecord | null, check: () => void): void;
  update(record: SavedQueryExternalRecord, sql: string, check: () => void): void;
  prepare(): Promise<(path: string) => Promise<boolean>>;
}

/** 单个本地编辑会话。只有私有目录及原查询摘要来自 Main，渲染层仅持不透明会话和预览编号。 */
export class SavedQueryExternalEdit {
  private active?: Session;
  private busy = false;

  constructor(private readonly host: Host) {}

  hasSession(): boolean { return !!this.active || this.busy; }

  /** 换页只撤销文档与预览凭据，副本仍可从本地记录显式恢复。 */
  orphan(): void { this.active = undefined; }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw Error(text.busy);
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  private attach(record: SavedQueryExternalRecord, scope: QueryFileSourceScope, launchFailed = false): SavedQueryExternalSession {
    scope.assertCurrent();
    const sessionId = randomUUID();
    this.active = { ...record, sessionId, document: scope.document };
    return { sessionId, queryId: record.source.id, name: record.name, path: record.path, committed: record.committed, ...(launchFailed ? { launchFailed } : {}) };
  }

  /** 恢复只发新的文档会话，不复用重启前的预览，也不自动打开编辑器。 */
  async resume(scope: QueryFileSourceScope): Promise<SavedQueryExternalSession | null> {
    return this.run(async () => {
      scope.assertCurrent();
      const record = this.host.recovery();
      return record ? this.attach(record, scope) : null;
    });
  }

  async start(source: SavedQueryReadTextInput, scope: QueryFileSourceScope): Promise<SavedQueryExternalSession> {
    return this.run(async () => {
      scope.assertCurrent();
      if (this.active || this.host.recovery()) throw Error(text.busy);
      const query = this.host.read(source), body = encodeQueryFile(query.sql, 'utf8');
      // 原 SQL 首字符为 U+FEFF 时额外标记文件 BOM，读回才能区分标记和正文。
      const bytes = query.sql.startsWith('\uFEFF') ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
      if (bytes.length > queryFileLimit) throw Error(text.startFailed);
      const launch = await this.host.prepare();
      scope.assertCurrent();
      let directory: string | undefined, recoverable = false;
      try {
        const temp = await realpath(this.host.temp);
        scope.assertCurrent();
        directory = await mkdtemp(join(temp, directoryPrefix));
        const path = join(directory, copyName);
        const check = () => scope.assertCurrent();
        const parent = await queryFileParent(path, check);
        await writeQueryFileBytes(path, bytes, check);
        check();
        this.host.read(source);
        const record = { version: 1, name: query.name, path, source, parent, committed: false } as const;
        this.host.saveRecovery(record, check);
        recoverable = true;
        let launched = false;
        try { launched = await launch(path); } catch { /* 启动失败仍提供已持久化副本。 */ }
        return this.attach(record, scope, !launched);
      } catch (error) {
        if (directory && !recoverable) await rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async reopen(id: string, scope: QueryFileSourceScope): Promise<void> {
    return this.run(async () => {
      const session = this.owned(id, scope), check = () => { this.owned(id, scope); };
      if (session.committed) throw Error(text.expired);
      const launch = await this.host.prepare();
      await this.snapshot(session, check);
      check();
      if (!await launch(session.path)) throw Error(externalSqlEditorZh.launchFailed);
    });
  }

  /** 磁盘操作只使用当前系统临时目录中的原私有目录，不跟随移走的目录或符号链接。 */
  private async assertTempRoot(session: Session, check: () => void): Promise<void> {
    const root = await realpath(this.host.temp);
    check();
    if (dirname(session.parent.path) !== root) throw Error(text.readFailed);
  }

  private owned(id: string, scope: QueryFileSourceScope): Session {
    scope.assertCurrent();
    const session = this.active;
    if (!session || session.document !== scope.document || session.sessionId !== id) throw Error(text.expired);
    return session;
  }

  private async snapshot(session: Session, check: () => void) {
    try {
      await this.assertTempRoot(session, check);
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
      const { version, name, path, source, parent } = session;
      this.host.update({ version, name, path, source, parent, committed: true }, decodeQueryFile(snapshot.bytes, 'utf8').sql, check);
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
    return this.run(async () => {
      this.owned(id, scope);
      this.host.saveRecovery(null, () => { this.owned(id, scope); });
      this.active = undefined;
    });
  }

  private async clean(session: Session, check: () => void): Promise<void> {
    try {
      await this.assertTempRoot(session, check);
      const parent = await queryFileParent(session.path, check).catch(error => {
        if (queryFileIsMissing(error)) return undefined;
        throw error;
      });
      if (parent && !sameQueryFileParent(session.parent, parent)) throw Error(text.cleanupFailed);
      check();
      if (parent) await rm(dirname(session.path), { recursive: true, force: true });
      this.host.saveRecovery(null, check);
      if (this.active === session) this.active = undefined;
    } catch { throw Error(text.cleanupFailed); }
  }
}
