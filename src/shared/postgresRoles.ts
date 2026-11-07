import { z } from 'zod';
import { postgresNewIdentifier } from './postgresCreateTable';

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
const membershipTarget = {connectionId: target.connectionId, database: target.database};
export const postgresMembershipOptionsSchema = z.object({admin: z.boolean(), inherit: z.boolean(), set: z.boolean()}).strict();
export const postgresMembershipPreviewSchema = z.discriminatedUnion('action', [
  z.object({...membershipTarget, action: z.literal('grant'), member: role, roleName: identifier, options: postgresMembershipOptionsSchema}).strict(),
  z.object({...membershipTarget, action: z.literal('revoke'), member: role, role, grantor: role}).strict(),
]);
export const postgresMembershipApplySchema = z.object({...membershipTarget, token: z.string().uuid(), confirmed: z.literal(true)}).strict();
export type PostgresMembershipDraft = z.infer<typeof postgresMembershipPreviewSchema>;
export type PostgresMembershipApply = z.infer<typeof postgresMembershipApplySchema>;
export type PostgresMembershipOptions = z.infer<typeof postgresMembershipOptionsSchema>;
export interface PostgresMembershipPreview {
  token: string; database: string; actor: string; action: 'grant' | 'revoke'; sql: string;
  member: PostgresRoleRef; role: PostgresRoleRef; grantor: PostgresRoleRef; options: PostgresMembershipOptions;
}
export interface PostgresMembershipOutcome {
  outcome: 'committed' | 'rolledBack' | 'notSent' | 'unknown'; message: string;
}
export const postgresRoleCreateDraftSchema = z.object({
  ...membershipTarget, name: postgresNewIdentifier.refine(value => !value.startsWith('pg_'), '角色名不能以 pg_ 开头'),
  auth: z.enum(['group', 'password', 'external']),
  inherit: z.boolean(), createDatabase: z.boolean(), createRole: z.boolean(), superuser: z.boolean(),
  replication: z.boolean(), bypassRls: z.boolean(), connectionLimit: z.number().int().min(-1).max(2147483647),
  validUntil: z.iso.datetime({precision: 3}).refine(value => Number.isFinite(Date.parse(value))).optional(),
}).strict().refine(value => value.validUntil === undefined || value.auth === 'password', '密码有效期仅适用于密码登录角色');
const rolePassword = z.string().min(1).max(1024).refine(value =>
  !/[\u0000\uD800-\uDFFF]/u.test(value) && new TextEncoder().encode(value).byteLength <= 1024, '请输入 1 至 1024 字节的密码');
export const postgresRoleCreateApplySchema = postgresMembershipApplySchema.extend({password: rolePassword.optional()});
export const postgresRolePasswordDraftSchema = z.object({...membershipTarget, role}).strict();
export const postgresRolePasswordApplySchema = postgresMembershipApplySchema.extend({password: rolePassword});
export type PostgresRoleCreateDraft = z.infer<typeof postgresRoleCreateDraftSchema>;
export type PostgresRoleCreateApply = z.infer<typeof postgresRoleCreateApplySchema>;
export type PostgresRolePasswordDraft = z.infer<typeof postgresRolePasswordDraftSchema>;
export type PostgresRolePasswordApply = z.infer<typeof postgresRolePasswordApplySchema>;
export interface PostgresRoleChangePreview {token: string; database: string; actor: string; sql: string;}
export interface PostgresRoleChangeOutcome extends PostgresMembershipOutcome {role?: PostgresRoleRef;}
export interface PostgresRole extends PostgresRoleRef {
  login: boolean; superuser: boolean; inherit: boolean; createRole: boolean; createDatabase: boolean;
  replication: boolean; bypassRls: boolean; connectionLimit: number; validUntil: string | null;
}
export interface PostgresRoleMembership {
  peer: PostgresRoleRef; grantor: string | null; grantorOid: string | null; admin: boolean; inherit: boolean | null; set: boolean | null;
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
