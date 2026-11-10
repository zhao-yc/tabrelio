import type { FilterGroup } from './contracts';
import { filterGroupSchemaFor, validateFilterGroupCoverage } from './filtering';
import { sqliteTableBrowseLimits } from './sqliteTableBrowse';

export const sqliteQueryBuilderGroupSchema = filterGroupSchemaFor(sqliteTableBrowseLimits.filters);
export const sqliteGroupMode = (mode: 'and' | 'or') => mode === 'and' ? 'all' : 'any';

export function validateSqliteBuilderGroup(count: number, mode: 'and' | 'or', group?: FilterGroup) {
  return validateFilterGroupCoverage(count, sqliteGroupMode(mode), group, sqliteTableBrowseLimits.filters);
}
