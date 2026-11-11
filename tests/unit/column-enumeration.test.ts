import { describe, expect, it, vi } from 'vitest';
import { catalogColumnEnumeration } from '../../src/engine/tableColumnDefinition';
import { setEnumerationMembers } from '../../src/renderer/components/RecordEnumerationPicker';
import { initialRecordInput, type RecordDraft } from '../../src/renderer/recordViews';
import { readPostgresTableEnumerations } from '../../src/engine/postgres/tableEnumerations';

describe('表数据枚举成员', () => {
  it.each(['mysql', 'mariadb'] as const)('%s 目录转义保留单引号、逗号、反斜杠、换行及空标签', dialect => {
    const raw = String.raw`enum('a,b','','O''Reilly','C:\\temp','一\n二','JSON')`;
    const values = ['a,b', '', "O'Reilly", 'C:\\temp', '一\n二', 'JSON'];
    expect(catalogColumnEnumeration(raw, dialect)).toEqual({ kind: 'ENUM', values });
    expect(initialRecordInput({ data: { e: 'JSON' } } as unknown as RecordDraft, {
      name: 'e', type: raw, nullable: true, defaultValue: null, extra: '', comment: '', generated: false,
    })).toEqual({ mode: 'text', text: 'JSON' });
  });

  it.each(["enum()", "enum('x',)", "enum('x','x')", "enum('x') EXTRA", "enum('x\u0000", "set('a,b','c')", "set('','a')"])('不把无法保真表示的目录当作选择源 %s', raw => {
    expect(catalogColumnEnumeration(raw, 'mysql')).toBeUndefined();
  });

  it('空 SET 表示零成员，未知成员和重复成员保留原文本输入', () => {
    expect(catalogColumnEnumeration("set('a','b')", 'mysql')).toEqual({ kind: 'SET', values: ['a', 'b'] });
    expect(setEnumerationMembers(['a', 'b'], '')).toEqual(new Set());
    expect(setEnumerationMembers(['a', 'b'], 'b,a')).toEqual(new Set(['b', 'a']));
    expect(setEnumerationMembers(['a', 'b'], 'a,a')).toBeUndefined();
    expect(setEnumerationMembers(['a', 'b'], 'a,c')).toBeUndefined();
  });

  it('PostgreSQL 枚举按目录顺序保留准确文本，普通类型不发起读取', async () => {
    const values = ['等待', '处理中', 'NULL', '', "O'Reilly"];
    const query = vi.fn().mockResolvedValue({ truncated: false, rows: values.map(c1 => ({ c0: '12345', c1 })) });
    expect(await readPostgresTableEnumerations({ query }, [])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
    expect(await readPostgresTableEnumerations({ query }, ['12345'])).toEqual(new Map([['12345', { kind: 'ENUM', values }]]));
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('ORDER BY chain.declared, item.enumsortorder'),
      [['12345'], 4097, 8193], { rows: 8193, bytes: 2 * 1024 * 1024 });
  });

  it('PostgreSQL 成员列表超限或回包截断时不提供部分选择', async () => {
    const rows = Array.from({ length: 4097 }, (_, index) => ({ c0: '12345', c1: String(index) }));
    rows.push({ c0: '12346', c1: '' });
    const query = vi.fn().mockResolvedValue({ truncated: false, rows });
    expect(await readPostgresTableEnumerations({ query }, ['12345', '12346'])).toEqual(new Map([['12346', { kind: 'ENUM', values: [''] }]]));
    query.mockResolvedValue({ truncated: true, rows });
    expect(await readPostgresTableEnumerations({ query }, ['12345', '12346'])).toEqual(new Map());
  });
});
