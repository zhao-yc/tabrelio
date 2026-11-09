import { expect, it, vi } from 'vitest';
import type { FieldDef } from 'pg';
import { postgresColumnReferences, readPostgresResultOrigins } from '../../src/engine/postgres/resultOrigins';
import { postgresResultOriginsSchema } from '../../src/shared/postgresResultOrigins';

it('协议列引用保留原位置及系统字段，表达式和越界值保持空位', () => {
  const field = (tableID: number, columnID: number) => ({ tableID, columnID } as FieldDef);
  expect(postgresColumnReferences([field(41, 1), field(0, 0), field(-1, -2), field(41, 65536)]))
    .toEqual([{ relation: 41, attribute: 1 }, null, { relation: 4294967295, attribute: -2 }, null]);
  expect(postgresResultOriginsSchema.safeParse({ sessionId: 's', connectionId: 'c', database: 'd',
    columns: [{ relation: 41, attribute: 1, sql: 'unexpected' }] }).success).toBe(false);
});

it('当前目录回包按原列位置对齐，临时关系可显示且不提供跳转', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [
    { c0: '2', c1: 'pg_temp_3', c2: '临时', c3: '值', c4: 'false' },
    { c0: '0', c1: 'public', c2: '原表', c3: 'id', c4: 'true' },
  ] });
  const columns = [{ relation: 41, attribute: 1 }, null, { relation: 42, attribute: 1 }, { relation: 43, attribute: 1 }];
  await expect(readPostgresResultOrigins({ query }, columns)).resolves.toEqual([
    { schema: 'public', table: '原表', column: 'id', canOpen: true }, null,
    { schema: 'pg_temp_3', table: '临时', column: '值', canOpen: false }, null,
  ]);
  expect(JSON.parse(query.mock.calls[0][1][0])).toEqual([
    { position: 0, relation: 41, attribute: 1 }, { position: 2, relation: 42, attribute: 1 },
    { position: 3, relation: 43, attribute: 1 },
  ]);
});
