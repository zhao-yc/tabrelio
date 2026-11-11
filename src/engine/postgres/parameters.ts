import { validateQueryParameters, type QueryParameter } from '../../shared/queryParameters';

/** 按已验证的整组参数名称绑定，精确数字以原文传输，二进制单独转成字节。 */
export function postgresParameterBindings(names: readonly string[], parameters?: QueryParameter[]): ReadonlyMap<string, string | Buffer | null> | undefined {
  if (!parameters) {
    if (names.length) throw Error('请为 PostgreSQL 查询填写参数值');
    return undefined;
  }
  validateQueryParameters(parameters, 38);
  if (names.length !== parameters.length || names.some((name, index) => name !== parameters[index].name))
    throw Error('PostgreSQL 参数顺序或名称已变化');
  return new Map(parameters.map(({ name, type, value }) => [
    name, type === 'null' ? null : type === 'binary' ? Buffer.from(value!, 'hex') : value!,
  ]));
}
