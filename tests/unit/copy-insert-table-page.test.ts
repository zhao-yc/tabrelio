import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers/copyInsertPage';
import { prepareCopyPrimaryKeyQuery, prepareCopyUpdateSql } from '../../src/renderer/copyInsertSql';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

describe('仅复制明确表页中已加载的未修改行', () => {
  it('无键表和只读引擎也能本地复制，按页顺序复制当前/选中行，不扩展整表', () => {
    const f = fixture(); expect(f.prepare().rows).toEqual([f.page.rows[0]]);
    expect(f.prepare(new Set(['行1', '行0'])).rows).toEqual(f.page.rows);
    expect(f.prepare().rows).not.toBe(f.page.rows); expect(f.page.hasMore).toBe(true);
  });
  it.each(['view', 'unknown', 'database', 'table', 'version', 'generation', 'metadata', 'page-object', 'busy', 'stale', 'unloaded', 'missing-source', 'missing-columns', 'original'])('%s 归属不成立时拒绝', condition => {
    const f = fixture();
    if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'unknown') delete f.info.objectKind;
    else if (condition === 'database') f.context.target.database = '另库'; else if (condition === 'table') f.context.target.table = '另表';
    else if (condition === 'version') f.context.connectionVersion++; else if (condition === 'generation') f.context.generation++;
    else if (condition === 'metadata') f.info.columns[1].comment = '目录已改变'; else if (condition === 'page-object') f.binding.page = { ...f.page };
    else if (condition === 'busy') f.context.busy = true; else if (condition === 'stale') f.context.stale = true; else if (condition === 'unloaded') f.context.loaded = false;
    else if (condition === 'missing-source') delete f.page.copySource; else if (condition === 'missing-columns') f.page.copySource!.missingColumns = ['值']; else f.rows[0].original!.值 = '旧快照被替换';
    expect(() => f.prepare()).toThrow();
  });
  it.each(['inserted', 'deleted', 'modified', 'missing', 'unknown'])('所选行 %s 草稿整次拒绝，不静默省略', condition => {
    const f = fixture();
    if (condition === 'inserted') f.rows[0].inserted = true; else if (condition === 'deleted') f.rows[0].deleted = true; else if (condition === 'modified') f.rows[0].data.值 = '草稿'; else if (condition === 'missing') delete f.rows[0].data.值; else f.rows[0].data.其他 = '额外值';
    expect(() => f.prepare(new Set(['行0', '行1']))).toThrow(); expect(f.rows).toHaveLength(2);
  });
  it('未勾选的草稿不混入原值复制，返回快照不随之后的本地修改改变', () => {
    const f = fixture(); f.rows[1].data.值 = '未勾选草稿'; const input = f.prepare();
    f.rows[0].original!.值 = '后来变化'; f.rows[0].data.值 = '后来草稿'; expect(input.rows[0].值).toBe('甲');
  });
  it('空选择、失效 UUID、缺失目录字段和未知结果列不能推断为完整 INSERT', () => {
    const f = fixture(); expect(() => f.prepare(new Set())).toThrow(); expect(() => f.prepare(new Set(['其他UUID']))).toThrow();
    delete f.page.rows[0].值; delete f.rows[0].original!.值; delete f.rows[0].data.值; expect(() => f.prepare()).toThrow('缺少字段');
  });
});

describe('MySQL 和 MariaDB 原主键查询复制', () => {
  function source() {
    const f = fixture();
    f.info.primaryKey = ['值', 'id', 'stamp', 'bit'];
    f.info.columns[0].type = 'bigint unsigned';
    f.info.columns[1].type = 'varchar(32)';
    f.info.columns.push({ ...f.info.columns[0], name: 'stamp', type: 'timestamp(6)' },
      { ...f.info.columns[0], name: 'bit', type: 'bit(64)' });
    f.page.copyMetadataKey = tableCopyMetadataKey(f.info);
    f.page.rows = [
      { id: '18446744073709551615', 值: "É'\\", stamp: '2024-06-02 12:34:56.123456', bit: { type: 'binary', base64: '//////////8=' } },
      { id: '18446744073709551614', 值: '', stamp: '2024-06-02 12:34:57.123456', bit: { type: 'binary', base64: 'AAAAAAAAAAA=' } },
    ];
    f.page.primaryKeyEpochs = [{ stamp: '1717331696.123456' }, { stamp: '1717331697.123456' }];
    f.rows.forEach((row, index) => { row.original = structuredClone(f.page.rows[index]); row.data = structuredClone(f.page.rows[index]); });
    const copy = (ids = new Set(['行0', '行1'])) => prepareCopyPrimaryKeyQuery(f.context, f.binding, f.page, f.rows, ids);
    return { ...f, copy };
  }

  it('按目录主键顺序生成复合条件，使用原键而不使用已编辑值', () => {
    const f = source();
    f.rows[0].data.id = '7';
    const sql = f.copy(new Set(['行1', '行0']));
    expect(sql).toContain("WHERE (`值` = _utf8mb4 X'c389275c' AND `id` = CAST(CAST(18446744073709551615 AS DECIMAL(20,0)) AS UNSIGNED)");
    expect(sql).toContain("UNIX_TIMESTAMP(`stamp`) = CAST(1717331696.123456 AS DECIMAL(20,6))");
    expect(sql).toContain("`bit` = CAST(CAST(18446744073709551615 AS DECIMAL(20,0)) AS UNSIGNED)");
    expect(sql).toContain("\n   OR (`值` = _utf8mb4 X''");
  });

  it('拒绝缺失时刻、修改的原快照、未知行与不可靠浮点键', () => {
    const f = source();
    delete f.page.primaryKeyEpochs![1].stamp;
    expect(() => f.copy()).toThrow('缺少原主键值');
    expect(() => f.copy(new Set(['行0', '后来行']))).toThrow('有效行');
    f.rows[0].original!.id = '1';
    expect(() => f.copy(new Set(['行0']))).toThrow('主键目录');
    f.rows[0].original = structuredClone(f.page.rows[0]);
    f.info.columns[0].type = 'double';
    f.page.copyMetadataKey = tableCopyMetadataKey(f.info);
    expect(() => f.copy(new Set(['行0']))).toThrow('无法保真');
  });

  it('UPDATE 沿用时刻及复合主键谓词，按本页顺序只写普通非键字段', () => {
    const f = source();
    // 完整原页的引擎回包没有补读租约，UPDATE 逐列核对原值即可。
    delete f.page.copySource;
    f.info.columns.push({ ...f.info.columns[1], name: 'note' }, { ...f.info.columns[0], name: 'generated', generated: true });
    f.page.copyMetadataKey = tableCopyMetadataKey(f.info);
    f.page.rows = f.page.rows.map((row, index) => ({ ...row, note: index === 0 ? "a'\\b" : '', generated: '100' }));
    f.rows.forEach((row, index) => { row.original = structuredClone(f.page.rows[index]); row.data = structuredClone(f.page.rows[index]); });
    const copy = () => prepareCopyUpdateSql(f.context, f.binding, f.page, f.rows, new Set(['行1', '行0']));
    const sql = copy();
    expect(sql.match(/^SET .*$/gm)).toEqual(["SET `note` = _utf8mb4 X'61275c62'", "SET `note` = _utf8mb4 X''"]);
    expect(sql.match(/^WHERE .*;$/gm)).toEqual(f.copy().match(/\([^\n]+\)/g)?.map(line => 'WHERE ' + line + ';'));
    f.rows[0].data.note = '本地修改';
    expect(copy).toThrow('草稿');
  });
});
