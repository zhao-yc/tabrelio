import{createHash}from'node:crypto';
import{historyPageInputSchema,historyReadSchema,historyRecordReferenceSchema,historySaveBatchLimits,historySaveQueryBatchSchema,historySaveQuerySchema,type HistoryPageInput,type HistoryPageEntry,type HistoryPagePosition,type HistoryOpenResult,type HistoryRecord}from'../shared/historyPages';
import { savedQueryOriginContext, type QueryCreate } from '../shared/queryBinding';
import{LocalSqlPages}from'./localSqlPages';
import{parseHistoryRecord}from'./historyPageMatch';

interface HistoryStore{historyPageRevision():string;historyPageNext(after:HistoryPagePosition|undefined,input:HistoryPageInput):(HistoryPagePosition & {raw:string|null;hasMore:boolean})|null;historyRaw(id:string):string|undefined;queryConnectionExists(id:string):boolean}

/** 执行历史与查询列表拥有独立页句柄；只读操作不写任务/历史或建立数据库连接。 */
export class HistoryPages extends LocalSqlPages<HistoryPageInput,HistoryPageEntry,HistoryPagePosition>{
 constructor(private readonly store:HistoryStore,workerPath:string){super({
  label:'执行历史',parse:raw=>historyPageInputSchema.parse(raw),revision:()=>store.historyPageRevision(),
  next:(after,input)=>{const record=store.historyPageNext(after,input);return record?{...record,orderValue:record.startedAt,position:{id:record.id,startedAt:record.startedAt,connectionId:record.connectionId,durationKey:record.durationKey}}:null;},
  match:(matcher,record,input)=>matcher.summarizeHistory(record.id,record.raw!,input,record.position)
 },workerPath);}
 /** 完整内容仅在明确打开时读取，并对所见摘要重核，不能替换成后来的历史。 */
 private current(id:string,digest:string){const raw=this.store.historyRaw(id);if(raw===undefined)throw Error('执行历史已移除，请刷新列表');if(createHash('sha256').update(raw).digest('hex')!==digest)throw Error('执行历史已变化，请刷新列表后打开');return parseHistoryRecord(id,raw);}
 /** 原连接缺失需显式选替代连接；替代后默认库变为未知，且只创建新草稿。 */
 read(raw:unknown):HistoryOpenResult{const input=historyReadSchema.parse(raw),record=this.current(input.id,input.digest);if(!this.store.queryConnectionExists(input.connectionId))throw Error('所选连接不存在，请明确选择有效连接');const{error,...entry}=record,contextChanged=entry.connectionId!==input.connectionId;return{entry,connectionId:input.connectionId,...(contextChanged?{databaseContext:{state:'unknown' as const}}:{database:entry.databaseContext?entry.databaseContext.state==='known'?entry.databaseContext.database??undefined:undefined:entry.database,databaseContext:entry.databaseContext}),contextChanged};}
 /** 错误全文按单条显式读取，概要列表不传完整错误或SQL。 */
 readError(raw:unknown):{error:string}{const input=historyRecordReferenceSchema.parse(raw),record=this.current(input.id,input.digest);return{error:record.error??''};}
 /** 只返回摘要对应的本地 SQL，不要求来源连接仍存在，也不建立会话。 */
 readSql(raw: unknown): { sql: string } {
  const { id, digest } = historyRecordReferenceSchema.parse(raw);
  return { sql: this.current(id, digest).sql };
 }
 /** 文件名只使用记录中的标准 UTC 时间。旧格式使用通用名称，由归档序号区分。 */
 readArchiveItem(raw: unknown): { name: string; sql: string } {
  const { id, digest } = historyRecordReferenceSchema.parse(raw);
  const { startedAt, sql } = this.current(id, digest);
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(startedAt);
  return { name: utc ? startedAt.replace(/:/g, '-') : '执行历史', sql };
 }
 /** 保存来源只能取自原历史。未绑定时清除库上下文，随后打开须明确选库。 */
 querySaveContent(raw: unknown): QueryCreate {
  const { id, digest, name, keepSource, group } = historySaveQuerySchema.parse(raw);
  const record = this.current(id, digest);
  return { ...this.saveContent(record, name, keepSource), ...(group ? { group } : {}) };
 }
 /** 仅按原勾选顺序和摘要读取，先检查整批正文预算，再交给存储一次性提交。 */
 querySaveBatchContents(raw: unknown) {
  const { items, prefix, keepSource, group } = historySaveQueryBatchSchema.parse(raw);
  let bytes = 0;
  const contents = items.map(({ id, digest }, index) => {
   const record = this.current(id, digest);
   bytes += Buffer.byteLength(record.sql, 'utf8');
   if (bytes > historySaveBatchLimits.bytes) throw Error('所选历史 SQL 合计超过 32 MiB，请缩小保存范围');
   const bound = keepSource && !!record.connectionId && this.store.queryConnectionExists(record.connectionId);
   return this.saveContent(record, `${prefix} ${index + 1}`, bound);
  });
  return { contents, group };
 }
 private saveContent(record: HistoryRecord, name: string, keepSource: boolean): QueryCreate {
  const content = { name, sql: record.sql };
  if (!keepSource) return { ...content, context: { state: 'unknown' } };
  if (!record.connectionId || !this.store.queryConnectionExists(record.connectionId)) throw Error('历史来源连接已失效，请选择不绑定连接后保存');
  return { ...content, connectionId: record.connectionId, context: savedQueryOriginContext(record.database, record.databaseContext) };
 }
}
