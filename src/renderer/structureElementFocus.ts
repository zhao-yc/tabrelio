import { useEffect, useRef } from 'react';

export type StructureElement = { group: 'columns' | 'indexes' | 'foreignKeys'; name: string; rename?: never }
  | { group: 'columns'; name: string; rename: true };

export function findStructureElement<T extends { name: string }>(items: readonly T[] | undefined, name: string | undefined): T | undefined {
  if (name === undefined || !items) return;
  const matches = items.filter(item => item.name === name);
  if (matches.length === 1) return matches[0];
}

/** 只使用设计器本次读回的唯一同名项。目录缺失时不回退到首行或相似名称。 */
export function useStructureElementFocus(focusName: string | undefined, items: readonly { name: string }[] | undefined) {
  const row = useRef<HTMLElement | null>(null), positioned = useRef<HTMLElement | null>(null);
  const match = findStructureElement(items, focusName);
  useEffect(() => {
    const node = row.current;
    if (!node || !match || positioned.current === node) return;
    positioned.current = node;
    const dialog = node.closest('[role="dialog"]');
    // 目录异步返回时，仅从默认关闭按钮移交键盘焦点，保留用户已经选择的控件。
    if (document.activeElement === dialog?.querySelector(':scope > header > button')) node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [match]);
  return {
    missing: focusName !== undefined && items !== undefined && !match,
    rowProps: (item: { name: string }) => item === match ? {
      ref: (element: HTMLElement | null) => { row.current = element; },
      tabIndex: -1,
      'aria-current': true as const,
      'data-structure-focus': '',
    } : {},
  };
}
