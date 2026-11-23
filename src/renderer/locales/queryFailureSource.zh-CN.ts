/** 定位只选择原编辑器内容，不回显展开值或错误 SQL。 */
export const queryFailureSourceZh = {
  locate: '定位未完成SQL',
  locatePosition: '定位错误位置',
  locatePositionFor: (ordinal: number) => `定位第${ordinal}条语句的错误位置`,
  locateLine: '定位报错行',
  locateLineFor: (ordinal: number) => `定位第${ordinal}条语句的报错行`,
  markerSource: '查询执行错误',
  markerMessage: (ordinal: number, message: string) => `第 ${ordinal} 条语句\n${message}`,
  available: '仅选择原编辑器中的未完成语句，不修改正文或重新执行。',
  unavailable: '定位不可用：执行范围未确认，或原编辑器、正文及连接已变化。',
  locateResult: '定位原语句',
  resultUnavailable: '原编辑器已变化或无法确认原语句范围。',
};
