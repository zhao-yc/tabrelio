import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildHtmlCellPreview, htmlCellSource } from '../htmlCellPreview';
import { htmlCellPreviewZh as text } from '../locales/htmlCellPreview.zh-CN';
import '../htmlCellPreview.css';

/** 隔离框不允许脚本、同源访问、导航父窗口、表单或弹窗。 */
export function HtmlCellFrame({ value }: { value: string }) {
  const source = useDeferredValue(value);
  const frame = useRef({source, revision: 0});
  // 草稿改变时重新挂载隔离文档，避免依赖旧沙箱文档能否导航到新版 srcdoc。
  if (frame.current.source !== source) frame.current = {source, revision: frame.current.revision + 1};
  const preview = useMemo(() => {
    try { return { src: buildHtmlCellPreview(source) }; }
    catch (reason) {
      const error = reason instanceof Error && (reason.message === text.bytes || reason.message === text.structure)
        ? reason.message : text.unavailable;
      return { error };
    }
  }, [source]);
  return preview.src
    ? <><p className="muted small">{text.hint}</p><iframe key={frame.current.revision} className="html-cell-frame"
      title={text.frame} sandbox="" referrerPolicy="no-referrer" tabIndex={0} srcDoc={preview.src}/></>
    : <p role="status">{preview.error}</p>;
}

/** 编辑器直接查看当前缓冲，预览只读，暂存与提交仍由外层字段处理。 */
export function HtmlCellPreviewToggle({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const source = htmlCellSource(value);
  if (source === undefined) return null;
  return <div className="html-cell-preview">
    <button type="button" aria-expanded={open} onClick={() => setOpen(previous => !previous)}>{open ? text.close : text.open}</button>
    {open && <HtmlCellFrame value={source}/>}
  </div>;
}

export function GridHtmlCellPreview({ value, title, onClose }: { value: string; title: string; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { close.current?.focus({preventScroll: true}); }, [value, title]);
  return <section className="html-cell-preview grid-html-cell-preview" aria-label={text.field(title)}>
    <header><strong title={title}>{text.field(title)}</strong><button ref={close} type="button" onClick={onClose}>{text.close}</button></header>
    <HtmlCellFrame value={value}/>
  </section>;
}
