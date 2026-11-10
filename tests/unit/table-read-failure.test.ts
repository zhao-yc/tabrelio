import { describe, expect, it } from 'vitest';
import { TableReadFailure, withTableReadTrace } from '../../src/shared/tableReadStatements';

describe('未完成的表页读取', () => {
  it('未投递和未显式请求的失败沿用原错误', async () => {
    const cause = Error('连接或目录检查未完成');
    for (const enabled of [true, undefined]) {
      await expect(withTableReadTrace(enabled, async record => {
        if (!enabled) expect(record).toBeUndefined();
        throw cause;
      })).rejects.toBe(cause);
    }
  });

  it('拒绝时交付有界模板和原错误，成功结果保持原样', async () => {
    const cause = Error('驱动错误原文');
    const sql = 'SELECT * FROM t WHERE label = ?';
    const long = sql.padEnd(8191, ' ') + '🚢';
    const reason = await withTableReadTrace(true, async record => {
      record!('SELECT COUNT(*) FROM t');
      record!(long);
      for (let attempt = 0; attempt < 5; attempt++) record!(sql);
      throw cause;
    }).catch(error => error);
    expect(reason).toBeInstanceOf(TableReadFailure);
    expect(reason).toMatchObject({ cause, message: cause.message, statements: [
      { sql: 'SELECT COUNT(*) FROM t', clipped: false }, { sql: long.slice(0, 8191), clipped: true },
      { sql, clipped: false }, { sql, clipped: false },
    ] });
    const page = { rows: [] };
    await expect(withTableReadTrace(true, async record => { record!(sql); return page; })).resolves.toBe(page);
  });
});
