import { copyInsertSqlZh } from '../shared/copyInsertSql.zh-CN';
import { updateSqlCopyZh } from './locales/updateSqlCopy.zh-CN';
import type { GridCellAction } from './components/GridCellActionMenu';

/** 菜单区分单行、复选框勾选和矩形覆盖行，避免混用三种来源。 */
export function gridRowSqlActions(scope: 'current' | 'selected' | 'range', insert?: () => void, update?: () => void): GridCellAction[] {
  const actions: GridCellAction[] = [];
  if (insert) actions.push({ label: copyInsertSqlZh[scope], run: insert });
  if (update) actions.push({ label: updateSqlCopyZh[scope], run: update });
  return actions;
}
