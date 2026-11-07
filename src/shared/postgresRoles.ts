import { z } from 'zod';

const identifier = z.string().min(1).max(256).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const oid = z.string().regex(/^[1-9]\d{0,9}$/).refine(value => Number(value) <= 0xffffffff);
const role = z.object({oid, name: identifier}).strict();
const target = {
  connectionId: z.string().min(1).max(256), taskId: z.string().min(1).max(256), database: identifier.optional(),
};
export const postgresRolesSchema = z.discriminatedUnion('kind', [
  z.object({...target, kind: z.literal('list'), search: z.string().max(128).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value)),
    after: identifier.optional()}).strict(),
  z.object({...target, kind: z.literal('detail'), role,
    scope: z.object({schema: identifier, relation: identifier.optional()}).strict().optional()}).strict(),
]);
export type PostgresRolesInput = z.infer<typeof postgresRolesSchema>;
export type PostgresRoleRef = z.infer<typeof role>;
export interface PostgresRole extends PostgresRoleRef {
  login: boolean; superuser: boolean; inherit: boolean; createRole: boolean; createDatabase: boolean;
  replication: boolean; bypassRls: boolean; connectionLimit: number; validUntil: string | null;
}
export interface PostgresRoleMembership {
  peer: PostgresRoleRef; grantor: string | null; admin: boolean; inherit: boolean | null; set: boolean | null;
}
export interface PostgresRolePrivilege {name: string; allowed: boolean; grantable: boolean;}
export interface PostgresRolesContext {database: string; login: string; current: PostgresRoleRef;}
export interface PostgresRolesList extends PostgresRolesContext {
  kind: 'list'; roles: PostgresRole[]; next?: string;
}
export interface PostgresRoleDetail extends PostgresRolesContext {
  kind: 'detail'; role: PostgresRole;
  memberships: {granted: PostgresRoleMembership[]; members: PostgresRoleMembership[]; limited: boolean};
  databasePrivileges: PostgresRolePrivilege[];
  scope?: {schema: PostgresRolePrivilege[] | null; relation?: {privileges: PostgresRolePrivilege[]; rls: boolean; forceRls: boolean} | null};
}
export type PostgresRolesOutput = PostgresRolesList | PostgresRoleDetail;
