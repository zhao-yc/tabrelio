/** 查询绑定、校验与编辑器共享的参数预算，编辑器无需加载参数值处理。 */
export const queryParameterLimits = { names: 200, occurrences: 100000, valueBytes: 64 * 1024, totalBytes: 1024 * 1024, sqlBytes: 20 * 1024 * 1024 } as const;
