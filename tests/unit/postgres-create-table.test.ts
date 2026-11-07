import { describe, expect, it } from 'vitest';
import { postgresCreateTablePlan, postgresCreateTablePreviewSchema, type PostgresCreateTableInput } from '../../src/shared/postgresCreateTable';
import { splitPostgresSql } from '../../src/shared/postgresSql';
import { postgresTableManageApplySchema, postgresTableManagePreviewSchema } from '../../src/shared/postgresTableManage';
import { postgresTriggerEditorDraft, postgresTriggerChangeSchema } from '../../src/shared/postgresTrigger';
import { postgresPolicyChangeSchema, postgresPolicyRequiresReplacement } from '../../src/shared/postgresPolicy';

const draft: PostgresCreateTableInput = {
  connectionId: '原连接', database: '原库', schema: '业务"区', table: '新"表', comment: "注释'；\\",
  columns: [{ name: '原"列', type: 'text', nullable: false, primary: true, unique: false, identity: 'none',
    default: { mode: 'literal', value: "a\\'; DROP TABLE 其他; --" }, comment: '多行\n注释' }],
};

describe('PostgreSQL 建表计划', () => {
  it('标识符、带反斜杠的默认值及注释不能逸出各自语法边界', () => {
    const result = postgresCreateTablePlan(draft);
    expect(result.table).toBe('"业务""区"."新""表"');
    expect(result.statements).toHaveLength(3);
    expect(splitPostgresSql(result.statements.join(';\n'), true).map(item => item.keyword)).toEqual(['CREATE', 'COMMENT', 'COMMENT']);
    expect(splitPostgresSql(result.statements.join(';\n'), false)).toHaveLength(3);
    expect(result.checks[0].value).toBe("a\\'; DROP TABLE 其他; --");
  });
  it('拒绝 Unicode 截断、重复列和类型属性错配', () => {
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, table: '长'.repeat(22) }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [...draft.columns, ...draft.columns] }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [{ ...draft.columns[0], identity: 'always' }] }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [{ ...draft.columns[0], type: 'numeric', precision: 2, scale: 3 }] }).success).toBe(false);
  });

  it('UUID 预设只接受 uuid 类型及固定模式，不接收表达式参数', () => {
    const column = { ...draft.columns[0], type: 'uuid' } as const;
    const input = { ...draft, columns: [{ ...column, default: { mode: 'randomUuid' as const } }] };
    expect(postgresCreateTablePlan(input).statements[0]).toContain('DEFAULT pg_catalog.gen_random_uuid()');
    expect(postgresCreateTablePreviewSchema.safeParse({ ...input, columns: [{ ...column, type: 'date', default: { mode: 'randomUuid' } }] }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...input, columns: [{ ...column,
      default: { mode: 'timeOrderedUuid', value: '1 day' } }] }).success).toBe(false);
  });

  it('生成列使用固定模式并保护表达式的 SQL 边界', () => {
    const column = { ...draft.columns[0], default: { mode: 'none' as const } };
    const generated = { ...column, generation: { mode: 'stored' as const, expression: `'a;b' -- 末尾注释` } };
    const plan = postgresCreateTablePlan({ ...draft, columns: [generated] });
    expect(plan.statements[0]).toContain("GENERATED ALWAYS AS (\n'a;b' -- 末尾注释\n) STORED");
    for (const invalid of [
      { ...generated, identity: 'always', type: 'integer' }, { ...generated, default: { mode: 'literal', value: '字' } },
      { ...generated, generation: { ...generated.generation, expression: "1) STORED, other int DEFAULT (1" } },
      { ...generated, generation: { ...generated.generation, expression: '1; CREATE TABLE other(i int)' } },
      { ...generated, generation: { ...generated.generation, expression: '$1' } },
    ]) expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [invalid] }).success).toBe(false);
  });
});

it('PostgreSQL 表管理绑定目录摘要，删除和执行都拒绝额外 SQL', () => {
  const target = { connectionId: 'saved', database: 'qa', table: '"public"."原表"', stamp: 'f'.repeat(64) };
  expect(postgresTableManagePreviewSchema.parse({ ...target, action: 'rename', name: '新"表' }).action).toBe('rename');
  for (const input of [{ ...target, action: 'drop', cascade: true }, { ...target, action: 'drop', name: 'x' },
    { ...target, action: 'rename', name: '长'.repeat(22) }, { ...target, action: 'drop', stamp: 'bad' }])
    expect(postgresTableManagePreviewSchema.safeParse(input).success).toBe(false);
  const apply = { connectionId: target.connectionId, database: target.database, token: '0550f154-5fc9-4447-a835-fd56f9e9a17f', confirmed: true };
  expect(postgresTableManageApplySchema.parse(apply)).toEqual(apply);
  expect(postgresTableManageApplySchema.safeParse({ ...apply, confirmed: false }).success).toBe(false);
  expect(postgresTableManageApplySchema.safeParse({ ...apply, sql: 'DROP TABLE x' }).success).toBe(false);
});

it('PostgreSQL 清空预览必须明确序列策略，拒绝级联和任意目标列表', () => {
  const target = { connectionId: 'saved', database: 'qa', table: '"public"."原表"', stamp: 'a'.repeat(64), action: 'truncate' };
  for (const identity of ['continue', 'restart'])
    expect(postgresTableManagePreviewSchema.parse({ ...target, identity })).toEqual({ ...target, identity });
  for (const input of [target, { ...target, identity: 'reset' }, { ...target, identity: 'restart', cascade: true },
    { ...target, identity: 'continue', tables: ['其他表'] }, { ...target, identity: 'continue', name: '另一表' }])
    expect(postgresTableManagePreviewSchema.safeParse(input).success).toBe(false);
});

it('PostgreSQL 移表预览只接受目标 schema 和原目录摘要', () => {
  const draft = { connectionId: 'saved', database: 'qa', table: '"来源"."原表"', stamp: 'a'.repeat(64),
    action: 'move', schema: '新"区域' };
  expect(postgresTableManagePreviewSchema.parse(draft)).toEqual(draft);
  for (const input of [{ ...draft, schema: undefined }, { ...draft, schema: '长'.repeat(22) },
    { ...draft, name: '另一表' }, { ...draft, database: '' }, { ...draft, sql: 'ALTER TABLE t SET SCHEMA other' }])
    expect(postgresTableManagePreviewSchema.safeParse(input).success).toBe(false);
});

it('PostgreSQL 注释批次区分未修改与清空，并拒绝重复字段和任意 SQL', () => {
  const draft = { connectionId: 'saved', database: 'qa', table: '"public"."原表"', stamp: 'a'.repeat(64),
    action: 'comment', value: null, columns: [{ position: 2, name: '原字段', value: '中文\n原样' }] };
  expect(postgresTableManagePreviewSchema.parse(draft)).toEqual(draft);
  expect(postgresTableManagePreviewSchema.parse({ ...draft, columns: [] })).toMatchObject({ value: null });
  for (const input of [{ ...draft, value: undefined, columns: [] }, { ...draft, value: '\0' }, { ...draft, sql: 'COMMENT ON TABLE x IS NULL' },
    { ...draft, columns: [...draft.columns, { ...draft.columns[0], name: '别的字段' }] }])
    expect(postgresTableManagePreviewSchema.safeParse(input).success).toBe(false);
});

it('PostgreSQL 标识列输入保留精确整数并拒绝任意选项', () => {
  const draft = { connectionId: 'saved', database: 'qa', table: '"public"."原表"', stamp: 'b'.repeat(64),
    action: 'identity', position: 1, name: '标识列', change: { kind: 'add', mode: 'always', start: '9007199254740993' } };
  expect(postgresTableManagePreviewSchema.parse(draft)).toEqual(draft);
  expect(postgresTableManagePreviewSchema.parse({ ...draft, change: { kind: 'restart' } })).toMatchObject({ change: { kind: 'restart' } });
  for (const value of [{ ...draft, position: 0 }, { ...draft, change: { kind: 'restart', value: 9007199254740992 } },
    { ...draft, change: { kind: 'add', mode: 'always', start: '1e4' } }, { ...draft, change: { kind: 'drop', cascade: true } }])
    expect(postgresTableManagePreviewSchema.safeParse(value).success).toBe(false);
});

it('PostgreSQL 触发器输入约束事件、UPDATE 字段和 WHEN 的边界', () => {
  const input = {
    connectionId: 'saved', database: 'qa', table: '"public"."原表"', stamp: 'c'.repeat(64), action: 'trigger',
    change: { kind: 'create', name: '记录更新', timing: 'BEFORE', events: ['UPDATE'], level: 'ROW', updateOf: ['金额'],
      condition: 'NEW."金额" > 0 -- 合法尾注', functionSchema: '业务', functionName: '更新记录', args: ["反斜杠\\'; --"] },
  };
  expect(postgresTableManagePreviewSchema.parse(input)).toEqual(input);
  for (const change of [
    { ...input.change, events: ['UPDATE', 'UPDATE'] }, { ...input.change, events: ['TRUNCATE'], updateOf: [] },
    { ...input.change, events: ['INSERT'] }, { ...input.change, condition: 'true) EXECUTE FUNCTION f(' },
    { ...input.change, condition: 'true; DROP TABLE x' }, { ...input.change, condition: '$1' },
    { ...input.change, sql: 'CREATE TRIGGER arbitrary' },
  ]) expect(postgresTableManagePreviewSchema.safeParse({ ...input, change }).success).toBe(false);
});

it('从 PostgreSQL 触发器目录还原条件、字面参数和过渡表别名', () => {
  const args = ["a'b", '尾部\\', '', 'EXECUTE FUNCTION ( WHEN ('];
  const condition = "((new.a > old.a) AND (new.memo <> 'EXECUTE FUNCTION )'))";
  const trigger = {
    oid: '12', name: 'WHEN (', mode: 'D' as const, internal: false, inherited: false, constraint: false,
    definition: `CREATE TRIGGER "WHEN (" AFTER UPDATE ON public.t REFERENCING OLD TABLE AS "旧表" NEW TABLE AS "新表" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION "x"."f("('a''b', '尾部\\', '', 'EXECUTE FUNCTION ( WHEN (')`,
    functionOid: '9', functionSchema: 'x', functionName: 'f(', eventBits: 17,
    argumentCount: args.length, updatePositions: [], argsHex: '', conditional: true, signature: '0'.repeat(32),
    oldTable: '旧表', newTable: '新表', comment: null, extensionBound: false,
  };
  const draft = postgresTriggerEditorDraft(trigger, []);
  expect(draft).toEqual({ timing: 'AFTER', events: ['UPDATE'], level: 'ROW', updateOf: [], condition,
    functionSchema: 'x', functionName: 'f(', args, oldTable: '旧表', newTable: '新表' });
  expect(postgresTriggerEditorDraft({ ...trigger, argumentCount: 9 }, [])).toBeUndefined();
  expect(postgresTriggerEditorDraft({ ...trigger, extensionBound: true }, [])).toBeUndefined();
  expect(postgresTriggerChangeSchema.safeParse({ ...draft, kind: 'replace', from: '旧触发器', updateOf: ['a'] }).success).toBe(false);
  expect(postgresTriggerChangeSchema.safeParse({ ...draft, kind: 'replace', from: '旧触发器', events: ['INSERT'] }).success).toBe(false);
});

it('PostgreSQL 行级安全策略区分命令、PUBLIC、条件清除和原位修改', () => {
  const old = { oid: '33', name: 'tenant', command: 'ALL' as const, permissive: true, comment: null, rebuildBlocked: false,
    roles: [{ oid: '0', name: 'PUBLIC' }], using: 'tenant = CURRENT_USER', check: null };
  const draft = { kind: 'edit' as const, from: 'tenant', command: 'ALL' as const, permissive: true,
    roles: null, using: 'tenant = CURRENT_USER -- 保留原行', check: null };
  expect(postgresPolicyChangeSchema.parse(draft)).toEqual(draft);
  expect(postgresPolicyRequiresReplacement(old, draft)).toBe(false);
  expect(postgresPolicyRequiresReplacement(old, { ...draft, using: null })).toBe(true);
  expect(postgresPolicyRequiresReplacement(old, { ...draft, command: 'SELECT' })).toBe(true);
  expect(postgresPolicyRequiresReplacement(old, { ...draft, permissive: false })).toBe(true);
  for (const change of [
    { ...draft, roles: [] }, { ...draft, roles: ['reader', 'reader'] },
    { ...draft, command: 'INSERT' }, { ...draft, command: 'SELECT', check: 'true' },
    { ...draft, using: 'true) WITH CHECK (true' }, { ...draft, using: 'true; DROP TABLE x' },
    { ...draft, using: '$1' }, { ...draft, sql: 'ALTER TABLE arbitrary' },
  ]) expect(postgresPolicyChangeSchema.safeParse(change).success).toBe(false);
});
