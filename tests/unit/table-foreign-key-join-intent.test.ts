import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { foreignKeyJoinPreview, fixedForeignKeyJoinStart, revalidateForeignKeyJoin, TableForeignKeyJoinIntent, type ForeignKeyJoinTarget } from '../../src/renderer/tableForeignKeyJoinIntent';
import { buildForeignKeyJoin, type ManualJoinPair, type ManualJoinStep } from '../../src/renderer/tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';

/** 完全合成的目录，不创建数据库会话或伪造查询执行成功。 */
function tables() {
  const table = (database: string, name: string, names: string[]): TableInfo => ({ database, name, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], primaryKey: [], editableKey: [], foreignKeys: [], columns: names.map(name => ({ name, type: 'bigint unsigned', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })) });
  const child = table('child_db', 'child', ['id', 'parent_id']), parent = table('parent_db', 'parent', ['id', 'value']);
  child.foreignKeys.push({ name: 'fk', columns: ['parent_id'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  return { child, parent };
}
function fixture() { const source = tables(), identity = {}, intent = new TableForeignKeyJoinIntent(source.child, 'connection', 77, [identity], () => true); return { ...source, identity, intent, preview: () => foreignKeyJoinPreview(intent, source.parent, 'fk', 'LEFT', { childColumns: ['id'], parentColumns: ['value'] }) }; }

describe('外键JOIN原结构与前置核验租约', () => {
  it.each(['=', '<>', '<', '<=', '>', '>='] as const)('手动条件只输出允许的比较符 %s', operator => {
    const { child, parent } = tables();
    const query = buildForeignKeyJoin(child, parent, [{ child: 'parent_id', operator, parent: 'id' }], 'INNER', 1);
    expect(query.sql).toContain('ON\n  c.`parent_id` ' + operator + ' p.`id`\n');
  });

  it('同一对列可用不同运算符，精确重复及未知比较符不能生成预览', () => {
    const { child, parent } = tables();
    const pairs: ManualJoinPair[] = [
      { child: 'id', operator: '>=', parent: 'id' },
      { child: 'id', operator: '<', parent: 'value' },
      { child: 'id', operator: '<>', parent: 'id' },
    ];
    const intent = new TableForeignKeyJoinIntent(child, 'connection', 1, [], () => true);
    const options = { childColumns: ['id'], parentColumns: ['value'], unmatchedOnly: true };
    const preview = foreignKeyJoinPreview(intent, parent, pairs, 'LEFT', options);
    expect(preview.sql).toContain('ON\n  c.`id` >= p.`id`\n  AND c.`id` < p.`value`\n  AND c.`id` <> p.`id`\nWHERE p.`id` IS NULL');
    pairs[0].operator = '=';
    expect(preview.relation).toMatchObject([{ operator: '>=' }, { operator: '<' }, { operator: '<>' }]);
    expect(() => intent.consume({ ...preview, relation: pairs })).toThrow(text.stale);
    for (const operator of ['<=>', 'OR 1=1', null]) {
      const invalid = [{ child: 'id', operator, parent: 'id' }] as unknown as ManualJoinPair[];
      expect(() => buildForeignKeyJoin(child, parent, invalid, 'INNER', 1)).toThrow(text.manualInvalid);
    }
    expect(() => buildForeignKeyJoin(child, parent, [{ child: 'id', parent: 'id' }, pairs[0]], 'INNER', 1)).toThrow(text.manualInvalid);
  });
  it('按顺序引用此前任一表，重用物理表时保持不同输出别名并只重读一次', async () => {
    const { child, parent, intent } = fixture();
    const third = { ...parent, name: 'third' };
    const pairs: ManualJoinPair[] = [{ child: 'parent_id', parent: 'id' }];
    const additionalJoins: ManualJoinStep[] = [
      { source: 1, target: third, kind: 'LEFT', pairs: [{ child: 'id', parent: 'id' }], columns: ['value'] },
      { source: 2, target: parent, kind: 'INNER', pairs: [{ child: 'value', operator: '>=', parent: 'value' }], columns: ['value'] },
    ];
    const options = { childColumns: ['id'], parentColumns: [], additionalJoins };
    const draft = foreignKeyJoinPreview(intent, parent, pairs, 'INNER', options);
    expect(draft.sql).toContain('t3.`value` AS `t3_2_value`,\n  t4.`value` AS `t4_2_value`');
    expect(draft.sql).toContain('LEFT JOIN `parent_db`.`third` AS t3\nON\n  p.`id` = t3.`id`\nINNER JOIN `parent_db`.`parent` AS t4\nON\n  t3.`value` >= t4.`value`');
    const read = vi.fn(async (target: ForeignKeyJoinTarget) => [child, parent, third].find(info => info.name === target.table)!);
    await revalidateForeignKeyJoin(intent, draft, read, () => true);
    expect(read.mock.calls.map(([target]) => target.table)).toEqual(['child', 'parent', 'third']);
    expect(intent.consume(draft)).toBe(draft.sql);
    expect(() => intent.consume(draft)).toThrow(text.stale);
  });

  it('手动 ON 支持 OR 与嵌套括号，外连接只识别整侧补空行', () => {
    const { child, parent } = tables();
    const relation: ManualJoinPair[] = [
      { child: 'parent_id', parent: 'id' }, { child: 'id', parent: 'value' },
    ];
    const base = { childColumns: ['id'], parentColumns: ['value'], unmatchedOnly: true };
    const left = buildForeignKeyJoin(child, parent, relation, 'LEFT', 1, { ...base, manualOn: { mode: 'any' } }).sql;
    expect(left).toContain('ON\n  c.`parent_id` = p.`id`\n  OR c.`id` = p.`value`\nWHERE p.`id` IS NULL AND p.`value` IS NULL');
    const right = buildForeignKeyJoin(child, parent, relation, 'RIGHT', 1, { ...base, manualOn: { mode: 'any' } }).sql;
    expect(right).toContain('WHERE c.`parent_id` IS NULL AND c.`id` IS NULL');
    const step: ManualJoinStep = { source: 1, target: parent, kind: 'LEFT', columns: [],
      pairs: [{ child: 'id', parent: 'id' }, { source: 0, child: 'id', parent: 'value' }, { child: 'value', parent: 'value' }],
      on: { mode: 'all', group: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] } } };
    expect(buildForeignKeyJoin(child, parent, relation, 'LEFT', 1, { ...base, additionalJoins: [step] }).sql).toContain(
      'ON\n  ((p.`id` = t3.`id` OR c.`id` = t3.`value`) AND p.`value` = t3.`value`)\nWHERE p.`id` IS NULL');
    for (const children of [[0], [0, 0], [0, 2]]) {
      expect(() => buildForeignKeyJoin(child, parent, relation, 'LEFT', 1, { ...base, manualOn: {
        mode: 'any', group: { mode: 'any', children },
      } })).toThrow(text.manualOnInvalid);
    }
    expect(() => buildForeignKeyJoin(child, parent, 'fk', 'LEFT', 1, { ...base, manualOn: { mode: 'any' } })).toThrow(text.manualOnInvalid);
  });

  it('追加 ON 逐条绑定已加入的别名，旧设计和新条件可混用', () => {
    const { child, parent } = tables();
    const relation: ManualJoinPair[] = [{ child: 'parent_id', parent: 'id' }];
    const step: ManualJoinStep = {
      source: 1, target: parent, kind: 'LEFT', columns: ['value'],
      pairs: [
        { child: 'id', parent: 'id' },
        { source: 0, child: 'id', parent: 'id' },
        { source: 1, child: 'value', operator: '>=', parent: 'value' },
      ],
    };
    const options = { childColumns: [], parentColumns: [], additionalJoins: [step] };
    const build = () => buildForeignKeyJoin(child, parent, relation, 'INNER', 10, options);
    expect(build().sql).toContain('ON\n  p.`id` = t3.`id`\n  AND c.`id` = t3.`id`\n  AND p.`value` >= t3.`value`');
    step.pairs = [...step.pairs, { source: 1, child: 'id', parent: 'id' }];
    expect(build).toThrow(text.manualInvalid);
    step.pairs = [{ source: 2, child: 'id', parent: 'id' }];
    expect(build).toThrow(text.manualInvalid);
    step.pairs = [{ source: 0, child: 'value', parent: 'value' }];
    expect(build).toThrow(text.manualInvalid);
    const first = [{ source: 0, child: 'parent_id', parent: 'id' }];
    expect(() => buildForeignKeyJoin(child, parent, first, 'INNER', 10)).toThrow(text.manualInvalid);
  });

  it('追加表字段参与 WHERE、DISTINCT 排序和严格汇总，来源按别名区分', () => {
    const { child, parent } = tables();
    const relation: ManualJoinPair[] = [{ child: 'parent_id', parent: 'id' }];
    const additionalJoins: ManualJoinStep[] = [
      { source: 1, target: parent, kind: 'LEFT', pairs: [{ child: 'id', parent: 'id' }], columns: ['value'] },
      { source: 2, target: parent, kind: 'LEFT', pairs: [{ child: 'value', parent: 'value' }], columns: [] },
    ];
    const options = {
      childColumns: [], parentColumns: [], additionalJoins,
      filters: [{ side: 't4', column: 'value', operator: 'IS NOT NULL' }] as const,
      sort: [{ side: 't3', column: 'value', direction: 'DESC', nulls: 'LAST' }] as const,
    };
    const detail = buildForeignKeyJoin(child, parent, relation, 'INNER', 10, { ...options, distinct: true });
    expect(detail.sql).toMatch(/^SELECT DISTINCT\n  t3\.`value` AS `t3_2_value`/);
    expect(detail.sql).toContain('WHERE (((t4.`value` IS NOT NULL)))\nORDER BY (t3.`value` IS NULL) ASC, t3.`value` DESC');
    expect(() => buildForeignKeyJoin(child, parent, relation, 'INNER', 10, { ...options, distinct: true,
      sort: [{ side: 't4', column: 'value', direction: 'DESC' }] })).toThrow(text.distinctSort);
    expect(() => buildForeignKeyJoin(child, parent, relation, 'INNER', 10, { ...options,
      additionalJoins: additionalJoins.slice(0, 1) })).toThrow();
    const summary = buildForeignKeyJoin(child, parent, relation, 'INNER', 10, {
      ...options, summary: {
        groups: [{ side: 't3', column: 'value' }],
        aggregates: [{ fn: 'SUM', side: 't4', column: 'value', alias: 'total' }],
      },
      having: { filters: [{ column: 'total', operator: '>', value: '0' }] },
      sort: [{ side: 't3', column: 'value', direction: 'ASC' }, { side: 'aggregate', column: 'total', direction: 'DESC' }],
    });
    expect(summary.sql).toContain('t3.`value` AS `t3_2_value`,\n  SUM(t4.`value`) AS `total`');
    expect(summary.sql).toContain('GROUP BY t3.`value`\nHAVING ((SUM(t4.`value`) > ');
    expect(summary.sql).toContain('ORDER BY t3.`value` ASC, SUM(t4.`value`) DESC');
  });

  it('禁止前向引用，最后一张表变化后不放行原预览', async () => {
    const { child, parent, intent } = fixture();
    const third = { ...parent, name: 'third' };
    const relation: ManualJoinPair[] = [{ child: 'parent_id', parent: 'id' }];
    const step: ManualJoinStep = { source: 2, target: third, kind: 'LEFT', pairs: [{ child: 'id', parent: 'id' }], columns: ['id'] };
    const options = { childColumns: [], parentColumns: [], additionalJoins: [step] };
    expect(() => foreignKeyJoinPreview(intent, parent, relation, 'LEFT', options)).toThrow(text.manualInvalid);
    step.source = 0;
    const draft = foreignKeyJoinPreview(intent, parent, relation, 'LEFT', options);
    step.columns = [];
    expect(draft.options.additionalJoins?.[0].columns).toEqual(['id']);
    const changed = structuredClone(third);
    changed.columns[0].type = 'int';
    const read = vi.fn(async (target: ForeignKeyJoinTarget) => [child, parent, changed].find(info => info.name === target.table)!);
    await expect(revalidateForeignKeyJoin(intent, draft, read, () => true)).rejects.toThrow(text.stale);
    expect(intent.current()).toBe(false);
  });

  it('没有外键也可生成跨库复合 JOIN，配对被快照固定，换目标结构不能打开旧 SQL', async () => {
    const { child, parent } = tables();
    child.foreignKeys = [];
    const intent = new TableForeignKeyJoinIntent(child, 'connection', 50, [], () => true);
    const pairs = [{ child: 'parent_id', parent: 'id' }, { child: 'id', parent: 'value' }];
    const options = { childColumns: ['id'], parentColumns: ['value'] };
    const preview = foreignKeyJoinPreview(intent, parent, pairs, 'INNER', options);
    expect(preview.sql).toContain('FROM `child_db`.`child` AS c\nINNER JOIN `parent_db`.`parent` AS p\nON\n  c.`parent_id` = p.`id`\n  AND c.`id` = p.`value`');
    pairs[0].child = 'id';
    expect(preview.relation).toEqual([{ child: 'parent_id', parent: 'id' }, { child: 'id', parent: 'value' }]);
    expect(() => intent.consume({ ...preview, relation: pairs })).toThrow(text.stale);
    for (const wrong of [[], [pairs[0], pairs[0]], [{ child: 'id', parent: '任意表达式()' }]]) {
      expect(() => foreignKeyJoinPreview(intent, parent, wrong, 'INNER', options)).toThrow(text.manualInvalid);
    }
    await expect(revalidateForeignKeyJoin(intent, preview, async target => target.table === child.name ? child : { ...parent, columns: parent.columns.slice(0, 1) }, () => true)).rejects.toThrow(text.stale);
  });
  it('入向目录必须与新读到的真实子表及完整有序映射一致', () => {
    const { child, parent } = tables();
    child.foreignKeys[0].columns = ['parent_id', 'id'];
    child.foreignKeys[0].referencedColumns = ['id', 'value'];
    const relation = { database: child.database, table: child.name, foreignKey: structuredClone(child.foreignKeys[0]), digest: 'a'.repeat(64) };
    expect(fixedForeignKeyJoinStart(parent, relation, child, 'RIGHT')).toEqual({ parent, foreignKey: 'fk', kind: 'RIGHT' });
    expect(() => fixedForeignKeyJoinStart(parent, relation, { ...child, database: '另一个库' }, 'RIGHT')).toThrow(text.stale);
    expect(() => fixedForeignKeyJoinStart(parent, {
      ...relation, foreignKey: { ...relation.foreignKey, columns: ['id', 'parent_id'] },
    }, child, 'RIGHT')).toThrow(text.stale);
    expect(() => fixedForeignKeyJoinStart(parent, {
      ...relation, foreignKey: { ...relation.foreignKey, onUpdate: 'CASCADE' },
    }, child, 'RIGHT')).toThrow(text.stale);
  });
  it('WHERE及模式冻结，打开前核未输出筛选列，原选项变更不能消费旧SQL',async()=>{const f=fixture(),filters=[{side:'parent' as const,column:'value',operator:'BETWEEN' as const,values:['1','2']}],preview=foreignKeyJoinPreview(f.intent,f.parent,'fk','LEFT',{childColumns:['id'],parentColumns:[],filters,filterMode:'any'});filters[0].values[0]='999';expect(preview.options.filters![0].values).toEqual(['1','2']);expect(Object.isFrozen(preview.options.filters![0].values)).toBe(true);expect(()=>f.intent.consume({...preview,options:{...preview.options,filterMode:'all',filters:[{side:'child',column:'id',operator:'IS NULL'}]}})).toThrow();const read=vi.fn(async(target:ForeignKeyJoinTarget)=>target.table===f.child.name?f.child:{...f.parent,columns:f.parent.columns.map(column=>column.name==='value'?{...column,type:'TEXT'}:column)});await expect(revalidateForeignKeyJoin(f.intent,preview,read,()=>true)).rejects.toThrow(text.stale);expect(f.intent.current()).toBe(false);});
  it('排序和上限共同冻结并参与打开前双表重核，旧字符串不能改写显式选择', async () => {
    const f=fixture(),options={childColumns:['id'],parentColumns:[],sort:[{side:'parent' as const,column:'value',direction:'DESC' as const,nulls:'LAST' as const}],limit:3},preview=foreignKeyJoinPreview(f.intent,f.parent,'fk','LEFT',options),read=vi.fn(async(target:ForeignKeyJoinTarget)=>target.table===f.child.name?f.child:f.parent);options.sort[0].column='id';expect(preview.options.sort![0].column).toBe('value');expect(Object.isFrozen(preview.options.sort![0])).toBe(true);await revalidateForeignKeyJoin(f.intent,preview,read,()=>true);expect(read).toHaveBeenCalledTimes(2);expect(f.intent.consume(preview)).toContain('p.`value` DESC\nLIMIT 3;');
  });
  it('伪造预览中的排序或上限不会沿用旧SQL消费一次打开能力', () => {
    const f=fixture(),preview=f.preview();for(const options of [{...preview.options,limit:2},{...preview.options,sort:[{side:'child' as const,column:'id',direction:'DESC' as const}]}])expect(()=>f.intent.consume({...preview,options})).toThrow(text.stale);expect(f.intent.current()).toBe(true);
  });
  it('预览在复制选项前拒绝排序及上限getter，不调用任意访问器', () => {
    const f=fixture(),getter=vi.fn(()=>5),options={childColumns:['id'],parentColumns:[]};Object.defineProperty(options,'limit',{enumerable:true,get:getter});expect(()=>foreignKeyJoinPreview(f.intent,f.parent,'fk','LEFT',options)).toThrow();expect(getter).not.toHaveBeenCalled();
  });
  it('不可枚举上限或排序不会在structuredClone时丢失并悄悄回退为默认查询', () => {
    const f=fixture();for(const [key,value]of [['limit',2],['sort',[{side:'child',column:'id',direction:'DESC'}]]]as const){const options={childColumns:['id'],parentColumns:[]};Object.defineProperty(options,key,{value,enumerable:false});expect(()=>foreignKeyJoinPreview(f.intent,f.parent,'fk','LEFT',options)).toThrow();}
  });
  it('固定只读结构不持有行或DDL条件，前置串行读同连接双方结构后仅消费一次', async () => {
    const f = fixture(), preview = f.preview(), read = vi.fn(async (target: ForeignKeyJoinTarget) => target.table === f.child.name ? f.child : f.parent);
    await revalidateForeignKeyJoin(f.intent, preview, read, () => true);
    expect(read.mock.calls.map(([target]) => target)).toEqual([{ connectionId: 'connection', database: 'child_db', table: 'child' }, { connectionId: 'connection', database: 'parent_db', table: 'parent' }]);
    expect(f.intent.consume(preview)).toBe(preview.sql); expect(preview.sql).toContain('LIMIT 77;'); expect(preview.sql).not.toMatch(/WHERE|ORDER BY|INSERT|UPDATE|DELETE/); expect(() => f.intent.consume(preview)).toThrow(text.stale);
  });
  it('观察导航ABA或guard失败后不能恢复同一个来源', () => {
    const f = fixture(); f.intent.observe([{}]); f.intent.observe([f.identity]); expect(f.intent.current()).toBe(false); expect(() => f.preview()).toThrow(text.stale);
    let current = true; const intent = new TableForeignKeyJoinIntent(f.child, 'connection', 1, [], () => current); current = false; expect(intent.current()).toBe(false); current = true; expect(intent.current()).toBe(false);
  });
  it.each(['child', 'parent'] as const)('打开前%s目录改变即拒绝旧SQL，不自动换用新结构', async side => {
    const f = fixture(), preview = f.preview(), changed = structuredClone(f[side]); changed.columns[0].type = 'varchar(64)';
    const read = vi.fn(async (target: ForeignKeyJoinTarget) => target.table === f.child.name ? side === 'child' ? changed : f.child : side === 'parent' ? changed : f.parent);
    await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => true)).rejects.toThrow(text.stale); expect(f.intent.current()).toBe(false); expect(read).toHaveBeenCalledTimes(side === 'child' ? 1 : 2);
  });
  it('子表核验在途后失效不再开始父表读取，也不吞原权限错误', async () => {
    const f = fixture(), preview = f.preview(); let active = true;
    const read = vi.fn(async () => { active = false; return f.child; }); await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => active)).rejects.toThrow(text.stale); expect(read).toHaveBeenCalledOnce();
    const g = fixture(), denied = vi.fn(async () => { throw Error('真实父目录权限拒绝'); }); await expect(revalidateForeignKeyJoin(g.intent, g.preview(), denied, () => true)).rejects.toThrow('真实父目录权限拒绝');
  });
  it('父表错目标拒绝，DDL文字改变不代替相关结构身份', async () => {
    const f = fixture(); expect(() => foreignKeyJoinPreview(f.intent, { ...f.parent, database: 'wrong' }, 'fk', 'LEFT', { childColumns: ['id'], parentColumns: [] })).toThrow(text.target);
    const preview = f.preview(), read = vi.fn(async (target: ForeignKeyJoinTarget) => ({ ...structuredClone(target.table === f.child.name ? f.child : f.parent), ddl: '无关AUTO_INCREMENT目录文字改变' }));
    await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => true)).resolves.toBeUndefined();
  });
  it('自关联前置核验只读一次原表，选列和输入对象都不被回执改写', async () => {
    const { child } = tables(); child.foreignKeys[0].referencedDatabase = child.database; child.foreignKeys[0].referencedTable = child.name;
    const source = structuredClone(child), intent = new TableForeignKeyJoinIntent(child, 'self', 5, [], () => true), options = { childColumns: ['id'], parentColumns: ['parent_id'] };
    const preview = foreignKeyJoinPreview(intent, child, 'fk', 'INNER', options), read = vi.fn(async () => child); options.parentColumns[0] = 'id';
    await revalidateForeignKeyJoin(intent, preview, read, () => true); expect(read).toHaveBeenCalledOnce(); expect(preview.options.parentColumns).toEqual(['parent_id']); expect(child).toEqual(source);
  });
});
