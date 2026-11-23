/** 这些 PRAGMA 允许指定表、视图或索引。完整性检查也接受错误数上限，仍然只读。 */
export const sqlitePragmasWithObjectArgument = [
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'foreign_key_check', 'integrity_check', 'quick_check',
] as const;

const objectPragmas = new Set<string>(sqlitePragmasWithObjectArgument);
const readWithoutValue = new Set([
  'database_list', 'collation_list', 'function_list', 'pragma_list', 'compile_options', 'foreign_keys',
  'query_only', 'legacy_alter_table', 'ignore_check_constraints', 'schema_version', 'data_version',
  'user_version', 'page_count', 'page_size', 'freelist_count', 'encoding', 'journal_mode',
]);

/** 有些 PRAGMA 在 prepare 阶段生效，因此原生授权和编辑器候选共用明确的只读范围。 */
export function readableSqlitePragma(name: string | null, argument: string | null): boolean {
  if (name === null) return false;
  const key = name.toLowerCase();
  return objectPragmas.has(key) || argument === null && readWithoutValue.has(key);
}

export function sqlitePragmaFunctionBase(name: string): string | undefined {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return;
  const key = name.toLowerCase(), pragma = key.slice(7);
  return key.startsWith('pragma_') && readableSqlitePragma(pragma, null) ? pragma : undefined;
}
