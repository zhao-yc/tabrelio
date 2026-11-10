import type { TableInfo } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinKind, type ForeignKeyJoinOptions, type ForeignKeyJoinSort } from '../../src/renderer/tableForeignKeyJoin';

/** 只把生成器的两个固定FROM目标换为合成派生表；不创建物理库表，也不冒称实物外键目录验收。 */
export function foreignKeyJoinReadOnlyCases() {
  const info = (name: string, fields: [string, string][]): TableInfo => ({ database: 'join_virtual_fixture', name, objectKind: 'table', engine: 'InnoDB', columns: fields.map(([name,type]) => ({ name,type,nullable:true,generated:false,extra:'',comment:'',defaultValue:null })), foreignKeys: [], primaryKey: [], editableKey: [], indexes: [], ddl: '' });
  const child = info('child', [['id','BIGINT UNSIGNED'],['parent_id','BIGINT UNSIGNED']]), parent = info('parent', [['id','BIGINT UNSIGNED'],['amount','DECIMAL(30,4)']]);
  child.foreignKeys = [{ name:'fk', columns:['parent_id'], referencedDatabase:parent.database, referencedTable:parent.name, referencedColumns:['id'], onUpdate:'RESTRICT', onDelete:'RESTRICT' }];
  const ids = ['9007199254740992','9007199254740993','9007199254740994','9007199254740995','18446744073709551614','18446744073709551615'], parentIds = ['300',null,'100','999','200','300'], amounts = ['2.0000',null,'1.0000',null,'2.0000','2.0000'];
  const c = ids.map((id,i) => 'SELECT CAST(\''+id+'\' AS UNSIGNED) AS id,'+(parentIds[i]===null?'NULL':'CAST(\''+parentIds[i]+'\' AS UNSIGNED)')+' AS parent_id').join('\nUNION ALL\n');
  const p = ['100','200','300'].map((id,i) => "SELECT CAST('"+id+"' AS UNSIGNED) AS id,CAST('"+(i===0?'1.0000':'2.0000')+"' AS DECIMAL(30,4)) AS amount").join('\nUNION ALL\n');
  const definitions: { name:string; sort:ForeignKeyJoinSort[]; expected:number[]; kind?:'LEFT'|'INNER'; limit?:number; outputParent?:boolean }[] = [
    {name:'UINT64精确降序',sort:[{side:'child',column:'id',direction:'DESC'}],expected:[5,4,3,2,1,0],outputParent:true},
    {name:'父数值升序NULL后同值子键降序',sort:[{side:'parent',column:'amount',direction:'ASC',nulls:'LAST'},{side:'child',column:'id',direction:'DESC'}],expected:[2,5,4,0,3,1],outputParent:true},
    {name:'父数值降序NULL前同值子键升序',sort:[{side:'parent',column:'amount',direction:'DESC',nulls:'FIRST'},{side:'child',column:'id',direction:'ASC'}],expected:[1,3,0,4,5,2],outputParent:true},
    {name:'双方同名id分别排序',sort:[{side:'parent',column:'id',direction:'DESC',nulls:'LAST'},{side:'child',column:'id',direction:'DESC'}],expected:[5,0,4,2,3,1]},
    {name:'未输出父字段排序及显式三行上限',sort:[{side:'parent',column:'amount',direction:'DESC',nulls:'LAST'},{side:'child',column:'id',direction:'ASC'}],expected:[0,4,5],limit:3},
    {name:'INNER保留完整匹配并排序',sort:[{side:'child',column:'id',direction:'ASC'}],expected:[0,2,4,5],kind:'INNER',outputParent:true},
    {name:'显式一行上限',sort:[{side:'child',column:'id',direction:'ASC'}],expected:[0],limit:1},
    {name:'子关联键NULL前及同值降序',sort:[{side:'child',column:'parent_id',direction:'ASC',nulls:'FIRST'},{side:'child',column:'id',direction:'DESC'}],expected:[1,2,4,5,0,3]},
  ];
  return definitions.map(value => {
    const generated = buildForeignKeyJoin(child,parent,'fk',value.kind??'LEFT',43,{childColumns:['id'],parentColumns:value.outputParent?['amount']:[],sort:value.sort,...(value.limit?{limit:value.limit}:{})}).sql;
    const before='FROM `join_virtual_fixture`.`child` AS c\n'+(value.kind??'LEFT')+' JOIN `join_virtual_fixture`.`parent` AS p\n';
    if (generated.split(before).length!==2) throw Error('只读JOIN派生表替换目标不唯一');
    const sql=generated.replace(before,'FROM (\n'+c+'\n) AS c\n'+(value.kind??'LEFT')+' JOIN (\n'+p+'\n) AS p\n');
    return {name:value.name,generated,sql,expected:value.expected.map(index=>({c_1_id:ids[index],...(value.outputParent?{p_2_amount:amounts[index]}:{})}))};
  });
}

/** 复合映射的一项不匹配、任一项 NULL、双方无对应行都用只读常量派生表复核。 */
export function foreignKeyJoinOuterReadOnlyCases() {
  const info = (name: string): TableInfo => ({
    database: 'join_virtual_fixture', name, objectKind: 'table', engine: 'InnoDB',
    columns: ['id', 'tenant', 'key_id', 'marker'].map(column => ({
      name: column, type: column === 'id' ? 'varchar(8)' : 'int', nullable: true, generated: false, extra: '', comment: '', defaultValue: null,
    })), foreignKeys: [], primaryKey: [], editableKey: [], indexes: [], ddl: '',
  });
  const child = info('child'), parent = info('parent');
  child.foreignKeys = [{ name: 'fk', columns: ['tenant', 'key_id'], referencedDatabase: parent.database,
    referencedTable: parent.name, referencedColumns: ['tenant', 'key_id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }];
  const derived = (rows: readonly (readonly [string, number | null, number | null, number | null])[]) =>
    rows.map(([id, tenant, key, marker]) => `SELECT '${id}' AS id, ${tenant ?? 'NULL'} AS tenant, ${key ?? 'NULL'} AS key_id, ${marker ?? 'NULL'} AS marker`).join('\nUNION ALL\n');
  const c = derived([['c1', 1, 10, 1], ['c2', 2, 10, 1], ['c3', null, 10, 1], ['c4', 1, null, 1], ['c5', 1, 20, 1]]);
  const p = derived([['p1', 1, 10, 1], ['p2', 3, 10, 1], ['p3', null, 10, 1], ['p4', 1, 20, null], ['p5', 1, null, 1], ['p6', 1, 99, 1]]);
  type Pair = [string | null, string | null];
  const verify = (name: string, kind: ForeignKeyJoinKind, expected: Pair[], options: Partial<ForeignKeyJoinOptions> = {}) => {
    const generated = buildForeignKeyJoin(child, parent, 'fk', kind, 50, {
      childColumns: ['id'], parentColumns: ['id'],
      sort: [{ side: kind === 'RIGHT' ? 'parent' : 'child', column: 'id', direction: 'ASC' }], ...options,
    }).sql;
    const from = `FROM \`join_virtual_fixture\`.\`child\` AS c\n${kind} JOIN \`join_virtual_fixture\`.\`parent\` AS p\n`;
    if (generated.split(from).length !== 2) throw Error('只读 JOIN 派生表替换目标不唯一');
    const sql = generated.replace(from, `FROM (\n${c}\n) AS c\n${kind} JOIN (\n${p}\n) AS p\n`);
    return { name, sql, expected: expected.map(([c_1_id, p_1_id]) => ({ c_1_id, p_1_id })) };
  };
  return [
    verify('RIGHT 保留匹配及未引用的父行', 'RIGHT', [['c1', 'p1'], [null, 'p2'], [null, 'p3'], ['c5', 'p4'], [null, 'p5'], [null, 'p6']]),
    verify('RIGHT 仅返回未引用的父行', 'RIGHT', [[null, 'p2'], [null, 'p3'], [null, 'p5'], [null, 'p6']], { unmatchedOnly: true }),
    verify('LEFT 仅返回无匹配的子行', 'LEFT', [['c2', null], ['c3', null], ['c4', null]], { unmatchedOnly: true }),
    verify('右侧 OR 条件不能纳入已匹配的 p4', 'RIGHT', [[null, 'p3']], { unmatchedOnly: true, filterMode: 'any',
      filters: [{ side: 'parent', column: 'tenant', operator: 'IS NULL' }, { side: 'parent', column: 'marker', operator: 'IS NULL' }] }),
  ];
}
