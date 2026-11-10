import{beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi}from'vitest';
import{mkdtempSync,rmSync,mkdirSync,rmdirSync,readFileSync}from'node:fs';
import{join,dirname,resolve,basename}from'node:path';
import{tmpdir}from'node:os';
import{createRequire}from'node:module';
import{randomUUID}from'node:crypto';
import{build}from'esbuild';
import type{Database}from'sql.js';
import{LocalStore}from'../../src/main/storage';
import{HistoryPages}from'../../src/main/historyPages';
import{SavedQueryPages}from'../../src/main/savedQueryPages';
import{SavedQueryMatcher}from'../../src/main/savedQueryMatcher';
import{SavedQuerySearchCancelled}from'../../src/main/savedQuerySearch';
import{summarizeHistoryRecord}from'../../src/main/historyPageMatch';
import{validateCommand}from'../../src/shared/validation';
import type{HistoryEntry,ConnectionProfile}from'../../src/shared/contracts';
import type{HistoryPageInput,HistoryPageEntry}from'../../src/shared/historyPages';

const require=createRequire(import.meta.url),protector={available:()=>false,encrypt:(value:string)=>value,decrypt:(value:string)=>value};
const request=(patch:Partial<HistoryPageInput>={}):HistoryPageInput=>({taskId:randomUUID(),search:'',fields:['sql','error'],scope:{kind:'all'},status:'all',onError:'continue',...patch});
const history=(patch:Partial<HistoryEntry>={}):HistoryEntry=>({id:'h',connectionId:'source',sql:'SELECT 9007199254740993',startedAt:'2026-10-15T00:00:00.000Z',elapsedMs:12,success:true,...patch});
const profile=(id='source'):ConnectionProfile=>({id,name:'离线来源',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'});
const position=(entry:HistoryEntry)=>({id:entry.id,connectionId:entry.connectionId,startedAt:entry.startedAt});
let workerDirectory:string,workerPath:string,directory:string,store:LocalStore,service:HistoryPages,restore:()=>void;
const workers=new Set<SavedQueryMatcher>();let onSummary:(worker:SavedQueryMatcher)=>void=()=>{};
/** 清理只允许本例在系统临时父目录创建的精确前缀，不触碰其它目录。 */
function removeDirectory(path:string){if(dirname(resolve(path))!==resolve(tmpdir())||!basename(path).startsWith('dbark-test-historypages-'))throw Error('拒绝清理非本例临时目录');rmSync(path,{recursive:true,force:true});}
/** 直接写入原始夹具仅用于损坏和旧版记录，不作为生产新增历史接口。 */
function insert(entry:HistoryEntry,raw=JSON.stringify(entry)){(store as unknown as{db:Database}).db.run('INSERT INTO history VALUES(?,?,?,?)',[entry.id,entry.connectionId,raw,entry.startedAt]);}
beforeAll(async()=>{workerDirectory=mkdtempSync(join(tmpdir(),'dbark-test-historypages-'));workerPath=join(workerDirectory,'worker.cjs');await build({entryPoints:['src/main/savedQuerySearchWorker.ts'],outfile:workerPath,bundle:true,platform:'node',format:'cjs',target:'node22'});const original=SavedQueryMatcher.prototype.summarizeHistory,spy=vi.spyOn(SavedQueryMatcher.prototype,'summarizeHistory').mockImplementation(function(this:SavedQueryMatcher,...args){workers.add(this);const result=original.apply(this,args);onSummary(this);return result;});restore=()=>spy.mockRestore();});
afterAll(()=>{restore?.();removeDirectory(workerDirectory);});
beforeEach(async()=>{directory=mkdtempSync(join(tmpdir(),'dbark-test-historypages-'));store=await LocalStore.open(join(directory,'test.sqlite'),require.resolve('sql.js/dist/sql-wasm.wasm'),protector);service=new HistoryPages(store,workerPath);workers.clear();onSummary=()=>{};});
afterEach(async()=>{await service?.close();for(const worker of workers)expect(worker.threadId).toBe(-1);store?.close();removeDirectory(directory);});

describe('历史概要和严格协议',()=>{
 it('执行库条件严格匹配原记录状态，且只可在首批和清理预览提交', () => {
  const records = [
   history({ id: 'named', database: 'old', databaseContext: { state: 'known', database: 'Sales' } }),
   history({ id: 'lower', databaseContext: { state: 'known', database: 'sales' } }),
   history({ id: 'none', database: 'Sales', databaseContext: { state: 'known', database: null } }),
   history({ id: 'unknown', database: 'Sales', databaseContext: { state: 'unknown' } }),
   history({ id: 'legacy', database: 'Sales' }),
  ];
  const cases = [
   [{ kind: 'known', database: 'Sales' }, 'named'], [{ kind: 'known', database: null }, 'none'],
   [{ kind: 'unknown' }, 'unknown'], [{ kind: 'legacy' }, 'legacy'],
  ] as const;
  for (const [database, id] of cases) {
   const input = request({ database });
   expect(records.filter(record => summarizeHistoryRecord(record.id, JSON.stringify(record), input, position(record))).map(record => record.id)).toEqual([id]);
   const { taskId, onError, ...filters } = input;
   expect(validateCommand('history.deletePreview', { taskId, scope: { kind: 'filtered', filters } })).toMatchObject({ scope: { filters: { database } } });
  }
  expect(() => validateCommand('history.page', request({ database: { kind: 'known', database: '' } }))).toThrow();
  expect(() => validateCommand('history.pageContinue', { taskId: randomUUID(), cursor: randomUUID(), database: { kind: 'unknown' } })).toThrow();
 });
 it('只允许在历史首批设置排序，续页和清理范围不接受排序字段', () => {
  for (const sort of ['recent', 'oldest', 'slowest', 'fastest'] as const)
   expect(validateCommand('history.page', request({ sort }))).toMatchObject({ sort });
  expect(() => validateCommand('history.page', { ...request(), sort: 'elapsed_ms' })).toThrow();
  expect(() => validateCommand('history.pageContinue', { taskId: randomUUID(), cursor: randomUUID(), sort: 'slowest' })).toThrow();
  const { taskId, onError, ...filters } = request({ sort: 'slowest' });
  expect(() => validateCommand('history.deletePreview', { taskId, scope: { kind: 'filtered', filters } })).toThrow();
 });
 it('历史另存只接受本地记录引用和支持的编码', () => {
  const ref = { id: 'h', digest: 'a'.repeat(64), encoding: 'utf16le' };
  expect(validateCommand('history.exportSql', ref)).toEqual(ref);
  for (const patch of [{ encoding: 'ascii' }, { digest: 'bad' }, { sql: 'SELECT 2' }, { path: '任意路径.sql' }, { connectionId: '其他连接' }])
    expect(() => validateCommand('history.exportSql', { ...ref, ...patch })).toThrow();
 });
 it('保存新查询仅接受历史摘要、非空名称与保留来源选择', () => {
  const input = { id: 'h', digest: 'a'.repeat(64), name: '查询名', keepSource: true };
  expect(validateCommand('history.saveQuery', { ...input, name: ' 查询名 ' })).toEqual(input);
  for (const patch of [{ name: ' ' }, { keepSource: 'true' }, { sql: 'SELECT 2' }, { connectionId: '替代' }, { context: {} }, { queryId: '覆盖' }])
    expect(() => validateCommand('history.saveQuery', { ...input, ...patch })).toThrow();
 });
 it('批量保存拒绝空批次、重复历史、超限和额外 SQL', () => {
  const ref = { id: 'h', digest: 'a'.repeat(64) };
  const input = { items: [ref], prefix: '  批量  ', keepSource: true };
  expect(validateCommand('history.saveQueryBatch', input)).toEqual({ ...input, prefix: '批量' });
  for (const patch of [{ items: [] }, { items: [ref, ref] },
   { items: Array.from({ length: 26 }, (_, index) => ({ ...ref, id: String(index) })) }, { prefix: '' }, { sql: 'SELECT 1' }])
   expect(() => validateCommand('history.saveQueryBatch', { ...input, ...patch })).toThrow();
 });
 it('限制筛选、字段、句柄、摘要及未知参数，不能注入SQL或客户端索引位置',()=>{expect(validateCommand('history.page',request())).toMatchObject({status:'all'});for(const patch of[{search:'x'.repeat(513)},{taskId:'h'},{fields:[]},{fields:['sql','sql']},{status:'other'},{scope:{kind:'connection',connectionId:''}},{sql:'SELECT 1'},{after:{id:'h'}},{onError:'skip'}])expect(()=>validateCommand('history.page',{...request(),...patch})).toThrow();expect(()=>validateCommand('history.pageContinue',{taskId:randomUUID(),cursor:randomUUID(),status:'failed'})).toThrow();expect(()=>validateCommand('history.read',{id:'h',digest:'a'.repeat(64)})).toThrow();expect(()=>validateCommand('history.readError',{id:'h',digest:'bad'})).toThrow();});
 it('完整SQL或错误尾部筛选，概要不含全文且Unicode预览不拆代理对',()=>{const entry=history({sql:'x'.repeat(511)+'😀'+'x'.repeat(8000)+'SQL尾部_9007199254740993',error:'x'.repeat(255)+'😀'+'x'.repeat(5000)+'错误尾部',success:false}),raw=JSON.stringify(entry),summary=summarizeHistoryRecord(entry.id,raw,request({search:'错误尾部',fields:['error']}),position(entry))!;expect(summary.sqlPreview).toHaveLength(511);expect(summary.errorPreview).toHaveLength(255);expect(summary.sqlUnits).toBe(entry.sql.length);expect(summary.errorUnits).toBe(entry.error!.length);expect(summary.previewTruncated&&summary.errorTruncated).toBe(true);expect(summary.digest).toMatch(/^[a-f0-9]{64}$/);expect('sql'in summary.entry||'error'in summary.entry).toBe(false);expect(JSON.stringify(summary)).not.toContain('错误尾部');expect(summarizeHistoryRecord(entry.id,raw,request({search:'错误尾部',fields:['sql']}),position(entry))).toBeUndefined();expect(summarizeHistoryRecord(entry.id,raw,request({search:'sql尾部_9007199254740993',fields:['sql']}),position(entry))).toBeTruthy();});
 it('普通包含不执行正则或SQL，状态过滤前先校验完整记录和索引',()=>{const entry=history({sql:'UPDATE t SET n=1 -- A.*% 尾部',success:true}),raw=JSON.stringify(entry);expect(summarizeHistoryRecord('h',raw,request({search:'a.*%'}),position(entry))).toBeTruthy();expect(summarizeHistoryRecord('h',raw,request({search:'^.*$'}),position(entry))).toBeUndefined();expect(()=>summarizeHistoryRecord('h',raw,request({status:'failed'}),{...position(entry),connectionId:'other'})).toThrow('索引不一致');expect(()=>summarizeHistoryRecord('h','{"sql":"绝不回显的原文"}',request({status:'failed'}),position(entry))).toThrow('结构无效');});
});

describe('真实SQLite与工作线程历史分页',()=>{
 it('历史批量打开按勾选顺序重读正文，逐条核对连接和摘要', async () => {
  store.saveConnection(profile());
  store.saveConnection(profile('replacement'));
  const sql = 'SELECT 9007199254740993;\r\n-- 保留换行';
  store.addHistory(history({ id: 'bound', sql, databaseContext: { state: 'known', database: null } }));
  store.addHistory(history({ id: 'lost', connectionId: 'gone', database: '旧库', error: '错误详情' }));
  const hits = (await service.start(request())).items;
  const items = ['bound', 'lost'].map((id, index) => ({ id, digest: hits.find(hit => hit.entry.id === id)!.digest,
   connectionId: index ? 'replacement' : 'source' }));
  expect(validateCommand('history.readBatch', { items })).toEqual({ items });
  expect(() => validateCommand('history.readBatch', { items: [items[0], items[0]] })).toThrow();
  const opened = service.readBatch({ items });
  expect(opened).toMatchObject([
   { entry: { id: 'bound', sql }, databaseContext: { state: 'known', database: null }, contextChanged: false },
   { entry: { id: 'lost' }, connectionId: 'replacement', databaseContext: { state: 'unknown' }, contextChanged: true },
  ]);
  expect(opened[1].entry).not.toHaveProperty('error');
  expect(() => service.readBatch({ items: [items[0], { ...items[1], digest: '0'.repeat(64) }] })).toThrow('历史已变化');
  expect(() => service.readBatch({ items: [items[0], { ...items[1], connectionId: 'gone' }] })).toThrow('连接不存在');
  expect(store.queries()).toEqual([]);
 });
 it('完整SQL只按当前摘要读取，来源删除后可查看，替换或删记录不复用旧摘要',async()=>{
  const entry=history({connectionId:'removed',sql:'SELECT 1; -- '+ '文'.repeat(70000)+'\r\n😀尾部',error:'仅错误正文'});
  store.addHistory(entry);
  const item=(await service.start(request())).items[0], ref={id:item.entry.id,digest:item.digest};
  expect(validateCommand('history.readSql',ref)).toEqual(ref);
  expect(()=>validateCommand('history.readSql',{...ref,connectionId:'other'})).toThrow();
  expect(()=>validateCommand('history.readSql',{...ref,sql:'SELECT 2'})).toThrow();
  expect(service.readSql(ref)).toEqual({sql:entry.sql});
  expect(()=>service.read({...ref,connectionId:'removed'})).toThrow('连接不存在');
  (store as unknown as {db:Database}).db.run('UPDATE history SET data=? WHERE id=?',[JSON.stringify({...entry,sql:'SELECT 2'}),entry.id]);
  expect(()=>service.readSql(ref)).toThrow('历史已变化');
  expect(()=>service.readSql({...ref,id:'missing'})).toThrow('刷新列表');
 });
 it('58条同时间记录稳定分三页并使用复合索引，从不调用500条全量入口',async()=>{const entries=Array.from({length:58},(_,i)=>history({id:'h'+String(i).padStart(3,'0'),startedAt:i<30?'2026-10-15T01:00:00Z':'2026-10-15T00:00:00Z'}));for(const entry of entries)store.addHistory(entry);const legacy=vi.spyOn(store,'history').mockImplementation(()=>{throw Error('禁止全量历史');});try{let page=await service.start(request());expect(page.items).toHaveLength(25);const results=[...page.items];while(page.cursor){for(const worker of workers)expect(worker.threadId).toBe(-1);page=await service.next({taskId:randomUUID(),cursor:page.cursor});expect(page.items.length).toBeLessThanOrEqual(25);results.push(...page.items);}expect(results.map(item=>item.entry.id)).toEqual(entries.sort((a,b)=>Buffer.compare(Buffer.from(b.startedAt),Buffer.from(a.startedAt))||Buffer.compare(Buffer.from(b.id),Buffer.from(a.id))).map(entry=>entry.id));expect(page).toMatchObject({scanned:58,matched:58,failed:0});expect(legacy).not.toHaveBeenCalled();const db=(store as unknown as{db:Database}).db;for(const[scope,index]of[['','history_started_id'],["connection_id='source' AND ",'history_connection_started_id']]){const plan=JSON.stringify(db.exec("EXPLAIN QUERY PLAN SELECT id FROM history WHERE "+scope+"(started_at COLLATE BINARY,id COLLATE BINARY)<('2026','h') ORDER BY started_at COLLATE BINARY DESC,id COLLATE BINARY DESC LIMIT 2"));expect(plan).toContain(index);expect(plan).not.toContain('TEMP B-TREE');}}finally{legacy.mockRestore();}});
 it('无命中页仍能继续，完整错误和SQL可分字段过滤且旧句柄仅消费一次',async()=>{for(let i=0;i<28;i++)store.addHistory(history({id:'h'+String(i).padStart(3,'0'),sql:i===0?'x'.repeat(9000)+'完整尾部':'SELECT 1',error:i===1?'x'.repeat(9000)+'完整尾部':undefined}));const first=await service.start(request({search:'完整尾部',fields:['sql']}));expect(first.items).toEqual([]);expect(first.scanned).toBe(25);const last=await service.next({taskId:randomUUID(),cursor:first.cursor});expect(last.items.map(item=>item.entry.id)).toEqual(['h000']);expect(last.scanned).toBe(28);expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor})).toThrow('已翻页');let errors=await service.start(request({search:'完整尾部',fields:['error']}));errors=await service.next({taskId:randomUUID(),cursor:errors.cursor});expect(errors.items.map(item=>item.entry.id)).toEqual(['h001']);});
 it('来源和成功失败按真实记录筛选，遗留空来源可独立读取',async()=>{store.addHistory(history({id:'a'}));store.addHistory(history({id:'b',connectionId:'other',success:false,error:'失败详情'}));const unbound=history({id:'legacy',connectionId:''});const{connectionId,...legacy}=unbound;insert(unbound,JSON.stringify(legacy));expect((await service.start(request({scope:{kind:'connection',connectionId:'source'}}))).items.map(item=>item.entry.id)).toEqual(['a']);expect((await service.start(request({status:'failed'}))).items.map(item=>item.entry.id)).toEqual(['b']);const page=await service.start(request({scope:{kind:'unbound'}}));expect(page.items.map(item=>item.entry.id)).toEqual(['legacy']);expect(page.items[0].entry.connectionId).toBeUndefined();});
 it('最长多字节概要受128KiB预算约束，续页不丢记录且页间真实线程已结束',async()=>{for(let i=0;i<40;i++)insert(history({id:String(i).padStart(4,'0')+'文'.repeat(196),connectionId:'文'.repeat(200),database:'文'.repeat(256),databaseContext:{state:'known',database:'文'.repeat(256)},startedAt:'文'.repeat(256),sql:'文'.repeat(3000),error:'文'.repeat(3000),success:false}));let page=await service.start(request());expect(page.items.length).toBeLessThan(25);const entries:HistoryPageEntry[]=[];for(;;){expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128*1024);for(const worker of workers)expect(worker.threadId).toBe(-1);entries.push(...page.items);if(!page.cursor)break;page=await service.next({taskId:randomUUID(),cursor:page.cursor});}expect(entries).toHaveLength(40);expect(new Set(entries.map(item=>item.entry.id)).size).toBe(40);expect(page).toMatchObject({scanned:40,matched:40,failed:0});});
 it('损坏记录、索引错位和过大原文均明确失败，停止及继续政策不把它们算无命中',async()=>{insert(history({id:'z'}),'绝不回显的损坏内容');insert(history({id:'y'}),JSON.stringify(history({id:'y',connectionId:'wrong'})));for(let i=0;i<26;i++)insert(history({id:'a'+i}));const stopped=await service.start(request({onError:'stop',status:'failed'}));expect(stopped).toMatchObject({scanned:1,failed:1,stoppedOnError:true});expect(stopped.cursor).toBeUndefined();expect(JSON.stringify(stopped.failures)).not.toContain('绝不回显');let page=await service.start(request());expect(page.failed).toBe(2);expect(page.failures).toHaveLength(2);page=await service.next({taskId:randomUUID(),cursor:page.cursor});expect(page).toMatchObject({scanned:28,matched:26,failed:2});const next=vi.spyOn(store,'historyPageNext').mockReturnValue({id:'large',startedAt:'2026',connectionId:'source',raw:null,hasMore:false});try{const failed=await service.start(request());expect(failed.failures[0].message).toContain('128MiB');expect(failed.failed).toBe(1);}finally{next.mockRestore();}});
 it('真实线程取消、最近编号归属和退出拒绝新读取，保存查询的句柄不受错误释放影响',async()=>{store.addHistory(history({sql:'x'.repeat(200000)}));const input=request();let cancellation:Promise<void>|undefined;onSummary=worker=>{expect(worker.threadId).toBeGreaterThan(0);cancellation=service.cancel(input.taskId);};await expect(service.start(input)).rejects.toBeInstanceOf(SavedQuerySearchCancelled);await cancellation;expect(service.owns(input.taskId)).toBe(true);for(const worker of workers)expect(worker.threadId).toBe(-1);onSummary=()=>{};const queries=new SavedQueryPages(store,workerPath);try{for(let i=0;i<26;i++)store.saveQuery({id:'q'+i,name:'查询',sql:'SELECT 1',updatedAt:'2026'});const page=await queries.start({taskId:randomUUID(),search:'',onError:'continue'});service.release({cursor:page.cursor});expect((await queries.next({taskId:randomUUID(),cursor:page.cursor})).items).toHaveLength(1);}finally{await queries.close();}await service.close();await expect(service.start(request())).rejects.toThrow('正在退出');});
 it('活动线程期间新增历史使当前页失效，不能发布混合新旧来源的结果',async()=>{store.addHistory(history());let changed=false;onSummary=()=>{if(!changed){changed=true;store.addHistory(history({id:'new'}));}};await expect(service.start(request())).rejects.toThrow('已变化');expect(store.history()).toHaveLength(2);for(const worker of workers)expect(worker.threadId).toBe(-1);});
 it('页释放、到期、编号复用和活动数量都有界，句柄不接受外部位置替代',async()=>{for(let i=0;i<26;i++)insert(history({id:'h'+i}));const input=request(),first=await service.start(input);await expect(service.start(input)).rejects.toThrow('编号已使用');service.release({cursor:first.cursor});expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor})).toThrow('已过期');const page=await service.start(request()),now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+5*60000+1);try{expect(()=>service.next({taskId:randomUUID(),cursor:page.cursor})).toThrow('已过期');}finally{now.mockRestore();}const a=service.start(request()),b=service.start(request());await expect(service.start(request())).rejects.toThrow('上限');await Promise.all([a,b]);});
});

describe('历史打开、保留上限和真实持久化',()=>{
 it('真实 SQLite 按原耗时、时间和编号跨批排序，旧库及损坏记录继续可读', async () => {
  const database = () => (store as unknown as { db: Database }).db;
  database().run('DROP INDEX history_duration_started_id');
  insert(history({ id: 'bad' }), '{损坏记录');
  const entries = Array.from({ length: 58 }, (_, index) => history({
   id: `sort-${String(index).padStart(2, '0')}`, connectionId: index % 5 ? 'source' : 'other',
   startedAt: `2026-10-15T0${index % 2}:00:00.000Z`,
   elapsedMs: index < 49 ? 1.125 : [0, 1.25, 1e21, Number.MAX_VALUE][index % 4],
  }));
  for (const entry of entries) store.addHistory(entry);
  await service.close(); store.close();
  store = await LocalStore.open(join(directory, 'test.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
  service = new HistoryPages(store, workerPath);
  expect(database().exec('PRAGMA user_version')[0].values[0][0]).toBe(9);
  const indexSql = String(database().exec("SELECT sql FROM sqlite_master WHERE name='history_duration_started_id'")[0].values[0][0]);
  const key = indexSql.slice(indexSql.indexOf('((CASE') + 1, indexSql.lastIndexOf(',started_at COLLATE BINARY'));
  const plan = JSON.stringify(database().exec(`EXPLAIN QUERY PLAN SELECT id FROM history WHERE ${key} >= 1 ORDER BY ${key},started_at COLLATE BINARY,id COLLATE BINARY LIMIT 2`));
  expect(plan).toMatch(/SEARCH history USING (?:COVERING )?INDEX history_duration_started_id/);
  expect(plan).not.toContain('TEMP B-TREE');
  for (const sort of ['slowest', 'fastest', 'oldest', 'recent'] as const) {
   const duration = sort === 'slowest' || sort === 'fastest';
   const direction = sort === 'slowest' || sort === 'recent' ? -1 : 1;
   const expected = [...entries].sort((a, b) => direction * ((duration ? Math.sign(a.elapsedMs - b.elapsedMs) : 0) ||
    Buffer.compare(Buffer.from(a.startedAt), Buffer.from(b.startedAt)) || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))));
   let page = await service.start(request({ sort }));
   const ids = page.items.map(item => item.entry.id);
   while (page.cursor) {
    page = await service.next({ taskId: randomUUID(), cursor: page.cursor });
    ids.push(...page.items.map(item => item.entry.id));
   }
   expect(ids).toEqual(expected.map(entry => entry.id));
   expect(page).toMatchObject({ scanned: 59, matched: 58, failed: 1 });
  }
  let filtered = await service.start(request({ sort: 'slowest', scope: { kind: 'connection', connectionId: 'source' }, durationRange: { minMs: 1, maxMs: 2 } }));
  const matches = [...filtered.items];
  while (filtered.cursor) {
   filtered = await service.next({ taskId: randomUUID(), cursor: filtered.cursor });
   matches.push(...filtered.items);
  }
  expect(matches.map(item => item.entry.id).sort()).toEqual(entries.filter(entry => entry.connectionId === 'source' && entry.elapsedMs >= 1 && entry.elapsedMs <= 2).map(entry => entry.id));
  expect(store.historyRaw('bad')).toBe('{损坏记录');
  for (const entry of entries) expect(store.historyRaw(entry.id)).toBe(JSON.stringify(entry));
 });
 it('保存内容准确区分四类历史上下文，并拒绝失效来源与陈旧摘要', async () => {
  store.saveConnection(profile());
  const contexts = [
    { database: '遗留库' }, { databaseContext: { state: 'known', database: null } },
    { databaseContext: { state: 'known', database: '执行库' } }, { databaseContext: { state: 'unknown' } },
  ] as const;
  const sql = 'SELECT 9007199254740993\r\n-- 😀 正文';
  for (const [index, context] of contexts.entries()) store.addHistory(history({ id: String(index), ...context, sql, error: '错误详情' }));
  const page = await service.start(request());
  for (const item of page.items) {
    const input = { id: item.entry.id, digest: item.digest, name: '同名新查询', keepSource: true };
    const saved = store.createBoundQuery(service.querySaveContent(input));
    const expected = contexts[Number(item.entry.id)];
    expect(saved.source.context).toEqual('databaseContext' in expected ? expected.databaseContext : { state: 'legacy', database: expected.database });
    expect(saved.source.connectionId).toBe('source');
  }
  expect(new Set(store.queries().map(query => query.id)).size).toBe(4);
  expect(store.queries().every(query => query.sql === sql && !('error' in query))).toBe(true);
  const item = page.items[0];
  const input = { id: item.entry.id, digest: item.digest, name: '解除绑定', keepSource: true };
  store.deleteConnection('source');
  expect(() => service.querySaveContent(input)).toThrow('来源连接已失效');
  expect(service.querySaveContent({ ...input, keepSource: false })).toEqual({ name: '解除绑定', sql, context: { state: 'unknown' } });
  const db = (store as unknown as { db: Database }).db;
  db.run('UPDATE history SET data=? WHERE id=?', [JSON.stringify({ ...item.entry, sql: 'SELECT 2' }), item.entry.id]);
  expect(() => service.querySaveContent({ ...input, keepSource: false })).toThrow('历史已变化');
  expect(store.queries()).toHaveLength(4);
 });
 it('批量保存按选择顺序构造正文，拒绝陈旧摘要和分组，写盘失败整批回退', async () => {
  store.saveConnection(profile());
  const sql = 'SELECT 9007199254740993;\r\n-- 正文';
  store.addHistory(history({ id: 'bound', sql, databaseContext: { state: 'known', database: null } }));
  store.addHistory(history({ id: 'lost', sql: 'SELECT 2', connectionId: 'lost', database: '旧库' }));
  const groupSnapshot = store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'create', name: '本批', parentId: null } });
  const group = { id: groupSnapshot.groups[0].id, expectedRevision: groupSnapshot.revision };
  const items = (await service.start(request())).items.reverse().map(item => ({ id: item.entry.id, digest: item.digest }));
  const input = { items, prefix: '批量', keepSource: true, group };
  expect(() => service.querySaveBatchContents({ ...input, items: [items[0], { ...items[1], digest: '0'.repeat(64) }] })).toThrow('历史已变化');
  const { contents } = service.querySaveBatchContents(input);
  expect(contents).toEqual([
   { name: '批量 1', sql, connectionId: 'source', context: { state: 'known', database: null } },
   { name: '批量 2', sql: 'SELECT 2', context: { state: 'unknown' } },
  ]);
  const path = join(directory, 'test.sqlite'), bytes = readFileSync(path), revision = store.queryOrganization().revision;
  expect(() => store.createBoundQueryBatch(contents, { ...group, expectedRevision: '0'.repeat(64) }, () => {})).toThrow('分组已变化');
  const blocker = path + '.tmp';
  mkdirSync(blocker);
  try { expect(() => store.createBoundQueryBatch(contents, group, () => {})).toThrow('修改未保存'); }
  finally { rmdirSync(blocker); }
  expect(store.queries()).toEqual([]);
  expect(store.queryOrganization().revision).toBe(revision);
  expect(readFileSync(path)).toEqual(bytes);
  expect(store.createBoundQueryBatch(contents, group, () => {})).toBe(2);
  expect(store.queryOrganization()).toMatchObject({ groups: [{ id: group.id, count: 2 }], unfiledCount: 0 });
  expect(store.history()).toHaveLength(2);
 });
 it('已知库、无库、未知及遗留上下文重启后保留，替代来源必须明确并变为未知',async()=>{store.saveConnection(profile());store.saveConnection(profile('replacement'));const contexts:Partial<HistoryEntry>[]=[{database:'旧库',databaseContext:{state:'known',database:'实际库'}},{database:'旧库',databaseContext:{state:'known',database:null}},{database:'旧库',databaseContext:{state:'unknown'}},{database:'遗留库'}];for(const[index,context]of contexts.entries())store.addHistory(history({id:String(index),...context,sql:'UPDATE t SET n=999 -- 绝不自动执行',error:'完整错误'}));await service.close();store.close();store=await LocalStore.open(join(directory,'test.sqlite'),require.resolve('sql.js/dist/sql-wasm.wasm'),protector);service=new HistoryPages(store,workerPath);for(const item of(await service.start(request())).items){const opened=service.read({id:item.entry.id,digest:item.digest,connectionId:'source'});expect(opened.databaseContext).toEqual(contexts[Number(item.entry.id)].databaseContext);expect(opened.entry.sql).toContain('绝不自动执行');expect('error'in opened.entry).toBe(false);expect(service.readError({id:item.entry.id,digest:item.digest})).toEqual({error:'完整错误'});expect(()=>service.read({id:item.entry.id,digest:item.digest,connectionId:'missing'})).toThrow('不存在');const changed=service.read({id:item.entry.id,digest:item.digest,connectionId:'replacement'});expect(changed.contextChanged).toBe(true);expect(changed.databaseContext).toEqual({state:'unknown'});expect(changed.database).toBeUndefined();}expect(store.tasks()).toEqual([]);expect(store.history()).toHaveLength(4);});
 it('陈旧摘要与已移除历史不能打开或读取别的错误，读取本身不修改磁盘',async()=>{store.saveConnection(profile());store.addHistory(history({error:'原始完整错误'}));const bytes=readFileSync(join(directory,'test.sqlite')),item=(await service.start(request())).items[0];expect(service.readError({id:'h',digest:item.digest})).toEqual({error:'原始完整错误'});expect(readFileSync(join(directory,'test.sqlite'))).toEqual(bytes);const db=(store as unknown as{db:Database}).db;db.run('UPDATE history SET data=? WHERE id=?',[JSON.stringify(history({error:'新错误'})),'h']);expect(()=>service.readError({id:'h',digest:item.digest})).toThrow('已变化');expect(()=>service.read({id:'h',digest:item.digest,connectionId:'source'})).toThrow('已变化');db.run('DELETE FROM history WHERE id=?',['h']);expect(()=>service.readError({id:'h',digest:item.digest})).toThrow('移除');});
 // 1000条需启动并回收40个真实分页线程；单条2秒产品期限保持不变，整例给慢CI独立预算。
 it('历史实际写盘失败恢复原文和修订，成功新增仍只保留最近1000条而非500条',async()=>{store.addHistory(history());const before=readFileSync(join(directory,'test.sqlite')),revision=store.historyPageRevision(),blocker=join(directory,'test.sqlite.tmp');mkdirSync(blocker);try{expect(()=>store.addHistory(history({id:'not-saved'}))).toThrow('修改未保存');expect(store.historyRaw('not-saved')).toBeUndefined();expect(store.historyPageRevision()).toBe(revision);}finally{rmdirSync(blocker);}expect(readFileSync(join(directory,'test.sqlite'))).toEqual(before);for(let i=0;i<1003;i++)insert(history({id:'x'+String(i).padStart(4,'0')}));store.addHistory(history({id:'latest',startedAt:'2026-10-16T00:00:00Z'}));const db=(store as unknown as{db:Database}).db;expect(db.exec('SELECT COUNT(*) FROM history')[0].values[0][0]).toBe(1000);expect(store.history()).toHaveLength(500);let page=await service.start(request()),count=page.items.length;while(page.cursor){page=await service.next({taskId:randomUUID(),cursor:page.cursor});count+=page.items.length;}expect(count).toBe(1000);expect(page.scanned).toBe(1000);expect(store.historyRaw('h')).toBeUndefined();},20000);
});
