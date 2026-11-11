import type { TableInfo } from '../../src/shared/contracts';
import type { MemoryDocument } from '../fixtures/memory-dom';

/** 只提供组件缩放调用的滚动端口。真实滚动范围与几何锚点由 Electron 用例核对。 */
export function installRelationshipViewportPort(document: MemoryDocument): void {
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    return name === 'div' ? Object.assign(node, {
      clientWidth: 640, clientHeight: 320, scrollLeft: 0, scrollTop: 0,
      scrollTo({ left = 0, top = 0 }: ScrollToOptions) { this.scrollLeft = left; this.scrollTop = top; },
    }) : node;
  };
}

/** 合成结构仅含目录信息，用于复合、自引用、跨库及重复表名；没有数据库凭据或真实数据。 */
export function relationshipFixture(): TableInfo[] {
  const column = (name: string, type = 'BIGINT') => ({ name, type, nullable: false, defaultValue: null, extra: '', comment: '', generated: false });
  const table = (name: string, columns: string[], primaryKey: string[]): TableInfo => ({ database: 'diagram_db', name, columns: columns.map(name => column(name)), indexes: [], foreignKeys: [], primaryKey, editableKey: primaryKey, engine: 'InnoDB', ddl: '', objectKind: 'table' });
  const parent = table('parent', ['tenant', 'id', '名称🚢'], ['tenant', 'id']);
  const child = table('child', ['id', 'tenant', 'parent_id', 'manager_id', '备注<script>'], ['id']);
  child.foreignKeys = [
    { name: 'fk_composite', columns: ['tenant', 'parent_id'], referencedDatabase: 'diagram_db', referencedTable: 'parent', referencedColumns: ['tenant', 'id'], onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    { name: 'fk_self', columns: ['manager_id'], referencedDatabase: 'diagram_db', referencedTable: 'child', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'SET NULL' },
    { name: 'fk_external', columns: ['parent_id'], referencedDatabase: 'outside_db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' },
  ];
  return [child, parent, table('unlinked', ['id', 'description'], ['id'])];
}
