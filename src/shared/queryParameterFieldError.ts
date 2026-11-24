/** 参数校验只传递行号和字段，错误定位不需要携带名称或原值。 */
export class QueryParameterFieldError extends Error {
  constructor(readonly index: number, readonly field: 'name' | 'value', message: string) {
    super(message);
  }
}
