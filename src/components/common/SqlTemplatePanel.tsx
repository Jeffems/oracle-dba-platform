import { Copy, Download, Play } from "lucide-react";
import { useEffect, useMemo } from "react";
import { executeWithCurrentConnection } from "../../services/connectionExecutor";
import { useConnectionStore } from "../../stores/useConnectionStore";
import { useModuleStateStore } from "../../stores/useModuleStateStore";
import type { QueryResult, ScriptExecutionLog } from "../../types/oracle";
import { splitSqlStatements } from "../../lib/sqlScript";
import { ResultTable } from "../ResultTable";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "password" | "select" | "range";
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
};

type Template = {
  id: string;
  label: string;
  fileName: string;
  help: string;
  render: (values: Record<string, string>) => string;
};

type CurrentStatement = {
  index: number;
  total: number;
  line: number;
  endLine: number;
  statement: string;
};

type Props = {
  title: string;
  description?: string;
  fields: Field[];
  defaults: Record<string, string>;
  templates: Template[];
};

function formatElapsed(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${millis}`;
}

function shortSql(sql?: string) {
  if (!sql) return "";
  return sql.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function SqlTemplatePanel({
  title,
  description,
  fields,
  defaults,
  templates,
}: Props) {
  const { mode, config, remote } = useConnectionStore();
  const moduleKey = useMemo(
    () =>
      title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-"),
    [title],
  );
  const defaultTemplateId = templates[0]?.id ?? "";
  const persistedState = useModuleStateStore((store) =>
    store.getTemplateState(moduleKey, defaults, defaultTemplateId),
  );
  const patchTemplateState = useModuleStateStore(
    (store) => store.patchTemplateState,
  );
  const patchTemplateValues = useModuleStateStore(
    (store) => store.patchTemplateValues,
  );

  const values = persistedState.values;
  const templateId = persistedState.templateId || defaultTemplateId;
  const result = persistedState.result;
  const busy = persistedState.busy;
  const elapsedMs = persistedState.elapsedMs;
  const current = persistedState.current as CurrentStatement | undefined;
  const logs = persistedState.logs;

  const template =
    templates.find((item) => item.id === templateId) ?? templates[0];
  const sql = template?.render(values) ?? "";
  const statements = useMemo(() => splitSqlStatements(sql), [sql]);

  useEffect(() => {
    if (!busy) return;

    const timer = window.setInterval(() => {
      if (persistedState.startedAt)
        patchTemplateState(moduleKey, {
          elapsedMs: Date.now() - persistedState.startedAt,
        });
    }, 100);

    return () => window.clearInterval(timer);
  }, [busy, moduleKey, patchTemplateState, persistedState.startedAt]);

  function update(key: string, value: string) {
    patchTemplateValues(moduleKey, { [key]: value });
  }

  async function copySql() {
    await navigator.clipboard.writeText(sql);
  }

  function downloadSql() {
    const blob = new Blob([sql], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = template.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function stopAfterCurrentStatement() {
    patchTemplateState(moduleKey, { cancelRequested: true });
  }

  async function runSql() {
    if (!statements.length) {
      patchTemplateState(moduleKey, {
        result: {
          ok: false,
          message: "Nenhum comando SQL encontrado neste script.",
        },
      });
      return;
    }

    const startedAt = Date.now();
    patchTemplateState(moduleKey, {
      busy: true,
      result: undefined,
      current: undefined,
      logs: [],
      elapsedMs: 0,
      cancelRequested: false,
      startedAt,
    });

    const localLogs: ScriptExecutionLog[] = [];
    let lastResult: QueryResult | undefined;

    try {
      for (let i = 0; i < statements.length; i++) {
        if (
          useModuleStateStore.getState().templates[moduleKey]?.cancelRequested
        ) {
          patchTemplateState(moduleKey, {
            result: {
              ok: false,
              message:
                "Execução interrompida pelo usuário após o comando atual.",
              executedCount: localLogs.filter(
                (entry) => entry.status === "success",
              ).length,
              logs: localLogs,
            },
          });
          return;
        }

        const item = statements[i];
        const currentStatement: CurrentStatement = {
          index: i + 1,
          total: statements.length,
          line: item.startLine,
          endLine: item.endLine,
          statement: item.statement,
        };

        patchTemplateState(moduleKey, { current: currentStatement });
        await new Promise((resolve) => window.requestAnimationFrame(resolve));

        const statementStartedAt = Date.now();
        const response = await executeWithCurrentConnection({
          mode,
          localConfig: config,
          remoteConfig: remote.config,
          agentId: remote.selectedAgentId,
          sql: item.statement,
          allowDangerous: true,
        });
        const durationMs = Date.now() - statementStartedAt;

        const log: ScriptExecutionLog = {
          index: i + 1,
          line: item.startLine,
          endLine: item.endLine,
          status: response.ok ? "success" : "error",
          statement: item.statement,
          message:
            response.message ??
            (response.ok
              ? "Comando executado com sucesso."
              : "Falha ao executar comando."),
          durationMs,
          rowsAffected: response.rowsAffected,
          rowCount: response.rows?.length,
        };

        localLogs.push(log);
        patchTemplateState(moduleKey, { logs: [...localLogs] });
        lastResult = response;

        if (!response.ok) {
          patchTemplateState(moduleKey, {
            result: {
              ...response,
              executedCount: localLogs.filter(
                (entry) => entry.status === "success",
              ).length,
              failedStatement: item.statement,
              logs: localLogs,
            },
          });
          return;
        }
      }

      patchTemplateState(moduleKey, {
        result: {
          ...(lastResult ?? { ok: true }),
          ok: true,
          message: `Script finalizado. ${localLogs.length} comando(s) executado(s).`,
          executedCount: localLogs.filter((entry) => entry.status === "success")
            .length,
          warningCount: localLogs.filter((entry) => entry.status === "warning")
            .length,
          logs: localLogs,
        },
      });
    } catch (error) {
      patchTemplateState(moduleKey, {
        result: {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Falha na execução. Verifique conexão local/remota",
          logs: localLogs,
        },
      });
    } finally {
      const state = useModuleStateStore.getState().templates[moduleKey];
      const finalElapsed = state?.startedAt
        ? Date.now() - state.startedAt
        : elapsedMs;
      patchTemplateState(moduleKey, {
        busy: false,
        elapsedMs: finalElapsed,
        startedAt: undefined,
        cancelRequested: false,
      });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        {description && <p className="text-slate-400 mt-1">{description}</p>}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1 md:col-span-1">
            <span className="text-sm text-slate-400">Modelo</span>
            <select
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2"
              value={templateId}
              onChange={(e) =>
                patchTemplateState(moduleKey, { templateId: e.target.value })
              }
            >
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {fields.map((field) => (
            <label className="space-y-1" key={field.key}>
              <span className="text-sm text-slate-400">{field.label}</span>
              {field.type === "select" ? (
                <select
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2"
                  value={values[field.key] ?? ""}
                  onChange={(e) => update(field.key, e.target.value)}
                >
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2"
                  type={field.type ?? "text"}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={values[field.key] ?? ""}
                  onChange={(e) => update(field.key, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
        <p className="text-sm text-slate-400">{template.help}</p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3">
          <div>
            <p className="font-semibold">{template.fileName}</p>
            <p className="text-xs text-slate-500">
              Script gerado automaticamente
            </p>
          </div>

          <div className="mx-auto min-w-[280px] flex-1 max-w-xl">
            <div
              className={`rounded-xl border px-4 py-2 ${busy ? "border-cyan-500/60 bg-cyan-950/30" : "border-slate-800 bg-slate-950/70"}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-mono text-lg font-bold text-cyan-300">
                  {formatElapsed(elapsedMs)}
                </span>
                {busy ? (
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-200">
                    Executando
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">
                    Pronto
                  </span>
                )}
                {current ? (
                  <span className="font-semibold text-slate-200">
                    Linha {current.line}
                    {current.endLine !== current.line
                      ? `-${current.endLine}`
                      : ""}{" "}
                    · Comando {current.index}/{current.total}
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {statements.length} comando(s) no script
                  </span>
                )}
              </div>
              {current && (
                <div className="mt-1 truncate font-mono text-xs text-slate-400">
                  {shortSql(current.statement)}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {busy && (
              <button
                onClick={stopAfterCurrentStatement}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10"
              >
                Parar
              </button>
            )}
            <button
              onClick={copySql}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              <Copy size={16} /> Copiar
            </button>
            <button
              onClick={downloadSql}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              <Download size={16} /> Baixar
            </button>
            <button
              onClick={runSql}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
            >
              <Play size={16} /> {busy ? "Aplicando..." : "Aplicar no banco"}
            </button>
          </div>
        </div>
        <pre className="p-5 text-sm overflow-auto whitespace-pre-wrap text-slate-200">
          {sql}
        </pre>
      </section>

      {logs.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="border-b border-slate-800 bg-slate-900 px-4 py-3 font-semibold">
            Log de execução
          </div>
          <div className="max-h-64 overflow-auto">
            {logs.map((log) => (
              <div
                key={`${log.index}-${log.status}-${log.durationMs}`}
                className="border-b border-slate-800 px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-200">
                    Linha {log.line ?? "-"}
                    {log.endLine && log.endLine !== log.line
                      ? `-${log.endLine}`
                      : ""}{" "}
                    · Comando {log.index}
                  </span>
                  <span
                    className={
                      log.status === "success"
                        ? "text-emerald-300"
                        : log.status === "warning"
                          ? "text-amber-300"
                          : "text-rose-300"
                    }
                  >
                    {log.status.toUpperCase()} ·{" "}
                    {formatElapsed(log.durationMs ?? 0)}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-slate-400">
                  {shortSql(log.statement)}
                </div>
                {log.message && (
                  <div className="mt-1 text-xs text-slate-500">
                    {log.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <ResultTable result={result} />
    </div>
  );
}
