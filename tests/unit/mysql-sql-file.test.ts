import { mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectMysqlSqlFile, readMysqlSqlFile } from '../../src/engine/mysqlSqlFile';
import { inspectMysqlRestoreSql } from '../../src/engine/mysqlSqlFileInspection';
import { mysqlSqlFileExecuteSchema, mysqlSqlFileInspectionSchema, mysqlSqlFilePickSchema, type MysqlSqlFileChooseInput } from '../../src/shared/mysqlSqlFile';

describe('MySQL／MariaDB SQL 文件授权与流式读取', () => {
  let directory: string;
  let path: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'tabrelio-mysql-file-')); path = join(directory, 'dump.sql'); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  async function read(family: 'mysql' | 'mariadb' = 'mysql', encoding: MysqlSqlFileChooseInput['encoding'] = 'utf8') {
    const source = await inspectMysqlSqlFile(path);
    let text = '';
    for await (const chunk of readMysqlSqlFile(source, encoding, family, () => {})) text += chunk;
    return text;
  }

  it('只替换 MariaDB 导出首行的固定客户端指令，保留后续文本及偏移', async () => {
    const marker = '/*M!999999\\- enable the sandbox mode */';
    const sql = "\r\nSELECT '中文🧪';\n";
    await writeFile(path, '\uFEFF' + marker + sql + marker);
    expect(await read('mariadb')).toBe(' '.repeat(marker.length) + sql + marker);
    expect(await read('mysql')).toBe(marker + sql + marker);
    await writeFile(path, marker + ' prefix' + sql);
    expect(await read('mariadb')).toBe(marker + ' prefix' + sql);
  });

  it('读取 UTF-16 LE，并拒绝 UTF-8 非法字节而不替换字符', async () => {
    await writeFile(path, Buffer.from("\uFEFFSELECT '中文';", 'utf16le'));
    expect(await read('mysql', 'utf16le')).toBe("SELECT '中文';");
    await writeFile(path, Buffer.from([0x53, 0x45, 0xff]));
    await expect(read()).rejects.toThrow();
  });

  it('替换文件后拒绝旧授权，且拒绝选择链接', async () => {
    await writeFile(path, 'SELECT 1;');
    const source = await inspectMysqlSqlFile(path);
    await rename(path, join(directory, 'original.sql'));
    await writeFile(path, 'SELECT 2;');
    await expect(readMysqlSqlFile(source, 'utf8', 'mysql', () => {}).next()).rejects.toThrow('SQL 文件已变化');
    if (process.platform !== 'win32') {
      const link = join(directory, 'link.sql');
      await symlink(path, link);
      await expect(inspectMysqlSqlFile(link)).rejects.toThrow('普通 SQL 文件');
    }
  });

  it('执行请求要求信任确认，并拒绝渲染传入文件路径或连接配置', () => {
    const input = { connectionId: 'conn', database: null, encoding: 'utf8', taskId: 'task',
      fileToken: '26bc6b95-1c96-420f-a765-be66b44b74f0', acknowledgeScript: true };
    expect(mysqlSqlFileExecuteSchema.safeParse(input).success).toBe(true);
    expect(mysqlSqlFileExecuteSchema.safeParse({ ...input, acknowledgeScript: false }).success).toBe(false);
    expect(mysqlSqlFileExecuteSchema.safeParse({ ...input, filePath: path }).success).toBe(false);
    expect(mysqlSqlFileExecuteSchema.safeParse({ ...input, profile: { dialect: 'mariadb' } }).success).toBe(false);
    expect(mysqlSqlFilePickSchema.safeParse({ encoding: 'utf8' }).success).toBe(true);
    expect(mysqlSqlFilePickSchema.safeParse({ encoding: 'utf8', database: '库' }).success).toBe(false);
    const offline = { operationId: input.fileToken, fileToken: input.fileToken, family: 'mysql', version: '8.4.11' };
    expect(mysqlSqlFileInspectionSchema.safeParse(offline).success).toBe(true);
    expect(mysqlSqlFileInspectionSchema.safeParse({ ...offline, version: '8.4', filePath: path }).success).toBe(false);
  });

  const inspect = async (filePath: string, family: 'mysql' | 'mariadb' = 'mysql', encoding: MysqlSqlFileChooseInput['encoding'] = 'utf8') => {
    const signal = new AbortController().signal;
    return inspectMysqlRestoreSql(await inspectMysqlSqlFile(filePath), encoding,
      { family, version: family === 'mysql' ? '8.4.11' : '11.4.13' }, signal, () => {});
  };

  it('识别版本注释及显式库操作，保留例程内部分隔符并按 SQL_MODE 解析名称', async () => {
    const script = '/*!50701 USE `仅MySQL` */;\nCREATE DATABASE IF NOT EXISTS `目标`;\n' +
      'SET @before=@@SQL_MODE, SQL_MODE=\'ANSI_QUOTES,NO_BACKSLASH_ESCAPES\';\nUSE "目标";\n' +
      'DELIMITER $$\nCREATE PROCEDURE p() BEGIN DROP DATABASE body_only; END$$\nDELIMITER ;\n' +
      'REPLACE INTO t VALUES (1);\nDROP DATABASE IF EXISTS `旧库`;\nSET SQL_MODE=@before;';
    await writeFile(path, script);
    const actions = [{ action: 'create', name: '目标' }, { action: 'use', name: '目标' }, { action: 'drop', name: '旧库' }];
    expect(await inspect(path)).toEqual({ statements: 8, structure: 3, changes: 1, destructive: 2,
      databaseActions: [{ action: 'use', name: '仅MySQL' }, ...actions], moreDatabases: false });
    expect(await inspect(path, 'mariadb')).toMatchObject({ statements: 7, databaseActions: actions });
  });

  it('报告客户端命令、边界歧义、无效编码与取消', async () => {
    await writeFile(path, 'SELECT 1;\nSOURCE another.sql;\n');
    expect(await inspect(path)).toMatchObject({ statements: 1, issue: { reason: 'client', nextStatement: 2 } });
    await writeFile(path, "SELECT '未闭合;");
    expect(await inspect(path)).toMatchObject({ issue: { reason: 'lexical' } });
    await writeFile(path, Buffer.from([0x53, 0x45, 0xff]));
    expect(await inspect(path)).toMatchObject({ issue: { reason: 'encoding' } });
    const controller = new AbortController();
    controller.abort();
    expect(await inspectMysqlRestoreSql(await inspectMysqlSqlFile(path), 'utf8', { family: 'mysql', version: '8.4.11' },
      controller.signal, () => controller.signal.throwIfAborted())).toMatchObject({ issue: { reason: 'cancelled' } });
  });
});
