import{beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi}from'vitest';
import{mkdtempSync,rmSync,mkdirSync,rmdirSync,readFileSync}from'node:fs';
import{join,dirname,resolve,basename}from'node:path';
import{tmpdir}from'node:os';
import{createRequire}from'node:module';
import{createHash,randomUUID}from'node:crypto';
import{build}from'esbuild';
import type{Database}from'sql.js';
import{LocalStore}from'../../src/main/storage';
import{SavedQueryPages}from'../../src/main/savedQueryPages';
import{SavedQueryMatcher}from'../../src/main/savedQueryMatcher';
import{SavedQuerySearches,SavedQuerySearchCancelled}from'../../src/main/savedQuerySearch';
import{summarizeSavedQueryRecord}from'../../src/main/savedQuerySearchMatch';
import{validateCommand}from'../../src/shared/validation';
import type{SavedQuery,ConnectionProfile}from'../../src/shared/contracts';
import type{SavedQueryPageInput,SavedQueryPageEntry}from'../../src/shared/savedQueryPages';

const require=createRequire(import.meta.url),protector={available:()=>false,encrypt:(value:string)=>value,decrypt:(value:string)=>value};
const request=(patch:Partial<SavedQueryPageInput>={}):SavedQueryPageInput=>({taskId:randomUUID(),search:'',onError:'continue',...patch});
const query=(patch:Partial<SavedQuery>={}):SavedQuery=>({id:'q',name:'查询',sql:'SELECT 9007199254740993',updatedAt:'2026-10-15T00:00:00.000Z',...patch});
let workerDirectory:string,workerPath:string,directory:string,store:LocalStore,service:SavedQueryPages,restore:()=>void;
const workers=new Set<SavedQueryMatcher>();let onSummary:(worker:SavedQueryMatcher)=>void=()=>{};
/** 删除前核对系统临时父目录与本测试精确前缀，不按宽泛目录批量删除。 */
function removeDirectory(path:string){if(dirname(resolve(path))!==resolve(tmpdir())||!basename(path).startsWith('dbark-test-querypages-'))throw Error('拒绝清理非本例临时目录');rmSync(path,{recursive:true,force:true});}
beforeAll(async()=>{workerDirectory=mkdtempSync(join(tmpdir(),'dbark-test-querypages-'));workerPath=join(workerDirectory,'worker.cjs');await build({entryPoints:['src/main/savedQuerySearchWorker.ts'],outfile:workerPath,bundle:true,platform:'node',format:'cjs',target:'node22'});const original=SavedQueryMatcher.prototype.summarize,spy=vi.spyOn(SavedQueryMatcher.prototype,'summarize').mockImplementation(function(this:SavedQueryMatcher,...args){workers.add(this);const result=original.apply(this,args);onSummary(this);return result;});restore=()=>spy.mockRestore();});
afterAll(()=>{restore?.();removeDirectory(workerDirectory);});
beforeEach(async()=>{directory=mkdtempSync(join(tmpdir(),'dbark-test-querypages-'));store=await LocalStore.open(join(directory,'test.sqlite'),require.resolve('sql.js/dist/sql-wasm.wasm'),protector);service=new SavedQueryPages(store,workerPath);workers.clear();onSummary=()=>{};});
afterEach(async()=>{await service?.close();for(const worker of workers)expect(worker.threadId).toBe(-1);store?.close();removeDirectory(directory);});

describe('保存查询概要和协议',()=>{
 it('默认库条件只允许在第一页提交明确的库名或上下文类别', () => {
  for (const database of [{ kind: 'known', database: 'Sales' }, { kind: 'known', database: null }, { kind: 'unknown' }, { kind: 'legacy' }])
   expect(validateCommand('queries.page', { ...request(), database })).toMatchObject({ database });
  for (const database of [{ kind: 'known', database: '' }, { kind: 'known' }, { kind: 'unknown', database: 'Sales' }])
   expect(() => validateCommand('queries.page', { ...request(), database })).toThrow();
  expect(() => validateCommand('queries.pageContinue', { taskId: randomUUID(), cursor: randomUUID(), database: { kind: 'unknown' } })).toThrow();
 });
 it('排序只允许在第一页提交枚举，不能通过续页改变顺序', () => {
  for (const sort of ['recent', 'oldest', 'name-asc', 'name-desc', 'opened'] as const)
   expect(validateCommand('queries.page', request({ sort }))).toMatchObject({ sort });
  expect(() => validateCommand('queries.page', { ...request(), sort: 'name; DROP TABLE queries' })).toThrow();
  expect(() => validateCommand('queries.pageContinue', { taskId: randomUUID(), cursor: randomUUID(), sort: 'name-asc' })).toThrow();
 });
 it('仅第一页允许传入严格的来源范围',()=>{
  const scope={kind:'connection' as const,connectionId:'source'};
  expect(validateCommand('queries.page',request({scope}))).toMatchObject({scope});
  for(const invalid of [{kind:'connection'},{kind:'connection',connectionId:''},{kind:'unbound',connectionId:'source'},{kind:'missing'}]){
   expect(()=>validateCommand('queries.page',{...request(),scope:invalid})).toThrow();
  }
  expect(()=>validateCommand('queries.pageContinue',{taskId:randomUUID(),cursor:randomUUID(),scope})).toThrow();
 });
 it('请求不接受SQL、外部位置或篡改续页范围，编号和摘要严格校验',()=>{expect(validateCommand('queries.page',request())).toMatchObject({search:''});for(const patch of[{search:'x'.repeat(513)},{taskId:'q'},{sql:'SELECT 1'},{after:{id:'q'}},{onError:'skip'}])expect(()=>validateCommand('queries.page',{...request(),...patch})).toThrow();expect(()=>validateCommand('queries.pageContinue',{taskId:randomUUID(),cursor:randomUUID(),search:'新范围'})).toThrow();expect(()=>validateCommand('queries.deleteChecked',{id:'q',digest:'bad'})).toThrow();});
 it('完整SQL尾部文字可筛选，概要保留精确字符串长度但不传全文',()=>{const value=query({sql:'x'.repeat(12000)+'尾部_9007199254740993'}),entry=summarizeSavedQueryRecord(value.id,JSON.stringify(value),'尾部_9007199254740993')!;expect(entry.sqlPreview).toHaveLength(512);expect(entry.sqlUnits).toBe(value.sql.length);expect(entry.previewTruncated).toBe(true);expect('sql'in entry.query).toBe(false);expect(entry.digest).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(entry)).not.toContain('尾部_9007199254740993');});
 it('普通包含不将正则或通配符执行，Unicode代理对预览不被拆分',()=>{const value=query({sql:'x'.repeat(511)+'😀_A.*%尾'}),raw=JSON.stringify(value);expect(summarizeSavedQueryRecord('q',raw,'a.*%')?.sqlPreview).toHaveLength(511);expect(summarizeSavedQueryRecord('q',raw,'^.*$')).toBeUndefined();expect(summarizeSavedQueryRecord('q',raw,'😀')).toBeTruthy();});
});

describe('真实SQLite键分页及工作线程',()=>{
 it('默认库严格区分大小写、明确空库、未知和遗留，跨页保持来源与全文条件', async () => {
  for (let index = 0; index < 25; index++) {
   const id = String(index).padStart(2, '0');
   store.saveQuery(query({ id, connectionId: 'source', sql: 'SELECT 1 -- 尾标', databaseContext: { state: 'known', database: 'sales' } }));
  }
  const candidates = [
   { id: '26', databaseContext: { state: 'known', database: 'Sales' } },
   { id: '27', databaseContext: { state: 'known', database: null } },
   { id: '28', databaseContext: { state: 'unknown' } },
   { id: '29', database: 'Sales' },
   { id: '30', connectionId: 'other', databaseContext: { state: 'known', database: 'Sales' } },
   { id: '31', sql: 'SELECT 2', databaseContext: { state: 'known', database: 'Sales' } },
  ] as const;
  for (const candidate of candidates) store.saveQuery(query({ connectionId: 'source', sql: 'SELECT 1 -- 尾标', ...candidate }));
  const filters = [
   [{ kind: 'known', database: 'Sales' }, '26'], [{ kind: 'known', database: null }, '27'],
   [{ kind: 'unknown' }, '28'], [{ kind: 'legacy' }, '29'],
  ] as const;
  for (const [database, id] of filters) {
   const first = await service.start(request({ database, sort: 'oldest', scope: { kind: 'connection', connectionId: 'source' }, search: '尾标' }));
   expect(first).toMatchObject({ items: [], scanned: 25, failed: 0 });
   const second = await service.next({ taskId: randomUUID(), cursor: first.cursor! });
   expect(second.items.map(entry => entry.query.id)).toEqual([id]);
   expect(second).toMatchObject({ scanned: 31, matched: 1, failed: 0 });
   expect(second.cursor).toBeUndefined();
  }
 });
 it('最近打开最多100条，跨页维持顺序，记录变动只使对应游标失效', async () => {
  const ids = Array.from({ length: 102 }, (_, index) => `opened-${index}`);
  for (const id of ids) store.saveQuery(query({ id, name: id }));
  const original = store.queries(), normal = await service.start(request());
  for (let start = 0; start < 101; start += 20) store.rememberOpenedSavedQueries({ ids: ids.slice(start, Math.min(start + 20, 101)) });
  expect(store.queries()).toEqual(original);
  await expect(service.next({ taskId: randomUUID(), cursor: normal.cursor! })).resolves.toMatchObject({ scanned: 50 });
  const input = request({ sort: 'opened' }), first = await service.start(input);
  expect(first.items.map(item => item.query.id)).toEqual([ids[100], ...ids.slice(80, 100), ...ids.slice(60, 64)]);
  const pending = first.cursor!, before = store.queryPageRevision(input), path = join(directory, 'test.sqlite');
  const bytes = readFileSync(path);
  mkdirSync(path + '.tmp');
  try { expect(() => store.rememberOpenedSavedQueries({ ids: [ids[0]] })).toThrow('修改未保存'); }
  finally { rmdirSync(path + '.tmp'); }
  expect(readFileSync(path)).toEqual(bytes);
  expect(store.queryPageRevision(input)).toBe(before);
  store.rememberOpenedSavedQueries({ ids: [ids[0], '已删除'] });
  await expect(service.next({ taskId: randomUUID(), cursor: pending })).rejects.toThrow('已变化');
  await service.close(); store.close();
  store = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
  service = new SavedQueryPages(store, workerPath);
  let page = await service.start(request({ sort: 'opened' }));
  const opened = page.items.map(item => item.query.id);
  while (page.cursor) {
   page = await service.next({ taskId: randomUUID(), cursor: page.cursor });
   opened.push(...page.items.map(item => item.query.id));
  }
  expect(opened).toHaveLength(100);
  expect(new Set(opened).size).toBe(100);
  expect(opened[0]).toBe(ids[0]);
  expect(opened).not.toContain(ids[101]);
  expect(opened).not.toContain('已删除');
  store.deleteQuery(ids[0]); store.saveQuery(query({ id: ids[0] }));
  expect((await service.start(request({ sort: 'opened', search: ids[0] }))).items).toEqual([]);
 });
 it('收藏跨页先筛选再读取正文，重开保留且删除同编号后不复活', async () => {
  const values = Array.from({ length: 29 }, (_, index) => query({
   id: `fav-${String(index).padStart(2, '0')}`, name: `查询 ${String(index).padStart(2, '0')}`,
   sql: index === 28 ? 'SELECT 2' : 'SELECT 1 /* 收藏正文 */',
  }));
  const path = join(directory, 'test.sqlite'), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  const reference = (id: string) => ({ id, digest: createHash('sha256').update(store.querySearchRaw(id)!).digest('hex'), expectedRevision: store.queryOrganization().revision });
  for (const value of values) store.saveQuery(value);
  for (const value of values.slice(1)) store.setSavedQueryFavorite({ ...reference(value.id), favorite: true });
  await service.close(); store.close();
  store = await LocalStore.open(path, wasm, protector);
  service = new SavedQueryPages(store, workerPath);
  const options = { favoritesOnly: true, search: '收藏正文', sort: 'name-asc' } as const;
  const first = await service.start(request(options));
  expect(first.items.map(entry => entry.query.id)).toEqual(values.slice(1, 26).map(value => value.id));
  expect(first.items.every(entry => entry.favorite && entry.digest === reference(entry.query.id).digest)).toBe(true);
  const second = await service.next({ taskId: randomUUID(), cursor: first.cursor! });
  expect(second.items.map(entry => entry.query.id)).toEqual(values.slice(26, 28).map(value => value.id));
  expect(second).toMatchObject({ scanned: 28, matched: 27, failed: 0 });
  expect(second.cursor).toBeUndefined();

  const current = await service.start(request(options)), id = values[1].id, before = readFileSync(path), beforeRevision = store.querySearchRevision();
  const change = { ...reference(id), favorite: false };
  expect(() => store.setSavedQueryFavorite({ ...change, digest: '0'.repeat(64) })).toThrow('原保存查询已变化');
  mkdirSync(path + '.tmp');
  try { expect(() => store.setSavedQueryFavorite(change)).toThrow('修改未保存'); }
  finally { rmdirSync(path + '.tmp'); }
  expect(readFileSync(path)).toEqual(before);
  expect(store.querySearchRevision()).toBe(beforeRevision);
  store.setSavedQueryFavorite(change);
  expect(() => store.setSavedQueryFavorite({ ...change, favorite: true })).toThrow('保存查询库已变化');
  await expect(service.next({ taskId: randomUUID(), cursor: current.cursor! })).rejects.toThrow('已变化');
  expect(store.querySearchRaw(id)).toBe(JSON.stringify(values[1]));
  expect((await service.start(request(options))).items[0].query.id).toBe(values[2].id);

  const renamed = reference(values[2].id);
  store.renameQueryChecked({ id: renamed.id, digest: renamed.digest, name: '改名后仍收藏' });
  expect((await service.start(request({ favoritesOnly: true, search: '改名后仍收藏' }))).items[0]).toMatchObject({ query: { id: values[2].id }, favorite: true });
  store.deleteQuery(values[2].id);
  store.saveQuery(values[2]);
  expect((await service.start(request(options))).items[0].query.id).toBe(values[3].id);
 });
 it('名称和更新时间双向跨页，旧库重开建立索引且坏记录仍可单独报告', async () => {
  const database = () => (store as unknown as { db: Database }).db;
  database().run('DROP INDEX queries_name_id');
  database().run('INSERT INTO queries VALUES (?,?,?)', ['broken', '{坏原文', '2026']);
  const values = Array.from({ length: 58 }, (_, index) => query({
   id: `sort-${String(index).padStart(2, '0')}`, name: index < 49 ? 'A\0保留' : ['a', 'A', '中文', '😀'][index % 4],
   updatedAt: index % 2 ? '2026-10-15T01:00:00.000Z' : '2026-10-15T00:00:00.000Z',
  }));
  for (const value of values) store.saveQuery(value);
  await service.close(); store.close();
  store = await LocalStore.open(join(directory, 'test.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
  service = new SavedQueryPages(store, workerPath);
  expect(database().exec('PRAGMA user_version')[0].values[0][0]).toBe(9);
  const indexSql = String(database().exec("SELECT sql FROM sqlite_master WHERE name='queries_name_id'")[0].values[0][0]);
  const nameKey = indexSql.slice(indexSql.indexOf('((CASE') + 1, indexSql.lastIndexOf(',id COLLATE BINARY'));
  const plan = JSON.stringify(database().exec(`EXPLAIN QUERY PLAN SELECT id FROM queries WHERE ${nameKey} >= X'41' AND (${nameKey},id COLLATE BINARY) > (X'41','sort-24') ORDER BY ${nameKey},id COLLATE BINARY LIMIT 2`));
  expect(plan).toMatch(/SEARCH queries USING (?:COVERING )?INDEX queries_name_id/);
  expect(plan).not.toContain('TEMP B-TREE');
  const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  for (const sort of ['name-asc', 'name-desc', 'oldest', 'recent'] as const) {
   const key = sort.startsWith('name-') ? 'name' : 'updatedAt';
   const direction = sort === 'recent' || sort === 'name-desc' ? -1 : 1;
   const expected = [...values].sort((a, b) => direction * (compare(a[key], b[key]) || compare(a.id, b.id))).map(value => value.id);
   let page = await service.start(request({ sort }));
   const ids = page.items.map(item => item.query.id);
   while (page.cursor) {
    page = await service.next({ taskId: randomUUID(), cursor: page.cursor });
    ids.push(...page.items.map(item => item.query.id));
   }
   expect(ids).toEqual(expected);
   expect(page).toMatchObject({ scanned: 59, matched: 58, failed: 1 });
  }
  expect(store.querySearchRaw('broken')).toBe('{坏原文');
  for (const value of values) expect(store.querySearchRaw(value.id)).toBe(JSON.stringify(value));
 });
 it('续页沿用来源、分组和全文条件，未绑定与已删除来源分别处理',async()=>{
  const search='正文尾部', group={kind:'unfiled' as const};
  for(let index=0;index<25;index++)store.saveQuery(query({id:'z-'+index,connectionId:'other',sql:search}));
  store.saveQuery(query({id:'a',connectionId:'source',sql:'x'.repeat(12000)+search}));
  store.saveQuery(query({id:'b',connectionId:'source'}));
  store.saveQuery(query({id:'c',connectionId:'deleted',sql:search}));
  store.saveQuery(query({id:'d',sql:search}));
  const first=await service.start(request({scope:{kind:'connection',connectionId:'source'},group,search}));
  expect(first.items).toEqual([]);
  expect(first.scanned).toBe(25);
  expect(first.cursor).toBeTruthy();
  const last=await service.next({taskId:randomUUID(),cursor:first.cursor!});
  expect(last.items.map(item=>item.query.id)).toEqual(['a']);
  expect(last.matched).toBe(1);
  expect(last.cursor).toBeUndefined();
  for(const [scope,id] of [[{kind:'unbound'},'d'],[{kind:'connection',connectionId:'deleted'},'c']] as const){
   const page=await service.start(request({scope,group,search}));
   const continued=await service.next({taskId:randomUUID(),cursor:page.cursor!});
   expect(continued.items.map(item=>item.query.id)).toEqual([id]);
  }
 });
 it('真实分组SQL位置过滤与线程全文匹配共同分页，原摘要保持且组织变化撤销续页',async()=>{
  for(let index=0;index<58;index++)store.saveQuery(query({id:'group-'+String(index).padStart(2,'0'),sql:index===0?'SELECT 0;\r\n/*'+'x'.repeat(12000)+'组织全文尾部😀*/':'SELECT '+index}));
  const originals=new Map(Array.from({length:58},(_,index)=>{const id='group-'+String(index).padStart(2,'0');return[id,store.querySearchRaw(id)];}));
  let organization=store.applyQueryOrganization({expectedRevision:store.queryOrganization().revision,operation:{kind:'create',name:'父组',parentId:null}}),parent=organization.groups[0].id;
  organization=store.applyQueryOrganization({expectedRevision:organization.revision,operation:{kind:'create',name:'子组',parentId:parent}});const child=organization.groups.find(item=>item.name==='子组')!.id;
  let page=await service.start(request());const entries=[...page.items];while(page.cursor){page=await service.next({taskId:randomUUID(),cursor:page.cursor});entries.push(...page.items);}expect(entries).toHaveLength(58);
  organization=store.applyQueryOrganization({expectedRevision:organization.revision,operation:{kind:'moveQueries',queries:entries.map(item=>({id:item.query.id,digest:item.digest})),groupId:child}});
  const scope={kind:'group' as const,id:parent,includeDescendants:true};page=await service.start(request({group:scope}));const sizes=[page.items.length],grouped=[...page.items];while(page.cursor){page=await service.next({taskId:randomUUID(),cursor:page.cursor});sizes.push(page.items.length);grouped.push(...page.items);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128*1024);}
  expect(sizes).toEqual([25,25,8]);expect(grouped.map(item=>[item.query.id,item.digest])).toEqual(entries.map(item=>[item.query.id,item.digest]));expect(grouped.every(item=>item.groupId===child)).toBe(true);
  expect((await service.start(request({group:{...scope,includeDescendants:false}}))).items).toEqual([]);expect((await service.start(request({group:{kind:'unfiled'}}))).items).toEqual([]);
  page=await service.start(request({group:scope,search:'组织全文尾部😀'}));expect(page.items).toEqual([]);while(page.cursor)page=await service.next({taskId:randomUUID(),cursor:page.cursor});expect(page.scanned).toBe(58);expect(page.matched).toBe(1);expect(page.items[0].query.id).toBe('group-00');expect(page.items[0].groupId).toBe(child);expect(page.items[0].previewTruncated).toBe(true);expect(page.items[0].sqlPreview).not.toContain('组织全文尾部');
  const old=await service.start(request({group:scope}));expect(old.cursor).toBeTruthy();organization=store.applyQueryOrganization({expectedRevision:organization.revision,operation:{kind:'rename',id:child,name:'改名保身份'}});await expect(service.next({taskId:randomUUID(),cursor:old.cursor!})).rejects.toThrow('已变化');
  organization=store.applyQueryOrganization({expectedRevision:organization.revision,operation:{kind:'dissolve',id:child}});expect(organization.unfiledCount).toBe(58);expect(organization.groups[0].totalCount).toBe(0);
  for(const[id,raw]of originals)expect(store.querySearchRaw(id)).toBe(raw);for(const worker of workers)expect(worker.threadId).toBe(-1);expect(store.history()).toEqual([]);expect(store.tasks()).toEqual([]);
 });
 it('58条跨相同更新时间稳定分三页，下一页由复合键定位且从不调用全量列表',async()=>{const values=Array.from({length:58},(_,i)=>query({id:'q'+String(i).padStart(3,'0'),updatedAt:i<30?'2026-10-15T01:00:00.000Z':'2026-10-15T00:00:00.000Z'}));for(const value of values)store.saveQuery(value);const legacy=vi.spyOn(store,'queries').mockImplementation(()=>{throw Error('禁止全量读取');});try{let page=await service.start(request());expect(page.items).toHaveLength(25);expect(page.scanned).toBe(25);for(const worker of workers)expect(worker.threadId).toBe(-1);const entries=[...page.items];while(page.cursor){page=await service.next({taskId:randomUUID(),cursor:page.cursor});expect(page.items.length).toBeLessThanOrEqual(25);entries.push(...page.items);}const expected=values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||Buffer.compare(Buffer.from(b.id),Buffer.from(a.id)));expect(entries.map(item=>item.query.id)).toEqual(expected.map(item=>item.id));expect(page.scanned).toBe(58);expect(page.matched).toBe(58);expect(page.failed).toBe(0);expect(legacy).not.toHaveBeenCalled();const database=(store as unknown as{db:Database}).db,plan=JSON.stringify(database.exec("EXPLAIN QUERY PLAN SELECT id FROM queries WHERE (updated_at COLLATE BINARY,id COLLATE BINARY)<('2026','q') ORDER BY updated_at COLLATE BINARY DESC,id COLLATE BINARY DESC LIMIT 2"));expect(plan).toContain('queries_updated_id');expect(plan).not.toContain('TEMP B-TREE');}finally{legacy.mockRestore();}});
 it('没有命中的页仍保留下一批，筛选在完整正文中执行',async()=>{for(let i=0;i<26;i++)store.saveQuery(query({id:'q'+String(i).padStart(3,'0'),sql:i===0?'x'.repeat(10000)+'全文尾部':'SELECT 1'}));const first=await service.start(request({search:'全文尾部'}));expect(first.items).toEqual([]);expect(first.scanned).toBe(25);expect(first.cursor).toBeTruthy();const last=await service.next({taskId:randomUUID(),cursor:first.cursor});expect(last.items.map(item=>item.query.id)).toEqual(['q000']);expect(last.scanned).toBe(26);expect(last.matched).toBe(1);expect(last.cursor).toBeUndefined();});
 it('最长Unicode概要遇字节预算先续页，含句柄不超过128KiB且不丢行',async()=>{for(let i=0;i<40;i++)store.saveQuery(query({id:String(i).padStart(4,'0')+'文'.repeat(196),name:'文'.repeat(256),connectionId:'文'.repeat(200),database:'文'.repeat(256),databaseContext:{state:'known',database:'文'.repeat(256)},updatedAt:'文'.repeat(256),sql:'文'.repeat(3000)}));let page=await service.start(request());expect(page.items.length).toBeLessThan(25);const entries:SavedQueryPageEntry[]=[];for(;;){expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128*1024);entries.push(...page.items);if(!page.cursor)break;page=await service.next({taskId:randomUUID(),cursor:page.cursor});}expect(entries).toHaveLength(40);expect(new Set(entries.map(item=>item.query.id)).size).toBe(40);expect(page.scanned).toBe(40);});
 it('接近128KiB的概要后再遇三条真实损坏记录，错误明细也分批且累计不丢失',async()=>{
  const base={name:'文'.repeat(256),connectionId:'文'.repeat(200),database:'文'.repeat(256),databaseContext:{state:'known' as const,database:'文'.repeat(256)},updatedAt:'文'.repeat(256)};
  const values=Array.from({length:22},(_,i)=>query({...base,id:'q'+String(24-i).padStart(3,'0')+'文'.repeat(196),sql:'文'.repeat(512)}));
  const size=()=>Buffer.byteLength(JSON.stringify({items:values.map(value=>summarizeSavedQueryRecord(value.id,JSON.stringify(value),'')),failures:[],scanned:0,matched:0,failed:0,stoppedOnError:false}));
  const target=128*1024-2100;expect(size()).toBeGreaterThan(target);let index=0;while(size()>target){const value=values[index++%values.length];value.sql=value.sql.slice(0,-1);}
  expect(size()).toBeGreaterThan(target-4);for(const value of values)store.saveQuery(value);
  for(let i=0;i<3;i++)store.saveQuery(query({...base,id:'q'+String(i).padStart(3,'0')+'文'.repeat(196),name:'',connectionId:'x'.repeat(201),databaseContext:{state:'known',database:'\0'},sql:42 as never}));
  let page=await service.start(request());const entries:SavedQueryPageEntry[]=[];let failures=0;
  for(;;){expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128*1024);entries.push(...page.items);failures+=page.failures.length;if(!page.cursor)break;page=await service.next({taskId:randomUUID(),cursor:page.cursor});}
  expect(entries).toHaveLength(22);expect(new Set(entries.map(item=>item.query.id)).size).toBe(22);expect(failures).toBe(3);expect(page.failed).toBe(3);expect(page.scanned).toBe(25);
 });
 it('成功保存重排使原续页失效，单次句柄不能重用或篡改筛选',async()=>{for(let i=0;i<26;i++)store.saveQuery(query({id:'q'+i}));const page=await service.start(request());store.saveQuery(query({id:'q0',updatedAt:'2026-10-15T02:00:00.000Z'}));await expect(service.next({taskId:randomUUID(),cursor:page.cursor})).rejects.toThrow('已变化');expect(()=>service.next({taskId:randomUUID(),cursor:page.cursor})).toThrow('过期');expect((await service.start(request())).items[0].query.id).toBe('q0');});
 it('明确释放、五分钟到期及重复编号分别拒绝，最近取消不进入数据库通道',async()=>{for(let i=0;i<26;i++)store.saveQuery(query({id:'q'+i}));const input=request(),first=await service.start(input);expect(service.owns(input.taskId)).toBe(true);await service.cancel(input.taskId);await expect(service.start(input)).rejects.toThrow('编号已使用');service.release({cursor:first.cursor});expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor})).toThrow('过期');const again=await service.start(request()),clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+5*60000+1);try{expect(()=>service.next({taskId:randomUUID(),cursor:again.cursor})).toThrow('过期');expect(service.owns(input.taskId)).toBe(false);}finally{clock.mockRestore();}});
 it('损坏记录停止或继续均明确失败，下一批仍报告累计失败数',async()=>{for(let i=0;i<27;i++)store.saveQuery(query({id:'q'+String(i).padStart(3,'0'),...(i===26?{sql:42 as never}:{})}));const stopped=await service.start(request({onError:'stop'}));expect(stopped.stoppedOnError).toBe(true);expect(stopped.failed).toBe(1);expect(stopped.items).toEqual([]);expect(stopped.cursor).toBeUndefined();const first=await service.start(request());expect(first.failures).toHaveLength(1);expect(first.failed).toBe(1);const last=await service.next({taskId:randomUUID(),cursor:first.cursor});expect(last.failed).toBe(1);expect(last.scanned).toBe(27);expect(last.matched).toBe(26);expect(last.failures).toEqual([]);});
 it('活动真实线程取消完成后编号仍归本地，关闭后拒绝新页',async()=>{store.saveQuery(query({sql:'x'.repeat(50000)}));const input=request();let cancellation:Promise<void>|undefined;onSummary=worker=>{expect(worker.threadId).toBeGreaterThan(0);cancellation=service.cancel(input.taskId);};await expect(service.start(input)).rejects.toBeInstanceOf(SavedQuerySearchCancelled);await cancellation;expect(service.owns(input.taskId)).toBe(true);for(const worker of workers)expect(worker.threadId).toBe(-1);await service.close();await expect(service.start(request())).rejects.toThrow('正在退出');});
 it('页内连接库变化拒绝旧结果，真实线程结束且原查询未被修改',async()=>{store.saveQuery(query());let changed=false;onSummary=()=>{if(!changed){changed=true;store.saveConnection({id:'a',name:'来源',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'});}};await expect(service.start(request())).rejects.toThrow('已变化');expect(store.querySearchRaw('q')).toContain('9007199254740993');});
 it('陈旧摘要删除拒绝新内容，有效删除只影响该本地查询并使续页失效',async()=>{for(let i=0;i<26;i++)store.saveQuery(query({id:'q'+i}));const first=await service.start(request()),entry=first.items[0];store.saveQuery(query({id:entry.query.id,sql:'SELECT 新保存内容'}));expect(()=>service.deleteChecked({id:entry.query.id,digest:entry.digest})).toThrow('未删除新内容');expect(store.querySearchRaw(entry.query.id)).toContain('新保存内容');const fresh=(await service.start(request())).items.find(item=>item.query.id===entry.query.id)!;service.deleteChecked({id:fresh.query.id,digest:fresh.digest});expect(store.querySearchRaw(entry.query.id)).toBeUndefined();expect(()=>service.deleteChecked({id:fresh.query.id,digest:fresh.digest})).toThrow('已删除');expect(store.queries()).toHaveLength(25);});
 it('删除实际写盘失败恢复原文与修订，读取搜索本身不改变磁盘字节',async()=>{store.saveQuery(query());const before=readFileSync(join(directory,'test.sqlite')),revision=store.querySearchRevision(),entry=(await service.start(request({search:'SELECT'}))).items[0];expect(readFileSync(join(directory,'test.sqlite'))).toEqual(before);const blocker=join(directory,'test.sqlite.tmp');mkdirSync(blocker);try{expect(()=>service.deleteChecked({id:'q',digest:entry.digest})).toThrow('修改未保存');expect(store.querySearchRevision()).toBe(revision);expect(store.querySearchRaw('q')).toContain('9007199254740993');}finally{rmdirSync(blocker);}expect(readFileSync(join(directory,'test.sqlite'))).toEqual(before);});
 it('概要摘要可直接安全打开，四上下文和原始SQL跨重开不变',async()=>{const profile:ConnectionProfile={id:'a',name:'来源',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'};store.saveConnection(profile);const contexts:Partial<SavedQuery>[]=[{database:'旧库',databaseContext:{state:'known',database:'实际库'}},{database:'旧库',databaseContext:{state:'known',database:null}},{database:'旧库',databaseContext:{state:'unknown'}},{database:'遗留库'}];for(const[index,context]of contexts.entries())store.saveQuery(query({id:String(index),connectionId:'a',...context}));await service.close();store.close();store=await LocalStore.open(join(directory,'test.sqlite'),require.resolve('sql.js/dist/sql-wasm.wasm'),protector);service=new SavedQueryPages(store,workerPath);const entries=(await service.start(request())).items,searches=new SavedQuerySearches(store,workerPath);try{for(const entry of entries){const opened=searches.read({id:entry.query.id,digest:entry.digest,connectionId:'a'});expect(opened.query.sql).toBe('SELECT 9007199254740993');expect(opened.databaseContext).toEqual(contexts[Number(entry.query.id)].databaseContext);}expect(store.history()).toEqual([]);expect(store.tasks()).toEqual([]);}finally{await searches.close();}});
});
