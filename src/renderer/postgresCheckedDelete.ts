import { postgresTableLimits, type PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { postgresBatchDeletePlan, type PostgresBatchDeletePlan } from './postgresBatchDelete';
import { postgresBatchDeleteZh as text } from './locales/postgresBatchDelete.zh-CN';

export interface PostgresCheckedDeletePage {
  readonly offset: number;
  readonly token: string;
  readonly valid: boolean;
  readonly expiresAt: number;
  readonly targets: readonly { rowKey: string; row: number }[];
  readonly rows: PostgresBatchDeletePlan['rows'];
}

/** 只保留行定位和有限主键预览，翻页不在渲染器复制整张数据页。 */
export function capturePostgresCheckedDelete(page: PostgresTablePage, offset: number, selected: ReadonlySet<number>, draft: readonly PostgresDraftEntry[]): PostgresCheckedDeletePage {
  if (!page.writeExpiresAt || page.writeExpiresAt <= Date.now()) throw Error(text.pagesExpired);
  const prior = new Map(draft.map(entry => [entry.rowKey, entry.change]));
  const plan = postgresBatchDeletePlan(page, selected, key => prior.get(key));
  return {
    offset, token: page.pageToken!, valid: true, expiresAt: page.writeExpiresAt, rows: plan.rows,
    targets: plan.rows.map(({ index }) => ({ rowKey: page.rowKeys![index], row: index })),
  };
}

export function postgresCheckedDeletePageCurrent(page: PostgresCheckedDeletePage): boolean {
  return page.valid && page.expiresAt > Date.now();
}

/** 确保显式收集的原页有保留名额，再用剩余名额保留普通撤销历史。 */
export function postgresCheckedDeletePins(pins: { retainPageTokens: string[]; retainHistoryPageTokens: string[] }, pages: readonly PostgresCheckedDeletePage[]) {
  const retained = new Set(pins.retainPageTokens), requested = new Set(pages.filter(page => postgresCheckedDeletePageCurrent(page) && !retained.has(page.token)).map(page => page.token));
  if (requested.size + retained.size > postgresTableLimits.draftPages) throw Error(text.pagesLimit);
  for (const token of pins.retainHistoryPageTokens) {
    if (requested.size + retained.size >= postgresTableLimits.draftPages) break;
    if (!retained.has(token)) requested.add(token);
  }
  return { retainPageTokens: pins.retainPageTokens, retainHistoryPageTokens: [...requested] };
}

/** 使用首次原行版本覆盖更新草稿，拒绝不同页收集到同一主键。 */
export function planPostgresCheckedDelete(pages: readonly PostgresCheckedDeletePage[], draft: readonly PostgresDraftEntry[]) {
  if (!pages.length || pages.some(page => !postgresCheckedDeletePageCurrent(page))) throw Error(text.pagesExpired);
  const ordered = [...pages].sort((left, right) => left.offset - right.offset);
  const prior = new Map(draft.map(entry => [entry.rowKey, entry]));
  const keys = new Set<string>(), additions: PostgresDraftEntry[] = [];
  const plan: PostgresBatchDeletePlan = { changes: [], rows: [], updates: 0 };
  for (const page of ordered) {
    for (const target of page.targets) {
      if (keys.has(target.rowKey)) throw Error(text.pagesOverlap);
      keys.add(target.rowKey);
      const previous = prior.get(target.rowKey);
      if (previous?.change.kind === 'delete') throw Error(text.stale);
      if (previous?.change.kind === 'update') plan.updates++;
      const change = { kind: 'delete' as const, row: previous?.change.kind === 'update' ? previous.change.row : target.row,
        pageToken: previous?.change.pageToken ?? page.token };
      additions.push({ change, rowKey: target.rowKey, offset: previous?.offset ?? page.offset });
      plan.changes.push(change);
    }
    plan.rows.push(...page.rows.map(row => ({ ...row, index: page.offset + row.index })));
  }
  return { plan, entries: [...draft.filter(entry => !entry.rowKey || !keys.has(entry.rowKey)), ...additions] };
}
