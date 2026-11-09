export const queryResultRegexLimits = { valueUnits: 1024 * 1024, batchCells: 256, startupMs: 8000, timeoutMs: 1500 } as const;

export interface QueryResultRegexInput {
  query: string;
  caseSensitive: boolean;
  values: (string | null)[];
}

export type QueryResultRegexResult =
  | { status: 'ready'; hits: boolean[] }
  | { status: 'invalid' | 'timeout' | 'worker' | 'cancelled' };
