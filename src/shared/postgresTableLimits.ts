/** 表页和查找线程共用预算常量，线程无需加载表页 IPC 的校验定义。 */
export const postgresTableLimits = { page: 200, offset: 1_000_000, changes: 100, draftPages: 16, fields: 200, value: 64 * 1024, draft: 1024 * 1024 } as const;
