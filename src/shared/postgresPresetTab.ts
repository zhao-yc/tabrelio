import { isTablePresetTabId, tablePresetIdFromTab, tablePresetTabId } from './tablePresetTab';

/** 标签设置只保存方案编号和独立标签编号，筛选值仍在本机方案库。 */
export function postgresPresetTabId(presetId: string, nonce: string): string {
  return tablePresetTabId('postgres', presetId, nonce);
}

export function isPostgresPresetTabId(id: string | undefined): boolean { return isTablePresetTabId('postgres', id); }

export function postgresPresetIdFromTab(id: string | undefined): string | undefined {
  return tablePresetIdFromTab('postgres', id);
}
