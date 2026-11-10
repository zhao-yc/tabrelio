import { describe, expect, it } from 'vitest';
import { buildPostgresQueryBuilderSql, postgresQueryBuilderInspectSchema, type PostgresQueryBuilderDesign,
  type PostgresQueryBuilderSource } from '../../src/shared/postgresQueryBuilder';
import { splitPostgresSql } from '../../src/shared/postgresSql';

const source: PostgresQueryBuilderSource = {
  target: { connectionId: 'pg', database: 'test', table: '"项目.数据"."表""1"' },
  fingerprint: 'a'.repeat(64), columns: [{ name: 'id', type: 'bigint' }, { name: '值', type: 'text' }],
};
const draft: PostgresQueryBuilderDesign = { ...source.target, fingerprint: source.fingerprint, columns: ['id', '值'], sort: [], distinct: false };

describe('PostgreSQL 单表查询设计', () => {
  it('保留限定名、嵌套分组、原始精确值、空值顺序及显式行数上限', () => {
    const sql = buildPostgresQueryBuilderSql({
      ...draft, distinct: true, rowLimit: 8, sort: [{ column: '值', direction: 'DESC', nulls: 'LAST' }],
      filter: { mode: 'all', rules: [
        { column: 'id', operator: '>=', value: '9223372036854775806' },
        { column: '值', operator: '=', value: "斜线\\\r\n'; DROP TABLE x; --" },
        { column: '值', operator: 'IS NULL' },
      ], group: { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] } },
    }, source);
    expect(sql).toBe(`SELECT DISTINCT "id", "值" FROM "项目.数据"."表""1" WHERE ("id" >= E'9223372036854775806' AND ("值" = E'斜线\\\\\\r\\n''; DROP TABLE x; --' OR "值" IS NULL)) ORDER BY "值" DESC NULLS LAST LIMIT 8`);
    expect(splitPostgresSql(sql, true)).toHaveLength(1);
    expect(splitPostgresSql(sql, false)).toHaveLength(1);
    expect(buildPostgresQueryBuilderSql(draft, source)).toBe('SELECT "id", "值" FROM "项目.数据"."表""1"');
  });

  it('拒绝来源变更、停用条件引用的未知字段、去重查询的非投影排序和额外 SQL', () => {
    expect(() => buildPostgresQueryBuilderSql(draft, { ...source, fingerprint: 'b'.repeat(64) })).toThrow('来源已变化');
    expect(() => buildPostgresQueryBuilderSql(draft, { ...source, target: { ...source.target, database: 'elsewhere' } })).toThrow('来源已变化');
    expect(() => buildPostgresQueryBuilderSql({ ...draft, filter: { mode: 'all', rules: [
      { column: '已删除', operator: 'IS NULL', enabled: false },
    ] } }, source)).toThrow('字段已变化');
    expect(() => buildPostgresQueryBuilderSql({ ...draft, columns: ['id'], distinct: true,
      sort: [{ column: '值', direction: 'ASC' }] }, source)).toThrow('输出字段排序');
    expect(postgresQueryBuilderInspectSchema.safeParse({ ...draft, inspect: 'rows', sql: 'SELECT 1' }).success).toBe(false);
    expect(postgresQueryBuilderInspectSchema.safeParse({ ...draft, inspect: 'rows', table: 'bare_name' }).success).toBe(false);
  });
});
