import { useEffect, useMemo, useState } from "react";
import { Cloud, Database, RefreshCcw } from "lucide-react";
import { testConnection } from "../services/oracleClient";
import {
  getCentralClients,
  getCentralHealth,
  saveCentralApiConfig,
  type CentralClient,
} from "../services/centralApiClient";
import { useConnectionStore } from "../stores/useConnectionStore";

function isOnline(value?: string | null) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 180000;
}

export function ConnectionPanel() {
  const {
    mode,
    config,
    remote,
    connected,
    status,
    setMode,
    setConfig,
    setRemoteConfig,
    setSelectedAgent,
    setConnected,
  } = useConnectionStore();
  const [message, setMessage] = useState("");
  const [agents, setAgents] = useState<CentralClient[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const selectedAgent = useMemo(
    () =>
      agents.find((agent) => agent.agentId === remote.selectedAgentId) ||
      remote.selectedAgent ||
      null,
    [agents, remote.selectedAgentId, remote.selectedAgent],
  );

  async function connectLocal() {
    setMessage("Testando conexão local...");
    try {
      const result = await testConnection(config);
      setConnected(
        result.ok,
        result.ok
          ? `Local conectado como ${config.user}`
          : "Erro na conexão local",
      );
      setMessage(
        result.ok
          ? "Conexão local realizada com sucesso."
          : (result.message ?? "Falha na conexão local."),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setConnected(false, "Bridge Oracle offline");
      setMessage(
        `Bridge Oracle não respondeu. Verifique logs/oracle-bridge.log. Detalhe: ${detail}`,
      );
    }
  }

  async function loadRemoteAgents() {
    setLoadingAgents(true);
    setMessage("Conectando na API Central...");
    try {
      saveCentralApiConfig(remote.config);
      const [health, clients] = await Promise.all([
        getCentralHealth(remote.config),
        getCentralClients(remote.config),
      ]);
      const rows = clients.rows || [];
      setAgents(rows);
      const current =
        rows.find((agent) => agent.agentId === remote.selectedAgentId) ||
        rows[0] ||
        null;
      if (current) setSelectedAgent(current.agentId, current);
      setConnected(
        Boolean(health?.ok && current),
        current
          ? `Remoto conectado: ${current.agentId}`
          : "API online, nenhum Agent encontrado",
      );
      setMessage(
        current
          ? "API Central conectada. Agent remoto selecionado."
          : "API Central conectada, mas nenhum Agent está cadastrado/online ainda.",
      );
    } catch (error) {
      setConnected(false, "Erro na API Central");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAgents(false);
    }
  }

  useEffect(() => {
    if (mode !== "remote") return;
    loadRemoteAgents().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Modo de conexão</h2>
          <p className="text-sm text-slate-400">Status: {status}</p>
        </div>
        <span
          className={`self-start rounded-full px-3 py-1 text-xs ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}
        >
          {connected ? "online" : "offline"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          onClick={() => setMode("local")}
          className={`rounded-2xl border px-4 py-3 text-left transition ${mode === "local" ? "border-cyan-400 bg-cyan-500/10 text-cyan-100" : "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"}`}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Database size={18} /> Local
          </div>
          <p className="mt-1 text-xs text-slate-400">
            App → Oracle Bridge → Oracle acessível nesta rede
          </p>
        </button>
        <button
          onClick={() => setMode("remote")}
          className={`rounded-2xl border px-4 py-3 text-left transition ${mode === "remote" ? "border-cyan-400 bg-cyan-500/10 text-cyan-100" : "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"}`}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Cloud size={18} /> Remoto via Agent
          </div>
          <p className="mt-1 text-xs text-slate-400">
            App → API Central → Agent Rust → Oracle do cliente
          </p>
        </button>
      </div>

      {mode === "local" ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            placeholder="Usuário"
            value={config.user}
            onChange={(e) => setConfig({ ...config, user: e.target.value })}
          />
          <input
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            placeholder="Senha"
            type="password"
            value={config.password}
            onChange={(e) => setConfig({ ...config, password: e.target.value })}
          />
          <input
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            placeholder="localhost:1521/ORCL19"
            value={config.connectString}
            onChange={(e) =>
              setConfig({ ...config, connectString: e.target.value })
            }
          />
          <button
            onClick={connectLocal}
            className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Conectar local
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto]">
            <input
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
              placeholder="https://central-api.up.railway.app"
              value={remote.config.apiUrl}
              onChange={(e) =>
                setRemoteConfig({ ...remote.config, apiUrl: e.target.value })
              }
            />
            <input
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
              placeholder="Token"
              value={remote.config.apiToken}
              onChange={(e) =>
                setRemoteConfig({ ...remote.config, apiToken: e.target.value })
              }
            />
            <button
              onClick={loadRemoteAgents}
              disabled={loadingAgents}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60"
            >
              <RefreshCcw
                size={16}
                className={loadingAgents ? "animate-spin" : ""}
              />{" "}
              Conectar remoto
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto]">
            <select
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
              value={remote.selectedAgentId}
              onChange={(e) => {
                const agent =
                  agents.find((item) => item.agentId === e.target.value) ||
                  null;
                setSelectedAgent(e.target.value, agent);
                setConnected(
                  Boolean(agent),
                  agent
                    ? `Remoto conectado: ${agent.agentId}`
                    : "Nenhum Agent selecionado",
                );
              }}
            >
              <option value="">Selecione um Agent</option>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.agentId} — {agent.customerName || "Cliente"} —{" "}
                  {isOnline(agent.lastSeenAt) ? "online" : "offline"}
                </option>
              ))}
            </select>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              {selectedAgent
                ? `${selectedAgent.customerName || selectedAgent.agentId} • ${selectedAgent.environment || "-"} • ${selectedAgent.host || "-"}`
                : "Nenhum Agent selecionado"}
            </div>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    </section>
  );
}
