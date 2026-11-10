import type { Column } from 'react-data-grid';
import { sqliteTableBrowseZh as text } from '../locales/sqliteTableBrowse.zh-CN';

export const sqliteRowIdKey = '__dbark_rowid_display';

/** 仅附加显示列。不会加入原数据投影、可编辑字段或导出结构。 */
export function sqliteRowIdColumn<Row>(read: (row: Row) => string | undefined): Column<Row> {
  return { key: sqliteRowIdKey, name: text.rowId, width: 196, renderCell: ({ row }) => {
    const id = read(row);
    return <span title={id ?? text.pendingRowId}>{id ?? '—'}</span>;
  } };
}
