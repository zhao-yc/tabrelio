import { expect, it, vi } from 'vitest';
import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { TableEditWorkspace, tableEditWorkspaceLimits } from '../../src/renderer/tableEditWorkspace';
import { recordTargetKey } from '../../src/renderer/recordViews';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';

/** 仅RAM原页及精确标量，不代替实库事务或GUI。 */
function fixture(complete = false) {
  const info: TableInfo={database:'db',name:'t',engine:'InnoDB',objectKind:'table',ddl:'',primaryKey:['id'],editableKey:['id'],indexes:[],foreignKeys:[],columns:[{name:'id',type:'bigint unsigned',nullable:false,generated:false,extra:'',defaultValue:null,comment:''},{name:'value',type:'text',nullable:true,generated:false,extra:'',defaultValue:null,comment:''}]};
  const profile={},scope='同一原查询',changed=vi.fn(),edits=new TableEditWorkspace(changed);
  const data=(id:number)=>({id:String(id),value:'{"n":9007199254740993,"n":-0}\0中文🚢',bytes:{type:'binary' as const,base64:'AP+A'},empty:'',nullable:null});
  function read(index:number,id=index) {const original=data(id);
    const values = complete ? { id: original.id, value: original.value } : original;
    const rows:DraftRow[]=[{id:'页'+index,data:structuredClone(values),original:structuredClone(values),inserted:false,deleted:false}],page:TablePage={page:index,pageSize:50,hasMore:true,columns:info.columns.map(c=>({name:c.name,key:c.name,type:c.type})),rows:[values],copyMetadataKey:tableCopyMetadataKey(info)};return {rows,page};}
  function add(index:number,id=index) {const incoming=read(index,id),ticket=edits.selected?edits.navigate(index,scope):undefined;return edits.adopt(scope,profile,info,incoming.page,incoming.rows,ticket);}
  function change(value:string){const before=edits.selected!.rows,after=before.map(row=>({...row,data:{...row.data,value}}));edits.update(before,after);edits.history.record(before,after);return after;}
  const first=add(1);return{edits,scope,profile,changed,info,read,add,change,first};
}
it('返回准确缓存无读取，各页历史端口稳定且保留独立undo／redo和原UUID／字节',()=>{const f=fixture(),history=f.edits.history,original=f.first.rows;const changed=f.change('第一页');const second=f.add(2);f.change('第二页');expect(f.edits.history).toBe(history);const t=f.edits.navigate(1,f.scope),cached=f.edits.cached(t)!;expect(cached).toBe(f.first);f.edits.select(t,cached);expect(f.edits.selected!.rows).toBe(changed);const before=f.edits.selected!.rows,undone=history.move(before,'undo')!;f.edits.update(before,undone);expect(undone[0].data).toEqual(original[0].data);expect(undone[0].id).toBe(original[0].id);expect(second.history.status.undo).toBe(1);expect(f.edits.changeCount).toBe(1);expect(f.edits.protected).toBe(true);});
it('统一捕获后台修改，当前干净页也可预览；改页、历史及后继批次不能领取旧快照',()=>{const f=fixture();f.change('后台修改');const second=f.add(2),batch=f.edits.batch(second.rows)!;expect(batch.pages).toBe(1);expect(collectChanges(batch.rows)).toEqual([{kind:'update',before:f.first.rows[0].original!,values:{value:'后台修改'}}]);expect(batch.current()).toBe(true);f.change('当前页');expect(batch.current()).toBe(false);const next=f.edits.batch(second.rows)!;expect(next.pages).toBe(2);f.edits.clearHistory();expect(next.current()).toBe(false);expect(f.edits.changeCount).toBe(2);});
it('已回滚仅清历史仍保留全部原草稿，明确成功重读后才采用新来源',()=>{const f=fixture();f.change('第一');const second=f.add(2);f.change('第二');f.edits.clearHistory();expect(f.edits.pages).toHaveLength(2);expect(f.edits.changeCount).toBe(2);expect(f.edits.pages.every(p=>!p.history.status.undo&&!p.history.status.redo)).toBe(true);const incoming=f.read(2);f.edits.adopt(f.scope,f.profile,f.info,incoming.page,incoming.rows);expect(f.edits.pages).toHaveLength(1);expect(f.edits.selected!.rows).toBe(incoming.rows);expect(f.edits.dirty).toBe(false);expect(second.rows[0].data.value).toBe('第二');});
it.each(['条件','连接','目录'] as const)('%s变化后永久失效，改回原值也不能新预览／切页，草稿保持',kind=>{const f=fixture();f.change('保留');f.add(2);const batch=f.edits.batch(f.edits.selected!.rows)!;if(kind==='条件')f.edits.observe('其它',f.profile);if(kind==='连接')f.edits.observe(f.scope,{});if(kind==='目录'){f.info.columns[1].type='json';f.edits.observe(f.scope,f.profile);}f.edits.observe(f.scope,f.profile);expect(f.edits.stale).toBe(true);expect(batch.current()).toBe(false);expect(()=>f.edits.navigate(1,f.scope)).toThrow();expect(f.edits.pages).toHaveLength(2);expect(f.edits.changeCount).toBe(1);});
it('16页均有修改或历史时不淘汰，明确放弃后台一页才可继续',()=>{const f=fixture();for(let n=1;n<=16;n++){if(n>1)f.add(n);f.change('第'+n);}expect(()=>f.edits.navigate(17,f.scope)).toThrow(/最多保留16页/);expect(f.edits.pages).toHaveLength(16);expect(f.edits.discard(f.first)).toBe(true);const seventeenth=f.add(17);expect(seventeenth.index).toBe(17);expect(f.edits.pages).toHaveLength(16);expect(f.edits.changeCount).toBe(15);});
it('干净无历史页可有界淘汰，改过又撤销的页仍不得静默丢失',()=>{const f=fixture();f.change('暂改');const before=f.first.rows,undo=f.edits.history.move(before,'undo')!;f.edits.update(before,undo);for(let n=2;n<=17;n++)f.add(n);expect(f.edits.pages).toHaveLength(16);expect(f.edits.pages.includes(f.first)).toBe(true);expect(f.first.history.status.redo).toBe(1);});
it('读取失败只取消本意图，原页数组／历史／字节完全保持；旧失败不能取消后继',()=>{const f=fixture();const rows=f.change('保留'),history=f.edits.history.generation,ticket=f.edits.navigate(2,f.scope);f.edits.fail(ticket);expect(f.edits.selected).toBe(f.first);expect(f.first.rows).toBe(rows);expect(f.edits.history.generation).toBe(history);const next=f.edits.navigate(3,f.scope);f.edits.fail(ticket);expect(f.edits.navigation(3,f.scope)).toBe(next);});
it('实际页号、页长或结构不符时不采用新页，旧行及旧历史保持',()=>{for(const kind of ['页号','页长','结构']){const f=fixture();const original=f.change('保留'),incoming=f.read(2),ticket=f.edits.navigate(2,f.scope);if(kind==='页号')incoming.page.page=3;if(kind==='页长')incoming.page.pageSize=100;if(kind==='结构')incoming.page.copyMetadataKey='其它';expect(()=>f.edits.adopt(f.scope,f.profile,f.info,incoming.page,incoming.rows,ticket)).toThrow();expect(f.edits.selected!.rows).toBe(original);expect(f.edits.history.status.undo).toBe(1);}});
it('偏移页重叠只读可保留；两个dirty原页同一定位拒绝整个预览',()=>{const f=fixture();f.change('第一页');f.add(2,1);const clean=f.edits.batch(f.edits.selected!.rows)!;expect(clean.pages).toBe(1);f.change('重复原记录');expect(()=>f.edits.batch(f.edits.selected!.rows)).toThrow(/同一条原记录/);expect(f.edits.changeCount).toBe(2);});
it('末页读回已保留页时保留原页／历史，不用新读值覆盖旧草稿',()=>{const f=fixture();f.change('第一页');const second=f.add(2);f.change('第二页');const ticket=f.edits.navigate('last',f.scope),incoming=f.read(1);const result=f.edits.adopt(f.scope,f.profile,f.info,incoming.page,incoming.rows,ticket);expect(result).toBe(f.first);expect(result.rows[0].data.value).toBe('第一页');expect(second.rows[0].data.value).toBe('第二页');});
it('全组原值预算超限拒绝第二页采用，当前草稿和来源不变',()=>{const f=fixture();f.change('保留');const incoming=f.read(2);incoming.rows[0].data.value='x'.repeat(tableEditWorkspaceLimits.bytes/2);const ticket=f.edits.navigate(2,f.scope);expect(()=>f.edits.adopt(f.scope,f.profile,f.info,incoming.page,incoming.rows,ticket)).toThrow(/64 MiB/);expect(f.edits.pages).toHaveLength(1);expect(f.edits.selected).toBe(f.first);expect(f.first.rows[0].data.value).toBe('保留');});
it('整组新输入超过原1MiB线路预算时拒绝预览，不截断或提交部分页',()=>{const f=fixture();f.change('x'.repeat(600000));f.add(2);f.change('y'.repeat(600000));expect(()=>f.edits.batch(f.edits.selected!.rows)).toThrow();expect(f.edits.pages).toHaveLength(2);expect(f.edits.changeCount).toBe(2);});
it('当前页明确放弃返回另一原缓存，后台页放弃不影响当前页，最后一页清空来源',()=>{const f=fixture();f.change('第一');const second=f.add(2);f.change('第二');expect(f.edits.discard(second)).toBe(true);expect(f.edits.selected).toBe(f.first);expect(f.edits.changeCount).toBe(1);expect(f.edits.discard(second)).toBe(false);expect(f.edits.discard(f.first)).toBe(true);expect(f.edits.pages).toHaveLength(0);expect(f.edits.stale).toBe(false);});

it('跨页勾选删除一次暂存并清除已处理的勾选，各页独立撤销', () => {
  const { edits, first, add, changed, scope } = fixture();
  const firstRows = first.rows;
  edits.remember(firstRows, new Set([firstRows[0].id]), undefined, new Set());
  const second = add(2), secondRows = second.rows;
  const plan = edits.planCheckedDeletion(secondRows, new Set([secondRows[0].id]));
  expect(plan.pages).toEqual([{ index: 1, count: 1 }, { index: 2, count: 1 }]);
  expect(edits.changeCount).toBe(0);
  changed.mockClear();
  const next = plan.stage();
  expect(changed).toHaveBeenCalledOnce();
  expect(next).toBe(second.rows);
  expect(edits.pages.map(page => page.selected.size)).toEqual([0, 0]);
  expect(collectChanges(edits.batch(next)!.rows)).toEqual([
    { kind: 'delete', before: firstRows[0].original },
    { kind: 'delete', before: secondRows[0].original },
  ]);
  expect(() => plan.stage()).toThrow();
  const ticket = edits.navigate(1, scope);
  edits.select(ticket, first);
  edits.update(first.rows, edits.history.move(first.rows, 'undo')!);
  expect(first.rows[0].deleted).toBe(false);
  expect(second.rows[0].deleted).toBe(true);
});

it('原定位跨页重复、勾选修订或原页变化时拒绝整批', () => {
  const duplicate = fixture();
  duplicate.edits.remember(duplicate.first.rows, new Set(['页1']), undefined, new Set());
  const repeated = duplicate.add(2, 1);
  expect(() => duplicate.edits.planCheckedDeletion(repeated.rows, new Set(['页2']))).toThrow(/同一条原记录/);
  expect(duplicate.edits.changeCount).toBe(0);

  const { edits, first, add } = fixture();
  edits.remember(first.rows, new Set(['页1']), undefined, new Set());
  const second = add(2), checks = new Set(['页2']);
  const plan = edits.planCheckedDeletion(second.rows, checks);
  checks.clear();
  expect(() => plan.stage()).toThrow();
  expect(edits.changeCount).toBe(0);
  expect(first.history.status.undo).toBe(0);
});

it('其它干净页可淘汰，已经勾选的页不会静默淘汰', () => {
  const { edits, first, add } = fixture();
  edits.remember(first.rows, new Set(['页1']), undefined, new Set());
  for (let index = 2; index <= 17; index++) add(index);
  expect(edits.pages).toHaveLength(16);
  expect(edits.pages).toContain(first);
  expect(edits.pages.some(page => page.index === 2)).toBe(false);
});


function fillContext(info: TableInfo) {
  return { target: { connectionId: '连接', database: info.database, table: info.name }, info, loaded: true, busy: false, stale: false, connectionVersion: 1, generation: 2 };
}

it('仅后台有勾选也能填充，非法输入可修正，重复填充值不新增历史', () => {
  const { edits, first, add, info, changed } = fixture(true);
  const firstRows = first.rows;
  edits.remember(firstRows, new Set(['页1']), undefined, new Set());
  const second = add(2), selected = new Set<string>(), context = fillContext(info);
  const intent = edits.planCheckedFill(second.rows, selected, context);
  expect(intent.groups).toEqual([{ index: 1, count: 1 }]);
  const fill = [{ column: 'value', input: { mode: 'text' as const, text: '统一值' } }];
  changed.mockClear();
  expect(() => intent.stage([...fill, { column: 'id', input: { mode: 'text', text: '3' } }], second.rows, selected, context)).toThrow();
  expect(first.rows).toBe(firstRows);
  expect(changed).not.toHaveBeenCalled();
  expect(intent.stage(fill, second.rows, selected, context)).toEqual({ rows: second.rows, changed: 1 });
  expect(first.rows[0].data.value).toBe('统一值');
  expect(first.selected.has('页1')).toBe(true);
  expect(first.history.status.undo).toBe(1);
  expect(second.history.status.undo).toBe(0);
  expect(changed).toHaveBeenCalledOnce();
  expect(() => intent.stage(fill, second.rows, selected, context)).toThrow();
  expect(edits.planCheckedFill(second.rows, selected, context).stage(fill, second.rows, selected, context).changed).toBe(0);
  expect(first.history.status.undo).toBe(1);
  expect(changed).toHaveBeenCalledOnce();
});

it('跨页填充遇到重叠定位、合计字节超限或勾选变动时不发布任一页', () => {
  for (const failure of ['overlap', 'budget', 'selection']) {
    const { edits, first, add, info, changed } = fixture(true);
    const checked = new Set(['页1']);
    edits.remember(first.rows, checked, undefined, new Set());
    const second = add(2, failure === 'overlap' ? 1 : 2), selected = new Set(['页2']), context = fillContext(info);
    const firstRows = first.rows, secondRows = second.rows;
    const intent = edits.planCheckedFill(secondRows, selected, context);
    if (failure === 'selection') checked.clear();
    changed.mockClear();
    // 二进制或文本值的线路预算作用于合计写入，不能把大值拆到各页分别暂存。
    const large = 'x'.repeat(175000);
    const assignments = [{ column: 'value', input: { mode: 'text' as const, text: failure === 'budget' ? large : '统一值' } }];
    if (failure === 'budget') {
      // 多页都能独立接收此值，扩到七页后合计超限。
      for (let index = 3; index <= 7; index++) {
        edits.remember(edits.selected!.rows, new Set(['页' + (index - 1)]), undefined, new Set());
        add(index);
      }
      changed.mockClear();
      const active = edits.selected!, checks = new Set(['页7']);
      const across = edits.planCheckedFill(active.rows, checks, context);
      expect(() => across.stage(assignments, active.rows, checks, context)).toThrow(/预算/);
    } else {
      expect(() => intent.stage(assignments, secondRows, selected, context)).toThrow(failure === 'overlap' ? /同一条原记录/ : /已变化/);
    }
    expect(first.rows).toBe(firstRows);
    expect(second.rows).toBe(secondRows);
    expect(edits.changeCount).toBe(0);
    expect(edits.pages.every(page => page.history.status.undo === 0)).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  }
});


it('跨页复制保留原行和勾选，新行及键保护按来源页登记并逐页撤销', () => {
  const { edits, first, add, change, info, scope } = fixture(true);
  info.columns[0].extra = 'auto_increment';
  // 按更新后的目录重新登记原始首页。
  edits.clear();
  const left = add(1);
  const before = change('已暂存的原字段');
  edits.remember(before, new Set(['页1']), undefined, new Set());
  const right = add(2), checks = new Set(['页2']);
  let nextId = 0;
  const plan = edits.planCheckedDuplication(right.rows, checks, fillContext(info), () => '复制' + ++nextId);
  expect(plan.pages).toEqual([{ index: 1, count: 1 }, { index: 2, count: 1 }]);
  expect(left.rows).toBe(before);
  expect(first.copied.size).toBe(0);
  expect(plan.stage()).toBe(right.rows);
  expect(left.rows[0]).toBe(before[0]);
  expect(left.rows[1]).toEqual({ id: '复制1', data: { value: '已暂存的原字段' }, inserted: true, deleted: false });
  expect(right.rows[1].data).toEqual({ value: right.rows[0].data.value });
  expect(left.selected).toEqual(new Set(['页1']));
  expect(left.copied).toEqual(new Set(['复制1']));
  expect(right.copied).toEqual(new Set(['复制2']));
  expect(() => plan.stage()).toThrow();
  edits.select(edits.navigate(1, scope), left);
  edits.update(left.rows, edits.history.move(left.rows, 'undo')!);
  expect(left.rows).toEqual(before);
  expect(right.rows[1].inserted).toBe(true);
});

it('跨页复制拒绝重叠原键、全组预算超限和勾选变动', () => {
  for (const failure of ['overlap', 'budget', 'selection']) {
    const { edits, first, add, change, info } = fixture(true);
    const checks = new Set(['页1']);
    if (failure === 'budget') change('a'.repeat(230000));
    edits.remember(first.rows, checks, undefined, new Set());
    const last = failure === 'budget' ? 5 : 2;
    for (let index = 2; index <= last; index++) {
      const page = add(index, failure === 'overlap' ? 1 : index);
      if (failure === 'budget') change('a'.repeat(230000));
      edits.remember(page.rows, new Set(['页' + index]), undefined, new Set());
    }
    const current = edits.selected!.rows, left = first.rows, selected = new Set(['页' + last]);
    let nextId = 0;
    const prepare = () => edits.planCheckedDuplication(current, selected, fillContext(info), () => '复制' + ++nextId);
    if (failure === 'selection') {
      const plan = prepare();
      checks.clear();
      expect(() => plan.stage()).toThrow();
    } else expect(prepare).toThrow(failure === 'overlap' ? /同一条原记录/ : /上限/);
    expect(first.rows).toBe(left);
    expect(edits.selected!.rows).toBe(current);
    expect(edits.pages.every(page => page.copied.size === 0)).toBe(true);
  }
});

it('跨页逐条编辑先验证全部候选，分别暂存不同值并保留原页撤销', () => {
  const { edits, first, add, info, scope } = fixture(true);
  const before = first.rows;
  edits.remember(before, new Set(['页1']), undefined, new Set());
  const second = add(2), current = second.rows, checks = new Set(['页2']), context = fillContext(info);
  const binding = { page: second.page, target: recordTargetKey(context.target), connectionVersion: 1, generation: 2 };
  const intent = edits.planCheckedRecordEdit(current, checks, context, binding, second.page, '批次');
  expect(intent.groups).toEqual([{ index: 1, count: 1 }, { index: 2, count: 1 }]);
  expect([...intent.pageByRow]).toEqual([['页1', 1], ['页2', 2]]);
  expect(intent.check(intent.initial)).toBe(intent.rows);
  const candidates = intent.initial.map((row, index) => ({ ...row, data: { ...row.data, value: '修改' + index } }));
  expect(() => intent.stage([candidates[0], { ...candidates[1], original: {} }], current, checks, context, binding, second.page)).toThrow();
  expect(first.rows).toBe(before);
  expect(second.rows).toBe(current);
  expect(intent.check(candidates)).not.toBe(intent.rows);
  expect(intent.stage(candidates, current, checks, context, binding, second.page).changed).toBe(2);
  expect(first.rows[0].data.value).toBe('修改0');
  expect(second.rows[0].data.value).toBe('修改1');
  expect(() => intent.stage(candidates, current, checks, context, binding, second.page)).toThrow();
  edits.select(edits.navigate(1, scope), first);
  edits.update(first.rows, edits.history.move(first.rows, 'undo')!);
  expect(first.rows[0].data).toEqual(before[0].data);
  expect(second.rows[0].data.value).toBe('修改1');
});

it('仅后台有勾选可逐条编辑；同一原定位或原选择变动时拒绝整批', () => {
  for (const overlap of [false, true]) {
    const { edits, first, add, info } = fixture(true);
    const checked = new Set(['页1']);
    edits.remember(first.rows, checked, undefined, new Set());
    const second = add(2, overlap ? 1 : 2), selected = new Set(overlap ? ['页2'] : []), context = fillContext(info);
    const binding = { page: second.page, target: recordTargetKey(context.target), connectionVersion: 1, generation: 2 };
    const prepare = () => edits.planCheckedRecordEdit(second.rows, selected, context, binding, second.page, '批次');
    if (overlap) expect(prepare).toThrow(/同一条原记录/);
    else {
      const intent = prepare();
      expect(intent.groups).toEqual([{ index: 1, count: 1 }]);
      const candidates = intent.initial.map(row => ({ ...row, data: { ...row.data, value: '仅后台' } }));
      expect(intent.stage(candidates, second.rows, selected, context, binding, second.page).changed).toBe(1);
      const pending = prepare();
      checked.clear();
      expect(pending.reason(second.rows, selected, context, binding, second.page)).toMatch(/已变化/);
      expect(first.rows[0].data.value).toBe('仅后台');
    }
  }
});
