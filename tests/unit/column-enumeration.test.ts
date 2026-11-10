import { describe, expect, it } from 'vitest';
import { catalogColumnEnumeration } from '../../src/engine/tableColumnDefinition';
import { setEnumerationMembers } from '../../src/renderer/components/RecordEnumerationPicker';
import { initialRecordInput, type RecordDraft } from '../../src/renderer/recordViews';

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
});
