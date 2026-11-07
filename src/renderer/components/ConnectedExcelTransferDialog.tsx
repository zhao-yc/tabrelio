import { useState } from 'react';
import type { ExcelImportOptions, ExcelTransferTarget } from '../../shared/excelTransfer';
import { excelTransferServices } from '../excelTransferServices';
import { useWorkspace } from '../store';
import { ImportBatchDialog } from './ImportBatchDialog';
import { ExcelTransferDialog } from './ExcelTransferDialog';

/** 复用工作台任务事件与现有导入导出入口，不创建旁路文件或数据库权限。 */
export function ConnectedExcelTransferDialog(props: ExcelTransferTarget & { mode: 'import' | 'export'; onClose(): void; onBack(): void; batchCurrent?(): boolean }) {
  const [taskId, setTaskId] = useState('');
  const [batch, setBatch] = useState<Omit<ExcelImportOptions, 'sheetId'>>();
  const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  if (batch && props.batchCurrent) return <ImportBatchDialog
    target={{ connectionId: props.connectionId, database: props.database, table: props.table }}
    options={{ format: 'xlsx', encoding: 'utf8' }} initialExcelSettings={batch} current={props.batchCurrent}
    onBack={() => setBatch(undefined)} onDone={props.onClose}/>;
  return <ExcelTransferDialog {...props} onBatch={props.mode === 'import' && props.batchCurrent ? settings => {
    if (props.batchCurrent?.()) setBatch(settings);
  } : undefined} services={excelTransferServices} onTaskStart={setTaskId} progress={task}/>;
}
