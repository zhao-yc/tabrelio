import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

const base = {
  source: { connectionId: 'source', database: 'db' }, target: { connectionId: 'target', database: 'db' },
  taskId: '31f0759b-9e09-4eb3-ac92-a1b50f6000d3',
  pairs: [{ source: 'a', target: 'x' }, { source: 'b', target: 'y' }], actions: ['insert', 'update'],
};

describe('PostgreSQL 多表事务同步合同', () => {
  it('固定一个右侧数据库，允许合法字段映射并拒绝重复或重叠的关系', () => {
    expect(validateCommand('postgres.compareData.batchPreview', base)).toEqual(base);
    expect(validateCommand('postgres.compareData.batchPreview', { ...base, target: base.source })).toBeDefined();
    const mapped = { ...base, pairs: [{ ...base.pairs[0], mapping: [
      { source: 'left_code', target: 'right_code', key: true }, { source: 'raw', target: 'payload', key: false },
    ] }, base.pairs[1]] };
    expect(validateCommand('postgres.compareData.batchPreview', mapped)).toEqual(mapped);
    for (const request of [
      { ...base, target: { ...base.target, table: 'x' } },
      { ...base, pairs: [base.pairs[0], { source: 'b', target: '"public"."x"' }] },
      { ...base, target: base.source, pairs: [base.pairs[0], { source: 'b', target: '"public"."a"' }] },
      { ...base, pairs: [{ ...base.pairs[0], mapping: [] }, base.pairs[1]] },
      { ...base, actions: ['delete', 'delete'] },
      { ...base, pairs: [base.pairs[0]] },
      { ...base, owner: '伪造窗口', sourceProfile: {} },
    ]) expect(() => validateCommand('postgres.compareData.batchPreview', request)).toThrow();
    expect(() => validateCommand('postgres.compareData.batchApply', {
      taskId: base.taskId, previewId: base.taskId, confirmation: 'db."public"."x"', target: base.target,
    })).toThrow();
  });
});
