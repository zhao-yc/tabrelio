import{createHash}from'node:crypto';
import{savedQueryPageInputSchema,savedQueryDeleteCheckedSchema,savedQueryFilteredArchiveLimits,type SavedQueryArchiveFilters,type SavedQueryPageInput,type SavedQueryPageEntry,type SavedQueryPagePosition}from'../shared/savedQueryPages';
import{LocalSqlPages}from'./localSqlPages';

interface PageStore{queryPageRevision(input:SavedQueryPageInput):string;queryPageNext(after?:SavedQueryPagePosition,input?:SavedQueryPageInput):(SavedQueryPagePosition & {raw:string|null;hasMore:boolean;groupId?:string;favorite?:true})|null;querySearchRaw(id:string):string|undefined;deleteQuery(id:string):void}

/** 保存查询与执行历史共用有界分页生命周期，资料源和句柄保持独立。 */
export class SavedQueryPages extends LocalSqlPages<SavedQueryPageInput,SavedQueryPageEntry,SavedQueryPagePosition>{
 constructor(private readonly store:PageStore,workerPath:string){super({
  label:'保存查询',parse:raw=>savedQueryPageInputSchema.parse(raw),revision:input=>store.queryPageRevision(input),
  next:(after,input)=>{const record=store.queryPageNext(after,input);return record?{...record,orderValue:record.updatedAt,position:{id:record.id,updatedAt:record.updatedAt,nameKey:record.nameKey,openOrder:record.openOrder}}:null;},
  match:(matcher,record,input)=>matcher.summarize(record.id,record.raw!,input.search,input.scope,input.database),
  // 原SQLite成员关系在字节预算之前加入概要，不能通过额外字段绕过128KiB门槛。
  verify:(entry,record)=>{
   if(entry.query.updatedAt!==record.orderValue)throw Error('保存查询更新时间与索引不一致');
   const {groupId,favorite}=record as typeof record&Pick<SavedQueryPageEntry,'groupId'|'favorite'>;
   if(groupId!==undefined)entry.groupId=groupId;
   if(favorite)entry.favorite=favorite;
  }
 },workerPath);}
 /** 归档沿用浏览条件，读取主进程内的摘要引用，不向渲染进程传全文。 */
 collectArchiveReferences(filters: SavedQueryArchiveFilters, assertCurrent: () => void) {
  return this.collectReferences(filters, savedQueryFilteredArchiveLimits, item => ({ id: item.query.id, digest: item.digest }), assertCurrent);
 }
 /** 删除针对所见原文；陈旧预览不能删除后来覆盖保存的新查询。 */
 deleteChecked(raw:unknown){const input=savedQueryDeleteCheckedSchema.parse(raw),source=this.store.querySearchRaw(input.id);if(source===undefined)throw Error('保存查询已删除，请刷新列表');if(createHash('sha256').update(source).digest('hex')!==input.digest)throw Error('保存查询已修改，未删除新内容，请刷新列表');this.store.deleteQuery(input.id);}
}
