const gridNavigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'PageUp', 'PageDown']);

/** 组合输入首尾可能只有229标记；只阻止网格命令，不取消浏览器实际输入。 */
export function tableCellKeyIsComposing(event: { isComposing?: boolean; keyCode?: number }): boolean { return event.isComposing === true || event.keyCode === 229; }

/** 区分数据格自身的焦点与格内文本框、复选框等控件。 */
export function isFocusedDataCell(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && !target.isContentEditable &&
    target.getAttribute('role') === 'gridcell' && target.ownerDocument.activeElement === target;
}

/** 编辑快捷键只属于真正聚焦的数据格，输入框和数据格内的控件保留原按键行为。 */
export function tableCellEditorKey(event: {
  key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number }; target: EventTarget | null;
}): boolean {
  return event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !tableCellKeyIsComposing(event.nativeEvent) && isFocusedDataCell(event.target);
}

/** 二进制仍可粘贴与导航；仅阻止网格自行把键盘输入交给普通文本编辑器。 */
export function blocksBinaryTextInput(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return !event.ctrlKey && !event.metaKey && !gridNavigationKeys.has(event.key) && !(event.shiftKey && event.key === ' ');
}
