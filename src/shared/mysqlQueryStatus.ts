export const mysqlQueryStatusLimit = 200;

export interface MysqlQueryStatusEntry {
  ordinal: number;
  status: 'completed' | 'failed';
  elapsedMs: number;
  /** 客户端观测到的 MySQL 协议字节，含包头和完整响应。无法采集时省略。 */
  traffic?: { sent: number; received: number };
}

export interface MysqlQueryStatusReport {
  entries: MysqlQueryStatusEntry[];
  omitted: number;
}
