import type { CellValue, DataRow } from '../../shared/contracts';
import type { PostgresColumnPrivilege, PostgresColumnPrivilegeRow, PostgresRole, PostgresRoleDetail, PostgresRoleMembership,
  PostgresRolePrivilege, PostgresRolesInput, PostgresRolesOutput, PostgresObjectPrivilege } from '../../shared/postgresRoles';
import type { PostgresConnection } from './connection';

const roleFields = 'r.oid::text,r.rolname::text,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,r.rolconnlimit::text,r.rolvaliduntil::text';
const pageSize = 50, memberLimit = 200;
const columnPageSize = 32;
const invalid = () => Error('PostgreSQL 角色目录返回不完整');
const text = (value: CellValue): string => { if (typeof value !== 'string') throw invalid(); return value; };
const nullableText = (value: CellValue): string | null => value === null ? null : text(value);
const flag = (value: CellValue): boolean => { if (value !== 't' && value !== 'f') throw invalid(); return value === 't'; };
const nullableFlag = (value: CellValue): boolean | null => value === null ? null : flag(value);
function readRole(row: DataRow): PostgresRole {
  const connectionLimit = Number(text(row.c9));
  if (!Number.isSafeInteger(connectionLimit)) throw invalid();
  return {oid: text(row.c0), name: text(row.c1), login: flag(row.c2), superuser: flag(row.c3), inherit: flag(row.c4),
    createRole: flag(row.c5), createDatabase: flag(row.c6), replication: flag(row.c7), bypassRls: flag(row.c8),
    connectionLimit, validUntil: nullableText(row.c10)};
}

/** 只投影角色属性和授权目录。用户名、对象名、过滤词始终以绑定值传递。 */
export async function readPostgresRoles(connection: PostgresConnection, input: PostgresRolesInput, check: () => void): Promise<PostgresRolesOutput> {
  const rows = async (sql: string, values: unknown[], limit: number) => {
    check();
    const result = await connection.query(sql, values, {rows: limit, bytes: 512 * 1024});
    check();
    if (result.truncated) throw invalid();
    return result.rows;
  };
  check();
  const begun = await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined, {rows: 0, bytes: 1024});
  if (begun.postgresCommand !== 'BEGIN' || !connection.state().transactionOpen) throw invalid();
  const [identity] = await rows(`SELECT pg_catalog.current_database()::text,session_user::text,current_user::text,r.oid::text
    FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`, [], 1);
  if (!identity) throw invalid();
  const context = {database: text(identity.c0), login: text(identity.c1), current: {name: text(identity.c2), oid: text(identity.c3)}};
  let output: PostgresRolesOutput;
  if (input.kind === 'list') {
    const found = await rows(`SELECT ${roleFields} FROM pg_catalog.pg_roles r
      WHERE pg_catalog.strpos(pg_catalog.lower(r.rolname::text),pg_catalog.lower($1::text))>0
        AND ($2::text IS NULL OR r.rolname::text COLLATE pg_catalog."C">$2::text COLLATE pg_catalog."C")
      ORDER BY r.rolname::text COLLATE pg_catalog."C" LIMIT 51`, [input.search, input.after ?? null], pageSize + 1);
    const roles = found.slice(0, pageSize).map(readRole);
    output = {kind: 'list', ...context, roles, ...(found.length > pageSize ? {next: roles.at(-1)!.name} : {})};
  } else {
    const [row] = await rows(`SELECT ${roleFields} FROM pg_catalog.pg_roles r WHERE r.oid=$1::oid AND r.rolname::text=$2::text`,
      [input.role.oid, input.role.name], 1);
    if (!row) throw Error('所选 PostgreSQL 角色已变化，请重新读取目录');
    const role = readRole(row);
    const memberships = async (direction: 'granted' | 'members') => {
      const owner = direction === 'granted' ? 'member' : 'roleid', peer = direction === 'granted' ? 'roleid' : 'member';
      // PG16 开始按授权记录保存 INHERIT 和 SET，旧版本显示未知而不猜权限。
      const result = await rows(`SELECT p.oid::text,p.rolname::text,g.rolname::text,m.admin_option,
        (pg_catalog.to_jsonb(m)->>'inherit_option')::boolean,(pg_catalog.to_jsonb(m)->>'set_option')::boolean,g.oid::text
        FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.${peer}
        LEFT JOIN pg_catalog.pg_roles g ON g.oid=m.grantor WHERE m.${owner}=$1::oid
        ORDER BY p.rolname::text COLLATE pg_catalog."C",m.grantor LIMIT 201`, [role.oid], memberLimit + 1);
      return {limited: result.length > memberLimit, edges: result.slice(0, memberLimit).map((edge): PostgresRoleMembership => ({
        peer: {oid: text(edge.c0), name: text(edge.c1)}, grantor: nullableText(edge.c2), grantorOid: nullableText(edge.c6), admin: flag(edge.c3),
        inherit: nullableFlag(edge.c4), set: nullableFlag(edge.c5),
      }))};
    };
    const granted = await memberships('granted'), members = await memberships('members');
    const privilege = (entry: DataRow): PostgresRolePrivilege => ({name: text(entry.c0), allowed: flag(entry.c1), grantable: flag(entry.c2)});
    /** 仅读取对象所有者对当前所选角色的直接记录，避免把 PUBLIC 或继承误当成直接授权。 */
    const directPrivileges = async (kind: 'database' | 'schema' | 'table', objectOid: string) => {
      const {catalog, acl, owner} = {
        database: {catalog: 'pg_database', acl: 'datacl', owner: 'datdba'},
        schema: {catalog: 'pg_namespace', acl: 'nspacl', owner: 'nspowner'},
        table: {catalog: 'pg_class', acl: 'relacl', owner: 'relowner'},
      }[kind];
      const direct = await rows(`SELECT a.privilege_type,a.is_grantable FROM pg_catalog.${catalog} c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.${acl}) a
        WHERE c.oid=$1::oid AND a.grantor=c.${owner} AND a.grantee=$2::oid ORDER BY a.privilege_type`, [objectOid, role.oid], 8);
      return direct.map(entry => ({privilege: text(entry.c0) as PostgresObjectPrivilege, grantable: flag(entry.c1)}));
    };
    const databaseRows = await rows(`SELECT p.name,pg_catalog.has_database_privilege($1::oid,d.oid,p.name),
      pg_catalog.has_database_privilege($1::oid,d.oid,p.name||' WITH GRANT OPTION'),d.oid::text,owner.rolname::text,
      d.datdba<>$1::oid AND NOT d.datistemplate AND (d.datdba=actor.oid OR actor.rolsuper)
      FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles owner ON owner.oid=d.datdba
      JOIN pg_catalog.pg_roles actor ON actor.oid=$2::oid CROSS JOIN (VALUES ('CONNECT'),('CREATE'),('TEMPORARY')) p(name)
      WHERE d.datname=pg_catalog.current_database()`, [role.oid, context.current.oid], 3);
    const databasePrivileges = databaseRows.map(privilege);
    const databaseRow = databaseRows[0];
    const databaseEditor = databaseRow && flag(databaseRow.c5) ? {
      object: {kind: 'database' as const, oid: text(databaseRow.c3), name: context.database},
      grantor: text(databaseRow.c4), direct: await directPrivileges('database', text(databaseRow.c3)),
    } : undefined;
    let scope: PostgresRoleDetail['scope'];
    if (input.scope) {
      const {schema, relation} = input.scope;
      const schemas = await rows(`SELECT p.name,pg_catalog.has_schema_privilege($1::oid,n.oid,p.name),
        pg_catalog.has_schema_privilege($1::oid,n.oid,p.name||' WITH GRANT OPTION'),n.oid::text,owner.rolname::text,
        n.nspowner<>$1::oid AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND (n.nspowner=actor.oid OR actor.rolsuper OR owner.rolname='pg_database_owner' AND d.datdba=actor.oid)
        FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles owner ON owner.oid=n.nspowner
        JOIN pg_catalog.pg_roles actor ON actor.oid=$3::oid CROSS JOIN pg_catalog.pg_database d
        CROSS JOIN (VALUES ('USAGE'),('CREATE')) p(name)
        WHERE n.nspname::text COLLATE pg_catalog."C"=$2::text AND d.datname=pg_catalog.current_database()`,
        [role.oid, schema, context.current.oid], 2);
      scope = {schema: schemas.length ? schemas.map(privilege) : null};
      const firstSchema = schemas[0];
      if (firstSchema && flag(firstSchema.c5)) {
        const oid = text(firstSchema.c3);
        scope.schemaEditor = {object: {kind: 'schema', oid, name: schema}, grantor: text(firstSchema.c4), direct: await directPrivileges('schema', oid)};
      }
      if (relation !== undefined) {
        const relations = await rows(`SELECT p.name,pg_catalog.has_table_privilege($1::oid,c.oid,p.name),
          pg_catalog.has_table_privilege($1::oid,c.oid,p.name||' WITH GRANT OPTION'),c.relrowsecurity,c.relforcerowsecurity,
          c.oid::text,pg_catalog.pg_get_userbyid(c.relowner)::text,
          c.relowner<>$1::oid AND c.relkind IN ('r','p','v') AND c.relpersistence<>'t'
            AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
            AND (c.relowner=$4::oid OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=$4::oid AND rolsuper))
          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
          WHERE n.nspname::text=$2::text AND c.relname::text=$3::text AND c.relkind IN ('r','p','v','m','f')
            AND (p.name<>'MAINTAIN' OR pg_catalog.current_setting('server_version_num')::int>=170000)`,
          [role.oid, schema, relation, context.current.oid], 8);
        const first = relations[0];
        scope.relation = first ? {oid: text(first.c5), privileges: relations.map(privilege), rls: flag(first.c3), forceRls: flag(first.c4)} : null;
        if (scope.relation && flag(first.c7)) {
          const oid = text(first.c5);
          scope.relation.editor = {table: {oid, schema, name: relation}, grantor: text(first.c6), direct: await directPrivileges('table', oid)};
        }
        if (input.scope.columns) {
          if (!scope.relation || scope.relation.oid !== input.scope.columns.relationOid) throw Error('列权限的原关系已变化，请重新检查对象权限');
          const columnRows = await rows(`WITH cols AS (
            SELECT a.attnum,a.attname,a.attacl,c.relowner FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
            WHERE c.oid=$1::oid AND a.attnum>$3::smallint AND NOT a.attisdropped ORDER BY a.attnum LIMIT ${columnPageSize + 1}
          )
          SELECT col.attnum::text,col.attname::text,p.name,pg_catalog.has_column_privilege($2::oid,$1::oid,col.attnum,p.name),
            pg_catalog.has_column_privilege($2::oid,$1::oid,col.attnum,p.name||' WITH GRANT OPTION'),a.is_grantable
          FROM cols col CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(name)
          LEFT JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
            ON a.grantee=$2::oid AND a.grantor=col.relowner AND a.privilege_type=p.name
          ORDER BY col.attnum,p.name`, [scope.relation.oid, role.oid, input.scope.columns.after], (columnPageSize + 1) * 4);
          const columns = new Map<number, PostgresColumnPrivilegeRow>();
          for (const entry of columnRows) {
            const number = Number(text(entry.c0)), name = text(entry.c1);
            const row = columns.get(number) ?? {column: {number, name}, privileges: []};
            row.privileges.push({name: text(entry.c2) as PostgresColumnPrivilege, allowed: flag(entry.c3),
              grantable: flag(entry.c4), direct: nullableFlag(entry.c5)});
            columns.set(number, row);
          }
          const page = [...columns.values()].slice(0, columnPageSize);
          scope.relation.columns = {rows: page, ...(columns.size > columnPageSize ? {next: page.at(-1)!.column.number} : {})};
        }
      }
    }
    output = {kind: 'detail', ...context, role, memberships: {granted: granted.edges, members: members.edges, limited: granted.limited || members.limited},
      databasePrivileges, ...(databaseEditor ? {databaseEditor} : {}), ...(scope ? {scope} : {})};
  }
  check();
  const ended = await connection.query('COMMIT', undefined, {rows: 0, bytes: 1024});
  if (ended.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) throw invalid();
  return output;
}
