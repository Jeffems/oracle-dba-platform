import { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { executeWithCurrentConnection } from '../services/connectionExecutor';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useModuleStateStore } from '../stores/useModuleStateStore';
import type { QueryResult, ScriptExecutionLog } from '../types/oracle';
import { ResultTable } from '../components/ResultTable';
import { ScriptExecutionStatus } from '../components/sql/ScriptExecutionStatus';
import { splitSqlStatements } from '../lib/sqlScript';

type CurrentStatement = {
  index: number;
  total: number;
  line: number;
  endLine: number;
  statement: string;
};

export function SqlWorksheet() {
  const { mode, config, remote } = useConnectionStore();
  const worksheet = useModuleStateStore((store) => store.worksheet);
  const patchWorksheet = useModuleStateStore((store) => store.patchWorksheet);

  const sql = worksheet.sql;
  const result = worksheet.result;
  const busy = worksheet.busy;
  const elapsedMs = worksheet.elapsedMs;
  const current = worksheet.current as CurrentStatement | undefined;
  const logs = worksheet.logs;

  useEffect(() => {
    if (!busy) return;

    const timer = window.setInterval(() => {
      if (worksheet.startedAt) patchWorksheet({ elapsedMs: Date.now() - worksheet.startedAt });
    }, 100);

    return () => window.clearInterval(timer);
  }, [busy, patchWorksheet, worksheet.startedAt]);

  async function run() {
    const statements = splitSqlStatements(sql);

    if (!statements.length) {
      patchWorksheet({ result: { ok: false, message: 'Nenhum comando SQL encontrado.' } });
      return;
    }

    const startedAt = Date.now();
    patchWorksheet({
      busy: true,
      result: undefined,
      logs: [],
      current: undefined,
      elapsedMs: 0,
      cancelRequested: false,
      startedAt,
    });

    const localLogs: ScriptExecutionLog[] = [];
    let lastResult: QueryResult | undefined;

    try {
      for (let i = 0; i < statements.length; i++) {
        if (useModuleStateStore.getState().worksheet.cancelRequested) break;

        const item = statements[i];
        const currentStatement: CurrentStatement = {
          index: i + 1,
          total: statements.length,
          line: item.startLine,
          endLine: item.endLine,
          statement: item.statement
        };

        patchWorksheet({ current: currentStatement });
        await new Promise((resolve) => window.requestAnimationFrame(resolve));

        const statementStartedAt = Date.now();
        const response = await executeWithCurrentConnection({
          mode,
          localConfig: config,
          remoteConfig: remote.config,
          agentId: remote.selectedAgentId,
          sql: item.statement,
          allowDangerous: true
        });
        const durationMs = Date.now() - statementStartedAt;

        const status: ScriptExecutionLog['status'] = response.ok ? 'success' : 'error';
        const log: ScriptExecutionLog = {
          index: i + 1,
          line: item.startLine,
          endLine: item.endLine,
          status,
          statement: item.statement,
          message: response.message ?? (response.ok ? 'Comando executado com sucesso.' : 'Falha ao executar comando.'),
          durationMs,
          rowsAffected: response.rowsAffected,
          rowCount: response.rows?.length
        };

        localLogs.push(log);
        patchWorksheet({ logs: [...localLogs] });
        lastResult = response;

        if (!response.ok) {
          patchWorksheet({ result: {
            ...response,
            executedCount: localLogs.filter((entry) => entry.status === 'success').length,
            failedStatement: item.statement,
            logs: localLogs
          }});
          return;
        }
      }

      patchWorksheet({ result: {
        ...(lastResult ?? { ok: true }),
        ok: true,
        executedCount: localLogs.filter((entry) => entry.status === 'success').length,
        warningCount: localLogs.filter((entry) => entry.status === 'warning').length,
        logs: localLogs
      }});
    } catch (error) {
      patchWorksheet({ result: {
        ok: false,
        message: error instanceof Error ? error.message : 'Falha na execução. Verifique conexão local/remota',
        logs: localLogs
      }});
    } finally {
      const state = useModuleStateStore.getState().worksheet;
      const finalElapsed = state.startedAt ? Date.now() - state.startedAt : elapsedMs;
      patchWorksheet({ busy: false, elapsedMs: finalElapsed, startedAt: undefined, cancelRequested: false });
    }
  }

  function stop() {
    patchWorksheet({ cancelRequested: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">SQL Worksheet</h2>
        <div className="flex gap-2">
          {busy && (
            <button
              onClick={stop}
              className="rounded-xl border border-rose-500/40 px-5 py-2 font-semibold text-rose-200 hover:bg-rose-500/10"
            >
              Parar após comando atual
            </button>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="rounded-xl bg-cyan-500 px-5 py-2 font-semibold text-slate-950 disabled:opacity-60"
          >
            {busy ? 'Executando...' : 'Executar'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-800">
        <Editor
          height="430px"
          defaultLanguage="sql"
          theme="vs-dark"
          value={sql}
          onChange={v => patchWorksheet({ sql: v ?? '' })}
          options={{ minimap: { enabled: false }, fontSize: 14 }}
        />
      </div>

      <ScriptExecutionStatus running={busy} elapsedMs={elapsedMs} current={current} logs={logs} />
      <ResultTable result={result} />
    </div>
  );
}
