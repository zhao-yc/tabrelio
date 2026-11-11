import { describe, expect, it } from 'vitest';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';
import { capturePostgresDiagramTable } from '../../src/renderer/objectBrowserDiagram';

const database = 'example';
const table = '"sales.east"."line""item"';
const columns: PostgresStructureResult['columns'] = ['scope', 'parent.id'].map((name, index) => ({
  name, position: index + 1, type: 'integer', nullable: false, defaultExpression: null,
  generationExpression: null, generation: '', identity: '', collation: null, comment: null,
}));
const common = { definition: '目录定义', deferrable: false, initiallyDeferred: false, validated: true, inherited: false };
const structure: PostgresStructureResult = {
  database, schema: 'sales.east', name: 'line"item', kind: 'r',
  comment: null, partitionKey: null, partitionBound: null, rowSecurity: false, forceRowSecurity: false,
  viewDefinition: null, columns, indexes: [],
  constraints: [
    { ...common, name: 'pkey', kind: 'p', keyColumns: ['scope', 'parent.id'] },
    { ...common, name: 'parent_fk', kind: 'f', foreign: {
      schema: 'core', table: 'target.data', enforced: true, match: 'f', onUpdate: 'r', onDelete: 'c',
      pairs: [{ local: 'parent.id', remote: 'id' }, { local: 'scope', remote: 'scope.key' }],
    } },
  ],
};

describe('对象浏览 ER 图的 PostgreSQL 目录转换', () => {
  it('保留原标识符、跨 schema 目标与目录给出的复合字段顺序', () => {
    const result = capturePostgresDiagramTable(structure, database, table);
    expect(result.name).toBe(table);
    expect(result.primaryKey).toEqual(['scope', 'parent.id']);
    expect(result.foreignKeys).toEqual([{
      name: 'parent_fk', referencedDatabase: database, referencedTable: '"core"."target.data"',
      columns: ['parent.id', 'scope'], referencedColumns: ['id', 'scope.key'], onUpdate: 'RESTRICT', onDelete: 'CASCADE',
    }]);
  });

  it('拒绝目标变化和缺失的外键映射', () => {
    expect(() => capturePostgresDiagramTable({ ...structure, kind: 'v' }, database, table)).toThrow();
    expect(() => capturePostgresDiagramTable({ ...structure, schema: 'sales' }, database, table)).toThrow();
    expect(() => capturePostgresDiagramTable(structure, 'another', table)).toThrow();
    expect(() => capturePostgresDiagramTable({ ...structure, columns: columns.slice(0, 1),
      constraints: structure.constraints.slice(1) }, database, table)).toThrow();
  });
});
