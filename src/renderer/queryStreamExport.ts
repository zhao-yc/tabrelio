import { queryExportSelectsRowResult, queryStreamExportLimits, type QueryExportSelection, type QueryExportFormat } from '../shared/queryStreamExport';
import { queryStreamZh } from './locales/queryStreamExport.zh-CN';

export function streamResultOrdinal(value: string): number | undefined {
  return /^[1-9]\d*$/.test(value) && Number(value) <= queryStreamExportLimits.results ? Number(value) : undefined;
}

/** 单结果布局的行结果序号独立于包含写入状态的协议结果序号。 */
export function streamResultSelection(format: QueryExportFormat, value: string): QueryExportSelection {
  if (!queryExportSelectsRowResult(format)) return { kind: 'all' };
  const ordinal = streamResultOrdinal(value);
  if (ordinal === undefined) throw new Error(queryStreamZh.ordinalInvalid);
  return { kind: 'row-result', ordinal };
}

/** 设置变化使确认失效；每次失败后的执行必须重新取得明确确认。 */
export function streamExecutionAllowed(fileToken: string | undefined, acknowledged: boolean, protocol: 'text-strict' | 'binary-explicit', binaryAcknowledged: boolean, busy: boolean, completed: boolean) {
  return !!fileToken && acknowledged && (protocol !== 'binary-explicit' || binaryAcknowledged) && !busy && !completed;
}
