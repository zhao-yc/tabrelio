import { describe, expect, it } from 'vitest';
import { relationshipDiagramPngScale, relationshipDiagramPngSchema } from '../../src/shared/relationshipDiagramPng';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';

describe('关系图 PNG 保存边界', () => {
  it('接纳合法 PNG，拒绝额外路径、非 PNG 或缺少结束块的输入', () => {
    expect(relationshipDiagramPngSchema.parse({ base64: png })).toEqual({ base64: png });
    expect(relationshipDiagramPngSchema.safeParse({ base64: png, suggestedName: 'other.png' }).success).toBe(false);
    expect(relationshipDiagramPngSchema.safeParse({ base64: 'e30=' }).success).toBe(false);
    expect(relationshipDiagramPngSchema.safeParse({ base64: png.slice(0, -16) }).success).toBe(false);
  });

  it('先校验图像尺寸与像素预算，有限尺寸可回退为原图清晰度', () => {
    expect(relationshipDiagramPngScale(850, 314)).toBe(2);
    expect(relationshipDiagramPngScale(1290, 4000)).toBe(1);
    expect(() => relationshipDiagramPngScale(1290, 15000)).toThrow();
    const modified = Buffer.from(png, 'base64');
    modified.writeUInt32BE(17000, 16);
    expect(relationshipDiagramPngSchema.safeParse({ base64: modified.toString('base64') }).success).toBe(false);
  });
});
