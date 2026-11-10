import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CellValue } from '../../shared/contracts';
import { decodeBinaryCell, inspectBinaryImage } from '../binaryCell';
import { sqliteBinaryOriginalCell } from '../sqliteBinaryInput';
import { binaryCellZh as text } from '../locales/binaryCell.zh-CN';
import './GridCellImage.css';

const width = 72, height = 48;
const waiting = new Set<() => Promise<void>>();
let active = 0;

/** 只同时解码两张原图，画入缩略图后立即释放位图。虚拟单元格卸载时移除尚未开始的任务。 */
function drainImages() {
  while (active < 2 && waiting.size) {
    const next = waiting.values().next().value!;
    waiting.delete(next);
    active++;
    void next().finally(() => { active--; drainImages(); });
  }
}

export function GridCellImage({ value, sqliteHex, children }: { value?: CellValue; sqliteHex?: string; children: ReactNode }) {
  const base64 = value && typeof value === 'object' && value.type === 'binary' ? value.base64 : undefined;
  // 大多数 BLOB 并非图片。只取签名前缀，避免在渲染普通字节时解码完整值。
  const candidate = sqliteHex !== undefined ? /^(?:89504e470d0a1a0a|ffd8ff|52494646)/i.test(sqliteHex)
    : base64 !== undefined && /^(?:iVBORw0KGgo|\/9j\/|UklGR)/.test(base64);
  return candidate ? <Thumbnail raw={sqliteHex ?? base64!} hex={sqliteHex !== undefined}>{children}</Thumbnail> : children;
}

function Thumbnail({ raw, hex, children }: { raw: string; hex: boolean; children: ReactNode }) {
  const source = useMemo(() => ({ raw, hex }), [raw, hex]);
  const host = useRef<HTMLSpanElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState<typeof source>();
  useEffect(() => {
    if (!host.current || !canvas.current) return;
    const target = canvas.current;
    let cancelled = false;
    async function draw() {
      if (cancelled) return;
      try {
        const value = source.hex ? sqliteBinaryOriginalCell(source.raw) : { type: 'binary' as const, base64: source.raw };
        const bytes = decodeBinaryCell(value);
        if (!bytes) return;
        const image = inspectBinaryImage(bytes);
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: image.mime }));
        try {
          // 真实解码尺寸仍需与预检一致。虚拟格复用后不写入继任单元格的画布。
          if (cancelled || canvas.current !== target || bitmap.width !== image.width || bitmap.height !== image.height) return;
          const ctx = target.getContext('2d');
          if (!ctx) return;
          const scale = Math.min(width / image.width, height / image.height);
          const w = image.width * scale, h = image.height * scale;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
          setDrawn(source);
        } finally { bitmap.close(); }
      } catch { /* 非图片、损坏或超预算值沿用原单元格文本。 */ }
    }
    const observer = new IntersectionObserver(entries => {
      if (cancelled || !entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      waiting.add(draw);
      drainImages();
    });
    observer.observe(host.current);
    return () => { cancelled = true; observer.disconnect(); waiting.delete(draw); };
  }, [source]);
  const ready = drawn === source;
  return <span ref={host} className="grid-image-thumbnail">
    <canvas ref={canvas} width={width} height={height} hidden={!ready} role="img" aria-label={text.gridImage}/>
    {!ready && children}
  </span>;
}
