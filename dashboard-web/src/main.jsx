import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Database,
  RefreshCcw,
  Server,
  ShieldCheck,
  Wifi,
  Zap,
} from "lucide-react";
import "./styles.css";

const DEFAULT_API_URL =
  localStorage.getItem("centralApiUrl") || "http://127.0.0.1:4090";
const DEFAULT_TOKEN =
  localStorage.getItem("centralApiToken") || "dev-token-change-me";
function fmtDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
function ageOk(value) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 120000;
}
function Card({ icon: Icon, label, value }) {
  return (
    <div className="card">
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [message, setMessage] = useState("Dashboard Web v2.6.0 pronto.");
  const [loading, setLoading] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const online = useMemo(
    () => clients.filter((c) => ageOk(c.lastSeenAt)).length,
    [clients],
  );
  const critical = useMemo(
    () => alerts.filter((a) => a.level === "critical").length,
    [alerts],
  );

  async function load() {
    setLoading(true);
    try {
      localStorage.setItem("centralApiUrl", apiUrl);
      localStorage.setItem("centralApiToken", token);
      const headers = { Authorization: `Bearer ${token}` };
      const [h, c, a, ah, m] = await Promise.all([
        fetch(`${apiUrl}/health`),
        fetch(`${apiUrl}/api/clients`, { headers }),
        fetch(`${apiUrl}/api/alerts`, { headers }),
        fetch(`${apiUrl}/api/alerts/history`, { headers }),
        fetch(`${apiUrl}/api/metrics?limit=30`, { headers }),
      ]);
      if (!h.ok) throw new Error(`Health HTTP ${h.status}`);
      if (!c.ok) throw new Error(`Clientes HTTP ${c.status}`);
      if (!a.ok) throw new Error(`Alertas HTTP ${a.status}`);
      if (!m.ok) throw new Error(`Métricas HTTP ${m.status}`);
      setHealth(await h.json());
      setClients((await c.json()).rows || []);
      setAlerts((await a.json()).rows || []);
      setAlertHistory((await ah.json()).rows || []);
      setMetrics((await m.json()).rows || []);
      setMessage("Dados atualizados com sucesso.");
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const url = `${apiUrl}/api/realtime?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onopen = () => {
      setRealtime(true);
      setMessage("Tempo real conectado.");
    };
    es.onerror = () => {
      setRealtime(false);
    };
    const updateState = (payload) => {
      if (payload.clients) setClients(payload.clients);
      if (payload.alerts) setAlerts(payload.alerts);
    };
    es.addEventListener("connected", (e) => updateState(JSON.parse(e.data)));
    es.addEventListener("state", (e) => updateState(JSON.parse(e.data)));
    es.addEventListener("metrics", (e) => {
      const payload = JSON.parse(e.data);
      updateState(payload.state || {});
      setMetrics((prev) => [payload.record, ...prev].slice(0, 30));
      setMessage("Métrica recebida em tempo real.");
    });
    es.addEventListener("command", (e) =>
      setMessage(`Comando auditado: ${JSON.parse(e.data).id}`),
    );
    return () => es.close();
  }, [apiUrl, token]);

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Oracle DBA Platform</p>
          <h1>Dashboard Web v2.6.0</h1>
          <p>
            Persistência real em PostgreSQL, health checks e tempo real via SSE.
          </p>
        </div>
        <button onClick={load} disabled={loading}>
          <RefreshCcw size={18} className={loading ? "spin" : ""} /> Atualizar
        </button>
      </header>
      <section className="panel settings">
        <label>
          URL da API Central
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        </label>
        <label>
          Token
          <input value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <div className="status">
          <strong>Status:</strong> {message}
        </div>
      </section>
      <section className="grid cards">
        <Card
          icon={Wifi}
          label="API"
          value={health?.ok ? "Online" : "Offline"}
        />
        <Card
          icon={Zap}
          label="Tempo real"
          value={realtime ? "Conectado" : "Offline"}
        />
        <Card icon={Server} label="Clientes/Agents" value={clients.length} />
        <Card icon={Activity} label="Online agora" value={online} />
        <Card icon={BellRing} label="Alertas críticos" value={critical} />
      </section>
      <section className="panel">
        <h2>
          <Database size={20} /> Clientes monitorados
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Agent</th>
                <th>Host</th>
                <th>Banco</th>
                <th>Status</th>
                <th>Último envio</th>
                <th>Sessões</th>
                <th>Bloqueios</th>
                <th>Tablespace</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.agentId}>
                  <td>{c.customerName || "-"}</td>
                  <td className="mono">{c.agentId}</td>
                  <td>{c.host || "-"}</td>
                  <td>{c.dbName || "-"}</td>
                  <td>
                    <span
                      className={ageOk(c.lastSeenAt) ? "pill ok" : "pill warn"}
                    >
                      {ageOk(c.lastSeenAt) ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td>{fmtDate(c.lastSeenAt)}</td>
                  <td>{c.activeSessions ?? 0}</td>
                  <td>{c.blockedSessions ?? 0}</td>
                  <td>{c.maxTablespacePct ?? 0}%</td>
                </tr>
              ))}
              {!clients.length && (
                <tr>
                  <td colSpan="9" className="empty">
                    Nenhum Agent enviou métricas ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="two-cols">
        <div className="panel">
          <h2>
            <AlertTriangle size={20} /> Alertas em tempo real
          </h2>
          {alerts.length ? (
            alerts.map((a, i) => (
              <div className={`alert ${a.level}`} key={i}>
                {a.message}
              </div>
            ))
          ) : (
            <p className="muted">Nenhum alerta ativo.</p>
          )}
          <h3>Histórico</h3>
          {alertHistory.slice(0, 8).map((a) => (
            <div className={`alert ${a.level}`} key={a.id}>
              {fmtDate(a.at)} — {a.message}
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>
            <ShieldCheck size={20} /> Últimas métricas recebidas
          </h2>
          <pre>
            {metrics.length
              ? JSON.stringify(metrics.slice(0, 5), null, 2)
              : "Sem métricas."}
          </pre>
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
