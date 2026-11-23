import { expect, it } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionLimits as limits } from '../../src/shared/sqliteCompletion';
function query(marked:string){const offset=marked.indexOf('|');if(offset<0)throw Error('缺少光标');const source=marked.slice(0,offset)+marked.slice(offset+1);return{source,offset};}
function analyze(marked:string){const input=query(marked);return analyzeSqliteCompletion(input.source,input.offset);}
function ready(marked:string){const input=query(marked),value=analyzeSqliteCompletion(input.source,input.offset);expect(value.status).toBe('ready');if(value.status!=='ready')throw Error(value.reason);expect(validateSqliteCompletionAnalysis(value,input.source,input.offset)).toEqual(value);return value;}

it.each([
  ['SELECT v AS picked FROM subject ORDER BY (pi|cked COLLATE nocase) DESC NULLS LAST', 'order', true],
  ['SELECT v AS picked FROM subject ORDER BY abs(pi|cked)', 'order', undefined],
  ['SELECT v AS picked FROM subject ORDER BY v, pi|cked', 'order', true],
  ['SELECT max(v, 1) picked FROM subject GROUP BY v, pi|cked', 'group', undefined],
  ['SELECT count(*) picked FROM subject HAVING pi|cked > 0', 'having', undefined],
  ['SELECT (SELECT count(*) FROM others) AS picked FROM subject WHERE pi|cked > 0', 'where', undefined],
] as const)('普通查询按使用位置提供别名和解析顺序：%s', (sql, clause, outputFirst) => {
  const value = ready(sql);
  expect(value.outputAliases).toEqual({ clause, scopeDepth: 0, names: ['picked'], ...(outputFirst ? { outputFirst } : {}) });
  expect(value.relations).toEqual([{ kind: 'physical', name: 'subject', scopeDepth: 0 }]);
});

it.each([
  'SELECT sum(v) AS picked FROM subject GROUP BY pi|cked',
  'SELECT min(v) AS picked FROM subject WHERE pi|cked > 0',
  'SELECT row_number() OVER () AS picked FROM subject GROUP BY v HAVING pi|cked > 0',
  'SELECT row_number() OVER () AS picked FROM subject WHERE pi|cked > 0',
  'SELECT v AS picked FROM subject ORDER BY row_number() OVER (ORDER BY pi|cked)',
  'SELECT v AS picked FROM subject ORDER BY count(*) FILTER (WHERE pi|cked > 0)',
  'SELECT v AS picked FROM subject ORDER BY v COLLATE pi|cked',
  'SELECT v AS picked FROM subject ORDER BY v NULLS LAST |',
  'SELECT v AS picked FROM subject ORDER BY v LIMIT pi|cked',
  'SELECT v AS picked FROM subject ORDER BY subject.pi|cked',
  'SELECT v AS picked FROM subject WHERE EXISTS (SELECT 1 WHERE pi|cked > 0)',
  'SELECT v COLLATE picked FROM subject ORDER BY pi|cked',
  'SELECT v BETWEEN 0 AND picked FROM subject ORDER BY pi|cked',
])('排除当前位置不可用的输出别名：%s', sql => {
  const value = analyze(sql);
  if (value.status === 'ready') expect(value.outputAliases).toBeUndefined();
});

it('在相关子查询记录别名自身层级和当前块来源，不把未知外层来源算作同级', () => {
  const value = ready('SELECT (SELECT 1 AS picked WHERE pi|cked > 0) FROM parent');
  expect(value.outputAliases).toEqual({ clause: 'where', scopeDepth: 1, names: ['picked'] });
  expect(value.relations).toEqual([{ kind: 'physical', name: 'parent', scopeDepth: 0 }]);
  const unknown = ready('SELECT 1 AS picked FROM (SELECT v+1 FROM subject) d WHERE pi|cked > 0');
  expect(unknown.outputAliases).toEqual({ clause: 'where', scopeDepth: 0, names: ['picked'], sourcesIncomplete: true });
  const unknownOuter = ready('SELECT (SELECT 1 AS picked WHERE pi|cked > 0) FROM (SELECT v+1 FROM subject) d');
  expect(unknownOuter.outputAliases).toEqual(value.outputAliases);
});

it('回包校验要求别名前缀、使用位置和来源层级匹配', () => {
  const marked = 'SELECT v AS picked FROM subject GROUP BY pi|cked', value = ready(marked);
  const { source, offset } = query(marked);
  for (const patch of [{ names: ['other'] }, { names: [] }, { outputFirst: true }, { scopeDepth: -1 }]) {
    expect(() => validateSqliteCompletionAnalysis({ ...value, outputAliases: { ...value.outputAliases, ...patch } }, source, offset)).toThrow();
  }
  for (const scopeDepth of [undefined, 1]) {
    const relations = [{ ...value.relations[0], scopeDepth }];
    expect(() => validateSqliteCompletionAnalysis({ ...value, relations }, source, offset)).toThrow();
  }
});
it('SELECT别名可向后读取准确FROM，限定字段只替当前标识符而不借MySQL词法',()=>{const value=ready('SELECT t.na|me FROM main."用户🚢" AS t');expect(value.target).toMatchObject({prefix:'na',quoted:false});expect(value.qualifiers).toEqual(['t']);expect(value.relations).toEqual([{kind:'physical',schema:'main',name:'用户🚢',alias:'t'}]);expect(value.syntax).toEqual(['column','keyword']);});
it('未限定物理表保schema省略让后端temp优先，main/temp显式目标保独立',()=>{expect(ready('SELECT | FROM subject').relations).toEqual([{kind:'physical',name:'subject'}]);expect(ready('SELECT t.| FROM temp.subject t').relations).toEqual([{kind:'physical',schema:'temp',name:'subject',alias:'t'}]);expect(ready('SELECT main.subject.| FROM main.subject').qualifiers).toEqual(['main','subject']);expect(ready('SELECT * FROM temp.|').syntax).toContain('relation');});
it('JOIN和同物理表不同alias保准确两个绑定；重复alias明确阻断歧义',()=>{expect(ready('SELECT a.| FROM subject a JOIN subject b ON a.id=b.id').relations).toEqual([{kind:'physical',name:'subject',alias:'a'},{kind:'physical',name:'subject',alias:'b'}]);expect(analyze('SELECT x.| FROM a x JOIN b x')).toMatchObject({status:'blocked',reason:'ambiguous'});});
it('混合JOIN ON后逗号仍属于FROM关系，不把ON内嵌函数逗号当表',()=>{const value=ready('SELECT c.| FROM a x JOIN b y ON coalesce(x.id,0)=y.id, c');expect(value.relations.map(item=>item.name)).toEqual(['a','b','c']);});
it('括号连接的成员在外部查询仍可单独限定，嵌套括号和函数参数不增加虚假来源', () => {
  const value = ready('SELECT j.va|lue FROM ((main.doc d JOIN json_each(coalesce(d.payload,\'[]\')) j ON 1), temp.other o)');
  expect(value.relations).toEqual([
    { kind: 'physical', name: 'doc', schema: 'main', alias: 'd' },
    { kind: 'physical', name: 'json_each', alias: 'j', tableFunction: true },
    { kind: 'physical', name: 'other', schema: 'temp', alias: 'o' },
  ]);
  expect(ready('SELECT * FROM a JOIN (b JOIN main.|) ON 1').syntax).toContain('relation');
  expect(ready('SELECT * FROM a JOIN (|').syntax).toContain('relation');
});
it('括号连接内部的 ON 和表值函数实参使用组内来源，限定不串到同查询块的其他组', () => {
  expect(ready('SELECT * FROM external e JOIN (a x JOIN b y ON x.i|d=y.id) ON e.id=x.id').relations)
    .toEqual([{ kind: 'physical', name: 'a', alias: 'x' }, { kind: 'physical', name: 'b', alias: 'y' }]);
  expect(ready('SELECT * FROM external e JOIN ((a x JOIN json_each(x.pa|yload) j ON 1), b y) ON 1').relations)
    .toEqual([{ kind: 'physical', name: 'a', alias: 'x' }]);
  expect(ready('SELECT * FROM (a x JOIN b y ON x.i|d=y.id) AS exposed').relations.map(relation => relation.alias))
    .toEqual(['x', 'y']);
  expect(ready('SELECT * FROM (a x JOIN b y ON future.i|d=y.id), c future').relations.map(relation => relation.alias))
    .toEqual(['x', 'y', 'future']);
});
it('单来源括号别名覆盖原限定符，定义定位到外部的别名声明', () => {
  const marked = 'SELECT ou|ter_alias.id FROM ((main.data_table AS inner_alias)) AS outer_alias JOIN other o ON 1';
  const { source, offset } = query(marked);
  const value = analyzeSqliteCompletion(source, offset, 'definition');
  const start = source.lastIndexOf('outer_alias');
  expect(value).toMatchObject({ status: 'ready', definition: { start, end: start + 'outer_alias'.length } });
  expect(ready('SELECT g.i|d FROM (main.data_table AS inner_alias) g').relations)
    .toEqual([{ kind: 'physical', name: 'data_table', schema: 'main', alias: 'g' }]);
  expect(ready('SELECT data_table.i|d FROM main.other o JOIN (main.data_table AS removed) ON 1').relations)
    .toEqual([{ kind: 'physical', name: 'other', schema: 'main', alias: 'o' }, { kind: 'physical', name: 'data_table', schema: 'main' }]);
});
it('括号内 USING 与复合星号通过原目录身份映射物理表和表值函数', () => {
  expect(ready('SELECT * FROM outside s, (main.a x JOIN temp.b y USING (i|d))').using).toEqual({
    left: [{ operand: { source: { name: 'a', schema: 'main' } } }], right: { source: { name: 'b', schema: 'temp' } }, used: [],
  });
  expect(ready("SELECT j.* FROM (doc d JOIN json_each(d.payload) j) UNION ALL SELECT j.* FROM (json_each('[]') j) ORDER BY va|").output)
    .toEqual({ columns: [], sources: [{ name: 'json_each', tableFunction: true }] });
  expect(ready('SELECT * FROM ((a LEFT JOIN b USING(id))) FULL JOIN c USING(i|d)').using).toEqual({
    left: [{ operand: { source: { name: 'a' } } }, { operand: { source: { name: 'b' } }, merged: ['id'] }],
    right: { source: { name: 'c' } }, used: [], uniqueLeft: true,
  });
  expect(ready('SELECT * FROM (a JOIN b USING(i|d)) FULL JOIN c USING(id)').using?.uniqueLeft).toBe(true);
  expect(ready('SELECT * FROM a FULL JOIN (b JOIN c USING(i|d)) ON 1').using?.uniqueLeft).toBeUndefined();
});
it('嵌套为内置查询的组外字段仅含投影列，复合排序只交付实际命中成员的分组树', () => {
  const value = ready("SELECT j.va|lue FROM doc d JOIN (payload p JOIN json_each(p.body) j ON 1) ON 1");
  expect(value.relations).toContainEqual({ kind: 'physical', name: 'json_each', alias: 'j', tableFunction: true, visibleColumnsOnly: true });
  expect(ready('SELECT 1 AS known UNION ALL SELECT y.* FROM a JOIN (b x JOIN c y USING(id)) ON 1 ORDER BY |').output)
    .toEqual({ columns: ['known'], sources: [], joinStars: [{ groups: [{ inputs: [
      { operand: { source: { name: 'b' } }, binding: 'x' }, { operand: { source: { name: 'c' } }, binding: 'y', merged: ['id'] },
    ] }], members: [{ group: 0, binding: 'y' }] }] });
});
it('复合排序的裸星号保留外层 JOIN 约束，共用树的多个星号不会重复登记同一组', () => {
  const value = ready('SELECT *, y.* FROM outside o JOIN (a x JOIN b y USING(id)) USING(id) UNION ALL SELECT 1 AS known ORDER BY i|d');
  expect(value.output).toEqual({ columns: ['known'], sources: [], joinStars: [{
    groups: [{ inputs: [{ operand: { source: { name: 'a' } }, binding: 'x' },
      { operand: { source: { name: 'b' } }, binding: 'y', merged: ['id'] }] }],
    all: [{ operand: { source: { name: 'outside' } } }, { operand: { group: 0 }, merged: ['id'] }], members: [{ group: 0, binding: 'y' }],
  }] });
  const invalid = ready('SELECT g.* FROM (a x JOIN b y) AS g UNION ALL SELECT 1 AS known ORDER BY |');
  expect(invalid.output).toEqual({ columns: ['known'], sources: [], incomplete: true });
});
it('复合排序分组树回包拒绝错误组号、重复成员和多余投影', () => {
  const { source, offset } = query('SELECT y.* FROM outside JOIN (a x JOIN b y) UNION ALL SELECT 1 ORDER BY |');
  const value = ready('SELECT y.* FROM outside JOIN (a x JOIN b y) UNION ALL SELECT 1 ORDER BY |');
  const star = value.output!.joinStars![0];
  for (const invalid of [{ ...star, members: [{ group: 1, binding: 'y' }] }, { ...star, members: [...star.members!, ...star.members!] },
    { ...star, groups: [...star.groups, ...star.groups] }, { ...star, members: undefined }]) {
    expect(() => validateSqliteCompletionAnalysis({ ...value, output: { ...value.output, joinStars: [invalid] } }, source, offset)).toThrow();
  }
  const branch = (prefix: string) => ({ members: star.members, groups: [{ inputs: Array.from({ length: 9 }, (_, index) => ({
    operand: { source: { name: prefix + index } }, binding: 'y',
  })) }] });
  expect(() => validateSqliteCompletionAnalysis({ ...value, output: { ...value.output, joinStars: [branch('a'), branch('b')] } }, source, offset)).toThrow();
});
it('当前statement之外的前后物理表不会进入补全',()=>{expect(ready('SELECT a. FROM prior a; SELECT b.| FROM actual b; SELECT c. FROM later c').relations).toEqual([{kind:'physical',name:'actual',alias:'b'}]);});
it('UTF16、CRLF与双引号重复转义保完整替换范围和准确prefix',()=>{const marked='SELECT\r\n t."co""l|umn🚢" FROM "表🚢" t',input=query(marked),value=ready(marked);expect(value.target).toEqual({start:input.source.indexOf('"co'),end:input.source.indexOf('" FROM')+1,prefix:'co"l',quoted:true});expect(input.source.slice(value.target.start,value.target.end)).toBe('"co""lumn🚢"');expect(value.qualifiers).toEqual(['t']);});
it('backtick重复转义和方括号完整名可识别；方括号不伪造]]转义',()=>{expect(ready('SELECT t.\u0060a\u0060\u0060b|c\u0060 FROM [表.🚢] t').target).toMatchObject({prefix:'a\u0060b',quoted:true});expect(ready('SELECT t.[a.|b] FROM subject t').target).toMatchObject({prefix:'a.',quoted:true});expect(analyze('SELECT [a|]]b] FROM subject')).toMatchObject({status:'blocked',reason:'syntax'});});
it('未闭合标识符允许当前输入完成，完整后缀仍纳入替换范围',()=>{expect(ready('SELECT t."字🚢| FROM subject t').target).toMatchObject({quoted:true,prefix:'字🚢'});const value=ready('SELECT t."pre|suffix" FROM subject t');expect(value.target.prefix).toBe('pre');expect(value.target.end-value.target.start).toBe('"presuffix"'.length);});
it.each(["SELECT 'str|ing' FROM t","SELECT 'it''s| literal' FROM t","SELECT 'back\\|slash' FROM t"])('单引号字符串不触发字段补全 %#',source=>{expect(analyze(source)).toMatchObject({status:'blocked',reason:'string'});});
it.each(['SELECT --no-space|FROM secret','SELECT /* block | FROM secret */ 1','SELECT /*! vendor | */ 1','SELECT /* first /*nested | */ FROM visible'])('SQLite注释中明确blocked，/*!只是普通注释 %#',source=>{expect(analyze(source)).toMatchObject({status:'blocked',reason:'comment'});});
it('注释不泄露假FROM；--不需空白且块注释不嵌套，#不是注释',()=>{expect(ready('SELECT t.| --comment\n FROM actual t /* FROM secret */').relations).toEqual([{kind:'physical',name:'actual',alias:'t'}]);expect(analyze('SELECT #not_comment\n t.| FROM actual t')).toMatchObject({status:'blocked',reason:'syntax'});});
it.each([':name','@name','$name','?123','$ns::value(index)'])('SQLite参数%s不能当字段prefix',parameter=>{expect(analyze('SELECT '+parameter+'| FROM subject')).toMatchObject({status:'blocked',reason:'parameter'});});
it('美元符号仅在标识符内部属于名称，不把合法a$b变成参数',()=>{expect(ready('SELECT t.a$|b FROM subject t').target.prefix).toBe('a$');});
it('INSERT列清单强制unqualified且只绑定准确目标，不携其它表列',()=>{const value=ready('INSERT INTO main.subject(na|me,other) VALUES(1,2)');expect(value.unqualifiedColumns).toBe(true);expect(value.syntax).toEqual(['column']);expect(value.relations).toEqual([{kind:'physical',schema:'main',name:'subject'}]);expect(analyze('INSERT INTO subject VALUES(|)')).toMatchObject({status:'blocked',reason:'values'});});
it('UPDATE赋值左侧只补目标非限定字段，RHS和WHERE保正常alias作用域',()=>{const left=ready('UPDATE subject AS t SET na|me=o.name FROM other o WHERE t.id=o.id');expect(left.unqualifiedColumns).toBe(true);expect(left.relations).toEqual([{kind:'physical',name:'subject',alias:'t'}]);const right=ready('UPDATE subject t SET name=o.| FROM other o WHERE t.id=o.id');expect(right.unqualifiedColumns).toBeUndefined();expect(right.qualifiers).toEqual(['o']);expect(right.relations.map(item=>item.name)).toEqual(['subject','other']);expect(analyze('UPDATE subject t SET t.|=1')).toMatchObject({status:'blocked',reason:'qualified-target'});});
it('DELETE与RETURNING保单目标，返回表达式使用目标实际表名',()=>{expect(ready('DELETE FROM subject t WHERE t.|=1').relations).toEqual([{kind:'physical',name:'subject',alias:'t',dmlRole:'mutation-target'}]);const value=ready('DELETE FROM subject AS t WHERE id=1 RETURNING na|me');expect(value.unqualifiedColumns).toBe(true);expect(value.relations).toEqual([{kind:'physical',name:'subject',dmlRole:'returning-target'}]);});
it('INSERT SELECT来源不会继承INSERT目标表绑定',()=>{const value=ready('INSERT INTO destination SELECT s.| FROM source s');expect(value.relations).toEqual([{kind:'physical',name:'source',alias:'s'}]);expect(value.unqualifiedColumns).toBeUndefined();});
it('CTE显式列和FROM绑定独立声明，局部名遮蔽永久同名对象',()=>{const value=ready('WITH shadow("本地🚢",n) AS (SELECT x,y FROM real) SELECT c.| FROM shadow AS c');expect(value.relations).toContainEqual({kind:'local',source:'cte',name:'shadow',columns:['本地🚢','n'],alias:'c'});expect(value.relations).toContainEqual({kind:'local',source:'cte',name:'shadow',columns:['本地🚢','n'],declaration:true});expect(value.relations.some(item=>item.kind==='physical'&&item.name==='shadow')).toBe(false);expect(ready('WITH c(x) AS (SELECT 1) SELECT * FROM c|').relations.some(item=>item.kind==='local'&&item.declaration===true)).toBe(true);});
it('CTE投影alias/简单字段可推导，count(*)内部星号不阻断明确alias',()=>{const value=ready('WITH c AS (SELECT a.id, count(*) AS total, 1 explicit FROM actual a) SELECT c.| FROM c');expect(value.relations.find(item=>item.kind==='local'&&!item.declaration)).toMatchObject({columns:['id','total','explicit']});});
it.each(['SELECT x+y FROM real','SELECT a COLLATE nocase FROM real','SELECT x AS duplicate,y AS duplicate FROM real'])('未知/歧义CTE输出%s不退永久同名表',body=>{expect(analyze('WITH shadow AS ('+body+') SELECT shadow.| FROM shadow')).toMatchObject({status:'blocked',reason:'local-output'});});
it('未知CTE只声明未绑定不泄列，显式main同名物理表可绕局部遮蔽',()=>{const declaration=ready('WITH shadow AS (SELECT * FROM real) SELECT * FROM sh|');expect(declaration.relations).toContainEqual({kind:'local',source:'cte',name:'shadow',columns:[],declaration:true});const explicit=ready('WITH shadow AS (SELECT * FROM real) SELECT p.| FROM main.shadow AS p');expect(explicit.relations).toContainEqual({kind:'physical',schema:'main',name:'shadow',alias:'p'});});
it('嵌套CTE声明按最近作用域遮蔽，不把外层声明变成本层绑定',()=>{const value=ready('WITH c(outer_col) AS (SELECT 1) SELECT (WITH c(inner_col) AS (SELECT 2) SELECT c.| FROM c) FROM actual a');const local=value.relations.filter(item=>item.kind==='local'&&item.name==='c');expect(local).toHaveLength(2);expect(local.every(item=>item.kind==='local'&&item.columns.join(',')==='inner_col')).toBe(true);});
it('递归CTE的递归成员可补显式列，锚点不借递归成员中的绑定', () => {
  expect(ready('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT c.| FROM c').relations)
    .toContainEqual({ kind: 'local', source: 'cte', name: 'c', columns: ['x'] });
  expect(ready('WITH RECURSIVE c(x) AS (SELECT | UNION ALL SELECT x+1 FROM c) SELECT * FROM c').relations)
    .toEqual([{ kind: 'local', source: 'cte', name: 'c', columns: ['x'], declaration: true }]);
  expect(ready('WITH RECURSIVE c(x) AS (VALUES(1) UNION ALL SELECT c.| + 1 FROM c WHERE x < 3) SELECT * FROM c').relations)
    .toContainEqual({ kind: 'local', source: 'cte', name: 'c', columns: ['x'] });
  expect(analyze('WITH c AS (VALUES(1) UNION ALL SELECT 2 AS later_name) SELECT c.| FROM c'))
    .toMatchObject({ status: 'blocked', reason: 'local-output' });
});
it('派生表显式输出保持离线，星号只携带实际来源的目录引用', () => {
  expect(ready('SELECT d.| FROM (SELECT source.id AS item,1 AS flag FROM source) AS d').relations)
    .toEqual([{ kind: 'local', source: 'derived', name: 'd', alias: 'd', columns: ['item', 'flag'] }]);
  const value = ready('SELECT d.na|me FROM (SELECT t.* FROM main.source t JOIN untouched u ON 1) AS d');
  expect(value.relations).toEqual([{ kind: 'local', source: 'derived', name: 'd', alias: 'd', columns: [], projection: 0 }]);
  expect(value.localProjections).toEqual([[{ star: { groups: [], all: [{ operand: { source: { name: 'source', schema: 'main' } } }], sole: true } }]]);
});
it('多层 CTE 星号保存声明作用域与顺序，前向引用不读取同名永久表', () => {
  const value = ready('WITH picked AS (SELECT base.*, 1 AS id FROM base), base AS (SELECT * FROM temp.data), ignored AS (SELECT * FROM unused) SELECT p.i|d FROM picked p');
  expect(value.localProjections).toEqual([
    [{ star: { groups: [], all: [{ operand: { source: { name: 'data', schema: 'temp' } } }], sole: true } }],
    [{ star: { groups: [], all: [{ operand: { projection: 0 } }], sole: true } }, { name: 'id' }],
  ]);
  expect(value.relations).toContainEqual({ kind: 'local', source: 'cte', name: 'picked', alias: 'p', columns: [], projection: 1 });
  const first = ready('WITH RECURSIVE a AS (SELECT * FROM seed UNION ALL SELECT * FROM a) SELECT a.| FROM a');
  expect(first.localProjections).toEqual([[{ star: { groups: [], all: [{ operand: { source: { name: 'seed' } } }], sole: true } }]]);
  expect(ready('WITH a(item) AS (SELECT * FROM seed) SELECT a.| FROM a').localProjections).toBeUndefined();
});
it('局部循环只保留未知目录，回包拒绝前向引用、越界根和孤立节点', () => {
  const marked = 'WITH a AS (SELECT * FROM a) SELECT a.| FROM a', { source, offset } = query(marked);
  const value = ready(marked);
  expect(value.localProjections).toEqual([[{ star: { groups: [], all: [{ operand: { columns: [] } }], sole: true } }]]);
  const root = value.relations.find(relation => relation.kind === 'local' && relation.projection !== undefined)!;
  for (const response of [
    { ...value, localProjections: [[{ star: { groups: [], all: [{ operand: { projection: 0 } }], sole: true } }]] },
    { ...value, localProjections: [...value.localProjections!, [{ name: 'detached' }]] },
    { ...value, relations: [{ ...root, projection: 1 }] },
    { ...value, relations: [{ ...root, declaration: true }] },
  ]) expect(() => validateSqliteCompletionAnalysis(response, source, offset)).toThrow();
});
it('普通相关子查询可见外层alias，FROM派生体不借外层行，内层同alias优先',()=>{const correlated=ready('SELECT * FROM outer_table o WHERE EXISTS (SELECT o.| FROM inner_table i)');expect(correlated.relations.map(item=>item.alias)).toEqual(['i','o']);const derived=ready('SELECT * FROM outer_table o JOIN (SELECT i.| FROM inner_table i) d ON 1=1');expect(derived.relations).toEqual([{kind:'physical',name:'inner_table',alias:'i'}]);const shadow=ready('SELECT * FROM outer_table t WHERE EXISTS (SELECT t.| FROM inner_table t)');expect(shadow.relations).toEqual([{kind:'physical',name:'inner_table',alias:'t'}]);});
it('trigger体内分号不伪造独立SELECT；后继statement仍准确隔离',()=>{expect(analyze('CREATE TRIGGER tr AFTER INSERT ON subject BEGIN SELECT x.| FROM secret x; END;')).toMatchObject({status:'blocked',reason:'trigger'});expect(ready('CREATE TRIGGER tr AFTER INSERT ON subject BEGIN SELECT CASE WHEN 1 THEN 2 END; END; SELECT t.| FROM actual t').relations).toEqual([{kind:'physical',name:'actual',alias:'t'}]);});
it.each(['SELECT * FROM a NOT INDEXED BY |','WITH c(x) AS(SELECT 1) UPDATE c SET |'])('未知SQLite复杂上下文明确blocked，不伪造物理关系 %#',source=>{expect(analyze(source).status).toBe('blocked');});

it('只交付命中组别名的投影树，成员别名和其他组仍各自绑定', () => {
  const marked = 'SELECT g.va|lue FROM (main.a x JOIN temp.b y USING(id)) AS g JOIN (c JOIN d) n ON 1';
  const value = ready(marked);
  expect(value.joinGroup).toEqual({ alias: 'g', groups: [{ inputs: [
    { operand: { source: { name: 'a', schema: 'main' } }, binding: 'x' },
    { operand: { source: { name: 'b', schema: 'temp' } }, binding: 'y', merged: ['id'] },
  ] }] });
  expect(value.relations.filter(relation => relation.kind === 'local').map(relation => relation.name)).toEqual(['g', 'n']);
  expect(ready(marked.replace('g.va|lue', 'x.va|lue')).joinGroup).toBeUndefined();
  expect(ready('SELECT (SELECT grp.va|lue) FROM (a JOIN b) grp').joinGroup?.alias).toBe('grp');
  expect(ready('SELECT grp.lo|cal FROM ((SELECT 1 AS local) JOIN b) grp').joinGroup?.groups[0].inputs[0])
    .toEqual({ operand: { columns: ['local'] } });
});

it('最外层组名覆盖内组名而保留成员，定位只指向实际声明', () => {
  const relation = 'FROM ((a x JOIN b y USING(id)) inner_group) AS outer_group';
  const readyOuter = ready('SELECT outer_group.va|lue ' + relation);
  expect(readyOuter.joinGroup?.groups).toHaveLength(1);
  expect(readyOuter.relations.map(value => value.alias ?? value.name)).toEqual(['x', 'y', 'outer_group']);
  expect(ready('SELECT inner_group.va|lue ' + relation).joinGroup).toBeUndefined();
  const { source, offset } = query('SELECT outer_|group.value ' + relation);
  const alias = source.lastIndexOf('outer_group');
  expect(analyzeSqliteCompletion(source, offset, 'definition')).toMatchObject({ status: 'ready', definition: { start: alias, end: alias + 'outer_group'.length } });
  expect(analyzeSqliteCompletion(source, offset, 'object')).toMatchObject({ status: 'blocked', reason: 'local' });
  expect(ready('SELECT y.va|lue FROM (a x JOIN b y) y').joinGroup?.alias).toBe('y');
});

it('组别名回包校验要求同名查询绑定和可达投影树', () => {
  const marked = 'SELECT g.va|lue FROM (a JOIN b) g', { source, offset } = query(marked), value = ready(marked);
  const group = value.joinGroup!;
  for (const response of [
    { ...value, joinGroup: { ...group, alias: 'other' } },
    { ...value, joinGroup: undefined },
    { ...value, relations: value.relations.filter(relation => relation.name !== 'g') },
    { ...value, joinGroup: { ...group, groups: [group.groups[0], group.groups[0]] } },
  ]) expect(() => validateSqliteCompletionAnalysis(response, source, offset)).toThrow();
});

it('表值调用保留实际目标、命名空间和绑定，未调用的同名关系沿用普通列目录', () => {
  expect(ready("SELECT j.va|lue FROM main.json_each('[1,2]') j").relations)
    .toEqual([{ kind: 'physical', name: 'json_each', schema: 'main', alias: 'j', tableFunction: true }]);
  expect(ready('SELECT j.| FROM temp.json_each j').relations)
    .toEqual([{ kind: 'physical', name: 'json_each', schema: 'temp', alias: 'j' }]);
  expect(analyze("WITH json_each(x) AS (VALUES(1)) SELECT j.| FROM json_each('[]') j"))
    .toMatchObject({ status: 'blocked', reason: 'table-function' });
});

it('表值函数实参识别已有表和相关外层，函数返回列沿外层 SELECT 或 UPDATE 作用域使用', () => {
  expect(ready('SELECT j.value FROM doc d JOIN json_each(d.pa|yload) j ON 1 JOIN later l ON 1').relations)
    .toEqual([{ kind: 'physical', name: 'doc', alias: 'd' }]);
  expect(ready('SELECT (SELECT j.value FROM json_each((SELECT d.pa|yload)) j) FROM doc d').relations)
    .toEqual([{ kind: 'physical', name: 'doc', alias: 'd' }]);
  expect(ready('SELECT j.value FROM doc d JOIN json_each(d.pa|').relations)
    .toEqual([{ kind: 'physical', name: 'doc', alias: 'd' }]);
  expect(ready("UPDATE dst SET code=j.va|lue FROM json_each('[]') j").relations)
    .toContainEqual({ kind: 'physical', name: 'json_each', alias: 'j', tableFunction: true });
});

it('USING 只交付当前连接两侧关系，保留原游标范围和前后已填项', () => {
  const value = ready('SELECT * FROM main.a x JOIN temp.b y USING ("已选", na|suffix, [后选]) JOIN json_each(\'[]\') j ON 1');
  expect(value).toMatchObject({ target: { prefix: 'na' }, syntax: ['column'], qualifiers: [], relations: [], using: {
    left: [{ operand: { source: { name: 'a', schema: 'main' } } }], right: { source: { name: 'b', schema: 'temp' } }, used: ['已选', '后选'],
  } });
});

it('USING 复用明确的 CTE 和派生表列，RIGHT/FULL 连接记录此前的列合并', () => {
  const value = ready('WITH a(id) AS (VALUES(1)) SELECT * FROM a JOIN (SELECT 1 AS id) b USING(id) NATURAL JOIN c FULL JOIN d USING(i|d)');
  expect(value.using).toEqual({ left: [
    { operand: { columns: ['id'] } }, { operand: { columns: ['id'] }, merged: ['id'] }, { operand: { source: { name: 'c' } }, merged: true },
  ], right: { source: { name: 'd' } }, used: [], uniqueLeft: true });
});

it.each([
  'SELECT * FROM out o WHERE EXISTS(SELECT * FROM a JOIN b USING(|))',
  'SELECT id FROM first UNION ALL SELECT id FROM a JOIN b USING(|)',
  'INSERT INTO dst SELECT * FROM a JOIN b USING(|)',
  'UPDATE dst SET n = 1 FROM a JOIN b INDEXED BY b_idx USING(|)',
  'SELECT * FROM a, b NOT INDEXED USING(|',
])('USING 隔离子查询外层、集合分支和写入目标：%s', sql => {
  expect(ready(sql).using).toEqual({ left: [{ operand: { source: { name: 'a' } } }], right: { source: { name: 'b' } }, used: [] });
});

it.each([
  'SELECT * FROM a USING(|)', 'SELECT * FROM a NATURAL JOIN b USING(|)', 'SELECT * FROM a JOIN b ON 1 USING(|)',
  'SELECT * FROM a JOIN b USING (a.i|d)', 'SELECT * FROM a JOIN b USING (i|d + 1)', 'SELECT * FROM a JOIN b WHERE using(|)',
  'SELECT * FROM a JOIN b AS USING(|)',
])('非有效 USING 列位置不读取目录：%s', sql => {
  expect(analyze(sql).status).toBe('blocked');
});

it('USING 的 Worker 回包不能同时携带外层绑定、解析模式或未验证目录字段', () => {
  const marked = 'SELECT * FROM a JOIN b USING(|)', { source, offset } = query(marked), value = ready(marked);
  const projection = value.using!;
  for (const fields of [{ relations: [{ kind: 'physical', name: 'a' }] }, { using: { ...projection, used: ['x', 'X'] } },
    { using: { ...projection, left: [] } }, { using: { ...projection, right: { source: { name: 'b', schema: 'unknown' } } } }]) {
    expect(() => validateSqliteCompletionAnalysis({ ...value, ...fields }, source, offset)).toThrow();
  }
  expect(() => validateSqliteCompletionAnalysis(value, source, offset, 'hover')).toThrow();
});

it('外层 USING 的两侧保留投影分组、约束和准确的递归来源', () => {
  const value = ready('SELECT * FROM (main.a NATURAL JOIN temp.b) AS lhs RIGHT JOIN ((main.c JOIN d USING(id)) AS inner_set JOIN e ON 1) AS rhs USING (i|d, ready)');
  expect(value.using).toEqual({
    left: [{ operand: { group: 0 } }], right: { group: 2 }, used: ['ready'], uniqueLeft: true, starGroupSides: 'right',
    groups: [
      { inputs: [{ operand: { source: { name: 'a', schema: 'main' } } }, { operand: { source: { name: 'b', schema: 'temp' } }, merged: true }] },
      { inputs: [{ operand: { source: { name: 'c', schema: 'main' } } }, { operand: { source: { name: 'd' } }, merged: ['id'] }] },
      { inputs: [{ operand: { group: 1 } }, { operand: { source: { name: 'e' } } }] },
    ],
  });
  const previous = ready('SELECT * FROM x JOIN (a JOIN b) USING(id) JOIN y USING(i|d)');
  expect(previous.using?.left).toEqual([{ operand: { source: { name: 'x' } } }, { operand: { group: 0 }, merged: ['id'] }]);
});

it('USING 回包拒绝前向、重复引用、孤立分组和超额叶子', () => {
  const { source, offset } = query('SELECT * FROM a JOIN (b JOIN c) USING(|)');
  const valid = ready('SELECT * FROM a JOIN (b JOIN c) USING(|)');
  const using = valid.using!, original = using.groups![0];
  for (const invalid of [
    { ...using, right: { group: 1 } },
    { ...using, left: [{ operand: { group: 0 } }] },
    { ...using, groups: [{ inputs: [{ operand: { group: 0 } }, original.inputs[1]] }] },
    { ...using, groups: [original, original] },
    { ...using, groups: [{ inputs: Array.from({ length: limits.relations }, () => original.inputs[0]) }] },
    { ...using, uniqueLeft: true, starGroupSides: 'left' },
  ]) expect(() => validateSqliteCompletionAnalysis({ ...valid, using: invalid }, source, offset)).toThrow();
});
it.each(['UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT'])('集合运算%s的两侧以光标所在分支为准', operator => {
  expect(ready(`SELECT s.| FROM main.first AS s ${operator} SELECT s.id FROM temp.second AS s`).relations)
    .toEqual([{ kind: 'physical', schema: 'main', name: 'first', alias: 's' }]);
  expect(ready(`SELECT s.id FROM main.first AS s ${operator} SELECT s.| FROM temp.second AS s`).relations)
    .toEqual([{ kind: 'physical', schema: 'temp', name: 'second', alias: 's' }]);
});

it('复合分支保留相关外层，隔离兄弟分支和 INSERT 目标', () => {
  expect(ready('SELECT * FROM parent p WHERE EXISTS (SELECT x.id FROM src x UNION ALL SELECT p.| FROM child c)').relations.map(relation => relation.name))
    .toEqual(['child', 'parent']);
  expect(ready('INSERT INTO dst SELECT a.id FROM first a UNION ALL SELECT b.| FROM second b').relations)
    .toEqual([{ kind: 'physical', name: 'second', alias: 'b' }]);
  expect(ready('SELECT 1 UNION ALL SEL|').syntax).toEqual(['keyword']);
});

it('复合排序只交付可确认的输出名，兼容不同分支的别名、星号与大小写去重', () => {
  const result = ready('SELECT a.*, a.cost * a.qty AS "合计🚢", a.id AS Key FROM first a UNION ALL SELECT b.*, 0 AS amount, b.id AS key FROM second b ORDER BY amount DESC, "合|计🚢" LIMIT 5');
  expect(result).toMatchObject({ syntax: ['column'], qualifiers: [], relations: [], output: {
    columns: ['合计🚢', 'Key', 'amount'], sources: [{ name: 'first' }, { name: 'second' }],
  } });
});

it.each([
  'SELECT 1 + 2 UNION ALL SELECT 3 + 4 ORDER BY |',
  'SELECT id FROM first UNION ALL SELECT id FROM second ORDER BY second.|',
  'SELECT id FROM first UNION ALL SELECT id FROM second ORDER BY id COLLATE no|case',
  'SELECT id FROM first UNION ALL SELECT id FROM second ORDER BY i|d + 1',
  'SELECT id FROM first UNION ALL SELECT id FROM second ORDER BY id LIMIT na|me',
  'SELECT 1 AS id UNION ALL VALUES(2) ORDER BY i|d',
])('复合排序/分页的其它位置不向分支目录回退 %s', source => {
  expect(analyze(source)).toMatchObject({ status: 'blocked', reason: 'compound' });
});

it('复合排序按星号实际投影的来源读目录，裸星号展开同一分支的全部本地绑定', () => {
  const result = ready('SELECT a.* FROM main.first a JOIN ignored z ON 1 UNION ALL SELECT * FROM temp.second b NATURAL JOIN main.third c ORDER BY |');
  expect(result.output).toEqual({ columns: [], sources: [{ name: 'first', schema: 'main' }, { name: 'second', schema: 'temp' }, { name: 'third', schema: 'main' }] });
});

it('明确的 CTE 和匿名派生表直接展开，动态局部来源保留投影引用', () => {
  const result = ready('WITH c(item) AS (SELECT 1), u AS (SELECT * FROM hidden_table) SELECT c.*, u.* FROM c, u UNION ALL SELECT * FROM (SELECT 2 AS next, 3 AS flag) ORDER BY |');
  expect(result.output).toEqual({ columns: ['item', 'next', 'flag'], sources: [], projections: [0] });
  expect(result.localProjections).toEqual([[{ star: { groups: [], all: [{ operand: { source: { name: 'hidden_table' } } }], sole: true } }]]);
});

it('局部投影按实际使用范围接入外层 USING、复合排序和连接组', () => {
  const common = 'WITH c AS (SELECT * FROM main.subject), unused AS (SELECT * FROM ignored) ';
  const using = ready(common + 'SELECT 1 FROM c JOIN (SELECT c.* FROM c) d USING(i|d)');
  expect(using.using).toEqual({ left: [{ operand: { projection: 0 } }], right: { projection: 1 }, used: [] });
  expect(using.localProjections).toHaveLength(2);
  const compound = ready(common + 'SELECT c.* FROM c UNION ALL SELECT d.* FROM (SELECT c.* FROM c) d ORDER BY i|d');
  expect(compound.output).toEqual({ columns: [], sources: [], projections: [0, 1] });
  expect(compound.localProjections).toEqual(using.localProjections);
  const expanded = ready(common + 'SELECT * FROM c JOIN side USING(id) UNION ALL SELECT 1 ORDER BY i|d');
  expect(expanded.output?.joinStars).toEqual([{ groups: [], all: [{ operand: { projection: 0 } }, { operand: { source: { name: 'side' } }, merged: ['id'] }] }]);
  const grouped = ready(common + 'SELECT g.i|d FROM upfront JOIN (c JOIN side ON 1) g ON 1');
  expect(grouped.joinGroup?.groups).toEqual([{ inputs: [{ operand: { projection: 0 }, binding: 'c' }, { operand: { source: { name: 'side' } } }] }]);
  expect(grouped.localProjections).toHaveLength(1);
});

it('外层局部投影回包拒绝缺失、越界和重复的投影根', () => {
  const usingMarked = 'WITH c AS (SELECT * FROM base) SELECT 1 FROM c JOIN peer USING(|)';
  const using = ready(usingMarked), usingInput = query(usingMarked);
  expect(() => validateSqliteCompletionAnalysis({ ...using, localProjections: undefined }, usingInput.source, usingInput.offset)).toThrow();
  expect(() => validateSqliteCompletionAnalysis({ ...using, using: { ...using.using, right: { projection: 1 } } }, usingInput.source, usingInput.offset)).toThrow();
  const outputMarked = 'WITH c AS (SELECT * FROM base) SELECT c.* FROM c UNION ALL SELECT 1 ORDER BY |';
  const output = ready(outputMarked), outputInput = query(outputMarked);
  for (const references of [[1], [0, 0]]) {
    expect(() => validateSqliteCompletionAnalysis({ ...output, output: { ...output.output, projections: references } }, outputInput.source, outputInput.offset)).toThrow();
  }
  expect(() => validateSqliteCompletionAnalysis({ ...output, output: { ...output.output, projections: undefined } }, outputInput.source, outputInput.offset)).toThrow();
});

it('重复读取同一物理目录仅登记一次，名称歧义的星号保留其它已知输出', () => {
  expect(ready('SELECT a.* FROM main.first a UNION ALL SELECT b.* FROM MAIN.FIRST b ORDER BY |').output)
    .toEqual({ columns: [], sources: [{ name: 'first', schema: 'main' }] });
  expect(ready('SELECT t.* FROM main.t JOIN temp.t ON 1 UNION ALL SELECT 1 AS known ORDER BY |').output)
    .toEqual({ columns: ['known'], sources: [], incomplete: true });
});

it('表函数与同名实体目录分开，复合星号保留调用身份', () => {
  const result = ready("SELECT t.*, j.*, 1 IS DISTINCT FROM 2 AS flag FROM main.first t JOIN json_each('[]') j ON 1 UNION ALL SELECT 1 AS id ORDER BY |");
  expect(result.output).toEqual({ columns: ['flag', 'id'], sources: [{ name: 'first', schema: 'main' }, { name: 'json_each', tableFunction: true }] });
});

it('复合输出候选回包独立于读取目录、悬停及定义范围', () => {
  const marked = 'SELECT 1 AS id UNION ALL SELECT 2 AS item ORDER BY |';
  const { source, offset } = query(marked), result = ready(marked);
  const openTable = { kind: 'physical', name: 'first' };
  for (const fields of [{ relations: [openTable] }, { qualifiers: ['first'] }, { output: { columns: [], sources: [] } },
    { output: { columns: ['X', 'x'], sources: [] } }, { output: { columns: [], sources: [{ name: 'a' }, { name: 'A' }] } },
    { output: { columns: [], sources: [{ name: 'a', schema: 'main', sql: 'SELECT private' }] } }, { syntax: ['column', 'keyword'] }]) {
    expect(() => validateSqliteCompletionAnalysis({ ...result, ...fields }, source, offset)).toThrow();
  }
  expect(() => validateSqliteCompletionAnalysis(result, source, offset, 'hover')).toThrow();
});
it('空文本与部分首keyword只补keyword，不读取物理元数据',()=>{expect(ready('|').syntax).toEqual(['keyword']);expect(ready('SEL|').relations).toEqual([]);});
it('ASCII大小写折叠不把Unicode区域相似字符合并成同alias',()=>{expect(analyze('SELECT a.| FROM first a JOIN second A')).toMatchObject({status:'blocked',reason:'ambiguous'});expect(ready('SELECT İ.| FROM first İ JOIN second i').relations.map(item=>item.alias)).toEqual(['İ','i']);});
it('预算含正文、token、深度、关系、名称与prefix，失败不返回截断关系',()=>{expect(analyzeSqliteCompletion(' '.repeat(limits.sourceUnits+1),0)).toMatchObject({status:'blocked',reason:'budget'});expect(analyzeSqliteCompletion(';'.repeat(limits.tokens+1),0)).toMatchObject({status:'blocked',reason:'budget'});expect(analyze('SELECT '+ '('.repeat(limits.depth+1)+'|')).toMatchObject({status:'blocked',reason:'budget'});expect(analyze('SELECT | FROM '+Array.from({length:limits.relations+1},(_,i)=>'t'+i+' a'+i).join(','))).toMatchObject({status:'blocked',reason:'budget'});expect(analyze('SELECT '+ 'a'.repeat(limits.prefixUnits+1)+'|')).toMatchObject({status:'blocked',reason:'prefix'});expect(analyze('SELECT '+ 'a'.repeat(limits.nameUnits+1)+'|')).toMatchObject({status:'blocked',reason:'budget'});});
it('光标不能切断代理对，NUL/孤立代理/非整数坐标都blocked',()=>{const source='SELECT "😀"';expect(analyzeSqliteCompletion(source,source.indexOf('😀')+1)).toMatchObject({status:'blocked',reason:'input'});for(const value of['SELECT \0','SELECT \ud800'])expect(analyzeSqliteCompletion(value,value.length)).toMatchObject({status:'blocked',reason:'input'});for(const offset of[-1,Infinity,0.5,999])expect(analyzeSqliteCompletion('SELECT x',offset).status).toBe('blocked');});
it('回包形状/预算/原范围验证拒绝伪造额外SQL、错误prefix/UTF16范围及unqualified限定链',()=>{const input=query('SELECT t.na|me FROM actual t'),value=ready('SELECT t.na|me FROM actual t');for(const forged of[{...value,sql:'SELECT secret'},{...value,target:{...value.target,prefix:'other'}},{...value,target:{...value.target,end:999}},{...value,unqualifiedColumns:true},{...value,relations:[{kind:'physical',name:'x',password:'secret'}]}])expect(()=>validateSqliteCompletionAnalysis(forged,input.source,input.offset)).toThrow();expect(()=>validateSqliteCompletionAnalysis({status:'blocked',reason:'SELECT secret'},input.source,input.offset)).toThrow();});

it('main/temp同名物理表仅准确schema限定时可分辨，不假装未限定alias唯一',()=>{const value=ready('SELECT main.subject.| FROM main.subject JOIN temp.subject ON 1=1');expect(value.relations).toEqual([{kind:'physical',schema:'main',name:'subject'},{kind:'physical',schema:'temp',name:'subject'}]);expect(analyze('SELECT subject.| FROM main.subject JOIN temp.subject ON 1=1')).toMatchObject({status:'blocked',reason:'ambiguous'});});
