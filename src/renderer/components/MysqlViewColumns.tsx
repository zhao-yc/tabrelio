import { useMemo } from 'react';
import { changeMysqlViewDraftColumns, mysqlViewDraftColumns } from '../../shared/mysqlViewFile';
import { ViewOutputColumns } from './ViewOutputColumns';

/** MySQL 和 MariaDB 的列清单直接来自当前完整 DDL 草稿。 */
export function MysqlViewColumns({ owner, database, view, sql, disabled, current, previewColumns, change }: {
  owner: object; database: string; view: string; sql: string; disabled: boolean;
  current(): boolean;
  previewColumns?: readonly string[];
  change(sql: string): void;
}) {
  const original = useMemo(() => {
    if (disabled) return;
    try { return mysqlViewDraftColumns(sql, database, view); } catch { return undefined; }
  }, [database, view, sql, disabled]);
  return <ViewOutputColumns owner={owner} original={original} disabled={disabled} current={current}
    previewColumns={previewColumns} applyNames={names => change(changeMysqlViewDraftColumns(sql, database, view, names))}/>;
}
