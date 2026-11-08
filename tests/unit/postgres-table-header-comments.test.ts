import { expect, it, vi } from 'vitest';
import { readRelation } from '../../src/engine/postgres/tableWorkspace';
import type { PostgresConnection } from '../../src/engine/postgres/connection';

it('表头摘要在同一目录读取，长注释按字符截断，注释变化不改变原表指纹', async () => {
  let comment = '🧪'.repeat(161);
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('FROM pg_catalog.pg_attribute') ? [
      { c0: 'value', c1: 'character varying(17)', c2: 'f', c3: 'f', c4: '', c5: '', c6: '1043',
        c7: '0', c8: '1', c9: '100', c10: null, c11: 'f', ...(sql.includes('col_description') ? { c12: comment } : {}) },
    ] : [{ c0: '900', c1: '1000', c2: 'r', c3: 'f', c4: 'f', c5: 'f', c6: 'f', c7: 'f',
      c8: null, c9: null, c10: 'f', c11: 't', c12: 't' }],
    truncated: false,
  }));
  const connection = { query } as unknown as PostgresConnection;
  const plain = await readRelation(connection, '"public"."subject"');
  const decorated = await readRelation(connection, '"public"."subject"', { headerComments: true });
  expect(query).toHaveBeenCalledTimes(4);
  expect(query.mock.calls[1][0]).not.toContain('col_description');
  expect(query.mock.calls[3][0]).toContain('pg_catalog.left(pg_catalog.col_description(a.attrelid, a.attnum), 161)');
  expect(plain.columns[0]).not.toHaveProperty('comment');
  expect(decorated.columns[0].comment).toBe('🧪'.repeat(160) + '…');
  expect(decorated.fingerprint).toBe(plain.fingerprint);
  comment = '新注释';
  const updated = await readRelation(connection, '"public"."subject"', { headerComments: true });
  expect(updated.columns[0].comment).toBe('新注释');
  expect(updated.fingerprint).toBe(plain.fingerprint);
});
