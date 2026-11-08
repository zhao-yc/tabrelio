import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectPostgresArchive, parsePostgresArchiveEntries } from '../../src/engine/postgres/customArchive';
import { postgresArchiveExportSchema } from '../../src/shared/postgresArchive';
import { postgresDatabaseBackupChooseSchema } from '../../src/shared/postgresDatabaseBackup';
import { postgresSqlFileExecuteSchema } from '../../src/shared/postgresSqlFile';

const token = '1618e886-931a-4c26-aed4-e321ba43a6bd';

it('归档命令仅接受能力令牌与导出范围，不能从 renderer 传数据库、路径和参数', () => {
  const input = { operationId: token, toolToken: token, sourceToken: token, content: 'schema', portable: true };
  expect(postgresArchiveExportSchema.parse(input)).toEqual(input);
  for (const extra of [{ database: '目标库' }, { path: '/tmp/archive.dump' }, { args: ['--clean'] }, { toolPath: '/tmp/pg_restore' }])
    expect(postgresArchiveExportSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(postgresDatabaseBackupChooseSchema.safeParse({
    connectionId: '来源', database: '数据库', toolToken: token, format: 'custom', portable: true,
  }).success).toBe(false);
});

it('授权读取前核验普通文件及 PGDMP 标记，拒绝纯文本与链接', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-pg-archive-test-'));
  const path = join(directory, 'source.dump');
  try {
    await writeFile(path, '-- SQL');
    await expect(inspectPostgresArchive(path, () => {})).rejects.toThrow('归档标记');
    await writeFile(path, 'PGDMP测试');
    expect((await inspectPostgresArchive(path, () => {})).stamp.size).toBe(11n);
    if (process.platform !== 'win32') {
      const linked = join(directory, 'linked.dump');
      await symlink(path, linked);
      await expect(inspectPostgresArchive(linked, () => {})).rejects.toThrow('普通 PostgreSQL 自定义归档');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('同一次恢复只接收一种来源，且仅数据归档需要现有目标库', () => {
  const input = { connectionId: '连接', database: '目标库', taskId: token,
    archive: { sourceToken: token, toolToken: token, content: 'data', portable: true } };
  expect(postgresSqlFileExecuteSchema.parse(input)).toEqual(input);
  expect(postgresSqlFileExecuteSchema.safeParse({ ...input, newDatabase: '新库' }).success).toBe(false);
  expect(postgresSqlFileExecuteSchema.safeParse({ ...input, fileToken: token }).success).toBe(false);
  expect(postgresSqlFileExecuteSchema.safeParse({ ...input, archive: { ...input.archive, path: '/tmp/dump' } }).success).toBe(false);
});

it('归档条目只接受有限且唯一的正整数，目录顺序保留原生顺序', () => {
  const input = { operationId: token, toolToken: token, sourceToken: token, content: 'all', portable: false };
  expect(postgresArchiveExportSchema.parse({ ...input, entryIds: [41, 3] }).entryIds).toEqual([41, 3]);
  for (const entryIds of [[], [1, 1], [0], [1.5], ['41'], [2_147_483_648], Array.from({ length: 4097 }, (_, id) => id + 1)])
    expect(postgresArchiveExportSchema.safeParse({ ...input, entryIds }).success).toBe(false);
  expect(parsePostgresArchiveEntries('; Selected TOC Entries:\r\n41; 1259 123 TABLE 范围 含空格;表 role\r\n' +
    '3; 0 123 TABLE DATA 范围 含空格;表 role\r\n')).toEqual([
    { id: 41, label: 'TABLE 范围 含空格;表 role' }, { id: 3, label: 'TABLE DATA 范围 含空格;表 role' },
  ]);
  expect(parsePostgresArchiveEntries('41; 1259 123 TABLE demo t r\n41; 0 123 TABLE DATA demo t r\n')).toEqual([]);
  expect(parsePostgresArchiveEntries('3; 0 123 TABLE DATA demo t r\n无法识别的行\n')).toEqual([]);
});
