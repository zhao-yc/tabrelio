import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

const request = {
  source: { connectionId: 'mysql', database: 'db' },
  target: { connectionId: 'mariadb', database: 'db' },
  taskId: '31f0759b-9e09-4eb3-ac92-a1b50f6000d3',
  pairs: [{ source: 'a', target: 'x.y' }, { source: 'b', target: 'y' }],
  actions: ['insert', 'update'],
};

describe('MySQL／MariaDB 多表同步合同', () => {
  it('限定一个右侧库，允许目录中带点号的原始表名', () => {
    expect(validateCommand('mysql.compareData.batchPreview', request)).toEqual(request);
    expect(validateCommand('mysql.compareData.batchPreview', { ...request, target: request.source })).toBeDefined();
  });

  it('拒绝来源目标重叠、重复操作以及注入的同步范围', () => {
    for (const input of [
      { ...request, target: { ...request.target, table: 'x.y' } },
      { ...request, pairs: [request.pairs[0], { source: 'b', target: 'x.y' }] },
      { ...request, target: request.source, pairs: [request.pairs[0], { source: 'b', target: 'a' }] },
      { ...request, pairs: [{ ...request.pairs[0], mapping: [] }, request.pairs[1]] },
      { ...request, pairs: [request.pairs[0]] },
      { ...request, actions: ['delete', 'delete'] },
      { ...request, owner: '伪造窗口' },
    ]) expect(() => validateCommand('mysql.compareData.batchPreview', input)).toThrow();
    const apply = { taskId: request.taskId, previewId: request.taskId, confirmation: '`db`.`x.y` 等 2 张表' };
    expect(validateCommand('mysql.compareData.batchApply', apply)).toEqual(apply);
    expect(() => validateCommand('mysql.compareData.batchApply', { ...apply, target: request.target })).toThrow();
  });
});
