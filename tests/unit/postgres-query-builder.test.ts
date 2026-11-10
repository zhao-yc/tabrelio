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
  it('跨 schema 多表与自关联使用有序别名，ON 只能引用本步及先前来源', () => {
    const right = { ...source, target: { ...source.target, table: '"public"."other"' },
      columns: [{ name: 'id', type: 'bigint' }, { name: 'x'.repeat(63), type: 'text' }] };
    const join = { table: right.target.table, fingerprint: right.fingerprint, kind: 'LEFT' as const, mode: 'all' as const,
      pairs: [{ left: 't1.id', right: 'id', operator: '=' as const }] };
    const multi: PostgresQueryBuilderDesign = { ...draft, columns: ['t1.id', 't2.id', 't3.' + 'x'.repeat(63)],
      joins: [join, { ...join, kind: 'INNER', mode: 'any',
        pairs: [{ left: 't2.id', right: 'id', operator: '=' }, { left: 't1.id', right: 'id', operator: '<>' }] }],
      filter: { mode: 'all', rules: [{ column: 't2.id', operator: 'IS NULL' }] },
      sort: [{ column: 't3.id', direction: 'DESC' }] };
    const sql = buildPostgresQueryBuilderSql(multi, source, [right, right]);
    expect(sql).toBe('SELECT t1."id" AS "t1.id", t2."id" AS "t2.id", t3."' + 'x'.repeat(63) +
      '" AS "t3#2" FROM "项目.数据"."表""1" AS t1 LEFT JOIN "public"."other" AS t2 ON (t1."id" = t2."id")' +
      ' INNER JOIN "public"."other" AS t3 ON (t2."id" = t3."id" OR t1."id" <> t3."id") WHERE t2."id" IS NULL ORDER BY t3."id" DESC');
    expect(() => buildPostgresQueryBuilderSql(multi, source, [right, { ...right, fingerprint: 'b'.repeat(64) }])).toThrow('关联来源已变化');
    expect(() => buildPostgresQueryBuilderSql({ ...multi, joins: [{ ...join, pairs: [{ left: 't2.id', right: 'id', operator: '=' }] }, multi.joins![1]] },
      source, [right, right])).toThrow('已加入的表');
    const grouped = buildPostgresQueryBuilderSql({ ...multi, columns: [], sort: [], summary: {
      groups: ['t1.id', 't2.id'], aggregates: [{ fn: 'COUNT', column: 't3.id', alias: '关联数' }], sort: [{ column: '关联数', direction: 'DESC' }],
      having: { mode: 'all', rules: [{ column: 't2.id', operator: 'IS NULL' }] },
    } }, source, [right, right]);
    expect(grouped).toContain('SELECT t1."id" AS "t1.id", t2."id" AS "t2.id", pg_catalog.COUNT(t3."id") AS "关联数"');
    expect(grouped).toContain('GROUP BY t1."id", t2."id" HAVING t2."id" IS NULL ORDER BY 3 DESC');
  });
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

  it('分组后按当前汇总输出排序，别名可与未投影的原字段同名', () => {
    const grouped: PostgresQueryBuilderDesign = {
      ...draft, columns: [], rowLimit: 4,
      filter: { mode: 'all', rules: [{ column: 'id', operator: 'IS NOT NULL' }] },
      summary: { groups: ['值'], aggregates: [{ fn: 'COUNT_DISTINCT', column: 'id', alias: 'id' },
        { fn: 'SUM', column: 'id', alias: '合计"值' }],
      sort: [{ column: 'id', direction: 'DESC', nulls: 'LAST' }],
      having: { mode: 'all', rules: [
        { column: 'id', operator: '>', value: '2' }, { column: '合计"值', operator: 'IS NOT NULL' },
        { column: '值', operator: 'IS NULL' },
      ], group: { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] } } },
    };
    expect(buildPostgresQueryBuilderSql(grouped, source)).toBe(
      'SELECT "值", pg_catalog.COUNT(DISTINCT "id") AS "id", pg_catalog.SUM("id") AS "合计""值" FROM "项目.数据"."表""1" WHERE "id" IS NOT NULL GROUP BY "值" HAVING (pg_catalog.COUNT(DISTINCT "id") > E\'2\' AND (pg_catalog.SUM("id") IS NOT NULL OR "值" IS NULL)) ORDER BY 2 DESC NULLS LAST LIMIT 4');
    expect(() => buildPostgresQueryBuilderSql({ ...grouped, columns: ['id'] }, source)).toThrow('汇总或明细');
    expect(() => buildPostgresQueryBuilderSql({ ...grouped, summary: { ...grouped.summary!, groups: ['id'] } }, source)).toThrow('必须唯一');
    expect(() => buildPostgresQueryBuilderSql({ ...grouped, summary: { ...grouped.summary!, sort: [{ column: '已移除', direction: 'ASC' }] } }, source)).toThrow('当前输出');
    expect(() => buildPostgresQueryBuilderSql({ ...grouped, summary: { ...grouped.summary!, having: { mode: 'all', rules: [
      { column: '已移除', operator: 'IS NULL', enabled: false },
    ] } } }, source)).toThrow('汇总输出已移除');
    expect(postgresQueryBuilderInspectSchema.safeParse({ ...grouped, inspect: 'rows', summary: {
      ...grouped.summary, aggregates: [{ fn: 'COUNT_ALL', alias: '统'.repeat(22) }],
    } }).success).toBe(false);
    expect(postgresQueryBuilderInspectSchema.safeParse({ ...grouped, inspect: 'rows', summary: {
      ...grouped.summary, aggregates: [{ fn: 'SUM', alias: '未授权 SQL', column: 'id', expression: 'nextval(...)' }],
    } }).success).toBe(false);
  });
});
