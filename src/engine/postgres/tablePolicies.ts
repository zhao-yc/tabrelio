import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresPolicyRequiresReplacement, type PostgresPolicyCatalog, type PostgresPolicyDefinition } from '../../shared/postgresPolicy';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import type { PostgresConnection } from './connection';
import { readPostgresStructureFacts } from './relationStructure';

const budget = () => ({ rows: 65, bytes: 32 * 1024 });

/** PUBLIC 使用服务器的伪角色 OID，其他角色在预览和锁后按精确名称核对身份。 */
async function bindRoles(connection: PostgresConnection, roles: PostgresPolicyDefinition['roles']) {
  if (roles === null) return ['0'];
  const result = await connection.query(`
    SELECT r.oid::text FROM pg_catalog.jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS draft(name, pos)
    JOIN pg_catalog.pg_roles r ON r.rolname::text COLLATE pg_catalog."C" = draft.name
    ORDER BY draft.pos
  `, [JSON.stringify(roles)], budget());
  if (result.truncated || result.rows.length !== roles.length || result.rows.some(row => typeof row.c0 !== 'string'))
    throw Error('策略角色不存在，请核对准确名称');
  return result.rows.map(row => String(row.c0)).sort();
}

const rolesSql = (roles: PostgresPolicyDefinition['roles']) => ' TO ' + (roles === null ? 'PUBLIC' : roles.map(postgresIdentifier).join(', '));
// 固定的括号和换行确保表达式末尾的注释不会吞掉下一条子句。
const clause = (label: string, value: string | null) => value === null ? '' : ' ' + label + ' (\n' + value + '\n)';

function createPolicySql(policy: string, definition: PostgresPolicyDefinition) {
  return 'CREATE POLICY ' + policy + ' AS ' + (definition.permissive ? 'PERMISSIVE' : 'RESTRICTIVE') +
    ' FOR ' + definition.command + rolesSql(definition.roles) + clause('USING', definition.using) + clause('WITH CHECK', definition.check);
}

/** 策略与 RLS 状态绑定原关系。重建只有在 PostgreSQL 无法原位修改时才使用，且整个批次原子提交。 */
export async function postgresTablePolicyPlan(connection: PostgresConnection,
  draft: Extract<PostgresTableManageInput, { action: 'policy' }>) {
  const original = await readPostgresStructureFacts(connection, draft.table);
  const { output } = original, { change } = draft;
  const policies = output.policies;
  const changed = '原表、行级安全状态或策略已变化，请刷新结构后重试';
  if (!policies || output.database !== draft.database || output.policyStamp !== draft.stamp) throw Error(changed);
  const table = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
  const originalPolicy = 'from' in change ? policies.find(policy => policy.name === change.from) : undefined;
  if ('from' in change && !originalPolicy) throw Error('所选策略不存在');
  if ('name' in change && policies.some(policy => policy.name === change.name)) throw Error('表中已有同名策略');
  const definition = change.kind === 'create' || change.kind === 'edit' ? change : undefined;
  const roles = definition ? await bindRoles(connection, definition.roles) : undefined;
  const replacing = change.kind === 'edit' && postgresPolicyRequiresReplacement(originalPolicy!, change);
  if (replacing && originalPolicy?.rebuildBlocked) throw Error('策略有扩展依赖或安全标签，不能重建');
  const name = change.kind === 'create' ? change.name : originalPolicy?.name;
  const qualified = name ? postgresIdentifier(name) + ' ON ' + table : '';
  const statements: string[] = [];
  const alterTable = 'ALTER TABLE ONLY ' + table + ' ';
  switch (change.kind) {
    case 'create': statements.push(createPolicySql(qualified, change)); break;
    case 'rename': statements.push('ALTER POLICY ' + qualified + ' RENAME TO ' + postgresIdentifier(change.name)); break;
    case 'drop': statements.push('DROP POLICY ' + qualified + ' RESTRICT'); break;
    case 'state':
      if (change.enabled !== output.rowSecurity) statements.push(alterTable + (change.enabled ? 'ENABLE' : 'DISABLE') + ' ROW LEVEL SECURITY');
      if (change.forced !== output.forceRowSecurity) statements.push(alterTable + (change.forced ? 'FORCE' : 'NO FORCE') + ' ROW LEVEL SECURITY');
      break;
    case 'edit':
      if (replacing) {
        statements.push('DROP POLICY ' + qualified + ' RESTRICT', createPolicySql(qualified, change));
        if (originalPolicy!.comment !== null) statements.push('COMMENT ON POLICY ' + qualified + ' IS ' + postgresDdlLiteral(originalPolicy!.comment));
      } else {
        const assignments = [
          roles!.join(',') === originalPolicy!.roles.map(role => role.oid).sort().join(',') ? '' : rolesSql(change.roles),
          change.using === originalPolicy!.using ? '' : clause('USING', change.using),
          change.check === originalPolicy!.check ? '' : clause('WITH CHECK', change.check),
        ].join('');
        if (assignments) statements.push('ALTER POLICY ' + qualified + assignments);
      }
      break;
  }
  if (!statements.length) throw Error('策略或行级安全状态没有变化');
  if (!connection.standardStrings) throw Error('策略表达式的字符串模式未确认');
  for (const sql of statements) await connection.query(sql, undefined, budget(), undefined, 'parse');

  function matchesDefinition(actual: PostgresPolicyCatalog) {
    if (!definition || actual.name !== name || actual.command !== definition.command || actual.permissive !== definition.permissive ||
        actual.roles.map(role => role.oid).sort().join(',') !== roles!.join(',') ||
        actual.comment !== (originalPolicy?.comment ?? null) || actual.rebuildBlocked !== (originalPolicy?.rebuildBlocked ?? false)) return false;
    // 服务器可能规范化新表达式。清除、保留的条件和目录身份都可直接比对。
    return (['using', 'check'] as const).every(key =>
      definition[key] === null || definition[key] === originalPolicy?.[key] ? actual[key] === definition[key] : !!actual[key]);
  }

  return {
    table, statements, protocol: 'extended' as const, readCommitted: true as const,
    lock: 'LOCK TABLE ONLY ' + table + ' IN ACCESS EXCLUSIVE MODE',
    success: 'PostgreSQL 行级安全改动已确认提交',
    async preflight(current: PostgresConnection) {
      const actual = await readPostgresStructureFacts(current, table);
      if (actual.oid !== original.oid || actual.output.policyStamp !== draft.stamp) throw Error(changed);
      if (definition && (await bindRoles(current, definition.roles)).join(',') !== roles!.join(','))
        throw Error('策略角色身份已变化，请重新预览');
      return draft.stamp;
    },
    async verify(current: PostgresConnection) {
      const actual = await readPostgresStructureFacts(current, table);
      const expected = new Map(policies.map(policy => [policy.oid, policy]));
      if (change.kind === 'drop' || replacing) expected.delete(originalPolicy!.oid);
      if (change.kind === 'rename') expected.set(originalPolicy!.oid, { ...originalPolicy!, name: change.name });
      const adds = change.kind === 'create' || replacing;
      const finalPolicies = actual.output.policies;
      if (actual.oid !== original.oid || !actual.output.policyStamp ||
          actual.output.rowSecurity !== (change.kind === 'state' ? change.enabled : output.rowSecurity) ||
          actual.output.forceRowSecurity !== (change.kind === 'state' ? change.forced : output.forceRowSecurity) ||
          !finalPolicies || finalPolicies.length !== expected.size + Number(adds) ||
          !finalPolicies.every(policy => {
            if (change.kind === 'edit' && policy.oid === originalPolicy!.oid)
              return !replacing && matchesDefinition(policy);
            const prior = expected.get(policy.oid);
            return prior ? JSON.stringify(prior) === JSON.stringify(policy) : adds && matchesDefinition(policy);
          })) throw Error('实际行级安全策略与预览不同，未提交');
    },
  };
}
