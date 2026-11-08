import type { MysqlViewDependencies, MysqlViewDependenciesInput, MysqlViewDependency } from '../shared/mysqlViewDependencies';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { renameViewLimits, tableRenameViewReferences } from './tableRenameViewDependencies';

const edgeLimit = 1024, pageSize = 32;
const literal = (value: string) => `CAST(X'${Buffer.from(value).toString('hex')}' AS BINARY)`;
const binary = (column: string) => 'CAST(' + column + ' AS BINARY)';
const exact = (schema: string, name: string, target: MysqlViewDependency) =>
  `${binary(schema)}=${literal(target.database)} AND ${binary(name)}=${literal(target.name)}`;
type ViewRow = { database: string; name: string; definition: string | null; fingerprint: string | null };
const columns = `TABLE_SCHEMA AS \`database\`, TABLE_NAME AS name,
  CASE WHEN OCTET_LENGTH(VIEW_DEFINITION)<=${renameViewLimits.definitionBytes} THEN VIEW_DEFINITION END AS definition`;

function missingCatalogue(reason: unknown): boolean {
  return ['ER_UNKNOWN_TABLE', 'ER_NO_SUCH_TABLE'].includes((reason as { code?: string })?.code ?? '');
}

/** 独立短会话只读取目录。MySQL 以原生直接边为准，缺少目录时逐条解析可见的规范定义。 */
export async function readMysqlViewDependencies(context: StructureTaskContext, input: MysqlViewDependenciesInput): Promise<MysqlViewDependencies> {
  const read = async <T>(sql: string): Promise<T[]> => (await structureTaskQuery<T[]>(context, sql)).rows;
  const target = { database: input.database, name: input.name };
  const targetWhere = exact('TABLE_SCHEMA', 'TABLE_NAME', target);
  const readTarget = async () => {
    const rows = await read<ViewRow>(`SELECT ${columns}, SHA2(VIEW_DEFINITION,256) AS fingerprint
      FROM information_schema.VIEWS WHERE ${targetWhere} LIMIT 2`);
    if (rows.length !== 1) throw Error('原视图不存在或当前账号无法读取其目录');
    return rows[0];
  };
  const before = await readTarget();
  const result: MysqlViewDependencies = { source: 'catalogue', referenced: [], referencing: [], skipped: 0, referencedUnknown: false, truncated: false };
  const dialect = context.managed.status.dialect;
  let useDefinitions = dialect === 'mariadb';
  if (!useDefinitions) {
    const edges = async (direction: 'referenced' | 'referencing') => {
      const [other, own] = direction === 'referenced' ? ['TABLE', 'VIEW'] : ['VIEW', 'TABLE'];
      const rows = await read<MysqlViewDependency>(`SELECT ${other}_SCHEMA AS \`database\`, ${other}_NAME AS name
        FROM information_schema.VIEW_TABLE_USAGE WHERE ${exact(own + '_SCHEMA', own + '_NAME', target)}
        ORDER BY BINARY ${other}_SCHEMA,BINARY ${other}_NAME LIMIT ${edgeLimit + 1}`);
      if (rows.length > edgeLimit) result.truncated = true;
      return rows.slice(0, edgeLimit);
    };
    try { result.referenced = await edges('referenced'); }
    catch (reason) { if (!missingCatalogue(reason)) throw reason; useDefinitions = true; }
    if (!useDefinitions) result.referencing = await edges('referencing');
  }
  if (useDefinitions) {
    result.source = 'definitions';
    const caseRows = await read<{ mode: number }>('SELECT @@lower_case_table_names AS mode');
    const caseMode = Number(caseRows[0]?.mode);
    if (![0, 1, 2].includes(caseMode)) throw Error('无法确认服务器的对象名大小写规则');
    const comparable = (value: string) => caseMode === 0 ? value : value.toLowerCase();
    const parse = (row: Pick<ViewRow, 'definition' | 'database'>) => {
      if (!row.definition) return;
      try {
        return tableRenameViewReferences(row.definition, row.database, { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } })
          .map(ref => ({ database: ref.database, name: ref.table }));
      } catch { return undefined; }
    };
    const referenced = parse(before);
    result.referencedUnknown = referenced === undefined;
    result.referenced = referenced?.slice(0, edgeLimit) ?? [];
    result.truncated = (referenced?.length ?? 0) > edgeLimit;
    let last: MysqlViewDependency | undefined, scanned = 0, bytes = 0;
    scan: for (;;) {
      const after = last ? ` AND (${binary('TABLE_SCHEMA')}>${literal(last.database)}
        OR (${binary('TABLE_SCHEMA')}=${literal(last.database)} AND ${binary('TABLE_NAME')}>${literal(last.name)}))` : '';
      const rows = await read<ViewRow>(`SELECT ${columns} FROM information_schema.VIEWS
        WHERE NOT (${targetWhere})${after} ORDER BY BINARY TABLE_SCHEMA,BINARY TABLE_NAME LIMIT ${pageSize + 1}`);
      for (const row of rows.slice(0, pageSize)) {
        context.checkCancelled();
        bytes += Buffer.byteLength(row.definition ?? '') + Buffer.byteLength(row.database) + Buffer.byteLength(row.name);
        if (++scanned > renameViewLimits.views || bytes > renameViewLimits.bytes) { result.truncated = true; break scan; }
        last = { database: row.database, name: row.name };
        const refs = parse(row);
        if (!refs) result.skipped++;
        else if (refs.some(ref => comparable(ref.database) === comparable(target.database) && comparable(ref.name) === comparable(target.name))) {
          if (result.referencing.length === edgeLimit) { result.truncated = true; break scan; }
          result.referencing.push(last);
        }
      }
      if (rows.length <= pageSize) break;
    }
  }
  context.checkCancelled();
  if ((await readTarget()).fingerprint !== before.fingerprint) throw Error('读取期间原视图定义已变化，请重新读取依赖');
  return result;
}
