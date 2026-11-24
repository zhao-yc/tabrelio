import type { HistoryInsertionTarget } from './historyInsertion';
import { historyInsertionZh as text } from './locales/historyInsertion.zh-CN';

/** 子面板只借用同一个原编辑器；切换资料页撤销子租约，不重新捕获选区或释放父权限。 */
export function borrowInsertion(source: HistoryInsertionTarget | null | undefined): HistoryInsertionTarget | null {
  if (!source) return null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const releases = new Map<() => void, () => void>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const release of releases.values()) release();
    releases.clear();
    for (const listener of [...listeners]) listener();
    listeners.clear();
  };
  const current = () => !disposed && source.current();
  const lease: HistoryInsertionTarget = {
    title: source.title,
    connectionId: source.connectionId,
    current,
    dispose,
    subscribe(listener) {
      if (disposed) return () => {};
      // 每个借用者仅清理自己的订阅；旧页面的迟到清理不能撤销下一页。
      const forward = () => listener();
      const release = source.subscribe(forward);
      listeners.add(forward); releases.set(forward, release);
      return () => { releases.get(forward)?.(); releases.delete(forward); listeners.delete(forward); };
    },
    insert(sql) {
      if (!current()) throw Error(text.changed);
      source.insert(sql);
      dispose();
    },
  };
  // 读取不消费借用权限。整份替换与插入一样，只能由当前资料页消费一次。
  if (source.readDraft && source.replaceDraft) {
    lease.readDraft = () => current() ? source.readDraft?.() : undefined;
    lease.replaceDraft = sql => {
      if (!current() || !source.replaceDraft) throw Error(text.restoreChanged);
      source.replaceDraft(sql);
      dispose();
    };
  }
  return lease;
}
