export type OracleConnectionConfig = {
  user: string;
  password: string;
  connectString: string;
  sysdba?: boolean;
};

export type ScriptExecutionLog = {
  index: number;
  line?: number;
  endLine?: number;
  status: "success" | "warning" | "error";
  statement: string;
  message?: string;
  durationMs?: number;
  rowsAffected?: number;
  rowCount?: number;
};

export type QueryResult = {
  ok: boolean;
  message?: string;
  rows?: unknown[];
  metaData?: Array<{ name: string }>;
  rowsAffected?: number;
  executedCount?: number;
  warningCount?: number;
  failedStatement?: string;
  warnings?: Array<{ statement: string; message: string }>;
  logs?: ScriptExecutionLog[];
};

export type PatchProgressEvent =
  | { type: "start"; startedAt: string; logPath?: string }
  | { type: "log"; line: string; elapsedMs: number }
  | { type: "done"; result: QueryResult; durationMs: number }
  | { type: "fatal"; message: string; durationMs: number };

export type ScriptProgressEvent =
  | { type: "start"; total: number; startedAt: string }
  | {
      type: "statement-start";
      index: number;
      total: number;
      line: number;
      endLine: number;
      statement: string;
      startedAt: string;
    }
  | {
      type: "statement-success";
      index: number;
      line: number;
      endLine: number;
      statement: string;
      durationMs: number;
      rowsAffected: number;
      rowCount: number;
      message: string;
    }
  | {
      type: "statement-warning";
      index: number;
      line: number;
      endLine: number;
      statement: string;
      durationMs: number;
      message: string;
    }
  | {
      type: "statement-error";
      index: number;
      line: number;
      endLine: number;
      statement: string;
      durationMs: number;
      message: string;
    }
  | { type: "done"; result: QueryResult; durationMs: number }
  | { type: "fatal"; message: string; durationMs: number };
