import type * as monaco from 'monaco-editor';
import { readPostgresCompletion } from '../../src/engine/postgres/completion';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../src/shared/postgresCompletion';
import { createPostgresCompletionProvider } from '../../src/renderer/postgresCompletionProvider';
import { describe, expect, it, vi } from 'vitest';
import { analyzePostgresCollationHover, analyzePostgresCompletion, analyzePostgresFieldHover, analyzePostgresLocalReferences, analyzePostgresLocalRename,
  analyzePostgresObjectDefinition, analyzePostgresSignature, analyzePostgresTimeZoneHover } from '../../src/renderer/postgresCompletionAnalysis';
import { postgresNamedParameterCompletion, postgresNamedParameterHover } from '../../src/renderer/postgresNamedParameterReferences';
import { postgresConflictExpression } from '../../src/shared/postgresConflictExpression';

/** 测试使用竖线表示编辑器光标，其余 SQL 原样进入生产词法。 */
function at(marked: string) {
  const offset = marked.indexOf('|');
  return analyzePostgresCompletion(marked.slice(0, offset) + marked.slice(offset + 1), offset);
}

it.each([
  ['SELECT created_at AT TIME ZONE | FROM events', '', false],
  ["SELECT created_at AT TIME ZONE 'Asia/|tail' FROM events", 'Asia/', true],
  ["SELECT created_at AT TIME ZONE 'America/New_Y|", 'America/New_Y', true],
  ["SELECT (created_at AT /* gap */ TIME ZONE 'Etc/GMT+|tail') FROM events", 'Etc/GMT+', true],
  ["SET LOCAL TIME ZONE 'Asia/Sh|tail'", 'Asia/Sh', true],
  ["SET SESSION timezone = 'Eu|tail'", 'Eu', true],
  ["SET timezone TO |", '', false],
  ["SELECT pg_catalog.timezone('Asia/Sh|tail', created_at) FROM events", 'Asia/Sh', true],
  ["SELECT date_trunc('day', (SELECT max(created_at) FROM events), |)", '', false],
  ["CREATE VIEW daily AS SELECT date_trunc('day', ts, 'UTC|tail') FROM events", 'UTC', true],
  ["EXPLAIN SELECT ts AT TIME ZONE 'UTC|tail' FROM events", 'UTC', true],
])('命名时区按运算符、函数和会话值槽补全：%s', (sql, prefix, literal) => {
  expect(at(sql)).toMatchObject({prefix, query: {kind: 'timeZones', literal}});
});

it.each([
  "SELECT 'Asia/Sh|tail'", "SELECT '-- AT TIME ZONE a|b'", "SELECT ts AT TIME ZONE E'Asia/Sh|tail'",
  "SELECT ts AT TIME ZONE 'Asia/'\n 'Sh|tail'", "SELECT ts AT TIME ZONE INTERVAL '+08:|00'",
  "SELECT other.timezone('Asia/Sh|tail', ts) FROM t", "SELECT timezone(ts, 'Asia/Sh|tail') FROM t",
  "SELECT date_trunc('da|y', ts, 'UTC') FROM t", "SELECT ts AT TIME ZONE zone_col| FROM t",
  "SELECT t.at TIME ZONE 'Asia/Sh|tail' FROM t", "ALTER ROLE analyst SET TIMEZONE TO 'Asia/Sh|tail'",
])('普通字符串、动态表达式和其他语句保持原有补全：%s', sql => {
  expect(at(sql)?.query?.kind).not.toBe('timeZones');
  expect(analyzePostgresTimeZoneHover(sql.replace('|', ''), sql.indexOf('|'))).toBeUndefined();
});

it('时区整段替换引号与后缀，悬停按精确名称请求数据库快照', async () => {
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({ items: [{kind: 'timeZone', name: 'America/New_York',
    abbreviation: 'EDT', daylight: true, offsetSeconds: -14400}], incomplete: false }));
  const marked = "SELECT timezone('america/new_y|tail', ts) FROM events";
  const exact = editor("SELECT ts AT TIME ZONE 'america/new_y|ork' FROM events", request, '时区会话');
  const edit = editor(marked, request, '时区会话');
  const offlineRequest = vi.fn(async () => ({items: [], incomplete: false}));
  const offline = editor("SET LOCAL TIME ZONE 'ut|tail'", offlineRequest);
  try {
    const item = (await edit.suggest())?.suggestions[0];
    expect(item).toMatchObject({label: {label: 'America/New_York'}, insertText: "'America/New_York'", filterText: "'America/New_York'"});
    if (!item || !('startColumn' in item.range)) throw Error('缺少整段替换范围');
    const source = marked.replace('|', '');
    expect(source.slice(item.range.startColumn - 1, item.range.endColumn - 1)).toBe("'america/new_ytail'");
    const hover = await exact.hover();
    expect(hover?.contents[0]).toMatchObject({supportHtml: false, isTrusted: false});
    expect(hover?.contents[0].value).toContain('查询时 UTC 偏移：UTC-04:00');
    expect(request).toHaveBeenNthCalledWith(1, {kind: 'timeZones', prefix: 'america/new_y', connectionId: '原连接', database: '原库', sessionId: '时区会话'});
    expect(request).toHaveBeenNthCalledWith(2, {kind: 'timeZones', prefix: 'america/new_york', exact: true,
      connectionId: '原连接', database: '原库', sessionId: '时区会话'});
    expect((await offline.suggest())?.suggestions.map(item => item.insertText)).toContain("'UTC'");
    expect(offlineRequest).not.toHaveBeenCalled();
  } finally { for (const current of [exact, edit, offline]) current.provider.dispose(); }
});

it('时区目录按原协议解码偏移秒数和夏令时，准确绑定前缀', async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({rows: [{c0: 'Asia/Kathmandu', c1: '+0545', c2: '20700', c3: 'f'}], truncated: false}));
  const connection = {database: '原库', query} as unknown as PostgresConnection;
  expect(await readPostgresCompletion(connection, {kind: 'timeZones', connectionId: '原连接', database: '原库',
    prefix: 'asia/kathmandu', exact: true})).toEqual({items: [{kind: 'timeZone', name: 'Asia/Kathmandu',
    abbreviation: '+0545', offsetSeconds: 20700, daylight: false}], incomplete: false});
  expect(query.mock.calls.at(-1)?.slice(0, 2)).toEqual([expect.stringContaining('pg_timezone_names'), ['asia/kathmandu', 2, true]]);
});

it.each([
  ['SELECT label COLLATE | FROM records', undefined],
  ['SELECT * FROM records ORDER BY label COLLATE "Locale NS"."Sort|Rule" DESC', 'Locale NS'],
  ['SELECT row_number() OVER (ORDER BY label COLLATE pg_catalog.|) FROM records', 'pg_catalog'],
  ["SELECT 'a' = ('A' COLLATE pub.C|tail)", 'pub'],
  ['CREATE TEMP TABLE t (name text COLLATE loc.C|tail)', 'loc'],
  ['CREATE UNIQUE INDEX i ON t (name COLLATE loc."C|tail")', 'loc'],
  ['ALTER TABLE t ALTER COLUMN c TYPE varchar(7) COLLATE loc.|', 'loc'],
  ['CREATE DOMAIN d AS text COLLATE pub.C|tail', 'pub'],
  ['EXPLAIN (FORMAT JSON) SELECT x FROM t ORDER BY x COLLATE pg_catalog.C|tail', 'pg_catalog'],
])('COLLATE 进入独立排序规则名称空间：%s', (sql, schema) => {
  expect(at(sql)?.query).toEqual({kind: 'collations', ...(schema ? {schema} : {})});
});

it.each([
  'SELECT r.collate | FROM records r', 'SELECT COLLATE c|', 'SELECT \'COLLATE x|\'', 'SELECT 1 /* COLLATE x| */',
  'SELECT label COLLATE catalog.loc.ru|le FROM records',
  'CREATE DATABASE d WITH LC_COLLATE \'C|\'', 'CREATE FUNCTION f() RETURNS text AS $$SELECT \'x\' COLLATE c|$$ LANGUAGE SQL',
])('普通名称、其它命令和引号内部不误用 COLLATE 目录：%s', marked => {
  expect(at(marked)?.query?.kind).not.toBe('collations');
  expect(analyzePostgresCollationHover(marked.replace('|', ''), marked.indexOf('|'))).toBeUndefined();
});

it('排序规则离线插入安全限定名，在线补全和悬停查询实际名称和元数据', async () => {
  const local = vi.fn(async () => ({items: [], incomplete: false}));
  const offline = editor('SELECT label COLLATE "P|tail" FROM records', local);
  const catalog = vi.fn(async (): Promise<PostgresCompletionResult> => ({items: [{kind: 'collation', schema: 'Case Space',
    name: 'Sort Rule', provider: 'i', deterministic: false, locale: '<b>und-u-ks-level2</b>', encoding: null}], incomplete: false}));
  const exact = editor('SELECT label COLLATE "Case Space"."So|rt Rule" FROM records', catalog, '原会话');
  try {
    const qualifier = 'SELECT label COLLATE loc|.Rule FROM records';
    expect(at(qualifier)?.query?.kind).not.toBe('collations');
    expect(analyzePostgresCollationHover(qualifier.replace('|', ''), qualifier.indexOf('|'))).toMatchObject({schema: 'loc', name: 'rule'});
    expect((await offline.suggest())?.suggestions).toMatchObject([{label: {label: 'POSIX'}, insertText: '"pg_catalog"."POSIX"'}]);
    expect(await offline.hover()).toBeNull();
    expect(local).not.toHaveBeenCalled();
    expect((await exact.suggest())?.suggestions).toMatchObject([{label: {label: 'Sort Rule'}, insertText: '"Sort Rule"'}]);
    const hover = await exact.hover();
    expect(hover?.contents[0]).toMatchObject({supportHtml: false, isTrusted: false});
    expect(hover?.contents[0].value).toContain('    排序规则："Case Space"."Sort Rule"');
    expect(hover?.contents[0].value).toContain('    区域设置：<b>und-u-ks-level2</b>');
    expect(catalog).toHaveBeenNthCalledWith(1, {kind: 'collations', prefix: 'So', schema: 'Case Space',
      connectionId: '原连接', database: '原库', sessionId: '原会话'});
    expect(catalog).toHaveBeenNthCalledWith(2, {kind: 'collations', prefix: 'Sort Rule', exact: true, schema: 'Case Space',
      connectionId: '原连接', database: '原库', sessionId: '原会话'});
  } finally { offline.provider.dispose(); exact.provider.dispose(); }
});

it('排序规则目录解码驱动的布尔原文并参数化精确名称', async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({rows: [{c0: 'locale', c1: 'Sort Rule',
    c2: 'i', c3: 'f', c4: 'und-u-ks-level2', c5: null}], truncated: false}));
  const connection = {database: '原库', query} as unknown as PostgresConnection;
  expect(await readPostgresCompletion(connection, {kind: 'collations', connectionId: '原连接', database: '原库',
    prefix: 'Sort Rule', schema: 'locale', exact: true})).toEqual({items: [{kind: 'collation', schema: 'locale', name: 'Sort Rule',
    provider: 'i', deterministic: false, locale: 'und-u-ks-level2', encoding: null}], incomplete: false});
  expect(query.mock.calls.at(-1)?.slice(0, 2)).toEqual([expect.stringContaining('pg_collation_is_visible'), ['Sort Rule', 'locale', 2, true]]);
});

const recursiveWalk = 'WITH RECURSIVE walk(node_id,parent_id) AS (SELECT 1 AS n,2 AS p UNION ALL ' +
  'SELECT w.parent_id,0 FROM walk w WHERE w.node_id<2)';

it('SEARCH 和 CYCLE 的键只用当前 CTE 的原投影，生成列按查询层级展开', async () => {
  const clauses = ' SEARCH BREADTH FIRST BY node_id SET order_seq CYCLE node_id SET looped TO \'cycle\' DEFAULT \'new\' USING visited';
  const partial = editor(recursiveWalk + ' SEARCH BREADTH FIRST BY node_id, par|tail SET order_seq' +
    ' CYCLE node_id SET looped USING visited SELECT * FROM walk', async () => ({items: [], incomplete: false}));
  try {
    expect((await partial.suggest())?.suggestions).toMatchObject([{label: {label: 'parent_id'}, insertText: '"parent_id"'}]);
  } finally { partial.provider.dispose(); }
  expect(at(recursiveWalk + ' CYCLE no|')?.query).toMatchObject({kind: 'recursiveKeys', names: ['node_id', 'parent_id']});
  expect(at(recursiveWalk + clauses + ', output AS (SELECT w.*,w.order_seq,w.looped,w.visited FROM walk w) SELECT o.| FROM output o')?.query)
    .toMatchObject({kind: 'columns', relations: [{projection: {names: ['node_id', 'parent_id', 'order_seq', 'looped', 'visited']}}]});
  expect(at(recursiveWalk + clauses + ', output AS (SELECT w.* FROM walk w) SELECT o.| FROM output o')?.query)
    .toMatchObject({kind: 'columns', relations: [{projection: {names: ['node_id', 'parent_id']}}]});
  expect(at(recursiveWalk + clauses + ' SELECT o.| FROM (SELECT * FROM walk) o')?.query)
    .toMatchObject({kind: 'columns', relations: [{projection: {names: ['node_id', 'parent_id']}}]});
  expect(at(recursiveWalk.replace('w.node_id<2', 'w.|<2') + clauses + ' SELECT * FROM walk')?.query)
    .toMatchObject({kind: 'columns', relations: [{projection: {names: ['node_id', 'parent_id', 'order_seq', 'looped', 'visited'],
      starProjection: {names: ['node_id', 'parent_id']}}}]});
  expect(at(recursiveWalk + ' CYCLE node_id SET node_id USING visited SELECT w.| FROM walk w')?.query).toBeUndefined();
  const reservedLike = recursiveWalk.replaceAll('node_id', 'set').replace('w.set<2', 'w."set"<2');
  expect(at(reservedLike + ' CYCLE set SET looped USING visited SELECT w.lo|oped FROM walk w')?.query)
    .toMatchObject({kind: 'columns', relations: [{projection: {names: ['set', 'parent_id', 'looped', 'visited']}}]});
});

it('递归键通配符请求真实来源目录，重复及已用的列退出候选', async () => {
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({items: [
    {kind: 'joinColumns', reference: 0, names: ['used', 'kept', 'ambiguous']},
  ], incomplete: false}));
  const edit = editor('WITH RECURSIVE walk AS (SELECT a.*,1 AS ambiguous FROM app.nodes a UNION ALL SELECT w.* FROM walk w)' +
    ' CYCLE used, | SET looped USING visited SELECT * FROM walk', request, '原会话');
  try {
    expect((await edit.suggest())?.suggestions).toMatchObject([{label: {label: 'kept'}, insertText: '"kept"'}]);
    expect(request).toHaveBeenCalledWith({kind: 'joinColumns', prefix: '', connectionId: '原连接', database: '原库',
      sessionId: '原会话', relations: [{name: 'nodes', schema: 'app'}]});
  } finally { edit.provider.dispose(); }
});

it('递归键和生成列沿原声明定位，整组改名保留另一个名称空间', () => {
  const sql = recursiveWalk + ' SEARCH DEPTH FIRST BY node_id SET seq CYCLE node_id SET looped USING visited ' +
    'SELECT r.looped FROM (SELECT w.*,w.looped,w.seq FROM walk w) r ORDER BY r.seq';
  const generated = sql.lastIndexOf('seq');
  const declaration = sql.indexOf('seq');
  expect(analyzePostgresLocalReferences(sql, generated)).toMatchObject({status: 'ready',
    declaration: {start: declaration, end: declaration + 'seq'.length}});
  expect(analyzePostgresLocalRename(sql, generated, true, 'search_order')).toMatchObject({status: 'ready', kind: 'column', edits: [
    {start: declaration, text: '"search_order"'}, {start: sql.indexOf('w.seq') + 2, text: '"search_order"'},
    {start: generated, text: '"search_order"'},
  ]});
  const key = sql.indexOf('node_id', sql.indexOf('BY'));
  const renamed = analyzePostgresLocalRename(sql, key, true, 'new_key');
  expect(renamed).toMatchObject({status: 'ready', kind: 'column'});
  if (renamed.status === 'ready') expect(renamed.edits).toHaveLength(4);
  expect(analyzePostgresObjectDefinition(sql, sql.indexOf('walk w'))).toBeUndefined();
});

it('TABLESAMPLE 按方法槽和原查询表达式分派，抽样后的别名与物理来源可导航', () => {
  expect(at('SELECT * FROM app.jobs j TABLESAMPLE |')?.query).toEqual({kind: 'sampleMethods'});
  expect(at('SELECT * FROM app.jobs AS j(id) TABLESAMPLE "方法"."Ca|se" /* 描述 */ (10)')?.query)
    .toEqual({kind: 'sampleMethods', schema: '方法'});
  expect(at('SELECT * FROM app.jobs j TABLESAMPLE sys|tem (10)')?.existingCall).toBe(true);
  expect(at('WITH q AS (SELECT 1) SELECT * FROM q TABLESAMPLE sys|')?.query?.kind).not.toBe('sampleMethods');
  expect(at('SELECT * FROM app.jobs j TABLESAMPLE system(j.i|d)')?.query).toBeUndefined();
  expect(at('SELECT * FROM app.inputs p, app.jobs j TABLESAMPLE system(p.s|eed)')?.query).toBeUndefined();
  expect(at('SELECT (SELECT count(*) FROM app.jobs j TABLESAMPLE system(10) REPEATABLE (p.i|d)) FROM app.inputs p')?.query)
    .toMatchObject({kind: 'columns', relations: [{name: 'inputs', schema: 'app', alias: 'p'}]});
  expect(at('SELECT j.i|d FROM app.jobs j TABLESAMPLE pg_catalog.system(100) REPEATABLE (1)')?.query)
    .toMatchObject({kind: 'columns', relations: [{name: 'jobs', schema: 'app', alias: 'j'}]});
  const sql = 'SELECT j.id FROM app.jobs j TABLESAMPLE pg_catalog.system(100) REPEATABLE (2) WHERE j.id > 0';
  expect(analyzePostgresLocalReferences(sql, sql.indexOf('j.id'))).toMatchObject({status: 'ready',
    declaration: {start: sql.indexOf('j TABLESAMPLE'), end: sql.indexOf('j TABLESAMPLE') + 1}});
  expect(analyzePostgresObjectDefinition(sql, sql.indexOf('jobs'))).toMatchObject({name: 'jobs', schema: 'app'});
  expect(analyzePostgresFieldHover(sql, sql.indexOf('j.id') + 2)).toMatchObject({name: 'id', relations: [{name: 'jobs', schema: 'app', alias: 'j'}]});
  expect(analyzePostgresObjectDefinition(sql, sql.indexOf('system'))).toBeUndefined();
});

it('离线抽样补全显式限定内置方法，并保留已经写好的参数括号', async () => {
  const request = vi.fn(async () => ({items: [], incomplete: false}));
  const ready = editor('SELECT * FROM jobs TABLESAMPLE sys|tail (100)', request);
  const bare = editor('SELECT * FROM jobs TABLESAMPLE ber|tail', request);
  const unknown = editor('SELECT * FROM jobs TABLESAMPLE ext.sys|tail', request);
  try {
    expect((await ready.suggest())?.suggestions).toMatchObject([{label: {label: 'system'}, insertText: '"pg_catalog"."system"'}]);
    expect((await bare.suggest())?.suggestions).toMatchObject([{label: {label: 'bernoulli'}, insertText: '"pg_catalog"."bernoulli"($0)'}]);
    expect((await unknown.suggest())?.suggestions).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  } finally { for (const edit of [ready, bare, unknown]) edit.provider.dispose(); }
});

it('只向原会话请求抽样目录目标，引用方法不暴露 handler 的伪参数', async () => {
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({items: [
    {kind: 'sampleMethod', schema: 'custom', name: 'Case$'}, {kind: 'sampleMethod', schema: 'custom', name: 'caseOther'},
  ], incomplete: false}));
  const edit = editor('SELECT * FROM jobs TABLESAMPLE custom."Ca|tail"', request, '抽样会话');
  try {
    expect((await edit.suggest())?.suggestions).toMatchObject([{label: {label: 'Case$'}, insertText: '"Case\\$"($0)'}]);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({kind: 'sampleMethods', schema: 'custom', prefix: 'Ca',
      connectionId: '原连接', database: '原库', sessionId: '抽样会话'});
  } finally { edit.provider.dispose(); }
});

it.each([
  ['SELECT * FROM jobs FOR |', ['UPDATE', 'NO KEY UPDATE', 'SHARE', 'KEY SHARE']],
  ['TABLE jobs FOR UPDATE |', ['NOWAIT', 'OF', 'SKIP LOCKED']],
  ['SELECT * FROM jobs q FOR UPDATE OF q |', ['NOWAIT', 'SKIP LOCKED']],
  ['SELECT * FROM jobs q ORDER BY q.id FETCH FIRST 2 ROWS WITH TIES FOR SHARE OF q |', ['NOWAIT']],
  ['SELECT * FROM jobs FOR UPDATE | LIMIT 2', ['NOWAIT', 'OF', 'SKIP LOCKED']],
  ['SELECT * FROM jobs FOR UPDATE | NOWAIT', []],
  ['SELECT * FROM jobs q ORDER BY id FOR UPDATE OF q SK|IP LOCKED FETCH FIRST 2 ROWS WITH TIES', []],
])('行锁提示由当前子句和已经写好的选项决定：%s', (sql, items) => {
  expect(at(sql)?.query).toEqual({kind: 'lockKeywords', items});
});

it.each([
  ['SELECT * FROM jobs FOR N|suffix', 'NO KEY UPDATE', 'SELECT * FROM jobs FOR NO KEY UPDATE'],
  ['SELECT * FROM jobs FOR N|O KEY UPDATE', 'NO', 'SELECT * FROM jobs FOR NO KEY UPDATE'],
  ['SELECT * FROM jobs FOR NO K|tail /* 保留 */ UPDATE OF jobs', 'KEY', 'SELECT * FROM jobs FOR NO KEY /* 保留 */ UPDATE OF jobs'],
  ['SELECT * FROM jobs FOR K|tail SHARE', 'KEY', 'SELECT * FROM jobs FOR KEY SHARE'],
  ['SELECT * FROM jobs FOR KEY S|tail', 'SHARE', 'SELECT * FROM jobs FOR KEY SHARE'],
  ['SELECT * FROM jobs FOR SHARE O|tail jobs', 'OF', 'SELECT * FROM jobs FOR SHARE OF jobs'],
  ['SELECT * FROM jobs FOR NO KEY UPDATE OF jobs N|tail', 'NOWAIT', 'SELECT * FROM jobs FOR NO KEY UPDATE OF jobs NOWAIT'],
  ['SELECT * FROM jobs FOR UPDATE OF jobs SK|tail LOCKED', 'SKIP', 'SELECT * FROM jobs FOR UPDATE OF jobs SKIP LOCKED'],
  ['SELECT * FROM jobs FOR UPDATE OF jobs SKIP L|tail', 'LOCKED', 'SELECT * FROM jobs FOR UPDATE OF jobs SKIP LOCKED'],
  ['SELECT (SELECT id FROM jobs FOR SHARE SK|tail)', 'SKIP LOCKED', 'SELECT (SELECT id FROM jobs FOR SHARE SKIP LOCKED)'],
  ['PREPARE p AS WITH a AS (SELECT 1) SELECT * FROM jobs FOR UPDATE NOWAIT FOR SHARE SK|tail', 'SKIP LOCKED',
    'PREPARE p AS WITH a AS (SELECT 1) SELECT * FROM jobs FOR UPDATE NOWAIT FOR SHARE SKIP LOCKED'],
  ['INSERT INTO outbox SELECT * FROM jobs FOR SHARE N|tail', 'NOWAIT', 'INSERT INTO outbox SELECT * FROM jobs FOR SHARE NOWAIT'],
])('按原文范围补齐行锁短语且离线无目录请求：%s', async (marked, label, expected) => {
  const request = vi.fn(async () => ({items: [], incomplete: false}));
  const { provider, suggest } = editor(marked, request);
  try {
    const item = (await suggest())?.suggestions.find(candidate => candidate.label === label);
    if (!item || !('startColumn' in item.range)) throw Error('缺少行锁短语与单一替换范围');
    const source = marked.replace('|', '');
    expect(source.slice(0, item.range.startColumn - 1) + item.insertText + source.slice(item.range.endColumn - 1)).toBe(expected);
    expect(request).not.toHaveBeenCalled();
  } finally { provider.dispose(); }
});

it.each([
  'SELECT DISTINCT id FROM jobs FOR U|', 'SELECT id FROM jobs GROUP BY id FOR U|',
  'SELECT id FROM jobs UNION ALL SELECT id FROM archive FOR U|', 'SELECT id FROM jobs FOR READ O|',
  'SELECT * FROM jobs q FOR UPDATE OF q, n|', 'SELECT * FROM jobs q FOR UPDATE OF q, | n',
  'SELECT * FROM jobs q FOR UPDATE OF q."N|"', 'SELECT * FROM jobs FOR UPDATE LIMIT n|',
  'SELECT * FROM jobs FOR UPDATE | ORDER BY id', 'SELECT substring(label FROM 1 FOR n|) FROM jobs',
])('行锁短语跳过普通表达式、目标名和不兼容查询：%s', sql => {
  const query = at(sql)?.query;
  expect(query?.kind === 'lockKeywords' ? query.items : []).toEqual([]);
});

it.each([
  ['SELECT * FROM app.job AS "Job" FOR NO KEY UPDATE OF "Jo|b" NOWAIT', ['Job']],
  ['SELECT * FROM a CROSS JOIN b CROSS JOIN c FOR KEY SHARE OF a, |, c SKIP LOCKED', ['b']],
  ['SELECT * FROM a LEFT JOIN b USING (id) AS j FOR UPDATE OF |', ['a']],
  ['SELECT * FROM a RIGHT JOIN b ON a.k=b.k FOR SHARE OF |', ['b']],
  ['SELECT * FROM (a JOIN b ON a.k=b.k) pair FOR UPDATE OF |', ['a', 'b']],
  ['SELECT * FROM a FULL OUTER JOIN b ON a.k=b.k FOR UPDATE OF |', []],
  ['WITH shadow AS (SELECT 1 n) SELECT * FROM shadow JOIN a q ON true, (VALUES (1)) v(n), generate_series(1,2) g, (SELECT * FROM b) d FOR UPDATE OF |', ['q', 'd']],
  ['SELECT (SELECT i.id FROM a i FOR UPDATE OF |) FROM b outer_row', ['i']],
  ['SELECT * FROM a CROSS JOIN b FOR UPDATE OF a NOWAIT FOR SHARE OF | LIMIT 10', ['a', 'b']],
  ['TABLE app.jobs FOR UPDATE OF | SKIP LOCKED', ['jobs']],
  ['SELECT * FROM a FOR UPDATE OF s.a|', []],
  ['SELECT DISTINCT id FROM a FOR UPDATE OF |', []],
  ['SELECT id FROM a UNION SELECT id FROM b FOR UPDATE OF |', []],
  ['SELECT id FROM a UNION (SELECT id FROM b FOR UPDATE OF |)', ['b']],
])('行锁 OF 按原查询关系和 JOIN 类型给出裸名称：%s', (sql, names) => {
  expect(at(sql)?.query).toEqual({kind: 'lockTargets', names});
});

it('定位行锁引用时区分别名与裸物理对象，整组改名更新 OF 清单', () => {
  const source = 'SELECT q.id FROM app.jobs q JOIN app.meta ON q.id=meta.id FOR UPDATE OF q, meta NOWAIT';
  const offset = source.lastIndexOf('q,');
  const declaration = source.indexOf(' q JOIN') + 1;
  expect(analyzePostgresLocalReferences(source, offset)).toMatchObject({ status: 'ready', declaration: {start: declaration, end: declaration + 1} });
  expect(analyzePostgresLocalRename(source, offset, true, 'claim')).toMatchObject({ status: 'ready', kind: 'alias', edits: [
    {start: source.indexOf('q.id'), text: '"claim"'}, {start: declaration, text: '"claim"'},
    {start: source.lastIndexOf('q.id'), text: '"claim"'}, {start: offset, text: '"claim"'},
  ] });
  expect(analyzePostgresObjectDefinition(source, source.lastIndexOf('meta') + 1)).toMatchObject({ name: 'meta', schema: 'app' });
});

it('行锁目标整词替换并保留带引号大小写，离线补全无需目录', async () => {
  const request = vi.fn(async () => ({items: [], incomplete: false}));
  const edit = editor('SELECT * FROM jobs AS "Job Queue", stats s FOR UPDATE OF "Jo|unk" NOWAIT', request);
  try {
    expect((await edit.suggest())?.suggestions).toMatchObject([{label: {label: 'Job Queue'}, insertText: '"Job Queue"'}]);
    expect(request).not.toHaveBeenCalled();
  } finally { edit.provider.dispose(); }
});

it.each([
  'CREATE LOCAL TEMP TABLE IF NOT EXISTS stage(amount) USING heap WITH (fillfactor=90) ON COMMIT PRESERVE ROWS AS SELECT q.am|ount FROM public.records q WITH NO DATA',
  'CREATE UNLOGGED TABLE "stage" USING heap WITHOUT OIDS TABLESPACE pg_default AS SELECT q.am|ount FROM public.records q WITH DATA',
  'CREATE OR REPLACE TEMP VIEW "as"(total) WITH (security_invoker=true) AS SELECT q.am|ount FROM public.records q WITH CASCADED CHECK OPTION',
  'CREATE MATERIALIZED VIEW IF NOT EXISTS public.stage(total) USING heap WITH (fillfactor=80) TABLESPACE pg_default AS (SELECT q.am|ount FROM public.records q) WITH NO DATA',
  'EXPLAIN (FORMAT JSON) CREATE TEMP TABLE stage AS SELECT q.am|ount FROM public.records q',
  'EXPLAIN VERBOSE CREATE MATERIALIZED VIEW stage AS SELECT q.am|ount FROM public.records q WITH DATA',
])('创建关系的查询正文沿用语义范围：%s', marked => {
  const sql = marked.replace('|', ''), offset = marked.indexOf('|');
  const result = at(marked)!;
  expect(result.query).toEqual({ kind: 'columns', qualified: true, relations: [{ name: 'records', schema: 'public', alias: 'q' }] });
  expect(sql.slice(result.start, result.end)).toBe('amount');
  expect(analyzePostgresFieldHover(sql, offset)).toMatchObject({ name: 'amount', relations: [{ name: 'records', schema: 'public', alias: 'q' }] });
  expect(analyzePostgresObjectDefinition(sql, sql.indexOf('records') + 1)).toMatchObject({ name: 'records', schema: 'public' });
});

it.each([
  'CREATE TABLE st|age AS SELECT q.amount FROM public.records q',
  'CREATE TABLE stage (am|ount) AS SELECT q.amount FROM public.records q',
  'CREATE TABLE stage AS SELECT q.amount FROM public.records q WITH NO DA|TA',
  'CREATE VIEW stage WITH (security_in|voker=true) AS SELECT q.amount FROM public.records q',
  'CREATE VIEW stage AS SELECT q.amount FROM public.records q WITH LOCAL CH|ECK OPTION',
  'CREATE TABLE stage (amount int GENERATED ALWAYS AS (q.am|ount) STORED)',
  'CREATE FUNCTION stage() RETURNS int LANGUAGE SQL AS $$SELECT q.am|ount FROM public.records q$$',
  'CREATE VIEW stage AS UPDATE public.records SET am|ount=1 RETURNING amount',
  'EXPLAIN CREATE VIEW stage AS SELECT q.am|ount FROM public.records q',
])('创建语句的定义头、尾部选项和其他语法保持查询隔离：%s', marked => {
  expect(at(marked)?.query).toBeUndefined();
  expect(analyzePostgresFieldHover(marked.replace('|', ''), marked.indexOf('|'))).toBeUndefined();
});

it('递归视图继承明确列和锚点输出，裸自引用与同名物理来源分开', () => {
  const marked = 'CREATE OR REPLACE RECURSIVE VIEW public."Walk"(step_no) AS (WITH seed AS (SELECT 1 AS start_no) ' +
    'SELECT seed.start_no, 10 AS step_limit FROM seed UNION ALL SELECT w.st|ep_no+1, w.step_limit ' +
    'FROM "Walk" w WHERE w.step_no < (SELECT max(a.amount) FROM archive."Walk" a))';
  const sql = marked.replace('|', ''), column = marked.indexOf('|');
  expect(at(marked)?.query).toMatchObject({ kind: 'columns', qualified: true,
    relations: [{ name: 'Walk', alias: 'w', projection: { names: ['step_no', 'step_limit'], stars: [], exact: true } }] });
  const declaredColumn = sql.indexOf('step_no');
  expect(analyzePostgresLocalReferences(sql, column)).toMatchObject({ status: 'ready', declaration: {
    start: declaredColumn, end: declaredColumn + 'step_no'.length } });
  const recursive = sql.indexOf('FROM "Walk"') + 'FROM "'.length;
  const declaredView = sql.indexOf('"Walk"');
  expect(analyzePostgresLocalReferences(sql, recursive)).toMatchObject({ status: 'ready', declaration: {
    start: declaredView, end: declaredView + '"Walk"'.length } });
  expect(analyzePostgresLocalRename(sql, column, true, 'next_step').status).toBe('blocked');
  expect(analyzePostgresLocalRename(sql, recursive, true, 'NextWalk').status).toBe('blocked');
  expect(analyzePostgresObjectDefinition(sql, recursive)).toBeUndefined();
  expect(analyzePostgresObjectDefinition(sql, sql.lastIndexOf('"Walk"') + 1)).toMatchObject({ name: 'Walk', schema: 'archive' });
});

it.each([
  'EXPLAIN (FORMAT JSON, COSTS OFF) SELECT q.am|ount FROM public.records q',
  'EXPLAIN ANALYSE VERBOSE SELECT q.am|ount FROM public.records q',
  'EXPLAIN (SELECT q.am|ount FROM public.records q)',
  'EXPLAIN (FORMAT JSON) DECLARE c CURSOR FOR SELECT q.am|ount FROM public.records q',
  'PREPARE "plan" (numeric(20,4), double precision) AS SELECT q.am|ount FROM public.records q WHERE q.amount > $1',
  'DECLARE "cursor" BINARY NO SCROLL CURSOR WITH HOLD FOR SELECT q.am|ount FROM public.records q',
  'COPY (SELECT q.am|ount FROM public.records q) TO STDOUT WITH (FORMAT CSV)',
  'SELECT 1; COPY (SELECT q.am|ount FROM public.records q',
])('查询正文保留关系作用域和原文替换范围：%s', marked => {
  const analysis = at(marked)!;
  expect(analysis.query).toEqual({ kind: 'columns', qualified: true, relations: [{ name: 'records', schema: 'public', alias: 'q' }] });
  expect(marked.replace('|', '').slice(analysis.start, analysis.end)).toBe('amount');
});

it('包装语句沿用局部引用、目录导航、函数参数及普通写入权限', () => {
  const marked = 'SELECT 1; COPY (WITH local_data AS (SELECT v.amount FROM public.records v) SELECT * FROM local_|data) TO STDOUT';
  const query = marked.replace('|', '');
  const declaration = query.indexOf('local_data');
  expect(analyzePostgresLocalReferences(query, marked.indexOf('|'))).toMatchObject({ status: 'ready',
    declaration: { start: declaration, end: declaration + 'local_data'.length } });
  expect(analyzePostgresObjectDefinition(query, query.indexOf('records') + 3)).toMatchObject({ schema: 'public', name: 'records' });
  expect(analyzePostgresFieldHover(query, query.indexOf('amount') + 3)).toMatchObject({ name: 'amount',
    relations: [{ schema: 'public', name: 'records', alias: 'v' }] });
  const call = 'PREPARE p AS SELECT sum(|) FROM public.records';
  expect(analyzePostgresSignature(call.replace('|', ''), call.indexOf('|'))).toMatchObject({ name: 'sum', argument: 0 });
  expect(at('EXPLAIN (FORMAT JSON) UPDATE public.records SET am|ount = 1')?.query).toMatchObject({
    kind: 'columns', relations: [{ name: 'records', schema: 'public', columnAccess: 'update' }] });
  expect(at('COPY (UPDATE public.records r SET amount=1 RETURNING r.am|ount) TO STDOUT')?.query).toMatchObject({
    kind: 'columns', relations: [{ name: 'records', schema: 'public', alias: 'r', columnAccess: 'select' }] });
  expect(at('DECLARE c CURSOR FOR SELECT q.amount FROM public.records q ORDER BY q.amount NULLS F|')?.keywords).toEqual(['FIRST']);
});

it.each([
  'EXPLAIN (FORM|AT JSON) SELECT q.amount FROM public.records q',
  'EXPLAIN (FORMAT JSON SELECT q.am|ount FROM public.records q',
  'PREPARE p (numeric(20,4), pub|lic.numeric) AS SELECT amount FROM public.records',
  'DECLARE c INSEN|SITIVE CURSOR FOR SELECT amount FROM public.records',
  'DECLARE c CURSOR FOR UPDATE public.records SET am|ount = 1',
  'COPY (SELECT q.amount FROM public.records q) TO STD|OUT',
  'COPY (SELECT q.am|ount FROM public.records q) FROM STDIN',
  'COPY public.records (am|ount) TO STDOUT',
])('包装选项、目标和无效正文没有查询语义：%s', marked => {
  expect(at(marked)?.query).toBeUndefined();
  expect(analyzePostgresFieldHover(marked.replace('|', ''), marked.indexOf('|'))).toBeUndefined();
});

it('对象定义只解析光标所在关系原名，保留限定名称及嵌套作用域', () => {
  const relation = (marked: string, mode?: boolean) => analyzePostgresObjectDefinition(marked.replace('|', ''), marked.indexOf('|'), mode);
  expect(relation('SELECT 7; WITH items AS (SELECT * FROM "Case"."Na|me") SELECT * FROM items'))
    .toMatchObject({ schema: 'Case', name: 'Name' });
  expect(relation('SELECT [$x] FROM PUBL|IC.Orders o')).toMatchObject({ schema: 'public', name: 'orders' });
  expect(relation('WITH items AS (SELECT 1) SELECT * FROM it|ems')).toBeUndefined();
  expect(relation('SELECT t.id FROM things AS |t')).toBeUndefined();
  expect(relation('SELECT * FROM app.gen|erate(1)')).toBeUndefined();
  expect(relation('SELECT * FROM "table" WHERE id = \"s|tr\"')).toBeUndefined();
  expect(relation('WITH target AS (SELECT 1) UPDATE tar|get SET value=1')).toMatchObject({ name: 'target' });
  expect(relation('INSERT INTO "Case".tar|get (value) VALUES (1)')).toMatchObject({ schema: 'Case', name: 'target' });
  expect(relation('MERGE INTO app.t USING app.so|urce s ON t.id = s.id WHEN MATCHED THEN DELETE')).toMatchObject({ schema: 'app', name: 'source' });
  const ambiguous = "SELECT 'a\\'; SELECT * FROM tab|le_name; -- '";
  expect(relation(ambiguous, true)).toMatchObject({ name: 'table_name' });
  expect(relation(ambiguous)).toBeUndefined();
});

it('字段悬停解析精确名称、可见层及候选关系，避开别名声明、类型和本地投影', () => {
  const field = (marked: string) => analyzePostgresFieldHover(marked.replace('|', ''), marked.indexOf('|'));
  expect(field('SELECT x."Am|ount" FROM app.orders AS x')).toMatchObject({ name: 'Amount', relations: [{ schema: 'app', name: 'orders', alias: 'x' }] });
  expect(field('SELECT app.orders.aM|OUNT FROM app.orders')).toMatchObject({ name: 'amount', relations: [{ schema: 'app', name: 'orders' }] });
  expect(field('SELECT (SELECT x.a|mt FROM app.inner_table x) FROM app.outer_table x')).toMatchObject({ relations: [{ name: 'inner_table' }] });
  expect(field('SELECT a.id FROM public.a a JOIN public.b b ON a.id=b.id WHERE aM|OUNT>1'))
    .toMatchObject({ name: 'amount', relations: [{ name: 'a', alias: 'a' }, { name: 'b', alias: 'b' }] });
  expect(field('INSERT INTO accounts (amount) VALUES (1) RETURNING new.a|mount')).toMatchObject({ name: 'amount', relations: [{ name: 'accounts', alias: 'new' }] });
  for (const sample of [
    'WITH x AS (SELECT 1 id) SELECT x.i|d FROM x', 'SELECT x.i|d FROM (SELECT 1 id) x',
    'SELECT x.i|d FROM app.orders AS x(id)', 'SELECT x.id::x.i|d FROM app.orders x',
    'SELECT 1 AS am|ount FROM app.orders', 'SELECT 1 AS amount FROM app.orders ORDER BY am|ount',
    'SELECT i|d FROM a JOIN b USING (id)', 'SELECT a.id FROM a, b JOIN c ON a.i|d=c.id',
    'SELECT app.o|rders.id FROM app.orders', 'SELECT x.i|d(1) FROM app.orders x',
  ]) expect(field(sample), sample).toBeUndefined();
});

it('参数定位识别最近调用、命名参数、数组和嵌套逗号', () => {
  const signature = (marked: string) => analyzePostgresSignature(marked.replace('|', ''), marked.indexOf('|'));
  expect(signature(`SELECT "工具"."Mix"(ARRAY[1, 2], nested('a,b', 4), "标记" => |)`)).toMatchObject({
    name: 'Mix', routine: { context: 'expression', schema: '工具' }, argument: 2, named: '标记', previousNames: [],
  });
  expect(signature('CALL tool.PROC(z => 1, a := |)')).toMatchObject({ name: 'proc', routine: { context: 'call', schema: 'tool' },
    argument: 1, named: 'a', previousNames: ['z'] });
  expect(signature('SELECT outer_call(ROUND(|), 1)')).toMatchObject({ name: 'round', argument: 0 });
  expect(signature('SELECT * FROM LATERAL tool.gen(|)')).toMatchObject({ routine: { context: 'from', schema: 'tool' } });
  expect(signature('SELECT outer_call($tag$x,y|$tag$, 1)')).toMatchObject({ name: 'outer_call', argument: 0 });
  for (const marked of ['CREATE FUNCTION public.f(|) RETURNS int', 'INSERT INTO public.t(|) VALUES (1)', 'SELECT 1; -- fake(|',
    'SELECT f(1); SELECT (|)']) expect(signature(marked)).toBeUndefined();
});

it('PostgreSQL窗口函数和聚合筛选关键字可从编辑器补全', async () => {
  const window = editor('SELECT WIN|', async () => ({ items: [], incomplete: false }));
  const frame = editor('SELECT PRE|', async () => ({ items: [], incomplete: false }));
  const filter = editor('SELECT FIL|', async () => ({ items: [], incomplete: false }));
  try {
    expect((await window.suggest())?.suggestions?.map(item => item.label)).toContain('WINDOW');
    expect((await frame.suggest())?.suggestions?.map(item => item.label)).toContain('PRECEDING');
    expect((await filter.suggest())?.suggestions?.map(item => item.label)).toContain('FILTER');
  } finally {
    window.provider.dispose();
    frame.provider.dispose();
    filter.provider.dispose();
  }
});

it('命名窗口补全区分裸 OVER、括号复制、定义继承和继承后的排序', () => {
  const windows = ' FROM t WINDOW base AS (PARTITION BY t.grp), sorted AS (base ORDER BY t.id), ' +
    'framed AS (sorted ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)';
  expect(at('SELECT count(*) OVER |' + windows)?.windows).toEqual({ inline: false, names: ['base', 'sorted', 'framed'] });
  expect(at('SELECT count(*) OVER (|)' + windows)?.windows).toEqual({ inline: true, names: ['base', 'sorted'] });
  expect(at('SELECT count(*) OVER (| ORDER BY t.id)' + windows)?.windows).toEqual({ inline: true, names: ['base'] });
  expect(at('SELECT count(*) FILTER (WHERE active) OVER (ba| PARTITION BY t.id)' + windows)?.windows)
    .toEqual({ inline: true, names: [] });
  expect(at('SELECT count(*) OVER derived WINDOW base AS (), derived AS (ba|), later AS ()')?.windows)
    .toEqual({ inline: true, names: ['base'] });
  expect(at('SELECT count(*) OVER derived WINDOW base AS (ORDER BY 1), derived AS (base), final AS (| ORDER BY 2)')?.windows)
    .toEqual({ inline: true, names: [] });
  expect(at('SELECT count(*) OVER (|) WINDOW w AS (ORDER BY rows, following)')?.windows)
    .toEqual({ inline: true, names: ['w'] });
});

it('命名窗口名称仅在本查询块可见，避开普通函数、子查询和同名字段', () => {
  expect(at('SELECT (SELECT sum(v) OVER in| FROM t WINDOW inner_win AS ()) WINDOW outer_win AS ()')?.windows)
    .toEqual({ inline: false, names: ['inner_win'] });
  expect(at('SELECT count(*) OVER fir| WINDOW first_win AS () UNION ALL SELECT count(*) OVER second_win WINDOW second_win AS ()')?.windows)
    .toEqual({ inline: false, names: ['first_win'] });
  expect(at('SELECT 1 FROM t WINDOW w AS () ORDER BY max(id) OVER w|')?.windows).toEqual({ inline: false, names: ['w'] });
  expect(at('SELECT (SELECT count(*) OVER |) WINDOW outer_win AS ()')?.windows).toEqual({ inline: false, names: [] });
  for (const sql of ['SELECT (x) OVER t| FROM t WINDOW w AS ()', 'SELECT over(t.|) FROM t WINDOW w AS ()',
    'SELECT count(*) OVER FROM table_| WINDOW w AS ()', 'SELECT sum(x) OVER (ORDER BY win|) FROM t WINDOW win AS ()']) {
    expect(at(sql)?.windows, sql).toBeUndefined();
  }
});

it('窗口补全只替换名称，引用转义和大小写遵循 PostgreSQL，且全程离线', async () => {
  const request = vi.fn(async () => ({ items: [], incomplete: false }));
  const marked = 'SELECT count(*) OVER "计""|旧" FROM app.t WINDOW "计""数" AS (), " Other" AS ()';
  const { provider, suggest } = editor(marked, request);
  try {
    const items = (await suggest())?.suggestions;
    expect(items).toHaveLength(1);
    const item = items![0];
    expect(item).toMatchObject({ label: {label: '计"数', description: '命名窗口'}, insertText: '"计""数"' });
    if (!('startColumn' in item.range)) throw Error('窗口名称必须使用完整替换范围');
    const sql = marked.replace('|', '');
    expect(sql.slice(0, item.range.startColumn - 1) + item.insertText + sql.slice(item.range.endColumn - 1))
      .toBe('SELECT count(*) OVER "计""数" FROM app.t WINDOW "计""数" AS (), " Other" AS ()');
    expect(request).not.toHaveBeenCalled();
  } finally { provider.dispose(); }
});

it('JOIN USING 离线找两侧唯一共有列，并排除其它操作数、已使用键和单侧同名歧义', async () => {
  const sql = 'WITH a(id, shared, dup) AS (VALUES (1,2,3)), b(id, dup) AS (VALUES (1,3)), ' +
    'c(id, shared, dup, unrelated) AS (VALUES (1,2,3,4)), noise(unrelated) AS (VALUES (4)) ' +
    'SELECT * FROM noise, (a LEFT JOIN b USING (id)) merged JOIN c USING (id, sh|Suffix)';
  const catalog = vi.fn(async () => ({items: [], incomplete: true}));
  const {provider, suggest} = editor(sql, catalog);
  try {
    const items = (await suggest())?.suggestions;
    expect(items?.map(item => item.insertText)).toEqual(['"shared"']);
    expect(items?.[0]).toMatchObject({label: {label: 'shared', description: '两侧共有列'}});
    const range = items?.[0]?.range;
    if (!range || !('startColumn' in range)) throw Error('共有列必须有完整替换范围');
    const source = sql.replace('|', '');
    expect(source.slice(0, range.startColumn - 1) + items![0].insertText + source.slice(range.endColumn - 1))
      .toBe(source.replace('shSuffix', '"shared"'));
    expect(catalog).not.toHaveBeenCalled();
  } finally { provider.dispose(); }
  const empty = editor(sql.replace('id, sh|Suffix', '|'), catalog);
  try { expect((await empty.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"id"', '"shared"']); }
  finally { empty.provider.dispose(); }
});

it('共有列目录只读取真实来源，以目录顺序还原 CTE 星号、列清单和嵌套 NATURAL JOIN', async () => {
  const marked = 'WITH x AS (SELECT l.* FROM app.left_table l("键")) ' +
    'SELECT * FROM x JOIN (app.right_table NATURAL JOIN app.stale_table) pair("键") USING ("|tmp")';
  const inventory: PostgresCompletionResult = {incomplete: false, items: [
    {kind: 'joinColumns', reference: 0, names: ['raw_id', 'extra']},
    {kind: 'joinColumns', reference: 1, names: ['raw_id', 'extra', 'only_right']},
    {kind: 'joinColumns', reference: 2, names: ['raw_id', 'only_stale']},
  ]};
  const request = vi.fn(async () => inventory);
  const session = editor(marked, request, '原会话');
  try {
    expect((await session.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"键"', '"extra"']);
    expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'joinColumns', prefix: '',
      connectionId: '原连接', database: '原库', sessionId: '原会话',
      relations: [{schema: 'app', name: 'left_table'}, {schema: 'app', name: 'right_table'}, {schema: 'app', name: 'stale_table'}]});
  } finally { session.provider.dispose(); }
  const partial = editor(marked, async () => ({...inventory, incomplete: true}));
  try { expect((await partial.suggest())?.suggestions).toEqual([]); } finally { partial.provider.dispose(); }
});

it.each([
  'UPDATE dst SET x=1 FROM app.left JOIN app.right USING (|)',
  'DELETE FROM dst USING app.left JOIN app.right USING (|)',
  'MERGE INTO dst USING (app.left JOIN app.right USING (|)) pair ON true WHEN MATCHED THEN DO NOTHING',
  'SELECT * FROM a JOIN b ON a.id=b.id, app.left JOIN app.right USING (|)',
  'SELECT * FROM app.left JOIN app.right USING (|',
])('USING 识别实际源位置和未闭合列表：%s', async marked => {
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false, items: [
    {kind: 'joinColumns', reference: 0, names: ['id', 'left_only']}, {kind: 'joinColumns', reference: 1, names: ['id', 'right_only']},
  ]}));
  const client = editor(marked, request);
  try {
    expect((await client.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"id"']);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({kind: 'joinColumns',
      relations: [{schema: 'app', name: 'left'}, {schema: 'app', name: 'right'}]}));
  } finally { client.provider.dispose(); }
});

it('USING 列不接受表限定符、重复的其它键或无法确认输出的来源', async () => {
  for (const sql of [
    'SELECT * FROM a JOIN b USING (a.|)',
    'SELECT * FROM a JOIN b USING (same, same, |)',
    'SELECT * FROM (SELECT 1+2) a JOIN b USING (|)',
    'SELECT * FROM app.a a("' + '列'.repeat(22) + '") JOIN app.b USING (|)',
  ]) {
    const request = vi.fn(async () => ({items: [], incomplete: false}));
    const {provider, suggest} = editor(sql, request);
    try {
      expect((await suggest())?.suggestions, sql).toEqual([]);
      expect(request, sql).not.toHaveBeenCalled();
    } finally { provider.dispose(); }
  }
});

it('JOIN ON 补全由当前两个操作数决定，保留相关外层并隔离逗号项、后续 JOIN 和写入目标', () => {
  const condition = ' FROM earlier e, a x JOIN b y ON ';
  const tail = ' JOIN later z ON true';
  expect(at('SELECT *' + condition + '|' + tail)?.query).toMatchObject({kind: 'columns', qualified: false,
    relations: [{name: 'a', alias: 'x'}, {name: 'b', alias: 'y'}]});
  expect(at('SELECT *' + condition + 'true AND |')?.query).toMatchObject({relations: [{name: 'a'}, {name: 'b'}]});
  for (const sample of [
    'SELECT *' + condition + 'e.|' + tail,
    'SELECT *' + condition + 'z.|' + tail,
    'SELECT * FROM earlier e TABLESAMPLE SYSTEM (100) REPEATABLE (1), a x JOIN b y ON e.|',
    'SELECT * FROM a x JOIN (b y JOIN c z ON x.|) wrapped ON true',
    'SELECT * FROM (a x JOIN b y ON true) wrapped JOIN c z ON x.|',
    'UPDATE dst d SET id=1 FROM a x JOIN b y ON d.|',
    'DELETE FROM dst d USING a x JOIN b y ON d.|',
  ]) expect(at(sample)?.query, sample).toBeUndefined();
  expect(at('SELECT * FROM a x JOIN (b y JOIN c z ON y.|) wrapped ON true')?.query)
    .toMatchObject({relations: [{name: 'b', alias: 'y'}]});
  expect(at('SELECT * FROM (a x JOIN b y ON true) wrapped JOIN c z ON wrapped.|')?.query)
    .toMatchObject({relations: [{name: 'wrapped'}], joinOutput: {source: {kind: 'join'}}});
  expect(at('SELECT * FROM a x JOIN b y ON EXISTS (SELECT 1 FROM inner_table v WHERE x.|) JOIN later z ON true')?.query)
    .toMatchObject({relations: [{name: 'a', alias: 'x'}]});
  expect(at('SELECT (SELECT 1 FROM a x JOIN b y ON parent.|) FROM app.parent')?.query)
    .toMatchObject({relations: [{name: 'parent', schema: 'app'}]});
  expect(at('UPDATE dst d SET id=1 FROM a x JOIN b y ON true WHERE d.|')?.query)
    .toMatchObject({relations: [{name: 'dst', alias: 'd'}]});
  expect(at('SELECT * FROM a x JOIN LATERAL (SELECT x.|) y ON true')?.query)
    .toMatchObject({relations: [{name: 'a', alias: 'x'}]});
  expect(at('SELECT * FROM a x TABLESAMPLE BERNOULLI (50) JOIN b y ON x.|')?.query)
    .toMatchObject({relations: [{name: 'a', alias: 'x'}]});
});

it('后续 ON 的裸列候选使用前序 JOIN 的合并输出，不读取其它 FROM 项的目录', async () => {
  const marked = 'SELECT * FROM outside, (app.a x JOIN app.b y USING (id)) pair JOIN app.c z ON i|_tail = 1';
  const request = vi.fn(async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => ({incomplete: false, items: input.kind === 'joinColumns' ? [
    {kind: 'joinColumns', reference: 0, names: ['id', 'from_a']},
    {kind: 'joinColumns', reference: 1, names: ['id', 'from_b']},
    {kind: 'joinColumns', reference: 2, names: ['other']},
  ] : []}));
  const {provider, suggest} = editor(marked, request, '原会话');
  try {
    expect((await suggest())?.suggestions.filter(item => typeof item.label === 'object').map(item => item.insertText)).toEqual(['"id"']);
    const catalogs = request.mock.calls.map(([input]) => input).filter(input => input.kind !== 'routines');
    expect(catalogs).toEqual([{kind: 'joinColumns', prefix: '',
      connectionId: '原连接', database: '原库', sessionId: '原会话',
      relations: [{schema: 'app', name: 'a'}, {schema: 'app', name: 'b'}, {schema: 'app', name: 'c'}]}]);
  } finally { provider.dispose(); }
});

it('普通 RETURNING 的 OLD/NEW 使用写入目标，隔离 INSERT 来源和冲突动作', () => {
  for (const statement of [
    'INSERT INTO app.items AS t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id=excluded.id',
    'INSERT INTO app.items AS t SELECT id FROM a UNION ALL SELECT id FROM b',
    'INSERT INTO app.items AS t DEFAULT VALUES',
    'UPDATE ONLY (app.items) AS t SET id=1',
    'DELETE FROM app.items AS t USING parent p WHERE t.id=p.id',
  ]) {
    expect(at(statement + ' RETURNING new.|')?.query, statement).toMatchObject({qualified: true,
      relations: [{schema: 'app', name: 'items', alias: 'new'}]});
    expect(at(statement + ' RETURNING WITH (OLD AS "之前", NEW AS after) "之前".|')?.query, statement)
      .toMatchObject({relations: [{schema: 'app', name: 'items', alias: '之前'}]});
    expect(at(statement + ' RETURNING WITH (OLD AS before) old.|')?.query, statement).toBeUndefined();
  }
  const insert = 'INSERT INTO app.items AS t SELECT incoming.id FROM source incoming';
  expect(at(insert + ' RETURNING incoming.|')?.query).toBeUndefined();
  expect(at(insert + ' RETURNING excluded.|')?.query).toBeUndefined();
  expect(at(insert + ' RETURNING WITH (OLD AS be|fore) before.id')?.query).toBeUndefined();
  expect(at(insert + ' RETURNING WITH (OLD AS t) t.|')?.query).toBeUndefined();
  expect(at(insert + ' RETURNING WITH (OLD AS before) tools.pol|')?.routine).toEqual({context: 'expression', schema: 'tools'});
  expect(at('UPDATE app.items AS t SET id=old.| RETURNING new.id')?.query).toBeUndefined();
  expect(at('UPDATE app.items AS t SET id=1 FROM app.parent AS old RETURNING old.|')?.query)
    .toMatchObject({relations: [{name: 'parent', alias: 'old'}]});
});

it('INSERT SELECT 的各分支只看到自身的来源，并沿用 CTE、连接条件和函数补全', () => {
  const sql = 'INSERT INTO app.target AS dst (id) OVERRIDING USER VALUE ';
  const first = ' FROM app.source src UNION ALL SELECT other.id FROM app.secondary other ON CONFLICT (id) DO NOTHING RETURNING id';
  expect(at(sql + 'SELECT src.|' + first)?.query).toMatchObject({relations: [{name: 'source', schema: 'app', alias: 'src'}]});
  expect(at(sql + 'SELECT dst.|' + first)?.query).toBeUndefined();
  expect(at('INSERT INTO app.target AS src SELECT src.| FROM app.source src')?.query)
    .toMatchObject({relations: [{name: 'source', alias: 'src'}]});
  expect(at(sql + 'SELECT id FROM app.source src UNION ALL SELECT other.| FROM app.secondary other')?.query)
    .toMatchObject({relations: [{name: 'secondary', alias: 'other'}]});
  expect(at(sql + 'SELECT id AS output FROM app.source UNION ALL SELECT id FROM app.secondary ORDER BY out|')?.query)
    .toMatchObject({relations: [{projection: {names: ['output']}}]});
  expect(at('WITH seed(id) AS (VALUES (4)) ' + sql + 'WITH seed(label) AS (VALUES (5)) SELECT s.| FROM seed s')?.query)
    .toMatchObject({relations: [{projection: {names: ['label']}}]});
  expect(at(sql + '(SELECT src.| FROM app.source src)')?.query).toMatchObject({relations: [{name: 'source'}]});
  expect(at(sql + 'SELECT 1 FROM outside o, a x JOIN b y ON o.|')?.query).toBeUndefined();
  expect(at(sql + 'SELECT 1 FROM outside o, a x JOIN b y ON x.|')?.query).toMatchObject({relations: [{name: 'a'}]});
  expect(at(sql + 'TABLE app.so|')?.query).toEqual({kind: 'relations', schema: 'app'});
  expect(at(sql + 'TABLE app.source ORDER BY id|')?.query).toMatchObject({relations: [{name: 'source', schema: 'app'}]});
  expect(at(sql + 'VALUES (dst.|)')?.query).toBeUndefined();
  expect(at(sql + 'VALUES (app.compute|())')?.routine).toEqual({context: 'expression', schema: 'app'});
});

it('INSERT 只在目标列表的基础列位置读取 INSERT 权限，并核对完整替换范围', async () => {
  const insert = 'INSERT INTO app.target AS dst (id, ';
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false,
    items: [{kind: 'column', reference: 0, name: 'new_value', type: 'text'}]}));
  const {provider, suggest} = editor(insert + 'new|_tail) OVERRIDING SYS', request, '原会话');
  try {
    const item = (await suggest())?.suggestions.find(candidate => candidate.insertText === '"new_value"');
    expect(item?.range).toMatchObject({startColumn: insert.length + 1, endColumn: insert.length + 'new_tail'.length + 1});
    expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'columns', prefix: 'new', connectionId: '原连接', database: '原库',
      sessionId: '原会话', relations: [{schema: 'app', name: 'target', columnAccess: 'insert'}]});
  } finally { provider.dispose(); }
  expect(at(insert + '|')?.query).toMatchObject({relations: [{name: 'target', columnAccess: 'insert'}]});
  for (const sample of [insert + 'array_col[|]) VALUES (1,2)', insert + 'composite.sub|) VALUES (1,2)']) {
    expect(at(sample)?.query, sample).toBeUndefined();
  }
});

it('ON CONFLICT DO UPDATE 区分赋值目标、既有行、EXCLUDED 和条件作用域', () => {
  const insert = 'INSERT INTO app.items AS target SELECT x.id FROM a x JOIN b ON conflict UNION ALL SELECT id FROM c ';
  const update = 'ON CONFLICT (id) WHERE visible DO UPDATE SET ';
  expect(at(insert + update + 'na|me = excluded.name')?.query).toMatchObject({qualified: false,
    relations: [{schema: 'app', name: 'items', alias: 'target', columnAccess: 'update'}]});
  expect(at(insert + update + 'id=excluded.id, (na|me, status)=(excluded.name, true)')?.query)
    .toMatchObject({relations: [{name: 'items', columnAccess: 'update'}]});
  expect(at(insert + update + 'name=excluded.na|me, status=true')?.query).toMatchObject({qualified: true,
    relations: [{schema: 'app', name: 'items', alias: 'excluded', columnAccess: 'select'}]});
  expect(at(insert + update + 'name=target.na|me')?.query).toMatchObject({relations: [{name: 'items', alias: 'target', columnAccess: 'select'}]});
  expect(at(insert + update + 'name=(SELECT excluded.| FROM metadata m)')?.query)
    .toMatchObject({relations: [{name: 'items', alias: 'excluded', columnAccess: 'select'}]});
  expect(at(insert + update + 'name=(SELECT excluded.| FROM metadata excluded)')?.query)
    .toMatchObject({relations: [{name: 'metadata', alias: 'excluded'}]});
  expect(at(insert + update + 'name=excluded.name WHERE target.|')?.query)
    .toMatchObject({relations: [{name: 'items', alias: 'target', columnAccess: 'select'}]});
  expect(at(insert + update + 'name=excluded.name WHERE tools.low|er(target.name)')?.routine)
    .toEqual({context: 'expression', schema: 'tools'});
  for (const sample of [
    insert + update + 'excluded.| = target.name',
    insert + update + 'name=x.|',
    insert + update + 'name=app.items.|',
    insert + 'ON CONFLICT (excluded.|) DO NOTHING',
    insert + update + 'name=excluded.name RETURNING excluded.|',
    'INSERT INTO app.items VALUES (excluded.|) ON CONFLICT (id) DO UPDATE SET name=excluded.name',
    'INSERT INTO app.excluded VALUES (1) ON CONFLICT (id) DO UPDATE SET name=excluded.|',
  ]) expect(at(sample)?.query, sample).toBeUndefined();
});

it('冲突目标补全区分键组、约束名、动作和读取来源', () => {
  const insert = 'INSERT INTO app.items AS t VALUES (1) ON CONFLICT ';
  expect(at(insert + 're|_tail')?.query).toEqual({kind: 'conflictTarget', relation: {name: 'items', schema: 'app'},
    selection: {mode: 'key', whole: true, used: []}});
  expect(at(insert + '(re|_tail, "标签") DO UPDATE SET value=excluded.value')?.query)
    .toMatchObject({selection: {mode: 'key', used: ['标签']}});
  expect(at(insert + '("标签", |')?.query).toMatchObject({selection: {mode: 'key', used: ['标签']}});
  expect(at(insert + 'ON CONSTRAINT "Case| x" DO NOTHING')?.query)
    .toMatchObject({selection: {mode: 'constraint', allowExclusion: true}});
  expect(at(insert + 'ON CONSTRAINT |')?.query).toMatchObject({selection: {mode: 'constraint'}});
  expect(at(insert + 'ON CONSTRAINT | DO UPDATE SET v=0')?.query).not.toMatchObject({selection: {allowExclusion: true}});
  for (const example of ['(id, id, |)', '(lower(x), |)', '(s.|)', '(key, |) WHERE live DO NOTHING', 'ON CONSTRAINT app.|']) {
    expect(at(insert + example)?.query, example).toBeUndefined();
  }
  const source = 'INSERT INTO app.items SELECT 1 FROM source s JOIN flags ON ';
  expect(at(source + 'conf|lict')?.query?.kind).toBe('columns');
  expect(at(source + 'conflict ON CONFLICT (|')?.query?.kind).toBe('conflictTarget');
});

it('冲突键补齐其余列并保留后续已填项，约束名使用原引号且不泄露排斥约束', async () => {
  const insert = 'INSERT INTO app.items VALUES (1) ON CONFLICT ';
  const marked = insert + '(re|_tail, id) DO UPDATE SET v=0';
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false, items: [
    {kind: 'conflictKey', name: 'first_index', columns: ['id', 'zone', 'region'], primary: false},
    {kind: 'conflictKey', name: 'same_keys', columns: ['region', 'id', 'zone'], primary: false},
    {kind: 'conflictKey', name: 'missing_id', columns: ['region'], primary: false},
  ]}));
  const keys = editor(marked, request, '现有会话');
  const constraints = editor(insert + 'ON CONSTRAINT "Case| x" DO UPDATE SET v=0', async () => ({incomplete: false, items: [
    {kind: 'conflictConstraint', name: 'Case"键', constraint: 'unique'},
    {kind: 'conflictConstraint', name: 'CaseOnlyNothing', constraint: 'exclusion'},
    {kind: 'conflictConstraint', name: 'caseLower', constraint: 'unique'},
  ]}));
  try {
    const items = (await keys.suggest())?.suggestions;
    expect(items?.map(item => item.insertText)).toEqual(['"region", "zone"']);
    expect(items?.[0].range).toMatchObject({startColumn: insert.length + 2, endColumn: insert.length + 2 + 're_tail'.length});
    expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'conflictTargets', connectionId: '原连接', database: '原库',
      sessionId: '现有会话', prefix: 're', relation: {name: 'items', schema: 'app'}, selection: {mode: 'key', used: ['id']}});
    expect((await constraints.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"Case""键"']);
  } finally { keys.provider.dispose(); constraints.provider.dispose(); }
});

it('完整冲突目标可同时插入表达式键、普通键和目录谓词，保留动作及用户手写条件', async () => {
  const source = 'INSERT INTO app.items VALUES (1) ON CONFLICT ';
  const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false, items: [
    {kind: 'conflictIndex', name: 'mixed_index', terms: [{column: 'tenant'}, {expression: 'lower(code)'}], predicate: "state <> '停用'::text"},
    {kind: 'conflictIndex', name: 'mixed_wrong', terms: [{column: 'tenant'}], predicate: 'true) DO NOTHING; DELETE FROM t; --'},
  ]}));
  const whole = editor(source + 'mix|_tail DO UPDATE SET state=excluded.state', request, '原会话');
  const handwritten = editor(source + '(te|_tail) WHERE enabled DO NOTHING', request, '原会话');
  try {
    expect((await whole.suggest())?.suggestions.map(item => item.insertText)).toEqual([
      `("tenant", (lower(code))) WHERE (state <> '停用'::text)`,
    ]);
    expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'conflictTargets', connectionId: '原连接', database: '原库',
      sessionId: '原会话', prefix: 'mix', relation: {name: 'items', schema: 'app'}, selection: {mode: 'key', whole: true, used: []}});
    expect((await handwritten.suggest())?.suggestions).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { whole.provider.dispose(); handwritten.provider.dispose(); }
});

it('目录表达式可以包含引号、嵌套括号和数组，但保持独立边界与绑定', () => {
  for (const valid of ["lower(code) || 'a; -- b)'", 'qty = ANY (ARRAY[1,2])', "tag = E'a\\\\b'", 'code IS NOT NULL']) {
    expect(postgresConflictExpression(valid, 'items'), valid).toBe(valid);
  }
  for (const invalid of ['a, b', 'x) OR (false', 'x; RESET ROLE', 'x -- 后续子句', '(SELECT 1)', '$1',
    'hash(items.*)', 'hash("items")', 'items.code', "code = 'a\\'b'"]) {
    expect(postgresConflictExpression(invalid, 'items'), invalid).toBeUndefined();
  }
});

it('附加索引目录失败时保留已经读取的普通冲突键', async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_get_indexdef')) throw Error('表达式目录读取失败');
    return {truncated: false, rows: sql.includes('FROM keys k') ? [{c0: 'items_pkey', c1: 't', c2: '["id"]'}] : []};
  });
  const connection = {database: '原库', query} as unknown as PostgresConnection;
  expect(await readPostgresCompletion(connection, {kind: 'conflictTargets', connectionId: '原连接', database: '原库', prefix: '',
    relation: {schema: 'app', name: 'items'}, selection: {mode: 'key', whole: true, used: []}})).toEqual({incomplete: true,
    items: [{kind: 'conflictKey', name: 'items_pkey', columns: ['id'], primary: true}]});
});

it('冲突更新目录传实际表和所需列权限，现有标签和完整替换范围保留', async () => {
  const sql = 'INSERT INTO app.items AS t VALUES (1) ON CONFLICT (id) DO UPDATE SET ';
  for (const [clause, columnAccess] of [['na|_tail=excluded.name', 'update'], ['name=excluded.na|_tail', 'select']] as const) {
    const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false,
      items: [{kind: 'column', reference: 0, name: 'name', type: 'text'}]}));
    const {provider, suggest} = editor(sql + clause, request, '原会话');
    try {
      const item = (await suggest())?.suggestions.find(candidate => candidate.insertText === '"name"');
      const start = sql.length + clause.indexOf('na|_tail') + 1;
      expect(item?.range).toMatchObject({startColumn: start, endColumn: start + 'na_tail'.length});
      expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'columns', prefix: 'na', connectionId: '原连接', database: '原库',
        sessionId: '原会话', relations: [{schema: 'app', name: 'items', columnAccess}]});
    } finally { provider.dispose(); }
  }
});

it('普通 UPDATE SET 按赋值位置区分目标、读取来源、元组和下标', () => {
  const sql = 'UPDATE ONLY (app.items) AS d SET ';
  const from = ' FROM app.feed s WHERE d.id=s.id RETURNING d.id';
  const write = {qualified: false, relations: [{schema: 'app', name: 'items', alias: 'd', columnAccess: 'update'}]};
  const read = {qualified: true, relations: [{schema: 'app', name: 'feed', alias: 's', columnAccess: 'select'}]};
  expect(at(sql + 'w|_tail=s.value' + from)?.query).toMatchObject(write);
  expect(at(sql + 'first=1, (second, th|ird)=(1,2)' + from)?.query).toMatchObject(write);
  expect(at(sql + 'second=(SELECT s.|)' + from)?.query).toMatchObject(read);
  expect(at(sql + 'second[s.|]=1' + from)?.query).toMatchObject(read);
  expect(at(sql + 'second=d.status IS DISTINCT FROM s.|' + from)?.query).toMatchObject(read);
  expect(at(sql + 'second=tools.co|nvert(s.status)' + from)?.routine).toEqual({context: 'expression', schema: 'tools'});
  for (const assignment of ['d.|=1', 's.|=1', 'record.fi|eld=1', 'record.field | =1']) {
    expect(at(sql + assignment + from)?.query, assignment).toBeUndefined();
  }
  expect(at('UPDATE app.items d SET info = k|ey FROM a JOIN b USING (key) AS keys')?.query)
    .toMatchObject({qualified: false, joinOutput: {source: {kind: 'projection'}}});
});

it('UPDATE SET 目录按原会话交付目标权限，并把读取权限传给 CTE 星号来源', async () => {
  const before = 'WITH q AS (SELECT * FROM app.feed) UPDATE app.items AS d SET ';
  for (const [assignment, name, columnAccess] of [['co|_tail=q.count', 'items', 'update'], ['count=q.co|_tail', 'feed', 'select']] as const) {
    const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false,
      items: [{kind: 'column', reference: 0, name: 'count', type: 'integer'}]}));
    const {provider, suggest} = editor(before + assignment + ' FROM q', request, '原会话');
    try {
      const item = (await suggest())?.suggestions.find(candidate => candidate.insertText === '"count"');
      const start = before.length + assignment.indexOf('co|_tail') + 1;
      expect(item?.range).toMatchObject({startColumn: start, endColumn: start + 'co_tail'.length});
      expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'columns', prefix: 'co', connectionId: '原连接', database: '原库',
        sessionId: '原会话', relations: [{schema: 'app', name, columnAccess}]});
    } finally { provider.dispose(); }
  }
});

it('更新和删除条件复用目标、连接输出及相关子查询的读取作用域', () => {
  const update = 'UPDATE ONLY (app.items) AS d SET value=1 FROM app.feed f WHERE ';
  const remove = 'DELETE FROM ONLY (app.items) AS d USING app.feed f WHERE ';
  for (const statement of [update, remove]) {
    expect(at(statement + 'd.| RETURNING d.id')?.query)
      .toMatchObject({relations: [{schema: 'app', name: 'items', alias: 'd', columnAccess: 'select'}]});
    expect(at(statement + 'EXISTS (SELECT 1 WHERE f.|)')?.query)
      .toMatchObject({relations: [{schema: 'app', name: 'feed', alias: 'f', columnAccess: 'select'}]});
    expect(at(statement + 'new.| RETURNING new.id')?.query).toBeUndefined();
    expect(at(statement + 'tools.ru|le(d.id)')?.routine).toEqual({context: 'expression', schema: 'tools'});
  }
  for (const statement of ['UPDATE app.items SET value=1', 'DELETE FROM app.items']) {
    expect(at(statement + ' WHERE CURRENT OF cur|sor RETURNING id')?.query).toBeUndefined();
  }
  expect(at('DELETE FROM app.items d USING (app.a JOIN app.b USING (k)) pair WHERE pair.|')?.query)
    .toMatchObject({relations: [{name: 'pair', columnAccess: 'select'}], joinOutput: {source: {kind: 'join'}}});
  expect(at('UPDATE app.items d SET value=1 FROM app.a JOIN app.b USING (k) WHERE k| = 1')?.query)
    .toMatchObject({qualified: false, joinOutput: {source: {kind: 'projection'}}});
});

it('RETURNING 直接引用和写入 CTE 星号均要求读取权限', async () => {
  for (const marked of [
    'INSERT INTO app.items DEFAULT VALUES RETURNING new.co|_tail',
    'DELETE FROM app.items t RETURNING WITH (OLD AS before) before.co|_tail',
    'WITH saved AS (UPDATE app.items SET id=1 RETURNING new.*) SELECT saved.co|_tail FROM saved',
  ]) {
    const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false,
      items: [{kind: 'column', reference: 0, name: 'count_read', type: 'integer'}]}));
    const {provider, suggest} = editor(marked, request, '原会话');
    try {
      expect((await suggest())?.suggestions.map(item => item.insertText)).toEqual(['"count_read"']);
      expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'columns', prefix: 'co', connectionId: '原连接', database: '原库',
        sessionId: '原会话', relations: [{schema: 'app', name: 'items', columnAccess: 'select'}]});
    } finally { provider.dispose(); }
  }
});

it('MERGE 分支分别使用 INSERT、UPDATE 或 SELECT 列权限及对应来源', () => {
  const merge = 'MERGE INTO app.items d USING app.feed s ON ';
  const target = {relations: [{schema: 'app', name: 'items', alias: 'd'}]};
  const source = {relations: [{schema: 'app', name: 'feed', alias: 's', columnAccess: 'select'}]};
  expect(at(merge + 's.|=d.id WHEN MATCHED THEN DELETE')?.query).toMatchObject(source);
  expect(at(merge + 'true WHEN MATCHED AND s.| THEN UPDATE SET value=1')?.query).toMatchObject(source);
  expect(at(merge + 'true WHEN MATCHED THEN UPDATE SET val|ue=s.value')?.query)
    .toMatchObject({relations: [{...target.relations[0], columnAccess: 'update'}]});
  expect(at(merge + 'true WHEN NOT MATCHED BY TARGET THEN INSERT (id,val|ue) VALUES (s.id,s.value)')?.query)
    .toMatchObject({relations: [{...target.relations[0], columnAccess: 'insert'}]});
  expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (vals[s.|]) VALUES (1)')?.query).toMatchObject(source);
  expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (vals) VALUES (s.|)')?.query).toMatchObject(source);
  expect(at(merge + 'true WHEN NOT MATCHED BY SOURCE THEN UPDATE SET value=d.|')?.query)
    .toMatchObject({relations: [{...target.relations[0], columnAccess: 'select'}]});
  expect(at(merge + 'true WHEN NOT MATCHED BY SOURCE THEN UPDATE SET value=s.|')?.query).toBeUndefined();
  expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (value) VALUES (d.|)')?.query).toBeUndefined();
  expect(at(merge + 'true WHEN NOT MATCHED THEN UPDATE SET val|ue=1')?.query).toBeUndefined();
  expect(at('MERGE INTO app.items d USING app.a JOIN app.b USING (k) ON true WHEN NOT MATCHED AND k| > 0')?.query)
    .toMatchObject({qualified: false, joinOutput: {source: {kind: 'projection'}}});
});

it('MERGE 写入位置只把目标身份和所需列权限发给原会话', async () => {
  const merge = 'MERGE INTO app.items d USING app.feed s ON d.id=s.id ';
  for (const [clause, columnAccess] of [
    ['WHEN MATCHED THEN UPDATE SET count_|tail=s.count_value', 'update'],
    ['WHEN NOT MATCHED THEN INSERT (count_|tail) VALUES (s.count_value)', 'insert'],
  ] as const) {
    const request = vi.fn(async (): Promise<PostgresCompletionResult> => ({incomplete: false,
      items: [{kind: 'column', reference: 0, name: 'count_value', type: 'integer'}]}));
    const {provider, suggest} = editor(merge + clause, request, '原会话');
    try {
      expect((await suggest())?.suggestions.map(item => item.insertText)).toEqual(['"count_value"']);
      expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'columns', prefix: 'count_', connectionId: '原连接', database: '原库',
        sessionId: '原会话', relations: [{schema: 'app', name: 'items', columnAccess}]});
    } finally { provider.dispose(); }
  }
});

it('RETURNING 结果可传给外层查询，暴露 JOIN 输出及显式行别名的星号', () => {
  const cte = 'WITH data(id, label) AS (VALUES (1, \'a\')), meta(id, info) AS (VALUES (1, \'b\')), changed AS (';
  const update = 'UPDATE app.items SET id=1 FROM data JOIN meta USING (id)';
  expect(at(update + ' RETURNING |')?.query).toMatchObject({qualified: false, joinOutput: {source: {kind: 'projection'}}});
  expect(at(cte + update + ' RETURNING WITH (OLD AS before) before.id AS old_id, meta.info) SELECT changed.| FROM changed')?.query)
    .toMatchObject({relations: [{projection: {names: ['old_id', 'info']}}]});
  expect(at(cte + update + ' RETURNING *) SELECT changed.| FROM changed')?.query)
    .toMatchObject({relations: [{projection: {names: ['id', 'label', 'info'], stars: [{schema: 'app', name: 'items'}]}}]});
  expect(at('WITH changed AS (INSERT INTO app.items DEFAULT VALUES RETURNING WITH (NEW AS after) after.*) SELECT changed.| FROM changed')?.query)
    .toMatchObject({relations: [{projection: {stars: [{schema: 'app', name: 'items'}]}}]});
  expect(at('DELETE FROM app.items t RETURNING WITH (OLD AS before) (SELECT before.|)')?.query)
    .toMatchObject({relations: [{name: 'items', alias: 'before'}]});
});

it('连接输出补全合并裸键，对仍重名的列给出可见限定名', async () => {
  const sql = 'WITH a(id, tag, only_a) AS (VALUES (1,2,3)), b(id, tag, only_b) AS (VALUES (1,4,5)) ' +
    'SELECT | FROM a FULL JOIN b USING (id) AS shared';
  const request = vi.fn(async () => ({items: [], incomplete: true}));
  const {provider, suggest} = editor(sql, request);
  try {
    expect((await suggest())?.suggestions.filter(item => typeof item.label === 'object').map(item => item.insertText))
      .toEqual(['"id"', '"only_a"', '"only_b"', '"a"."tag"', '"b"."tag"']);
    expect(request).not.toHaveBeenCalled();
  } finally { provider.dispose(); }
});

it('USING AS 只公开连接键，整个 JOIN 的别名遮蔽内部来源', async () => {
  const request = vi.fn(async () => ({items: [], incomplete: true}));
  const sql = 'WITH a(id, only_a) AS (VALUES (1,2)), b(id, only_b) AS (VALUES (1,3)) ';
  const narrow = editor(sql + 'SELECT shared.| FROM a JOIN b USING (id) AS shared', request);
  const parenthesized = editor(sql + 'SELECT whole.| FROM (a JOIN b USING (id) AS shared) whole("新键")', request);
  try {
    expect((await narrow.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"id"']);
    expect((await parenthesized.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"新键"', '"only_a"', '"only_b"']);
    expect(at(sql + 'SELECT a.| FROM (a JOIN b USING (id) AS shared) whole')?.query).toBeUndefined();
    expect(at(sql + 'SELECT shared.| FROM (a JOIN b USING (id) AS shared) whole')?.query).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  } finally { narrow.provider.dispose(); parenthesized.provider.dispose(); }
});

it('连接星号通过派生表和 CTE 保留合并顺序，作为后续 USING 的输入', async () => {
  const request = vi.fn(async () => ({items: [], incomplete: true}));
  const sources = 'WITH a(extra_a, id) AS (VALUES (2,1)), b(id, extra_b) AS (VALUES (1,3)), ' +
    'merged AS (SELECT * FROM a NATURAL JOIN b), wrapped AS (SELECT d.* FROM (SELECT * FROM merged) d) ';
  const qualified = editor(sources + 'SELECT w.| FROM wrapped w(new_id)', request);
  const mixed = editor(sources + 'SELECT | FROM wrapped w, (VALUES (7)) extra(extra_a)', request);
  const nextJoin = editor(sources + 'SELECT * FROM wrapped w JOIN (VALUES (1,7)) next(id, ignored) USING (i|d)', request);
  try {
    expect((await qualified.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"new_id"', '"extra_a"', '"extra_b"']);
    expect((await mixed.suggest())?.suggestions.filter(item => typeof item.label === 'object').map(item => item.insertText))
      .toEqual(['"id"', '"extra_b"', '"w"."extra_a"', '"extra"."extra_a"']);
    expect((await nextJoin.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"id"']);
    expect(request).not.toHaveBeenCalled();
  } finally { qualified.provider.dispose(); mixed.provider.dispose(); nextJoin.provider.dispose(); }
});

it('物理连接星号按完整目录生成一次输出，缺列或结果歧义时不猜候选', async () => {
  const source = 'WITH merged AS (SELECT * FROM app.a JOIN app.b USING (id)) SELECT merged.| FROM merged AS merged("键")';
  const inventory: PostgresCompletionResult = {incomplete: false, items: [
    {kind: 'joinColumns', reference: 0, names: ['left_only', 'id', 'tag']},
    {kind: 'joinColumns', reference: 1, names: ['id', 'right_only', 'tag']},
  ]};
  const request = vi.fn(async () => inventory);
  const ready = editor(source, request, '原会话');
  const partial = editor(source, async () => ({...inventory, incomplete: true}));
  try {
    expect((await ready.suggest())?.suggestions.map(item => item.insertText)).toEqual(['"键"', '"left_only"', '"right_only"']);
    expect(request).toHaveBeenCalledExactlyOnceWith({kind: 'joinColumns', prefix: '', connectionId: '原连接',
      database: '原库', sessionId: '原会话', relations: [{schema: 'app', name: 'a'}, {schema: 'app', name: 'b'}]});
    expect((await partial.suggest())?.suggestions).toEqual([]);
  } finally { ready.provider.dispose(); partial.provider.dispose(); }
});

it.each([
  ['SELECT 1 ORDER BY 1 NU|', 'NULLS LAST', 'SELECT 1 ORDER BY 1 NULLS LAST'],
  ['SELECT 1 ORDER BY 1 NULLS F|suffix', 'FIRST', 'SELECT 1 ORDER BY 1 NULLS FIRST'],
  ['SELECT 1 ORDER BY 1 NU|LLS LAST', 'NULLS', 'SELECT 1 ORDER BY 1 NULLS LAST'],
  ['SELECT 1 ORDER BY 1 NULLS LAST OFFSET 2 ROWS FE|', 'FETCH FIRST', 'SELECT 1 ORDER BY 1 NULLS LAST OFFSET 2 ROWS FETCH FIRST'],
  ['SELECT 1 FETCH N|suffix 2 ROWS ONLY', 'NEXT', 'SELECT 1 FETCH NEXT 2 ROWS ONLY'],
  ['SELECT 1 FET|CH FIRST 2 ROWS ONLY', 'FETCH', 'SELECT 1 FETCH FIRST 2 ROWS ONLY'],
  ['SELECT (SELECT 1 ORDER BY 1 NULLS L|)', 'LAST', 'SELECT (SELECT 1 ORDER BY 1 NULLS LAST)'],
  ['WITH c AS (SELECT 1 AS id) SELECT id FROM c ORDER BY id DESC NULLS |', 'LAST', 'WITH c AS (SELECT 1 AS id) SELECT id FROM c ORDER BY id DESC NULLS LAST'],
  ['SELECT 1 ORDER BY 1 NULLS LAST, 2 NU|', 'NULLS FIRST', 'SELECT 1 ORDER BY 1 NULLS LAST, 2 NULLS FIRST'],
  ['SELECT 1 UNION ALL SELECT 2 ORDER BY 1 NULLS F|', 'FIRST', 'SELECT 1 UNION ALL SELECT 2 ORDER BY 1 NULLS FIRST'],
  ['SELECT 1 OFFSET $2 RO|suffix', 'ROWS', 'SELECT 1 OFFSET $2 ROWS'],
  ['SELECT 1 OFFSET (1 + 2) R|', 'ROW', 'SELECT 1 OFFSET (1 + 2) ROW'],
  ['SELECT 1 FETCH FIRST R|', 'ROW', 'SELECT 1 FETCH FIRST ROW'],
  ['SELECT 1 OFFSET 2 ROWS FETCH NEXT +10 RO| ONLY', 'ROWS', 'SELECT 1 OFFSET 2 ROWS FETCH NEXT +10 ROWS ONLY'],
  ['SELECT 1 FETCH FIRST $1 ROWS ON|suffix', 'ONLY', 'SELECT 1 FETCH FIRST $1 ROWS ONLY'],
  ['SELECT 1 FETCH FIRST ROWS |', 'ONLY', 'SELECT 1 FETCH FIRST ROWS ONLY'],
  ['SELECT 1 ORDER BY 1 FETCH FIRST 1_000 ROWS W|', 'WITH TIES', 'SELECT 1 ORDER BY 1 FETCH FIRST 1_000 ROWS WITH TIES'],
  ['SELECT 1 ORDER BY 1 FETCH FIRST (1 + $2) ROWS WITH T|suffix', 'TIES', 'SELECT 1 ORDER BY 1 FETCH FIRST (1 + $2) ROWS WITH TIES'],
  ['SELECT 1 UNION ALL SELECT 2 ORDER BY 1 FETCH FIRST 2 ROWS W|ITH TIES', 'WITH', 'SELECT 1 UNION ALL SELECT 2 ORDER BY 1 FETCH FIRST 2 ROWS WITH TIES'],
])('排序与分页短语按真实光标范围插入：%s', async (marked, label, expected) => {
  const request = vi.fn(async () => ({ items: [], incomplete: false }));
  const { provider, suggest } = editor(marked, request);
  try {
    const item = (await suggest())?.suggestions.find(candidate => candidate.label === label);
    expect(item).toBeDefined();
    if (!item || !('startColumn' in item.range)) throw Error('缺少单一替换范围');
    const source = marked.replace('|', '');
    expect(source.slice(0, item.range.startColumn - 1) + item.insertText + source.slice(item.range.endColumn - 1)).toBe(expected);
    if (!/^(?:NULLS|FETCH)(?: |$)/.test(label)) expect(request).not.toHaveBeenCalled();
  } finally { provider.dispose(); }
});

it.each([
  'SELECT NU|', 'SELECT a FROM t WHERE a = NU|', 'SELECT a ORDER BY NU|',
  'SELECT a ORDER BY a, NU|', 'SELECT t.fet| FROM t', 'SELECT a LIMIT 1 FE|',
  'SELECT a ORDER BY a "NU|"', "SELECT 'NULLS F|'", 'SELECT 1; SELECT NULLS F|',
  'SELECT a ORDER BY a NULLS LAST NU|', 'SELECT a ORDER BY a OFFSET 2 NULLS F|',
  'SELECT OFFSET t RO|', 'SELECT 1 OFFSET RO|', 'SELECT 1 OFFSET 2 ROWS O|',
  'SELECT 1 FETCH FIRST 1 + 2 RO|', 'SELECT 1 FETCH FIRST 2 ROWS W|',
  'SELECT 1 ORDER BY 1 FETCH FIRST 2 ROWS W| FOR UPDATE SKIP LOCKED',
  'SELECT (SELECT 1 ORDER BY 1) FETCH FIRST 2 ROWS WITH T|',
  'SELECT (SELECT 1 FETCH FIRST 2 ROWS ONLY) RO|',
  'SELECT 1 FETCH FIRST 2 ROWS ONLY RO|', 'SELECT 1 OFFSET 2 | ROWS',
])('无对应子句时不生成排序或分页短语：%s', marked => {
  expect(at(marked)?.keywords).toBeUndefined();
});

describe('PostgreSQL 补全词法和关系作用域', () => {
  it('关系位置读取 schema，引用前缀和后半个词使用完整替换范围', () => {
    expect(at('SELECT * FROM /* 说明 */ "业.务"."品|名"')).toMatchObject({ prefix: '品', quoted: true,
      query: { kind: 'relations', schema: '业.务' } });
    expect(at('SELECT * FROM "|')).toMatchObject({ prefix: '', quoted: true, query: { kind: 'relations' } });
    expect(at('SELECT * FROM "业""|')).toMatchObject({ prefix: '业"', query: { kind: 'relations' } });
    expect(at('SELECT * FROM ONLY s.ta|')).toMatchObject({ prefix: 'ta', query: { kind: 'relations', schema: 's' } });
    expect(at('SELECT * FROM s.t, q.|')).toMatchObject({ query: { kind: 'relations', schema: 'q' } });
  });
  it('从光标之后的 FROM 绑定别名，大小写、引号及跨 schema 连接保留原身份', () => {
    const sql = 'SELECT coalesce("客".na|me, NULL) FROM "甲"."主""表" AS "客" JOIN public.c AS C ON true';
    const result = at(sql)!;
    expect(result.prefix).toBe('na');
    expect(sql.replace('|', '').slice(result.start, result.end)).toBe('name');
    expect(result.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: '甲', name: '主"表', alias: '客' }] });
    expect(at('SELECT c.| FROM public.A AS C')?.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 'public', name: 'a', alias: 'c' }] });
    expect(at('SELECT s.t.| FROM s.t')?.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 's', name: 't' }] });
    expect(at('SELECT t.| FROM s.t AS r')?.query).toBeUndefined();
    expect(at('INSERT INTO "甲".t (na|) VALUES (1)')?.query).toMatchObject({ kind: 'columns', qualified: false,
      relations: [{ schema: '甲', name: 't', columnAccess: 'insert' }] });
  });
  it('字符串、嵌套注释、dollar 正文及参数不触发目录，同名别名不猜来源', () => {
    for (const input of ["SELECT 'x|z' FROM t", 'SELECT /* a /* b */ | */ FROM t',
      'SELECT $tag$ FROM x| $tag$ FROM t', 'SELECT $1| FROM t', 'SELECT -- FROM a|\nFROM t']) {
      expect(at(input)).toBeUndefined();
    }
    expect(at('SELECT a.| FROM s.a AS a, q.b AS a')?.query).toBeUndefined();
    expect(at('SELECT * FROM s.t; SELECT a.| FROM q.b AS a')?.query).toEqual({
      kind: 'columns', qualified: true, relations: [{ schema: 'q', name: 'b', alias: 'a' }],
    });
  });
  it('按声明顺序和引用大小写绑定 CTE，局部同名关系覆盖目录', () => {
    expect(at('WITH "订单"(编号) AS (VALUES (1)), total AS (SELECT 编号 AS 合计 FROM "订单") SELECT x.| FROM total x')?.query)
      .toMatchObject({ qualified: true, relations: [{ name: 'total', alias: 'x', projection: { names: ['合计'], stars: [] } }] });
    expect(at('WITH a AS (SELECT 1 AS value), b AS (SELECT * FROM |) SELECT * FROM b')?.query)
      .toEqual({ kind: 'relations', ctes: ['a'] });
    expect(at('WITH a AS (SELECT 1) SELECT t.| FROM public.a AS t')?.query)
      .toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 'public', name: 'a', alias: 't' }] });
    expect(at('WITH a AS (SELECT 1 AS local_col) UPDATE a SET field = a.|')?.query)
      .toMatchObject({ kind: 'columns', qualified: true, relations: [{ name: 'a', columnAccess: 'select', physical: true }] });
    expect(at('WITH a AS (SELECT 1 AS outer_col) SELECT (WITH a AS (SELECT 1 AS inner_col) SELECT a.| FROM a)')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['inner_col'] } }] });
  });
  it('位置别名保留已知的后续投影，物理通配列只映射回派生关系', () => {
    expect(at('SELECT d.| FROM (SELECT 1, x.kept, ARRAY[1, 2] AS arr FROM real.x) AS d("首列")')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { names: ['首列', 'kept', 'arr'], stars: [] } }] });
    expect(at('WITH x AS (SELECT o.* FROM real.orders o) SELECT d.| FROM (SELECT * FROM x) d')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { stars: [{ schema: 'real', name: 'orders' }] } }] });
    expect(at('SELECT d.| FROM (SELECT * FROM t) d(alias_only)')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { names: ['alias_only'], stars: [] } }] });
    expect(at('WITH x AS (UPDATE t SET name = 1 RETURNING id AS changed) SELECT x.| FROM x')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['changed'], stars: [] } }] });
    expect(at('SELECT d.| FROM (SELECT a.*, b.* FROM a JOIN b USING (id)) d')?.query)
      .toMatchObject({ relations: [{ projection: { stars: [{ name: 'a' }, { name: 'b' }] } }] });
    expect(at('SELECT d.| FROM (SELECT * FROM a JOIN b USING (id)) d')?.query)
      .toMatchObject({ joinOutput: { qualifiers: [] }, relations: [{ projection: { names: ['id'], stars: [] } }] });
  });
  it('表函数声明列、位置别名和序号列沿派生关系补全', () => {
    expect(at('SELECT r.| FROM get_records() AS r(id int, "对外值" numeric(12,3))')?.query)
      .toMatchObject({ qualified: true, relations: [{ alias: 'r', projection: { names: ['id', '对外值'], stars: [], exact: true } }] });
    expect(at('SELECT get_records.| FROM tools.get_records() AS (id int)')?.query)
      .toMatchObject({ relations: [{ name: 'get_records', projection: { names: ['id'], stars: [] } }] });
    const rows = 'ROWS FROM (get_records() AS (id int, val text), get_tags() AS (tag text)) WITH ORDINALITY AS r(key)';
    expect(at('WITH c AS (SELECT r.* FROM ' + rows + ') SELECT c.| FROM c')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['key', 'val', 'tag', 'ordinality'], stars: [], exact: true } }] });
    expect(at('SELECT r.| FROM ROWS FROM (get_records() AS (id int)) WITH ORDINALITY AS r(key,seq)')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['key', 'seq'], exact: true } }] });
  });
  it('JSON_TABLE 投影包含嵌套列、存在列和序号，并应用位置别名', () => {
    const source = `JSON_TABLE(d.payload, '$' AS root PASSING d.n AS minimum COLUMNS (
      seq FOR ORDINALITY, id int, NESTED PATH '$.items[*]' AS child COLUMNS (
        sub_seq FOR ORDINALITY, "名称" text PATH '$.name', ok boolean EXISTS PATH '$.ok'
      )) EMPTY ARRAY ON ERROR) AS j("顺序")`;
    expect(at('SELECT j.| FROM documents d, ' + source)?.query).toMatchObject({ relations: [{ alias: 'j',
      projection: { names: ['顺序', 'id', 'sub_seq', '名称', 'ok'], stars: [], exact: true } }] });
    expect(at('MERGE INTO orders d USING ' + source.replace('d.payload', "'{}'").replace('d.n', '1') + ' ON j.|')?.query).toMatchObject({ relations: [{ alias: 'j',
      projection: { names: ['顺序', 'id', 'sub_seq', '名称', 'ok'], stars: [] } }] });
    expect(at("WITH q AS (SELECT json_table.* FROM JSON_TABLE('{}', E'$' COLUMNS (id int))) SELECT q.| FROM q")?.query)
      .toMatchObject({ relations: [{ projection: { names: ['id'], stars: [] } }] });
  });
  it('JSON_TABLE 的文档和 PASSING 使用前序来源，路径与列元数据没有字段补全', () => {
    expect(at('SELECT * FROM documents d, JSON_TABLE(d.|)')?.query).toMatchObject({ relations: [{ name: 'documents', alias: 'd' }] });
    expect(at("SELECT * FROM documents d, JSON_TABLE('{}', '$' PASSING d.| AS v COLUMNS (id int)) j")?.query)
      .toMatchObject({ relations: [{ name: 'documents', alias: 'd' }] });
    expect(at("SELECT * FROM documents d, JSON_TABLE('{}', '$' PASSING j.| AS v COLUMNS (id int)) j")?.query).toBeUndefined();
    expect(at("SELECT * FROM documents d, JSON_TABLE('{}', '$' COLUMNS (id int DEFAULT d.| ON EMPTY)) j")?.query).toBeUndefined();
    expect(at("SELECT j.| FROM JSON_TABLE('{}', '$' COLUMNS (id int, NESTED '$' COLUMNS (id int))) j")?.query).toBeUndefined();
  });
  it('XMLTABLE 声明列按原顺序传播到 CTE，并应用位置别名', () => {
    const table = `XMLTABLE(XMLNAMESPACES(d.uri AS n), d.xpath PASSING BY REF d.doc BY VALUE
      COLUMNS seq FOR ORDINALITY, amount numeric(12,3) PATH d.amount_path, "名称" text DEFAULT d.fallback NOT NULL)`;
    expect(at('WITH q AS (SELECT xmltable.* FROM documents d, ' + table + ') SELECT q.| FROM q')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['seq', 'amount', '名称'], stars: [], exact: true } }] });
    expect(at('SELECT x.| FROM documents d, ' + table + ' AS x("顺序")')?.query)
      .toMatchObject({ relations: [{ alias: 'x', projection: { names: ['顺序', 'amount', '名称'], stars: [], exact: true } }] });
    expect(at("MERGE INTO orders d USING XMLTABLE('/r' PASSING xmlparse(document '<r/>') COLUMNS id int) x ON x.|")?.query)
      .toMatchObject({ relations: [{ alias: 'x', projection: { names: ['id'], stars: [] } }] });
    expect(at('SELECT x.| FROM documents d, ' + table + ' x(a,b,c,extra)')?.query).toBeUndefined();
    expect(at('SELECT x.| FROM documents d, ' + table.replace('"名称" text DEFAULT d.fallback NOT NULL', 'seq int') + ' x')?.query).toBeUndefined();
  });
  it('XMLTABLE 的五类表达式可以补全前序来源，元数据、后续来源和写入目标不可见', () => {
    const table = "XMLTABLE(XMLNAMESPACES(d.uri AS n), d.xpath PASSING BY REF d.doc BY VALUE COLUMNS id int PATH d.path DEFAULT d.n NOT NULL) x";
    const query = 'SELECT * FROM documents d, ' + table + ', later l';
    for (const field of ['uri', 'xpath', 'doc', 'path', 'n']) {
      expect(at(query.replace('d.' + field, 'd.|' + field))?.query)
        .toMatchObject({ qualified: true, relations: [{ name: 'documents', alias: 'd' }] });
    }
    expect(at('SELECT * FROM documents d, XMLTABLE(XMLNAMESPACES(d.|')?.query)
      .toMatchObject({ relations: [{ alias: 'd' }] });
    expect(at("SELECT * FROM documents d, XMLTABLE('/r' PASSING BY REF d.|")?.query)
      .toMatchObject({ relations: [{ alias: 'd' }] });
    expect(at(query.replace('DEFAULT d.n', 'DEFAULT tools.get_|n'))?.routine)
      .toEqual({ context: 'expression', schema: 'tools' });
    expect(at(query.replace('AS n', 'AS |n'))?.query).toBeUndefined();
    expect(at(query.replace('id int', 'id d.|typ'))?.query).toBeUndefined();
    expect(at(query.replace('d.path', 'l.|path'))?.query).toBeUndefined();
    expect(at('UPDATE documents d SET n=1 FROM ' + table.replace('d.path', 'd.|path'))?.query).toBeUndefined();
    expect(at("DELETE FROM documents d USING XMLTABLE('/r' PASSING d.|doc COLUMNS id int) x")?.query).toBeUndefined();
  });
  it('裸 XMLTABLE 调用不查例程目录，同名表和模式限定函数仍可补全', () => {
    expect(at("SELECT * FROM XMLTABLE|('/r' PASSING doc COLUMNS id int)")).not.toHaveProperty('routine');
    expect(at('SELECT x.| FROM xmltable x')?.query).toMatchObject({ relations: [{ name: 'xmltable', alias: 'x' }] });
    const marked = 'SELECT * FROM tools.xmltable(|1)';
    expect(analyzePostgresSignature(marked.replace('|', ''), marked.indexOf('|')))
      .toMatchObject({ name: 'xmltable', routine: { context: 'from', schema: 'tools' } });
    const table = "SELECT * FROM XMLTABLE('/r' PASSING |doc COLUMNS id int)";
    expect(analyzePostgresSignature(table.replace('|', ''), table.indexOf('|'))).toBeUndefined();
  });
  it('遇到未知返回列时只保留确定的名称，UPDATE FROM 和 DELETE USING 共享补全', () => {
    const rows = 'ROWS FROM (unknown_rows(), get_records() AS (id int, val text)) WITH ORDINALITY AS r(key)';
    const projected = { relations: [{ projection: { names: ['key', 'val', 'ordinality'], exact: false, stars: [{
      functionLayout: { aliasCount: 1, ordinality: true, members: [
        { kind: 'function', name: 'unknown_rows', call: { argumentCount: 0 } }, { kind: 'declared', names: ['id', 'val'] },
      ] },
    }] } }] };
    expect(at('SELECT r.| FROM ' + rows)?.query).toMatchObject(projected);
    expect(at('UPDATE orders d SET value=r.| FROM ' + rows)?.query).toMatchObject(projected);
    expect(at('DELETE FROM orders d USING ' + rows + ' WHERE d.id=r.|')?.query).toMatchObject(projected);
    expect(at('SELECT r.| FROM unknown_rows() WITH ORDINALITY AS r(first,second)')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['first', 'second'], exact: false,
        stars: [{ functionLayout: { aliasCount: 2, ordinality: true,
          members: [{ kind: 'function', name: 'unknown_rows', call: { argumentCount: 0, scalarAlias: 'r' } }] } }],
      } }] });
  });
  it('表函数实参只看到可关联的前序来源，列定义内不触发字段补全', () => {
    expect(at('SELECT * FROM incoming i, ROWS FROM (get_records(i.|) AS (id int)) r, later l')?.query)
      .toMatchObject({ relations: [{ name: 'incoming', alias: 'i' }] });
    expect(at('SELECT * FROM incoming i, ROWS FROM (get_records(l.|) AS (id int)) r, later l')?.query).toBeUndefined();
    expect(at('SELECT * FROM incoming i RIGHT JOIN get_records(i.|) AS r(id int) ON true')?.query).toBeUndefined();
    expect(at('UPDATE orders d SET value=1 FROM get_records(d.|) AS r(id int)')?.query).toBeUndefined();
    expect(at('SELECT * FROM get_records() AS r(id r.|type)')?.query).toBeUndefined();
  });
  it('表函数投影保留真实例程身份和成员参数数量，显式列仍可离线使用', () => {
    expect(at('WITH c AS (SELECT r.* FROM api.feed(1, nested(2,3)) r) SELECT c.| FROM c')?.query)
      .toMatchObject({ relations: [{ projection: { stars: [{ schema: 'api', name: 'feed', functionCall: { argumentCount: 2, scalarAlias: 'r' } }] } }] });
    expect(at('MERGE INTO orders d USING ROWS FROM (api.a(), api.b(1) AS (k int), api.c(2)) WITH ORDINALITY r ON r.|')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['k', 'ordinality'], stars: [
        { schema: 'api', name: 'a', functionCall: { argumentCount: 0 } },
        { schema: 'api', name: 'c', functionCall: { argumentCount: 1 } },
      ] } }] });
    expect(at('SELECT r.| FROM api.feed() AS r(id int)')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['id'], stars: [] } }] });
    expect(at('SELECT r.| FROM unnest(ARRAY[1,2],ARRAY[3,4]) AS r')?.query)
      .toMatchObject({ relations: [{ projection: { stars: [] } }] });
  });
  it('MERGE 在尚未写完的 ON 和 WHEN 中绑定字段及分支作用域', () => {
    const merge = 'MERGE INTO app.orders d USING (SELECT 1 id, 2 value) s ON ';
    const source = { relations: [{ alias: 's', projection: { names: ['id', 'value'], stars: [] } }] };
    const target = { relations: [{ name: 'orders', schema: 'app', alias: 'd' }] };
    expect(at(merge + 'd.id=s.|')?.query).toMatchObject(source);
    expect(at(merge + 'true WHEN MATCHED AND CASE WHEN d.id=1 THEN s.|')?.query).toMatchObject(source);
    expect(at(merge + 'true WHEN NOT MATCHED BY SOURCE AND d.|')?.query).toMatchObject(target);
    expect(at(merge + 'true WHEN NOT MATCHED BY SOURCE AND s.|')?.query).toBeUndefined();
    expect(at(merge + 'true WHEN NOT MATCHED BY TARGET AND d.|')?.query).toBeUndefined();
    expect(at(merge + 'true WHEN MATCHED THEN UPDATE SET value=(SELECT s.|)')?.query).toMatchObject(source);
    expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (id) VALUES (s.|')?.query).toMatchObject(source);
    expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (id) VALUES (d.|)')?.query).toBeUndefined();
    expect(at(merge + 'true WHEN MATCHED THEN UPDATE SET value=s.value, |')?.query).toMatchObject(target);
    expect(at(merge + 'true WHEN NOT MATCHED THEN INSERT (|) VALUES (s.id)')?.query).toMatchObject(target);
    expect(at(merge + 'true WHEN MATCHED THEN UPDATE SET d.|')?.query).toBeUndefined();
  });
  it('MERGE 在来源 JOIN、CTE 和 RETURNING 内按绑定取得字段', () => {
    expect(at('MERGE INTO orders d USING (SELECT 1 id) s JOIN (SELECT 1 id) t ON s.|')?.query)
      .toMatchObject({ relations: [{ alias: 's', projection: { names: ['id'] } }] });
    expect(at('MERGE INTO orders d USING (SELECT 1 id) s JOIN (SELECT 1 id) t ON d.| ON true')?.query).toBeUndefined();
    expect(at('MERGE INTO orders d USING ((SELECT 1 id, 2 n) s JOIN (SELECT 1 id, 3 f) t USING (id)) j(key) ON j.|')?.query)
      .toMatchObject({ relations: [{ name: 'j', projection: { names: ['key', 'n', 'f'], exact: true } }] });
    expect(at('MERGE INTO orders d USING a JOIN b USING (id) AS k ON k.|')?.query)
      .toMatchObject({ relations: [{ name: 'k', projection: { names: ['id'], stars: [] } }] });
    const merge = 'MERGE INTO app.orders d USING feed s ON d.id=s.id WHEN MATCHED THEN DELETE';
    expect(at(merge + ' RETURNING WITH (OLD AS previous) previous.|')?.query)
      .toMatchObject({ relations: [{ name: 'orders', schema: 'app', alias: 'previous' }] });
    expect(at(merge + ' RETURNING new.|')?.query).toMatchObject({ relations: [{ name: 'orders', alias: 'new' }] });
    expect(at(merge + ' RETURNING WITH (OLD AS previous) old.|')?.query).toBeUndefined();
    expect(at('WITH feed(id) AS (VALUES (1)), changed AS (' + merge + ' RETURNING WITH (OLD AS previous) previous.id AS removed) SELECT changed.| FROM changed')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['removed'] } }] });
    expect(at('WITH feed(id, extra) AS (VALUES (1,2)), changed AS (' + merge + ' RETURNING *) SELECT changed.| FROM changed')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['id', 'extra'], stars: [{ schema: 'app', name: 'orders' }] } }] });
  });
  it('MERGE 关系提示支持未完成的 INTO、USING、JOIN 和 ROWS FROM', () => {
    expect(at('WITH orders AS (SELECT 1) MERGE INTO or|')?.query).toEqual({ kind: 'relations', mergeTarget: true });
    expect(at('MERGE INTO ONLY ("业务".订|)')?.query).toEqual({ kind: 'relations', schema: '业务', mergeTarget: true });
    expect(at('MERGE INTO orders AS d| USING feed s ON true')?.query).toBeUndefined();
    expect(at('WITH feed AS (SELECT 1) MERGE INTO orders d USING fe|'))
      .toMatchObject({ query: { kind: 'relations', ctes: ['feed'] }, routine: { context: 'from' } });
    expect(at('MERGE INTO orders d USING ONLY staging.fe|'))
      .toMatchObject({ query: { kind: 'relations', schema: 'staging' } });
    expect(at('MERGE INTO orders d USING s LEFT JOIN LATERAL tool.ge|'))
      .toMatchObject({ routine: { context: 'from', schema: 'tool' } });
    const member = at('MERGE INTO orders d USING ROWS FROM (series(1), tool.re|cords(2)) ON true');
    expect(member).toMatchObject({ routine: { context: 'from', schema: 'tool' }, existingCall: true });
    expect(member?.query).toBeUndefined();
    expect(at('MERGE INTO orders d USING a JOIN b USING (i|d) ON true')?.routine).toBeUndefined();
  });
  it('MERGE 函数提示只在来源调用和分支表达式开启，识别现有调用参数', () => {
    const merge = 'MERGE INTO orders d USING incoming s ON true ';
    expect(at(merge + 'WHEN MATCHED AND tools.is_ok| THEN DELETE')?.routine).toEqual({ context: 'expression', schema: 'tools' });
    expect(at(merge + 'WHEN NOT MATCHED BY SOURCE AND s.is_ok| THEN DELETE')?.routine).toBeUndefined();
    expect(at(merge + 'WHEN MATCHED THEN UPDATE SET fo|')?.routine).toBeUndefined();
    expect(at(merge + 'WHEN MATCHED THEN DELETE RETURNING WITH (OLD AS previous) tools.show|')?.routine)
      .toEqual({ context: 'expression', schema: 'tools' });
    const signature = (marked: string) => analyzePostgresSignature(marked.replace('|', ''), marked.indexOf('|'));
    expect(signature('MERGE INTO orders d USING ROWS FROM (series(1), tool.records(1, |)) r ON true'))
      .toMatchObject({ name: 'records', argument: 1, routine: { context: 'from', schema: 'tool' } });
    expect(signature(merge + 'WHEN NOT MATCHED THEN INSERT (id) VALUES (tool.to_id(value => |))'))
      .toMatchObject({ name: 'to_id', named: 'value', routine: { context: 'expression', schema: 'tool' } });
  });
  it('作用域跟随光标，区分普通派生表、LATERAL、相关子查询与集合分支', () => {
    expect(at('SELECT (SELECT p.| FROM child) FROM parent p')?.query)
      .toMatchObject({ relations: [{ name: 'parent', alias: 'p' }] });
    expect(at('SELECT (SELECT p.| FROM child p) FROM parent p')?.query)
      .toMatchObject({ relations: [{ name: 'child', alias: 'p' }] });
    expect(at('SELECT * FROM parent p, (SELECT p.|) d')?.query).toBeUndefined();
    expect(at('SELECT * FROM parent p, LATERAL (SELECT p.|) d')?.query)
      .toMatchObject({ relations: [{ name: 'parent', alias: 'p' }] });
    expect(at('SELECT a.id FROM first a UNION ALL SELECT a.| FROM second a')?.query)
      .toMatchObject({ relations: [{ name: 'second', alias: 'a' }] });
    expect(at('SELECT 1 AS first UNION ALL SELECT 2 AS second ORDER BY fi|')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['first'] } }] });
    expect(at('WITH RECURSIVE t AS (SELECT 1 AS step UNION ALL SELECT t.| + 1 FROM t) SELECT * FROM t')?.query)
      .toMatchObject({ relations: [{ name: 't', projection: { names: ['step'], stars: [] } }] });
  });
  it('识别函数表达式、FROM 和 CALL，避开别名、列清单、赋值左侧和类型转换', () => {
    expect(at('SELECT "工具.甲"."混|合"(/* 间隔 */ 1)')).toMatchObject({ routine: { context: 'expression', schema: '工具.甲' }, existingCall: true });
    expect(at('SELECT * FROM LATERAL tool.gen|')).toMatchObject({ routine: { context: 'from', schema: 'tool' } });
    expect(at('CALL tool.bac|')).toMatchObject({ routine: { context: 'call', schema: 'tool' } });
    expect(at('CALL proc(upper(lo|))')?.routine).toEqual({ context: 'expression' });
    expect(at('SELECT 1 UNION ALL SELECT cou|')?.routine).toEqual({ context: 'expression' });
    expect(at('UPDATE t SET n=rou|')?.routine).toEqual({ context: 'expression' });
    for (const text of ['SELECT t.no| FROM s.t', 'INSERT INTO s.t (na|) VALUES (1)', 'UPDATE t SET a=1, na|',
      'SELECT * FROM a JOIN b USING (na|)', 'SELECT 1::te|', 'SELECT * FROM ONLY s.t|', 'DELETE FROM s.ta|']) {
      expect(at(text)?.routine).toBeUndefined();
    }
  });
});

/** 通过生产 provider 检查请求内容和插入文字。 */
function editor(marked: string, request: (input: PostgresCompletionInput) => Promise<PostgresCompletionResult>, sessionId?: string) {
  const offset = marked.indexOf('|');
  const sql = marked.replace('|', '');
  const position = { lineNumber: 1, column: offset + 1 } as monaco.Position;
  const disposable = { dispose() {} };
  const model = {
    getValue: () => sql, getValueLength: () => sql.length, getVersionId: () => 1,
    getOffsetAt: () => offset, getPositionAt: (index: number) => ({ lineNumber: 1, column: index + 1 }),
    isDisposed: () => false, onDidChangeContent: () => disposable,
  } as unknown as monaco.editor.ITextModel;
  const token: monaco.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => disposable };
  const provider = createPostgresCompletionProvider({
    scope: { tabId: '原页', connectionId: '原连接', database: '原库', connectionVersion: 1, sessionId },
    model: () => model, position: () => position, current: () => true,
    request,
    kinds: { schema: 1, table: 1, view: 1, column: 1, keyword: 1, routine: 1, variable: 1 },
    snippetRule: 4,
    status: () => {},
  });
  return { provider, suggest: () => provider.provideCompletionItems(model, position, { triggerKind: 0 }, token),
    signature: () => provider.signatureHelp.provideSignatureHelp(model, position, token, { triggerKind: 1, isRetrigger: false }),
    hover: () => provider.hover.provideHover(model, position, token) };
}

it('悬停仅发送结构化字段请求，保留原备注文字并拒绝歧义、短回包和迟到结果', async () => {
  const first = { kind: 'columnDetail', reference: 0, schema: 'app', relation: 'orders', name: 'amount', type: 'numeric(22,6)',
    nullable: false, expression: '0.00', generated: false, comment: '<b>金额</b>', temporary: false } as const;
  const request = vi.fn(async () => ({ items: [first], incomplete: false }));
  const exact = editor('SELECT o.am|ount FROM app.orders o', request, '原会话');
  const response = await exact.hover();
  expect(request).toHaveBeenCalledWith({ kind: 'columnDetails', connectionId: '原连接', database: '原库', sessionId: '原会话',
    prefix: 'amount', relations: [{ schema: 'app', name: 'orders' }] });
  expect(response?.contents[0]).toMatchObject({ value: expect.stringContaining('    允许NULL（目录）：否'), supportHtml: false, isTrusted: false });
  expect(response?.contents[0].value).toContain('    备注：<b>金额</b>');

  const ambiguous = editor('SELECT am|ount FROM app.orders a CROSS JOIN app.orders b', async () => ({
    items: [first, { ...first, reference: 1 }], incomplete: false,
  }));
  const conflict = (await ambiguous.hover())?.contents[0].value;
  expect(conflict).toContain('未限定字段存在多个候选来源');
  expect(conflict).toContain('"a" → "app"."orders"."amount"');
  expect(conflict).toContain('"b" → "app"."orders"."amount"');
  expect(conflict).not.toContain('numeric');

  const partial = editor('SELECT o.am|ount FROM app.orders o', async () => ({ items: [first], incomplete: true }));
  expect(await partial.hover()).toBeNull();
  let release: ((reply: PostgresCompletionResult) => void) | undefined;
  const stale = editor('SELECT o.am|ount FROM app.orders o', () => new Promise(resolve => { release = resolve; }));
  const pending = stale.hover();
  stale.provider.invalidate();
  release?.({ items: [first], incomplete: false });
  expect(await pending).toBeNull();
  for (const client of [exact, ambiguous, partial, stale]) client.provider.dispose();
});

it('物理字段目录只按完整解析的候选消歧，字段无权或关系未确认时拒绝其它候选代替', async () => {
  const input: PostgresCompletionInput = { kind: 'columnDetails', connectionId: '原连接', database: '原库', prefix: 'Amount',
    relations: [{ schema: 'sales', name: 'orders' }, { name: 'closed_orders' }] };
  const first = { c0: '1', c1: 'sales', c2: 'orders', c3: 't', c4: 'Amount', c5: 'numeric(28,7)', c6: 'f',
    c7: '1.00', c8: 'f', c9: null, c10: 'f' };
  const withoutName = { c0: '2', c3: 'f' };
  const unreadable = { c0: '2', c3: 't', c4: null };
  for (const [rows, incomplete] of [[[first, withoutName], false], [[first, unreadable], true], [[first], true]] as const) {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes('to_regclass') ? rows : [], truncated: false }));
    const connection = { database: '原库', query } as unknown as PostgresConnection;
    const result = await readPostgresCompletion(connection, input);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('pg_catalog.to_regclass'), [['"sales"."orders"', '"closed_orders"'], 'Amount'], expect.any(Object));
    expect(result.incomplete).toBe(incomplete);
    expect(result.items).toEqual(incomplete ? [] : [expect.objectContaining({ kind: 'columnDetail', name: 'Amount', nullable: false })]);
  }
});

it('离线参数补全优先建议本语句的匹配名称，整段替换并保留后续类型转换', async () => {
  const active = '[$ne_tail]', marked = "SELECT [$needle], [$Needle], '[$never]'; SELECT [$near], [$ne|_tail]::int, [$near]";
  const start = marked.indexOf('[$ne|_tail]');
  const request = vi.fn(async () => ({ items: [], incomplete: false }));
  const client = editor(marked, request);
  try {
    const result = await client.suggest();
    expect(result?.incomplete).toBe(true);
    expect(result?.suggestions.map(item => item.insertText)).toEqual(['[$near]', '[$needle]']);
    expect(result?.suggestions[0].range).toEqual({ startLineNumber: 1, startColumn: start + 1, endLineNumber: 1, endColumn: start + active.length + 1 });
    expect(request).not.toHaveBeenCalled();
  } finally { client.provider.dispose(); }
});

it('不在注释、引用或 dollar 标签内补全，未知字符串模式需要一致的参数绑定', () => {
  const complete = (marked: string, standardStrings?: boolean) =>
    postgresNamedParameterCompletion(marked.replace('|', ''), marked.indexOf('|'), standardStrings);
  for (const sample of ["'[$ne|]'", '"[$ne|]"', '$body$[$ne|]$body$', '1 /* [$ne|] */', '1 -- [$ne|]']) {
    expect(complete('SELECT [$needle]; SELECT ' + sample)).toBeNull();
  }
  for (const sample of ['arr[$1|]', 'arr[$tag|$value$tag$]', '[$中文|]', '[$' + 'a'.repeat(65) + '|]']) {
    expect(complete('SELECT [$needle]; SELECT ' + sample)).toBeUndefined();
  }
  const ambiguous = "SELECT [$|], 'a\\', [$needle], '--' ;";
  expect(complete(ambiguous)).toBeNull();
  expect(complete(ambiguous, true)?.items).toEqual([{ name: 'needle', local: true }]);
  expect(complete(ambiguous, false)?.items).toEqual([]);
});

it('参数悬停只给出原名、单句及整篇次数，排除相似文本且不读取目录', async () => {
  const request = vi.fn(async () => ({ items: [], incomplete: false }));
  const source = "SELECT [$needle], [$Needle]; SELECT [$ne|edle], [$needle], '[$needle]'; -- [$needle]";
  const client = editor(source, request);
  try {
    expect(await client.hover()).toMatchObject({ contents: [
      { value: '`[$needle]` · PostgreSQL 命名值参数' }, { value: '本语句 2 处 · 当前草稿 3 处' },
    ] });
    expect(postgresNamedParameterHover(source.replace('|', ''), source.lastIndexOf('needle'))).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  } finally { client.provider.dispose(); }
});

it('签名按名称或位置高亮，精确请求受原标签失效约束', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const response: PostgresCompletionResult = { incomplete: false, items: [
    { kind: 'routine', schema: '工具', name: 'Mix', arguments: '', returns: 'text', category: 'f', parameters: [
      { name: 'first', type: 'integer', mode: 'i', optional: false }, { name: 'second', type: 'text', mode: 'i', optional: true },
    ] }, { kind: 'routine', schema: '工具', name: 'Mix', arguments: '', returns: 'integer', category: 'f', parameters: [
      { name: 'other', type: 'integer', mode: 'i', optional: false },
    ] },
  ] };
  const named = editor('SELECT "工具"."Mix"(second => |)', async input => { inputs.push(input); return response; }, '原会话');
  const pending: ((result: PostgresCompletionResult) => void)[] = [];
  const old = editor('SELECT "工具"."Mix"(1, |)', () => new Promise(resolve => pending.push(resolve)));
  try {
    const current = (await named.signature())?.value;
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', sessionId: '原会话', kind: 'signatures', prefix: 'Mix',
      routine: { context: 'expression', schema: '工具' } }]);
    expect(current).toMatchObject({ activeParameter: 1, signatures: [{ activeParameter: 1 }] });
    const [signature] = current!.signatures;
    const range = signature.parameters[1].label as [number, number];
    expect(signature.label.slice(...range)).toBe('"second" text DEFAULT …');
    const lookup = old.signature();
    await expect.poll(() => pending.length).toBe(1);
    const latest = old.signature();
    expect(pending).toHaveLength(1);
    pending[0](response);
    expect(await lookup).toBeNull();
    await expect.poll(() => pending.length).toBe(2);
    old.provider.invalidate();
    pending[1](response);
    expect(await latest).toBeNull();
  } finally { named.provider.dispose(); old.provider.dispose(); }
});

it('本地投影不读取目录，同名物理列不可取代 CTE，通配结果使用外层别名', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => {
    inputs.push(input);
    return { items: [{ kind: 'column', reference: 0, name: 'note', type: 'text' }], incomplete: false };
  };
  const local = editor('WITH t AS (SELECT 1 AS "对外") SELECT t.对| FROM t', request);
  const star = editor('WITH t AS (SELECT q.* FROM real.orders q) SELECT no| FROM t d, other e', request);
  const duplicate = editor('SELECT d.no| FROM (SELECT t.*, 1 AS note FROM t) d', request);
  try {
    expect((await local.suggest())?.suggestions).toMatchObject([{ insertText: '"对外"' }]);
    expect(inputs).toEqual([]);
    expect((await star.suggest())?.suggestions).toMatchObject([{ insertText: '"d"."note"', detail: 'text' }]);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', prefix: 'no',
      kind: 'columns', routine: { context: 'expression' }, relations: [{ schema: 'real', name: 'orders' }, { name: 'other' }] }]);
    expect((await duplicate.suggest())?.suggestions).toEqual([]);
  } finally {
    local.provider.dispose();
    star.provider.dispose();
    duplicate.provider.dispose();
  }
});

it('表函数声明列补全使用安全引用和原文替换范围，零目录请求', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput) => {
    inputs.push(input);
    return { items: [], incomplete: false };
  };
  const local = editor('SELECT r.对|旧 FROM ROWS FROM (get_records() AS ("对外""值" int)) WITH ORDINALITY AS r', request);
  const duplicate = editor('SELECT r.ordi| FROM ROWS FROM (get_records() AS (ordinality int)) WITH ORDINALITY AS r', request);
  try {
    expect((await local.suggest())?.suggestions).toMatchObject([{ insertText: '"对外""值"',
      range: { startColumn: 10, endColumn: 12 } }]);
    expect((await duplicate.suggest())?.suggestions).toEqual([]);
    expect(inputs).toEqual([]);
  } finally { local.provider.dispose(); duplicate.provider.dispose(); }
});

it('JSON_TABLE 声明列直接补全，保持已输入的标识符范围且零目录请求', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const local = editor(`SELECT j.名|旧 FROM JSON_TABLE('{}', '$' COLUMNS (NESTED '$' COLUMNS ("名称" text))) j`,
    async input => { inputs.push(input); return { items: [], incomplete: false }; });
  try {
    expect((await local.suggest())?.suggestions).toMatchObject([{ insertText: '"名称"', range: { startColumn: 10, endColumn: 12 } }]);
    expect(inputs).toEqual([]);
  } finally { local.provider.dispose(); }
});

it('XMLTABLE 声明列补全保留引号和光标后的原标识符范围', async () => {
  const request = vi.fn(async () => ({ items: [], incomplete: false }));
  const local = editor(`SELECT x.名|旧 FROM XMLTABLE('/r' PASSING xmlparse(document '<r/>') COLUMNS "名称" text) x`, request);
  try {
    expect((await local.suggest())?.suggestions).toMatchObject([{ insertText: '"名称"', range: { startColumn: 10, endColumn: 12 } }]);
    expect(request).not.toHaveBeenCalled();
  } finally { local.provider.dispose(); }
});

it('MERGE 只向目录发送当前目标身份，本地来源字段直接补全', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => {
    inputs.push(input);
    return { items: [{ kind: 'column', reference: 0, name: 'note', type: 'text' }], incomplete: false };
  };
  const merge = 'MERGE INTO app.orders d USING (SELECT 1 AS "编号") s ON true WHEN MATCHED THEN DELETE';
  const source = editor(merge + ' RETURNING s.编|', request);
  const target = editor(merge + ' RETURNING WITH (OLD AS previous) previous.no|', request);
  try {
    expect((await source.suggest())?.suggestions).toMatchObject([{ insertText: '"编号"' }]);
    expect(inputs).toEqual([]);
    expect((await target.suggest())?.suggestions).toMatchObject([{ insertText: '"note"', detail: 'text' }]);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', prefix: 'no', kind: 'columns',
      relations: [{ schema: 'app', name: 'orders', columnAccess: 'select' }] }]);
  } finally { source.provider.dispose(); target.provider.dispose(); }
});

it('MERGE 目录请求区分目标和来源，保留原会话与例程类别', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput) => {
    inputs.push(input);
    return { items: [], incomplete: false };
  };
  const target = editor('WITH orders AS (SELECT 1) MERGE INTO app.or|', request, '原会话');
  const source = editor('WITH local_feed AS (SELECT 1) MERGE INTO orders USING local_|', request, '原会话');
  try {
    expect((await target.suggest())?.suggestions).toEqual([]);
    expect((await source.suggest())?.suggestions).toMatchObject([{ insertText: '"local_feed"' }]);
    expect(inputs).toEqual([
      { connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: 'or', kind: 'relations', schema: 'app', mergeTarget: true },
      { connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: 'local_', kind: 'relations', routine: { context: 'from' } },
    ]);
  } finally { target.provider.dispose(); source.provider.dispose(); }
});

it('表函数返回列沿原会话查询，候选类型未知时保留名称', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const source = editor('SELECT f.co| FROM api.feed(1) AS f', async input => {
    inputs.push(input);
    return { items: [{ kind: 'column', reference: 0, name: 'common', type: '' }], incomplete: false };
  }, '原会话');
  try {
    const suggestions = (await source.suggest())?.suggestions;
    expect(suggestions).toMatchObject([{ label: { label: 'common', description: 'f' }, insertText: '"common"' }]);
    expect(suggestions?.[0].detail).toBeUndefined();
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: 'co', kind: 'columns',
      relations: [{ schema: 'api', name: 'feed', functionCall: { argumentCount: 1, scalarAlias: 'f' } }] }]);
  } finally { source.provider.dispose(); }
});

it('位置别名与目录证明的剩余列一起补全，只向原会话发送有序成员', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const source = editor('SELECT r.| FROM ROWS FROM (api.feed(1), api.tags() AS (tag text)) WITH ORDINALITY AS r(key,amount)',
    async input => {
      inputs.push(input);
      return { items: [{ kind: 'column', reference: 0, name: 'tag', type: '' },
        { kind: 'column', reference: 0, name: 'ordinality', type: 'bigint' }], incomplete: false };
    }, '原会话');
  try {
    expect((await source.suggest())?.suggestions?.map(item => item.insertText)).toEqual(['"key"', '"amount"', '"tag"', '"ordinality"']);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: '', kind: 'columns', relations: [
      { name: 'feed', functionLayout: { aliasCount: 2, ordinality: true, members: [
        { kind: 'function', schema: 'api', name: 'feed', call: { argumentCount: 1 } }, { kind: 'declared', names: ['tag'] },
      ] } },
    ] }]);
  } finally { source.provider.dispose(); }
});

it('切走再返回原标签时丢弃迟到目录，并由原承诺串行收尾', async () => {
  const pending: ((result: PostgresCompletionResult) => void)[] = [];
  const { provider, suggest } = editor('SELECT * FROM test|', () => new Promise(resolve => pending.push(resolve)));
  try {
    const old = suggest();
    await expect.poll(() => pending.length).toBe(1);
    provider.invalidate();
    const latest = suggest();
    pending[0]({ items: [{ kind: 'table', schema: '旧', name: 'test_old' }], incomplete: false });
    expect((await old)?.suggestions).toEqual([]);
    await expect.poll(() => pending.length).toBe(2);
    pending[1]({ items: [{ kind: 'table', schema: '新', name: 'test_new' }], incomplete: false });
    expect((await latest)?.suggestions).toMatchObject([{ insertText: '"新"."test_new"' }]);
  } finally { provider.dispose(); }
});

it('物理目录延后时保留本地 CTE 候选，并且只投递原会话', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const { provider, suggest } = editor('WITH x AS (SELECT 1 AS value) SELECT * FROM x|', async input => {
    inputs.push(input);
    return { items: [], incomplete: false, deferred: 'transaction' };
  }, '原会话');
  try {
    expect((await suggest())?.suggestions).toMatchObject([{ insertText: '"x"' }]);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', prefix: 'x',
      kind: 'relations', routine: { context: 'from' }, sessionId: '原会话' }]);
  } finally { provider.dispose(); }
});

it('按原会话请求重载，安全插入调用括号且保留现有括号', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => {
    inputs.push(input);
    return { incomplete: false, items: [{ kind: 'routine', schema: '工具', name: '算$"法', category: 'f', arguments: 'value integer', returns: 'bigint' },
      { kind: 'routine', schema: '工具', name: '算$"法', category: 'f', arguments: 'value text', returns: 'text' }] };
  };
  const fresh = editor('SELECT "工具".算|', request, '原会话');
  const existing = editor('SELECT "工具".算| /* 注释 */ (1)', request, '原会话');
  try {
    expect((await fresh.suggest())?.suggestions).toMatchObject([
      { label: { label: '算$"法', detail: '(value integer)', description: '工具 → bigint' }, insertText: '"算\\$""法"($0)', insertTextRules: 4 },
      { label: { detail: '(value text)' } },
    ]);
    expect(inputs[0]).toEqual({ connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: '算', kind: 'routines',
      routine: { context: 'expression', schema: '工具' } });
    expect((await existing.suggest())?.suggestions).toMatchObject([{ insertText: '"算$""法"' }, { insertText: '"算$""法"' }]);
  } finally { fresh.provider.dispose(); existing.provider.dispose(); }
});

it('目录失败只回滚自己的读取事务，回滚失效时封住原会话', async () => {
  const input = { kind: 'relations', connectionId: '原连接', database: '原库', prefix: '' } as const;
  for (const rollbackFails of [false, true]) {
    const calls: string[] = [];
    let transactionOpen = false;
    const connection = {
      database: '原库', broken: false,
      state: () => ({ transactionKnown: true, transactionOpen }),
      query: async (sql: string) => {
        calls.push(sql.trim());
        if (sql.startsWith('BEGIN')) transactionOpen = true;
        if (sql.includes('WITH namespaces')) throw Error('原目录读取失败');
        if (sql === 'ROLLBACK') {
          if (rollbackFails) throw Error('原回滚失败');
          transactionOpen = false;
        }
        return { rows: [] };
      },
    } as unknown as PostgresConnection;
    await expect(readPostgresCompletion(connection, input, true)).rejects.toThrow(rollbackFails ? '原回滚失败' : '原目录读取失败');
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(connection.broken).toBe(rollbackFails);
    expect(transactionOpen).toBe(rollbackFails);
  }
});
