import { describe, expect, it } from 'vitest';
import { TableWriteTraceCapture } from '../../src/shared/tableWriteTrace';

describe('表页集中提交的 SQL 模板', () => {
  it('无投递不生成记录，超出上限时仍保留事务控制语句', () => {
    const trace = new TableWriteTraceCapture();
    expect(trace.snapshot()).toBeUndefined();
    trace.record('BEGIN');
    for (let i = 0; i < 20; i++) trace.record('UPDATE t SET name = ? WHERE id = ?');
    trace.record('COMMIT');
    trace.record('ROLLBACK');
    const captured = trace.snapshot()!;
    expect(captured.omitted).toBe(11);
    expect(captured.statements).toHaveLength(12);
    expect(captured.statements[0].sql).toBe('BEGIN');
    expect(captured.statements.slice(-2).map(entry => entry.sql)).toEqual(['COMMIT', 'ROLLBACK']);
  });
});
