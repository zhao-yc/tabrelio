import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { sqliteParameterPlan } from '../../src/engine/sqlite/parameters';
import { validLocalRename } from '../../src/shared/localRename';
import { sqliteReferenceContext } from '../../src/shared/sqliteCompletionAnalysis';
import { analyzeSqliteLocalReferences, validSqliteLocalReferences } from '../../src/shared/sqliteLocalReferences';
import { analyzeSqliteLocalRename } from '../../src/shared/sqliteLocalRename';

const first = "SELECT :Key AS written, ':Key🚢' AS literal, :key AS lowercase /* :Key */;\r\n";
const second = 'SELECT :Other AS other, :Key AS reused; -- :Key';
const script = first + second;
const start = script.indexOf(':Key'), reused = first.length + second.indexOf(':Key');
const occurrences = [start, reused].map(start => ({ start, end: start + ':Key'.length }));

it.each([start, start + 1, reused + ':Key'.length])('跨语句返回全部精确范围，没有虚构声明 %d', offset => {
  const result = analyzeSqliteLocalReferences(script, offset);
  expect(result).toEqual({ status: 'ready', target: offset < reused ? occurrences[0] : occurrences[1], declaration: null, references: occurrences });
  expect(validSqliteLocalReferences(result, script, offset)).toBe(true);
  expect(validSqliteLocalReferences({ ...result, references: [occurrences[0]] }, script, offset)).toBe(false);
  expect(validSqliteLocalReferences({ ...result, references: Array(2) }, script, offset)).toBe(false);
  expect(validSqliteLocalReferences({ ...result, declaration: occurrences[0] }, script, offset)).toBe(false);
});

it('按原文范围整组重命名，可以用新名称执行两个 SQLite 语句', () => {
  const context = sqliteReferenceContext(script, start), result = analyzeSqliteLocalRename(script, start, 'KEY');
  expect(result).toEqual({ status: 'ready', kind: 'parameter', name: ':Key', target: occurrences[0], edits: occurrences.map(range => ({ ...range, text: ':KEY' })) });
  if (result.status !== 'ready') throw Error(result.reason);
  expect(validLocalRename(result, context, 'sqlite', ':KEY')).toBe(true);
  expect(validLocalRename({ ...result, edits: [result.edits[0]] }, context, 'sqlite', 'KEY')).toBe(false);
  expect(validLocalRename({ ...result, edits: Array(2) }, context, 'sqlite', 'KEY')).toBe(false);
  expect(validLocalRename({ ...result, edits: result.edits.map(edit => ({ ...edit, text: 'KEY' })) }, context, 'sqlite', 'KEY')).toBe(false);
  const renamed = result.edits.reduceRight((sql, edit) => sql.slice(0, edit.start) + edit.text + sql.slice(edit.end), script);
  expect(sqliteParameterPlan(renamed).names).toEqual(['KEY', 'key', 'Other']);
  const database = new DatabaseSync(':memory:');
  try {
    expect(database.prepare(renamed.slice(0, first.length)).get({ ':KEY': 7, ':key': 4 })).toEqual({ written: 7, literal: ':Key🚢', lowercase: 4 });
    expect(database.prepare(renamed.slice(first.length)).get({ ':Other': 1, ':KEY': 7 })).toEqual({ other: 1, reused: 7 });
  } finally { database.close(); }
});

it.each(['key', ':Other'])('已存在的精确名称 %s 不会合并绑定', name => {
  expect(analyzeSqliteLocalRename(script, start, name)).toEqual({ status: 'blocked', reason: 'parameter-collision' });
});

it.each([':7', '::new', '中文', 'a b', 'a'.repeat(65)])('不允许改成超出绑定格式的 %s', name => {
  expect(analyzeSqliteLocalRename(script, start, name)).toEqual({ status: 'blocked', reason: 'parameter-name' });
});

it('已有或目标名称命中显式模板时拒绝修改，字符串或注释中的模板无影响', () => {
  expect(analyzeSqliteLocalRename('SELECT :Key, [$Key]', start)).toEqual({ status: 'blocked', reason: 'parameter-template' });
  expect(analyzeSqliteLocalRename('SELECT :Key; SELECT [$other]', start, 'other')).toEqual({ status: 'blocked', reason: 'parameter-template' });
  expect(analyzeSqliteLocalRename("SELECT :Key, '[$other]' /* [$other] */", start, 'other')).toMatchObject({ status: 'ready', edits: [{ ...occurrences[0], text: ':other' }] });
});

it('只引用完整原生占位符且允许只有一处；超出预算不交付部分范围', () => {
  const source = 'SELECT :Key, :Key::path, :Key(:Key), @Key, $Key, [$Key]';
  expect(analyzeSqliteLocalReferences(source, start)).toMatchObject({ status: 'ready', declaration: null, references: [occurrences[0]] });
  expect(analyzeSqliteLocalReferences(source, source.indexOf(':Key::') + 1)).toMatchObject({ status: 'blocked' });
  expect(analyzeSqliteLocalRename('SELECT :Key', start, 'next')).toMatchObject({ status: 'ready', edits: [{ ...occurrences[0], text: ':next' }] });
  const long = 'SELECT ' + Array(257).fill(':Key').join(',');
  expect(analyzeSqliteLocalReferences(long, start)).toEqual({ status: 'blocked', reason: 'budget' });
  expect(analyzeSqliteLocalRename(long, start)).toEqual({ status: 'blocked', reason: 'budget' });
});
