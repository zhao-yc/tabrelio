import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectPostgresNativeTool } from '../../src/engine/postgres/nativeTool';
import { postgresDatabaseBackupChooseSchema, postgresDatabaseBackupExecuteSchema, postgresDatabaseBackupToolSchema, postgresDumpSelection } from '../../src/shared/postgresDatabaseBackup';

it('备份 IPC 只接受来源和能力令牌，拒绝命令行、工具路径和凭据注入', () => {
  const fileToken = 'e2e2662b-9a3b-4606-a3e5-e18f53310020', toolToken = '7674d54f-8ab7-4718-a3d1-df39314bdfbb';
  const request = { connectionId: '已保存连接', database: '来源数据库', portable: false, fileToken, toolToken, taskId: '原任务' };
  expect(postgresDatabaseBackupExecuteSchema.parse(request)).toEqual(request);
  expect(postgresDatabaseBackupToolSchema.safeParse({ path: '/tmp/pg_dump' }).success).toBe(false);
  for (const extra of [{ filePath: '/tmp/output.sql' }, { tool: { path: '/tmp/pg_dump' } }, { args: ['--file=output'] }, { password: '凭据' }])
    expect(postgresDatabaseBackupExecuteSchema.safeParse({ ...request, ...extra }).success).toBe(false);
});

it('指定 Schema 必须非空且唯一，并逐字转义 pg_dump 模式', () => {
  const selected = { name: '范围.*"区', stamp: 'a'.repeat(64) };
  const input = { connectionId: '连接', database: '库', portable: false, content: 'schema',
    toolToken: '7674d54f-8ab7-4718-a3d1-df39314bdfbb', schemas: [selected] };
  expect(postgresDumpSelection(postgresDatabaseBackupChooseSchema.parse(input)))
    .toEqual(['--schema-only', '--strict-names', '--schema="范围.*""区"']);
  expect(postgresDumpSelection({ content: 'data' })).toEqual(['--data-only']);
  expect(postgresDumpSelection({})).toEqual([]);
  for (const schemas of [[], [selected, selected], [{ ...selected, stamp: 'bad' }], [{ ...selected, sql: 'SELECT 1' }]])
    expect(postgresDatabaseBackupChooseSchema.safeParse({ ...input, schemas }).success).toBe(false);
});

it('指定关系逐段引用限定名，允许跨 Schema 同名并拒绝混用范围', () => {
  const relation = { schema: '区域.a', name: '表.*"?', stamp: 'b'.repeat(64) };
  const second = { ...relation, schema: '区域' };
  const input = { connectionId: '连接', database: '库', portable: false, content: 'data',
    toolToken: '7674d54f-8ab7-4718-a3d1-df39314bdfbb', relations: [relation, second] };
  expect(postgresDumpSelection(postgresDatabaseBackupChooseSchema.parse(input)))
    .toEqual(['--data-only', '--strict-names', '--table="区域.a"."表.*""?"', '--table="区域"."表.*""?"']);
  for (const relations of [[], [relation, relation], [{ ...relation, schema: '' }], [{ ...relation, name: 'a\0b' }], [{ ...relation, oid: 5 }]])
    expect(postgresDatabaseBackupChooseSchema.safeParse({ ...input, relations }).success).toBe(false);
  expect(postgresDatabaseBackupChooseSchema.safeParse({ ...input, schemas: [{ name: relation.schema, stamp: relation.stamp }] }).success).toBe(false);
});

it('只选择对应系统的 pg_dump 普通文件，并观察工具文件修改代次', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-pg-tool-test-'));
  try {
    const tool = join(directory, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    await writeFile(tool, '版本甲', { mode: 0o700 });
    const original = await inspectPostgresNativeTool(tool, 'pg_dump');
    await writeFile(tool, '版本乙文件已变');
    expect((await inspectPostgresNativeTool(tool, 'pg_dump')).version).not.toBe(original.version);
    const other = join(directory, 'other.exe');
    await writeFile(other, '其它文件', { mode: 0o700 });
    await expect(inspectPostgresNativeTool(other, 'pg_dump')).rejects.toThrow('pg_dump');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
