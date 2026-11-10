import { invoke, uid } from './lib';
import { QueryFileTaskOperation, type QueryFileTaskState } from './queryFileTasks';
import { useWorkspace, type WorkspaceTab } from './store';

/** 将纯任务状态接到工作区，文件入口共用文档复核、进度和准确的取消命令。 */
export function beginWorkspaceQueryFileTask(snapshot: Readonly<WorkspaceTab>, operation: QueryFileTaskState['operation'], ownsView: () => boolean, publish: (state: QueryFileTaskState) => void) {
  const taskId = uid();
  const owner = new QueryFileTaskOperation(snapshot, taskId, operation, {
    read: () => useWorkspace.getState().settings.tabs.find(item => item.id === snapshot.id), ownsView,
    subscribeDocument: changed => useWorkspace.subscribe(changed), subscribeTask: changed => window.dbark?.onTask(changed) ?? (() => {}),
    cancel: input => invoke('queryFileSources.cancel', input),
    publish: value => { useWorkspace.getState().setQueryFileTask(value); publish(value); },
  });
  return { taskId, owner };
}
