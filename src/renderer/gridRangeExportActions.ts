import { txtExportDefaults } from '../shared/txtExport';
import type { GridRangeExportData } from './gridRangeExport';
import { errorMessage, invoke, uid } from './lib';
import { gridRangeExportZh as text } from './locales/gridRangeExport.zh-CN';
import { useWorkspace } from './store';

let savingText = false;

/** 选择目标后再次核对原网格。确认后沿文件任务写入冻结数据，不重新执行查询。 */
async function saveRangeText(capture: () => GridRangeExportData, current: () => boolean): Promise<void> {
  if (savingText || !current()) return;
  savingText = true;
  let valid = true;
  const stillCurrent = () => {
    if (valid) valid = current();
    return valid;
  };
  const release = useWorkspace.subscribe(stillCurrent);
  try {
    const { columns, rows, truncated } = capture();
    const file = await invoke('files.choose', { purpose: 'export', format: 'txt', suggestedName: text.txtFilename });
    if (!file) return;
    if (!stillCurrent()) throw Error(text.stale);
    const saved = await invoke('files.exportResult', { fileToken: file.token, format: 'txt', encoding: 'utf8',
      txtOptions: txtExportDefaults, taskId: uid(), result: { columns, rows, truncated } });
    useWorkspace.getState().notify(text.txtSaved(file.name, saved.rows));
  } catch (reason) {
    useWorkspace.getState().notify(errorMessage(reason), true);
  } finally {
    release();
    savingText = false;
  }
}

/** 两个文件入口绑定同一矩形。只有导出窗口需要携带 SQLite 类型元数据。 */
export function gridRangeExportActions(capture: (withStorage: boolean) => GridRangeExportData, current: () => boolean,
  open: (data: GridRangeExportData) => void, report: (reason: unknown) => void) {
  return [
    { label: text.action, run: () => {
      if (!current()) return;
      try {
        const data = capture(true);
        if (current()) open(data);
      } catch (reason) { if (current()) report(reason); }
    } },
    { label: text.txt, run: () => { void saveRangeText(() => capture(false), current); } },
  ];
}
