import { binaryCellLimits, decodeBinaryCell, inspectBinaryImage } from './binaryCell';
import { htmlCellPreviewZh as text } from './locales/htmlCellPreview.zh-CN';

const byteLimit = 256 * 1024;
const nodeLimit = 4096;
const depthLimit = 48;
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const elements = new Set(('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr').split(' '));
const discarded = new Set('applet audio button canvas datalist embed form frame frameset iframe input link meta noscript object script select template textarea title video'.split(' '));
const attributes = ['alt', 'class', 'colspan', 'dir', 'height', 'id', 'lang', 'open', 'reversed', 'rowspan', 'scope', 'span', 'start', 'title', 'value', 'width'];
// 仅保留不接受图像或外部资源的排版属性。CSS 背景用 background-color，图片统一走字节和尺寸校验。
const properties = ('align-content align-items align-self background-color border border-bottom border-collapse border-color border-left border-radius border-right border-spacing border-style border-top border-width box-shadow box-sizing caption-side clear color direction display flex flex-basis flex-direction flex-grow flex-shrink flex-wrap float font font-family font-size font-style font-variant font-weight gap grid-template-columns grid-template-rows height justify-content letter-spacing line-height list-style-type margin margin-bottom margin-left margin-right margin-top max-height max-width min-height min-width opacity overflow-wrap padding padding-bottom padding-left padding-right padding-top table-layout text-align text-decoration text-indent text-shadow text-transform vertical-align white-space width word-break word-spacing').split(' ');

/** 只在含标签的原始文本格显示入口，普通文本和二进制包装值不参与。 */
export function htmlCellSource(value: unknown): string | undefined {
  return typeof value === 'string' && /<(?:!doctype\s+html|[a-z][a-z0-9-]*(?=[\s/>]))/i.test(value.slice(0, 4096)) ? value : undefined;
}

function safeDeclarations(style: CSSStyleDeclaration): string {
  if (!style.length) return '';
  return properties.flatMap(name => {
    const value = style.getPropertyValue(name);
    return value ? [`${name}:${value}${style.getPropertyPriority(name) ? ' !important' : ''};`] : [];
  }).join('');
}

/** 样式表只保留普通样式规则的静态属性；生成的 CSS 不可结束外层 style 标签。 */
function safeStyles(source: string): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(source);
  if (sheet.cssRules.length > nodeLimit) throw Error(text.structure);
  return Array.from(sheet.cssRules).flatMap(rule => {
    if (!(rule instanceof CSSStyleRule)) return [];
    const declarations = safeDeclarations(rule.style);
    return declarations ? [rule.selectorText + '{' + declarations + '}'] : [];
  }).join('\n').replaceAll('<', '\\3c ');
}

/** 从惰性模板重建静态 HTML；输出只进入无权限 iframe，原值不参与任何 DOM 插入或数据库写入。 */
export function buildHtmlCellPreview(source: string): string {
  if (source.length > byteLimit || new TextEncoder().encode(source).byteLength > byteLimit) throw Error(text.bytes);
  const input = document.createElement('template');
  input.innerHTML = source;
  const inert = input.content.ownerDocument;
  const body = inert.createElement('div'), styles: string[] = [];
  let nodes = 0, pixels = 0;

  function copyChildren(from: Node, to: Node, depth: number): void {
    for (let child = from.firstChild; child; child = child.nextSibling) {
      if (++nodes > nodeLimit || depth > depthLimit) throw Error(text.structure);
      if (child.nodeType === Node.TEXT_NODE) { to.appendChild(inert.createTextNode(child.nodeValue ?? '')); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement, name = element.localName;
      if (element.namespaceURI !== htmlNamespace || discarded.has(name)) continue;
      if (name === 'style') { styles.push(safeStyles(element.textContent ?? '')); continue; }
      if (!elements.has(name)) { copyChildren(element, to, depth + 1); continue; }
      const next = inert.createElement(name);
      for (const key of attributes) {
        const value = element.getAttribute(key);
        if (value !== null) next.setAttribute(key, value);
      }
      const style = safeDeclarations(element.style);
      if (style) next.setAttribute('style', style);
      if (name === 'img') {
        const source = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(element.getAttribute('src') ?? '');
        if (source) try {
          const bytes = decodeBinaryCell({type: 'binary', base64: source[2]})!;
          const info = inspectBinaryImage(bytes), size = info.width * info.height;
          if (source[1] === info.mime && pixels + size <= binaryCellLimits.pixels) {
            pixels += size;
            next.setAttribute('src', source[0]);
          }
        } catch { /* 无法确认的图片仅保留原 alt 文字。 */ }
        if (!next.hasAttribute('src')) {
          const alt = next.getAttribute('alt');
          if (alt) to.appendChild(inert.createTextNode(alt));
          continue;
        }
      }
      copyChildren(element, next, depth + 1);
      to.appendChild(next);
    }
  }
  copyChildren(input.content, body, 0);
  const content = body.innerHTML, css = styles.join('\n');
  if (content.length + css.length > byteLimit * 2) throw Error(text.structure);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:12px;font:14px/1.5 system-ui,sans-serif;color:#17212b;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse}th,td{border:1px solid #d1d7df;padding:4px 8px}\n${css}</style></head><body>${content}</body></html>`;
}
