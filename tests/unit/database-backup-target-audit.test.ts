import { describe, expect, it, vi } from 'vitest';
import { execute } from '../../src/engine/connection';
import { databaseBackupSourceSql } from '../../src/engine/databaseBackupSource';
import { auditDatabaseBackupTarget } from '../../src/engine/databaseBackupTargetAudit';
import { canRestoreBackupArchive, type DatabaseBackupTargetManifest } from '../../src/shared/databaseBackupArchiveFiles';

vi.mock('../../src/engine/connection', () => ({ execute: vi.fn() }));

function fixture(identifierCase: number, loseVisibility = false) {
  let grantReads = 0;
  const query = vi.mocked(execute);
  query.mockReset().mockImplementation(async (_managed, sql) => {
    let rows: Record<string, unknown>[];
    if (sql.startsWith('SELECT VERSION()')) rows = [{ version: '8.4.11', versionComment: 'MySQL Community Server',
      identifierCase, scheduler: 'OFF', currentDatabase: 'target' }];
    else if (sql.startsWith('SELECT CURRENT_USER()')) rows = [{ account: 'test@localhost', activeRole: 'NONE', sqlMode: '' }];
    else if (sql === databaseBackupSourceSql.grants) {
      grantReads++;
      rows = [{ grants: 'GRANT SELECT, SHOW DATABASES, SHOW VIEW, EVENT' + (loseVisibility && grantReads > 1 ? '' : ', TRIGGER') +
        ' ON *.* TO `test`@`localhost`' }];
    } else if (sql.includes('information_schema.SCHEMATA')) rows = [{ name: 'target' }];
    else if (sql.includes('COUNT(*)')) rows = [{ relations: 1, views: 0, routines: 0, triggers: 0, events: 0 }];
    else if (sql.startsWith('SELECT TABLE_NAME') || sql.startsWith('SELECT TRIGGER_NAME')) rows = [];
    else throw Error('出现非预期的目标目录查询');
    return { rows, fields: [] } as Awaited<ReturnType<typeof execute>>;
  });
  const managed = { status: { dialect: 'mysql' } } as Parameters<typeof auditDatabaseBackupTarget>[0]['managed'];
  const audit = (tables: string[]) => {
    const manifest: DatabaseBackupTargetManifest = { family: 'mysql', serverVersion: '8.4.11', database: 'source',
      tableScope: { content: 'schema', tables }, triggerNames: ['watch_table'] };
    return auditDatabaseBackupTarget({ managed, commandStarted: () => () => undefined, checkCancelled: () => undefined },
      manifest, 'target', true);
  };
  return { query, audit };
}

describe('指定表归档结构预检', () => {
  it('按服务器的大小写规则查询表目录，表名和触发器名均走参数绑定', async () => {
    const { query, audit } = fixture(1);
    expect(canRestoreBackupArchive(await audit(["Sales'`"]))).toBe(true);
    expect(query.mock.calls.find(([, sql]) => sql.startsWith('SELECT TABLE_NAME'))?.slice(1)).toEqual([
      expect.stringContaining('BINARY LOWER(TABLE_NAME) IN (BINARY LOWER(?))'), ['target', "Sales'`"],
    ]);
    expect(query.mock.calls.find(([, sql]) => sql.startsWith('SELECT TRIGGER_NAME'))?.slice(1)).toEqual([
      expect.stringContaining('TRIGGER_NAME IN (?)'), ['target', 'watch_table'],
    ]);
  });

  it('拒绝折叠后重复的表名及有对象时无法可靠比较的非 ASCII 表名', async () => {
    const { audit } = fixture(1);
    for (const [tables, code] of [[['Sales', 'sales'], 'table-case-collision'], [['账目'], 'table-case-unknown']] as const) {
      const result = await audit([...tables]);
      expect(canRestoreBackupArchive(result)).toBe(false);
      expect(result.blockers).toContainEqual(expect.objectContaining({ code }));
    }
  });

  it('目录查询返回零行后若失去可见性，拒绝回放', async () => {
    const result = await fixture(0, true).audit(['ledger']);
    expect(canRestoreBackupArchive(result)).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'visibility' }));
  });
});
