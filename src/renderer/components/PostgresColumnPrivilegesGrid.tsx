import type { ReactNode } from 'react';
import { postgresColumnPrivileges, type PostgresColumnPrivilegeRef, type PostgresColumnPrivilegeRow } from '../../shared/postgresRoles';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';

const t = roles.tablePrivileges.column;
type Privilege = PostgresColumnPrivilegeRow['privileges'][number];
const describe = (allowed: boolean, grantable: boolean) => grantable ? t.withOption : allowed ? roles.yes : roles.no;

export function PostgresColumnPrivilegesGrid({rows, control}: {
  rows: PostgresColumnPrivilegeRow[];
  control?(column: PostgresColumnPrivilegeRef, privilege: Privilege): ReactNode;
}) {
  if (!rows.length) return <p>{t.none}</p>;
  return <div className="postgres-column-privileges">
    <table aria-label={t.label}>
      <thead><tr><th scope="col">{t.column}</th>{postgresColumnPrivileges.map(name => <th key={name} scope="col">{name}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.column.number}>
        <th scope="row">{row.column.name}</th>
        {postgresColumnPrivileges.map(name => {
          const privilege = row.privileges.find(item => item.name === name);
          return <td key={name}>{privilege && <>
            {control?.(row.column, privilege)}
            <div>{t.effective} {describe(privilege.allowed, privilege.grantable)}</div>
            <div>{t.direct} {describe(privilege.direct !== null, privilege.direct === true)}</div>
          </>}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
