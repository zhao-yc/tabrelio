import { postgresTableLimits } from '../shared/postgresTable';
import { postgresBatchDeleteZh as text } from './locales/postgresBatchDelete.zh-CN';

export interface PostgresCheckedPage {
  readonly offset: number;
  readonly token: string;
  readonly valid: boolean;
  readonly expiresAt: number;
}

export function postgresCheckedPageCurrent(page: PostgresCheckedPage): boolean {
  return page.valid && page.expiresAt > Date.now();
}

/** 草稿和明确收集的页共享原快照名额，普通撤销历史只使用剩余名额。 */
export function postgresCheckedPagePins(pins: { retainPageTokens: string[]; retainHistoryPageTokens: string[] }, pages: readonly PostgresCheckedPage[]) {
  const retained = new Set(pins.retainPageTokens);
  const requested = new Set(pages.filter(page => postgresCheckedPageCurrent(page) && !retained.has(page.token)).map(page => page.token));
  if (requested.size + retained.size > postgresTableLimits.draftPages) throw Error(text.pagesLimit);
  for (const token of pins.retainHistoryPageTokens) {
    if (requested.size + retained.size >= postgresTableLimits.draftPages) break;
    if (!retained.has(token)) requested.add(token);
  }
  return { retainPageTokens: pins.retainPageTokens, retainHistoryPageTokens: [...requested] };
}

/** 未获引擎确认的原令牌永久失效，重读同页不会让旧收集重新生效。 */
export function retainPostgresCheckedPages<T extends PostgresCheckedPage>(pages: readonly T[], tokens: ReadonlySet<string>): readonly T[] {
  if (!pages.some(page => page.valid && !tokens.has(page.token))) return pages;
  return pages.map(page => page.valid && !tokens.has(page.token) ? { ...page, valid: false } : page);
}
