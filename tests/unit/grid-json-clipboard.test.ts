import { describe, expect, it } from 'vitest';
import { encodeGridCsv, encodeGridJson, maxClipboardCells, maxClipboardCharacters, type ClipboardCell } from '../../src/renderer/gridClipboard';
import { gridJsonClipboardZh as text } from '../../src/renderer/locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csv } from '../../src/renderer/locales/gridCsvClipboard.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

describe('记录复制为 JSON', () => {
  it('保持显示顺序、重名映射、精确原文和二进制，省略草稿默认值', () => {
    const columns = ['__proto__', '__proto__', '__proto__ [2]', '', 'nullable', 'default', ''].map((name, index) => ({ key: String(index), name }));
    const values: ClipboardCell[] = ['9007199254740993', '0.1234567890123456789', '第一行\0\n🚢', '', null, undefined, { type: 'binary', base64: 'AP8=' }];
    const output = encodeGridJson(columns, [values, values.slice().reverse()], (row, key) => row[Number(key)]);
    const [first, second] = JSON.parse(output);
    expect(Object.keys(first)).toEqual(['__proto__', '__proto__ [3]', '__proto__ [2]', '列 [4]', 'nullable', '列 [7]']);
    expect(Object.values(first)).toEqual(values.filter(value => value !== undefined));
    expect(Object.hasOwn(second, 'default')).toBe(true);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(output).toContain('\\u0000\\n🚢');
  });

  it('拒绝不安全数值、非法二进制和自定义 JSON 转换，单元格数及转义后文本均受预算限制', () => {
    const columns = [{ name: 'value', key: 'value' }];
    expect(() => encodeGridJson(columns, Array(maxClipboardCells + 1).fill(0), row => row)).toThrow(zh.clipboard.copyLimit);
    expect(() => encodeGridJson(columns, ['\0'.repeat(Math.ceil(maxClipboardCharacters / 6))], row => row)).toThrow(zh.clipboard.copySizeLimit);
    for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, { type: 'binary', base64: 'a=a=' }, {
      type: 'binary', base64: 'AP8=', toJSON() { throw Error('不应执行 toJSON'); },
    }] as ClipboardCell[]) expect(() => encodeGridJson(columns, [value], row => row)).toThrow(text.invalid);
  });
});

describe('记录复制为 CSV', () => {
  it('按文件 CSV 规则编码同名表头、精确值、空串、换行和二进制', () => {
    const columns = ['列,名', '列,名', '', 'nullable', 'binary', 'empty', 'raw', 'zero'].map((name, index) => ({ key: String(index), name }));
    const values: ClipboardCell[] = ['9007199254740993', '0.1234567890123456789', '甲,"乙"\r\n🚢', null, { type: 'binary', base64: 'AP8=' }, '', '\\N', -0];
    expect(encodeGridCsv(columns, [values], (row, key) => row[Number(key)])).toBe(
      '"列,名","列,名 [2]",列 [3],nullable,binary,empty,raw,zero\r\n' +
      '9007199254740993,0.1234567890123456789,"甲,""乙""\r\n🚢",\\N,base64:AP8=,"",\\\\N,-0\r\n');
  });

  it('默认值、损坏字段和超预算时拒绝整批', () => {
    const columns = [{ key: 'value', name: 'value' }];
    expect(() => encodeGridCsv(columns, [null, undefined], value => value)).toThrow(csv.defaultValue);
    expect(() => encodeGridCsv(columns, [Number.MAX_SAFE_INTEGER + 1], value => value)).toThrow(csv.invalid);
    expect(() => encodeGridCsv<ClipboardCell>(columns, [{ type: 'binary', base64: 'a=a=' }], value => value)).toThrow(csv.invalid);
    expect(() => encodeGridCsv(columns, Array(maxClipboardCells).fill(0), value => value)).toThrow(zh.clipboard.copyLimit);
    expect(() => encodeGridCsv(columns, ['"'.repeat(Math.ceil(maxClipboardCharacters / 2))], value => value)).toThrow(zh.clipboard.copySizeLimit);
  });
});
