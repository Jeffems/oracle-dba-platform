import type { ScriptExecutionLog } from '../../types/oracle';

function formatElapsed(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function shortSql(sql?: string) {
  if (!sql) return '';
  return sql.replace(/\s+/g, ' ').trim().slice(0, 180);
}

type Props = {
  running: boolean;
  elapsedMs: number;
  current?: {
    index: number;
    total: number;
    line: number;
    endLine: number;
    statement: string;
  };
  logs: ScriptExecutionLog[];
};

export function ScriptExecutionStatus({ running, elapsedMs, current, logs }: Props) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Execução do script</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-2xl font-bold text-cyan-300">{formatElapsed(elapsedMs)}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${running ? 'bg-cyan-500/15 text-cyan-200' : 'bg-slate-800 text-slate-300'}`}>
              {running ? 'Executando' : 'Parado'}
            </span>
          </div>
        </div>

        {current && (
          <div className="min-w-[280px] rounded-xl border border-cyan-900/60 bg-cyan-950/20 px-4 py-3 text-sm">
            <div className="font-semibold text-cyan-200">
              Linha {current.line}{current.endLine !== current.line ? `-${current.endLine}` : ''} · Comando {current.index}/{current.total}
            </div>
            <div className="mt-1 max-w-xl truncate font-mono text-xs text-slate-300">{shortSql(current.statement)}</div>
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-slate-800 bg-slate-950">
          {logs.map((log) => (
            <div key={`${log.index}-${log.status}-${log.durationMs}`} className="border-b border-slate-800 px-3 py-2 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-200">
                  Linha {log.line ?? '-'}{log.endLine && log.endLine !== log.line ? `-${log.endLine}` : ''} · #{log.index}
                </span>
                <span className={log.status === 'success' ? 'text-emerald-300' : log.status === 'warning' ? 'text-amber-300' : 'text-rose-300'}>
                  {log.status.toUpperCase()} · {formatElapsed(log.durationMs ?? 0)}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-slate-400">{shortSql(log.statement)}</div>
              {log.message && <div className="mt-1 text-xs text-slate-500">{log.message}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
