import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ExternalSqlEditor } from '../../src/main/externalSqlEditor';
import { validateCommand } from '../../src/shared/validation';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async importOriginal => ({ ...(await importOriginal<typeof import('node:child_process')>()), spawn }));

it('Windows 编辑器由原生选择授权，SQL 路径按单参数传递且清除后拒绝迟到启动', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-editor-'));
  try {
    const executable = join(directory, '测试 编辑器.exe');
    const sql = join(directory, '文件 & 测试.sql');
    await writeFile(executable, '');
    let stored: string | null = null, choice: string | undefined = executable;
    const editor = new ExternalSqlEditor({
      externalSqlEditorPath: () => stored,
      setExternalSqlEditorPath: (path, check) => { check(); stored = path; },
    }, async () => choice, 'win32');
    const current = () => {};
    expect(() => validateCommand('externalSqlEditor.choose', { path: executable })).toThrow();
    expect(() => validateCommand('queryFileSources.handoff', { tabId: 'one', source: { id: 'b8e937d8-2dc2-4a84-b30d-54316215a738', revision: 1 }, action: 'edit', editor: executable })).toThrow();
    const chosen = await editor.choose(current);
    expect(chosen.path).toBe(await realpath(executable));
    choice = join(directory, '恶意命令.cmd');
    await writeFile(choice, '');
    await expect(editor.choose(current)).rejects.toThrow(/所选编辑器不可用/);
    expect(editor.status()).toEqual(chosen);

    const open = await editor.prepare();
    const unref = vi.fn();
    const child = Object.assign(new EventEmitter(), { unref });
    spawn.mockReturnValueOnce(child);
    const result = open(sql);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(chosen.path, [sql], { shell: false, detached: true, stdio: 'ignore' });
    child.emit('spawn');
    await expect(result).resolves.toBe(true);
    expect(unref).toHaveBeenCalledOnce();
    editor.clear(current);
    expect(() => open(sql)).toThrow(/设置已变化/);
    expect(spawn).toHaveBeenCalledOnce();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
