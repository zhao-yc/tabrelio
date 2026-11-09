import { execFile, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import type { LocalStore } from './storage';
import { externalSqlEditorZh as text, type ExternalSqlEditorView } from '../shared/externalSqlEditor';
import { QueryFileSourceFailure } from './queryFileSourceFiles';

type EditorPlatform = 'darwin' | 'win32';
type EditorStore = Pick<LocalStore, 'externalSqlEditorPath' | 'setExternalSqlEditorPath'>;

/** 编辑器授权和工作区设置分开。只有原生选择能写入路径，启动参数只来自已复核的 SQL 文件。 */
export class ExternalSqlEditor {
  private choosing = false;
  private readonly platform: EditorPlatform | undefined;

  constructor(private readonly store: EditorStore, private readonly choosePath: (platform: EditorPlatform) => Promise<string | undefined>, platform = process.platform) {
    this.platform = platform === 'darwin' || platform === 'win32' ? platform : undefined;
  }

  status(): ExternalSqlEditorView {
    return { supported: !!this.platform, path: this.platform ? this.store.externalSqlEditorPath() : null };
  }

  async choose(assertCurrent: () => void): Promise<ExternalSqlEditorView> {
    if (!this.platform) throw Error(text.unsupported);
    if (this.choosing) throw Error(text.changed);
    this.choosing = true;
    try {
      assertCurrent();
      const choice = await this.choosePath(this.platform);
      assertCurrent();
      if (choice === undefined) return this.status();
      const canonical = await this.verify(choice);
      assertCurrent();
      this.store.setExternalSqlEditorPath(canonical, assertCurrent);
      return this.status();
    } finally { this.choosing = false; }
  }

  clear(assertCurrent: () => void): ExternalSqlEditorView {
    if (!this.platform) throw Error(text.unsupported);
    assertCurrent();
    if (this.choosing) throw Error(text.changed);
    this.store.setExternalSqlEditorPath(null, assertCurrent);
    return this.status();
  }

  /** 从选择器规范化路径；启动前再次核实，防止新符号链接把启动目标转到别处。 */
  private async verify(path: string): Promise<string> {
    try {
      const mac = this.platform === 'darwin', extension = mac ? '.app' : '.exe';
      if (!isAbsolute(path) || extname(path).toLowerCase() !== extension) throw Error();
      const canonical = await realpath(path);
      const stat = await lstat(canonical);
      if (extname(canonical).toLowerCase() !== extension || !(mac ? stat.isDirectory() : stat.isFile())) throw Error();
      return canonical;
    } catch { throw new QueryFileSourceFailure('permission', text.invalid); }
  }

  /** 在文件身份复核之前准备应用，待文件复核后只同步检查配置并发出启动请求。 */
  async prepare(): Promise<(path: string) => Promise<boolean>> {
    const { supported, path } = this.status();
    if (!supported) throw new QueryFileSourceFailure('io', text.unsupported);
    if (!path) throw new QueryFileSourceFailure('io', text.configureFirst);
    if (await this.verify(path) !== path) throw new QueryFileSourceFailure('permission', text.invalid);
    return sqlFile => {
      if (this.status().path !== path) throw new QueryFileSourceFailure('document-changed', text.changed);
      return this.platform === 'darwin'
        ? new Promise(resolve => execFile('/usr/bin/open', ['-a', path, sqlFile], { shell: false }, error => resolve(!error)))
        : new Promise(resolve => {
          // 参数独立传递，避免 Windows Shell、批处理及调用方拼接命令。应用成功创建后独立运行。
          const child = spawn(path, [sqlFile], { shell: false, detached: true, stdio: 'ignore' });
          child.on('error', () => resolve(false));
          child.once('spawn', () => { child.unref(); resolve(true); });
        });
    };
  }
}
