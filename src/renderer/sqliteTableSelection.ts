import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';

/** 复选框选择绑定准确展示页及原草稿对象；不能用相同行id或下标接管后继页。 */
export interface SqliteCheckedRows {
  readonly page: SqliteTablePage;
  readonly rows: readonly SqliteDraftRow[];
  readonly selected: readonly SqliteDraftRow[];
  /** 只核对勾选代次和原行，调用方须另核自己允许的模态。 */
  selectionCurrent(): boolean;
  current(): boolean;
}
