import type { ConnectionProfile, DatabaseObject, DatabaseObjectDetails } from '../shared/contracts';
import { navigationZh as text } from './locales/navigation.zh-CN';

export type ObjectProperty = Exclude<keyof DatabaseObjectDetails, 'strict'>;
export const objectPropertyWidths: Record<ObjectProperty, number> = {
  storage: 105, schema: 130, relation: 128, collation: 160, estimatedRows: 117,
  dataBytes: 138, indexBytes: 138, created: 164, updated: 164, comment: 240,
};
const networkProperties: readonly ObjectProperty[] = ['storage', 'estimatedRows', 'dataBytes', 'indexBytes', 'collation', 'created', 'updated', 'comment'];
const postgresProperties: readonly ObjectProperty[] = ['schema', 'relation', 'estimatedRows', 'dataBytes', 'indexBytes', 'comment'];
const sqliteProperties: readonly ObjectProperty[] = ['relation', 'estimatedRows'];
const defaultProperties: readonly ObjectProperty[] = ['storage', 'schema', 'relation', 'estimatedRows', 'dataBytes'];
const numericProperties = new Set<ObjectProperty>(['estimatedRows', 'dataBytes', 'indexBytes']);
const integerFormat = new Intl.NumberFormat('zh-CN');

export function objectProperties(dialect: ConnectionProfile['dialect']) {
  return dialect === 'sqlite' ? sqliteProperties : dialect === 'postgresql' ? postgresProperties : networkProperties;
}

export function defaultObjectProperty(property: ObjectProperty) { return defaultProperties.includes(property); }
export function numericObjectProperty(property: ObjectProperty) { return numericProperties.has(property); }

function objectProperty(object: DatabaseObject, property: ObjectProperty): string | undefined {
  const value = object.details?.[property];
  return property === 'relation' && object.details?.relation
    ? text.relations[object.details.relation] + (object.details.strict ? text.strictTableSuffix : '')
    : value;
}

/** 估算数加标记，大小按字节显示；缺失值与服务器返回的零分开。 */
export function objectPropertyText(object: DatabaseObject, property: ObjectProperty) {
  const value = objectProperty(object, property);
  if (value === undefined) return text.propertyUnavailable;
  if (!numericObjectProperty(property)) return value;
  const formatted = integerFormat.format(BigInt(value));
  return property === 'estimatedRows' ? '≈ ' + formatted : formatted;
}

/** 数值按完整十进制位排序，两个方向都把未知值放在末尾；并列用名称和类型稳定排序。 */
export function compareBrowserObjects(left: DatabaseObject, right: DatabaseObject, property: 'name' | ObjectProperty, descending: boolean): number {
  const byName = left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind);
  const direction = descending ? -1 : 1;
  if (property === 'name') return direction * byName;
  const a = objectProperty(left, property), b = objectProperty(right, property);
  if (a === undefined || b === undefined) return Number(a === undefined) - Number(b === undefined) || byName;
  const result = numericObjectProperty(property) ? a.length - b.length || a.localeCompare(b) : a.localeCompare(b);
  return direction * result || byName;
}
