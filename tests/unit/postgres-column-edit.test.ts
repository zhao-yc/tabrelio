import { describe, expect, it } from 'vitest';
import { matchesPostgresColumnPlan, postgresColumnPlan } from '../../src/shared/postgresColumnEdit';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';

const stamp = 'a'.repeat(64);
const source: PostgresStructureResult = {
  database: '库', schema: '甲', name: '带"引号', kind: 'r', comment: null, partitionKey: null, partitionBound: null,
  rowSecurity: false, forceRowSecurity: false, viewDefinition: null, editStamp: stamp, constraints: [], indexes: [],
  columns: [{ position: 3, name: 'old', type: 'text', nullable: true, defaultExpression: null,
    generationExpression: null, generation: '', identity: '', collation: null, comment: null }],
};
const target = { connectionId: '连接', database: '库', table: '"甲"."带""引号"', editStamp: stamp };

describe('PostgreSQL 已有表字段修改', () => {
  it('按批次顺序保持原列序号，并准确编译新增字段默认值', () => {
    const plan = postgresColumnPlan(source, { ...target, changes: [
      { kind: 'rename', from: 'old', name: '现"值' },
      { kind: 'add', field: { name: '新增', type: 'varchar', length: 30, nullable: false, primary: false, unique: false,
        identity: 'none', comment: "引'号", default: { mode: 'literal', value: "值'; DROP TABLE x; --" } } },
    ] });
    expect(plan.columns).toEqual([{ name: '现"值', position: 3 }, { name: '新增', position: undefined }]);
    expect(plan.statements[0]).toBe('ALTER TABLE ONLY "甲"."带""引号" RENAME COLUMN "old" TO "现""值"');
    expect(plan.statements[1]).toContain("DEFAULT E'值''; DROP TABLE x; --'::varchar(30)");
    expect(plan.checks[0]).toMatchObject({ length: 30, type: 'varchar(30)' });
    expect(plan.statements[2]).toContain("E'引''号'");
  });

  it('拒绝原结构变更、重复名称及错误来源', () => {
    const changes = [{ kind: 'rename', from: 'old', name: 'new' }] as const;
    expect(() => postgresColumnPlan(source, { ...target, editStamp: 'b'.repeat(64), changes: [...changes] })).toThrow('结构已变化');
    expect(() => postgresColumnPlan(source, { ...target, changes: [{ kind: 'rename', from: 'other', name: 'new' }] })).toThrow('原字段不存在');
    expect(() => postgresColumnPlan(source, { ...target, changes: [{ kind: 'rename', from: 'old', name: 'old' }] })).toThrow('名称已存在');
  });

  it('按当前名称和类型编译修改，删除后仍核对原列的序号', () => {
    const plan = postgresColumnPlan({ ...source, columns: [...source.columns, { ...source.columns[0], name: 'other', position: 8 }] },
      { ...target, changes: [{ kind: 'rename', from: 'other', name: 'other"name' },
        { kind: 'type', from: 'other"name', dataType: { type: 'varchar', length: 2 } },
        { kind: 'default', from: 'other"name', value: "字'" }, { kind: 'drop', from: 'old' }] });
    expect(plan.statements[2]).toContain(`"other""name" SET DEFAULT E'字'''`);
    expect(plan.statements[3]).toContain('DROP COLUMN "old" RESTRICT');
    expect(plan.columns).toEqual([{ name: 'other"name', position: 8, expected: { type: 'character varying(2)', hasDefault: true } }]);
    expect(() => postgresColumnPlan(source, { ...target, changes: [
      { kind: 'type', from: 'old', dataType: { type: 'varchar', length: 1 } },
      { kind: 'default', from: 'old', value: '两字' },
    ] })).toThrow('默认值超过字段长度');
    expect(() => postgresColumnPlan(source, { ...target, changes: [
      { kind: 'drop', from: 'old' }, { kind: 'comment', from: 'old', value: null },
    ] })).toThrow('原字段不存在');
  });

  it('仅允许匹配列类型的服务器默认值，最终核对表达式且保留同批前序所需函数', () => {
    const uuid = { ...source.columns[0], type: 'uuid' };
    const original = { ...source, columns: [uuid] };
    const preset = { kind: 'defaultPreset', from: 'old', preset: 'timeOrderedUuid' } as const;
    expect(() => postgresColumnPlan(source, { ...target, changes: [preset] })).toThrow('字段类型不兼容');
    expect(() => postgresColumnPlan({ ...source, columns: [{ ...uuid, generation: 's' }] },
      { ...target, changes: [preset] })).toThrow('生成列');
    const plan = postgresColumnPlan(original, { ...target, changes: [preset] });
    expect(plan.statements[0]).toContain('SET DEFAULT pg_catalog.uuidv7()');
    expect(matchesPostgresColumnPlan([{ ...uuid, defaultExpression: 'uuidv7()' }], plan.columns)).toBe(true);
    expect(matchesPostgresColumnPlan([{ ...uuid, defaultExpression: 'other.uuidv7()' }], plan.columns)).toBe(false);
    expect(matchesPostgresColumnPlan([{ ...uuid, defaultExpression: 'gen_random_uuid()' }], plan.columns)).toBe(false);
    const clear = postgresColumnPlan(original, { ...target, changes: [preset, { kind: 'default', from: 'old', value: null }] });
    expect(clear.presets).toEqual(['timeOrderedUuid']);
    expect(matchesPostgresColumnPlan([uuid], clear.columns)).toBe(true);
  });
});
