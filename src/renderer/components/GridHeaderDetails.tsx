import type { ReactNode } from 'react';
import { gridHeaderDetailsZh as text } from '../locales/gridHeaderDetails.zh-CN';
import '../gridHeaderDetails.css';

export interface GridHeaderDetailsValue { type?: string; comment?: string; }

export interface GridHeaderDetailsOptions {
  showType: boolean;
  showComment?: boolean;
  fields?: ReadonlyMap<string, GridHeaderDetailsValue>;
}

/** 标签与目录文字只负责显示，网格列键、名称和排序标记由调用方保留。 */
export function GridHeaderDetails({ name, type, comment, hint, children }: GridHeaderDetailsValue & { name: string; hint?: string; children?: ReactNode }) {
  const tooltip = [name, type && text.type + ' ' + type, comment && text.comment + ' ' + comment, hint].filter(Boolean).join('\n');
  return <span className="grid-header-details" title={tooltip}>
    <span className="grid-header-detail-name">{name}{children}</span>
    {type && <small className="column-type">{type}</small>}
    {comment && <small className="grid-header-comment">{comment}</small>}
  </span>;
}
