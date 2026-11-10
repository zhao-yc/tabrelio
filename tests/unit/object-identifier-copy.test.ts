import { describe, expect, it } from 'vitest';
import { objectIdentifierCopy } from '../../src/renderer/objectIdentifierCopy';

describe('目录对象的名称复制', () => {
  it.each(['mysql', 'mariadb'] as const)('%s 逐段引用目录中原有的点号和反引号', dialect => {
    expect(objectIdentifierCopy(dialect, '库.一`', { kind: 'event', name: '日程.`A' }))
      .toEqual({ plain: '日程.`A', qualified: '`库.一```.`日程.``A`' });
    expect(objectIdentifierCopy(dialect, '', { kind: 'table', name: '样本' }))
      .toEqual({ plain: '样本', qualified: undefined });
  });

  it.each(['table', 'view', 'sequence'] as const)('PostgreSQL %s 使用实际 schema，保留特殊字符和 Unicode', kind => {
    expect(objectIdentifierCopy('postgresql', '连接库', { kind, name: '"业务.一"""."数据.""表😀"' }))
      .toEqual({ plain: '数据."表😀', qualified: '"业务.一"""."数据.""表😀"' });
  });

  it.each(['function', 'procedure'] as const)('PostgreSQL %s 从重载中提取可调用名称', kind => {
    expect(objectIdentifierCopy('postgresql', 'postgres', { kind, name: '"业务"."函数("""(integer, "类型"."编号"[])' }))
      .toEqual({ plain: '函数("', qualified: '"业务"."函数("""' });
  });

  it('SQLite 目录引用 main，名称中的引号加倍', () => {
    expect(objectIdentifierCopy('sqlite', 'main', { kind: 'trigger', name: '触发."😀' }))
      .toEqual({ plain: '触发."😀', qualified: '"main"."触发.""😀"' });
  });

  it('目录上下文不明、种类不符和无效标识符不会产生推测出的限定名', () => {
    expect(objectIdentifierCopy('postgresql', 'postgres', { kind: 'table', name: '未限定.关系' })).toBeUndefined();
    expect(objectIdentifierCopy('postgresql', 'postgres', { kind: 'function', name: '"s"."f"' })).toBeUndefined();
    expect(objectIdentifierCopy('postgresql', 'postgres', { kind: 'trigger', name: '"s"."t"' })).toBeUndefined();
    expect(objectIdentifierCopy('sqlite', 'temp', { kind: 'table', name: '临时' })).toBeUndefined();
    expect(objectIdentifierCopy('sqlite', 'main', { kind: 'table', name: '坏\0名' })).toBeUndefined();
    expect(objectIdentifierCopy('sqlite', 'main', { kind: 'table', name: '\ud800' })).toBeUndefined();
  });
});
