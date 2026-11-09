import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { queryLayoutLimits } from '../shared/queryLayout';

/** 外层及结果内部工具条分别计费，网格内容另留96像素；不足时仅视觉压缩编辑区。 */
export function queryLayoutMaximum(height: number, chrome: number, maximum: number, resultChrome=0): number {
  return Math.max(0, Math.min(maximum, Math.floor(height - chrome - 96 - resultChrome)));
}

/** 只沿本结果固定容器查找工具条及内容区，不扫描结果行或计划节点。 */
function resultLayoutParts(children: Element[]){
  const child=(parent:Element|undefined,name:string)=>Array.from(parent?.children??[]).find(node=>node.classList.contains(name));
  const body=children.find(node=>node.classList.contains('result-body')),details=child(body,'query-result-with-details'),holder=child(details,'query-result-grid');
  // PostgreSQL 用 display:contents 包裹替换区，其它查询页直接把替换区放在结果网格内。
  const host=child(holder,'pg-find-host')??holder,replace=child(host,'pg-table-find'),copy=child(host,'query-result-copy-region'),find=child(copy,'query-result-find-region');
  const plan = child(body, 'explain-view');
  const chrome = plan ? Array.from(plan.children).filter(node => !node.classList.contains('explain-content'))
    : [replace,child(copy,'query-result-copy-actions'),child(find,'query-result-find-toolbar'),child(find,'query-result-find-status')].filter((node):node is Element=>!!node);
  return { chrome, plan, grid: child(child(find,'query-result-find-grid')??host,'results-grid') as HTMLElement|undefined };
}

/** 布局包装层始终保留组件身份，测量时只展开这三层固定容器。 */
function queryLayoutChildren(root: Element): Element[] {
  return Array.from(root.children).flatMap(child => ['query-layout-panes', 'query-layout-editor', 'query-layout-results'].some(name => child.classList.contains(name)) ? queryLayoutChildren(child) : [child]);
}

/** 测量当前标签的实际可用区，隐藏标签不沿用全局窗口高度；只调整显示边界，不保存偏好。 */
export function useQueryLayoutMaximum(root: RefObject<HTMLDivElement | null>, maximum: number, setAvailableWidth?: (width: number) => void): number {
  const [value, setValue] = useState(maximum), observer = useRef<ResizeObserver | null>(null), watched = useRef(new Set<Element>());
  const minimum=useRef<{element:HTMLDivElement;height:number}|undefined>(undefined);
  const revealedPlan = useRef<Element | undefined>(undefined);
  /** 只扣固定chrome，编辑区与弹性结果内容不反向参与保存高度。 */
  function measure() {
    const element = root.current; if (!element) return;
    const bounds = element.getBoundingClientRect(), children = queryLayoutChildren(element);
    setAvailableWidth?.(element.clientWidth);
    let chrome = 0;
    for (const child of children) {
      if (child.classList.contains('sql-editor-wrap') || child.classList.contains('result-body')) continue;
      chrome += child.getBoundingClientRect().height;
    }
    const parts=resultLayoutParts(children),grid=parts.grid;
    // offsetHeight包含横向滚动条和边框，clientHeight才是可读客户区；按实际差额预留，不硬编码平台滚动条宽度。
    const scrollChrome=grid&&Number.isFinite(grid.offsetHeight)&&Number.isFinite(grid.clientHeight)?Math.max(0,grid.offsetHeight-grid.clientHeight):0;
    // 计划树需要同时容纳父子节点和首段指标，工具条换行及诊断提示另计。
    const planSpace = parts.plan ? 96 : 0;
    const resultChrome=Math.ceil(parts.chrome.reduce((sum,node)=>sum+Math.max(0,node.getBoundingClientRect().height),scrollChrome + planSpace)),height=96+resultChrome;
    // 此变量仅属于当前标签的显示布局；极短窗口靠标签滚动，不让内部工具条挤掉表头。
    if(minimum.current?.element!==element||minimum.current.height!==height){element.style.setProperty('--query-result-min-height',`${height}px`);minimum.current={element,height};}
    const available = queryLayoutMaximum(bounds.height, chrome, maximum,resultChrome);
    // 极短窗口通过标签滚动容纳计划，保留可重新访问的 SQL 编辑器。
    const next = parts.plan ? Math.max(available, Math.min(maximum, queryLayoutLimits.minEditorHeight)) : available;
    setValue(next);
    return { next, visible: bounds.height > 0 };
  }
  useLayoutEffect(() => {
    const element = root.current;
    observer.current = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (element) { observer.current?.observe(element); watched.current.add(element); }
    window.addEventListener('resize', measure);
    return () => { observer.current?.disconnect(); observer.current = null; watched.current.clear(); window.removeEventListener('resize', measure); };
  }, [maximum, setAvailableWidth]);
  // 新结果/错误/固定结果工具条可改变占用，React提交后补观察；相同测量不会重渲染。
  useLayoutEffect(() => {
    const children = root.current ? queryLayoutChildren(root.current) : [];
    const parts=resultLayoutParts(children);
    const next = new Set<Element>(root.current ? [root.current, ...children, ...parts.chrome, ...(parts.grid?[parts.grid]:[])] : []);
    for (const previous of watched.current) if (!next.has(previous)) observer.current?.unobserve(previous);
    for (const child of next) if (!watched.current.has(child)) observer.current?.observe(child);
    watched.current = next;
    const measured = measure();
    if (!parts.plan) revealedPlan.current = undefined;
    else if (measured?.visible && value === measured.next && revealedPlan.current !== parts.plan) {
      // 等编辑区的新高度提交后仅滚动一次，之后由用户控制阅读位置。
      revealedPlan.current = parts.plan;
      parts.plan.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  });
  return value;
}
