import type { DataCompareProfileFamily } from '../shared/dataCompareProfiles';
import type { PostgresDataCompareEndpoint as Endpoint } from '../shared/postgresDataCompare';
import { invoke, uid } from './lib';

/** 读取实际表的字段目录。SQLite 的结构能力只用于取列名，读取后立即释放。 */
export async function readDataCompareFields(family: DataCompareProfileFamily, endpoint: Endpoint) {
  if (family !== 'sqlite') return invoke(family === 'mysql' ? 'mysql.compareData.catalogue' : 'postgres.compareData.catalogue', endpoint);
  const catalogue = await invoke('sqlite.columns.inspect', { ...endpoint, database: 'main', taskId: uid() });
  try { return catalogue.columns.filter(column => column.hidden !== 1).map(column => column.name); }
  finally { await invoke('sqlite.columns.release', { catalogueId: catalogue.catalogueId }); }
}
