import { tableReadStatements, type TableReadStatement } from './tableReadStatements';

export type TableWriteOutcome = 'committed' | 'rolled-back' | 'not-sent' | 'unknown';
export interface TableWriteTrace {
  statements: TableReadStatement[];
  omitted: number;
}

/** 大批量只保留前段模板，另为 COMMIT 和 ROLLBACK 留出位置。 */
export class TableWriteTraceCapture {
  private statements: TableReadStatement[] = [];
  private omitted = 0;

  record(sql: string): void {
    const limit = sql === 'COMMIT' || sql === 'ROLLBACK' ? 12 : 10;
    if (this.statements.length >= limit) { this.omitted++; return; }
    this.statements.push(tableReadStatements(sql)[0]);
  }

  snapshot(): TableWriteTrace | undefined {
    if (this.statements.length) return { statements: this.statements.slice(), omitted: this.omitted };
  }
}
