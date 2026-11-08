import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

const base = { sourceConnectionId: 'left', targetConnectionId: 'right', taskId: '31f0759b-9e09-4eb3-ac92-a1b50f6000d3',
  pairs: [{ source: 'a', target: 'x' }, { source: 'b', target: 'y' }], actions: ['insert', 'update'] };

describe('SQLite 多表事务同步合同', () => {
  it('只接收明确的表对和操作，禁止重复对象、同文件源目标重叠以及任意 SQL', () => {
    expect(validateCommand('sqlite.compareSync.batchPreview', base)).toEqual(base);
    expect(validateCommand('sqlite.compareSync.batchPreview', { ...base, targetConnectionId: 'left' })).toBeDefined();
    const mapped = { ...base, pairs: [{ ...base.pairs[0], mapping: [
      { source: 'code', target: 'identifier', key: true }, { source: 'raw', target: 'payload', key: false },
    ] }, base.pairs[1]] };
    expect(validateCommand('sqlite.compareSync.batchPreview', mapped)).toEqual(mapped);
    for (const input of [
      { ...base, pairs: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x' }] },
      { ...base, pairs: [{ source: 'a', target: 'x' }, { source: 'a', target: 'y' }] },
      { ...base, pairs: [{ source: 'a', target: 'b' }, base.pairs[1]], targetConnectionId: 'left' },
      { ...base, pairs: [{ ...base.pairs[0], mapping: [] }, base.pairs[1]] },
      { ...base, pairs: [base.pairs[0]] },
      { ...base, actions: [] }, { ...base, actions: ['delete', 'delete'] }, { ...base, sql: 'DELETE' },
    ]) expect(() => validateCommand('sqlite.compareSync.batchPreview', input)).toThrow();
    expect(() => validateCommand('sqlite.compareSync.batchApply', {
      taskId: base.taskId, previewId: 'p', confirmation: 'main.a 等 2 张表', pairs: base.pairs,
    })).toThrow();
  });
});
