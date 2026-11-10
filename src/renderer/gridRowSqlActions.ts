import { copyInsertSqlZh } from '../shared/copyInsertSql.zh-CN';
import { updateSqlCopyZh } from './locales/updateSqlCopy.zh-CN';
import type { GridCellAction } from './components/GridCellActionMenu';

/** 菜单明确区分点中的未勾选行与点中的整组已勾选行。 */
export function gridRowSqlActions(checked: boolean, insert?: () => void, update?: () => void): GridCellAction[] {
  const scope = checked ? 'selected' : 'current';
  const actions: GridCellAction[] = [];
  if (insert) actions.push({ label: copyInsertSqlZh[scope], run: insert });
  if (update) actions.push({ label: updateSqlCopyZh[scope], run: update });
  return actions;
}
