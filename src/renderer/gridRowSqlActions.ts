import { copyInsertSqlZh } from '../shared/copyInsertSql.zh-CN';
import { updateSqlCopyZh } from './locales/updateSqlCopy.zh-CN';
import type { GridCellAction } from './components/GridCellActionMenu';

/** 菜单名称与单行、勾选、矩形或当前网格的实际范围一致。 */
export function gridRowSqlActions(scope: 'current' | 'selected' | 'range' | 'all', insert?: () => void, update?: () => void): GridCellAction[] {
  const actions: GridCellAction[] = [];
  if (insert) actions.push({ label: copyInsertSqlZh[scope], run: insert });
  if (update) actions.push({ label: updateSqlCopyZh[scope], run: update });
  return actions;
}
