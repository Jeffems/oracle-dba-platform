import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Lock,
  LayoutDashboard,
  Link2,
  List,
  Play,
  RefreshCcw,
  Server,
  Search,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  Eye,
  EyeOff,
  Trash2,
  Wifi,
  Zap,
} from "lucide-react";
import "./styles.css";

const VERSION = "3.3.15";
const DEFAULT_API_URL =
  localStorage.getItem("centralApiUrl") ||
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:4090";
const DEFAULT_TOKEN = localStorage.getItem("dashboardAuthToken") || "";

function fmtDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}
function fmtTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return value;
  }
}
function ageOk(value) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 120000;
}
function n(value) {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function compact(value, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    notation: Math.abs(n(value)) >= 100000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  }).format(n(value));
}
function pctClass(value, warn = 80, danger = 90) {
  const x = n(value);
  if (x >= danger) return "danger";
  if (x >= warn) return "warn";
  return "ok";
}
function statusClass(status) {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED" || status === "BLOCKED_REVIEW_REQUIRED")
    return "danger";
  if (status === "IN_PROGRESS") return "info";
  return "warn";
}

function clientSeverity(c) {
  if (!ageOk(c.lastSeenAt)) return "offline";
  const bsev = backupSeverity(c);
  if (bsev === "critical") return "critical";
  if (
    n(c.maxTablespacePct) >= 90 ||
    n(c.blockedSessions) > 0 ||
    n(c.locksWaiting) > 0
  )
    return "critical";
  if (bsev === "warning") return "warning";
  if (n(c.maxTablespacePct) >= 80) return "warning";
  return "healthy";
}
function severityLabel(sev) {
  if (sev === "critical") return "Crítico";
  if (sev === "warning") return "Atenção";
  if (sev === "offline") return "Offline";
  return "OK";
}
function severityTone(sev) {
  if (sev === "critical") return "danger";
  if (sev === "warning" || sev === "offline") return "warn";
  return "ok";
}

function backupSeverity(c) {
  const b = c?.backupStatus || {};
  if (!b.enabled) return "unknown";
  const st = String(b.status || "").toUpperCase();
  if (st === "FAILED") return "critical";
  if (st === "WARNING") return "warning";
  if (st === "OK") return "healthy";
  return "unknown";
}
function backupLabel(c) {
  const b = c?.backupStatus || {};
  if (!b.enabled) return "Sem monitor";
  const sev = backupSeverity(c);
  if (sev === "critical") return "Falha";
  if (sev === "warning") return "Atenção";
  if (sev === "healthy") return "OK";
  return "Sem dados";
}
function backupTone(c) {
  const sev = backupSeverity(c);
  if (sev === "critical") return "danger";
  if (sev === "warning" || sev === "unknown") return "warn";
  return "ok";
}
function fmtBackupAge(c) {
  const b = c?.backupStatus || {};
  if (!b.enabled) return "-";
  if (b.ageHours === undefined || b.ageHours === null) return "-";
  return `${compact(b.ageHours, 1)}h`;
}
function metricRows(snapshot) {
  return snapshot?.overview || snapshot?.OVERVIEW || [];
}
function metricValue(snapshot, key) {
  const rows = metricRows(snapshot);
  const found = rows.find(
    (r) => String(r.METRIC || r.metric || "").toUpperCase() === key,
  );
  return n(found?.VALUE ?? found?.value);
}
function getLatestMetric(metrics, agentId, key) {
  const row = metrics.find(
    (m) =>
      (!agentId || m.agentId === agentId) && metricValue(m.snapshot, key) !== 0,
  );
  return row ? metricValue(row.snapshot, key) : 0;
}
function metricSeries(rows, metric, maxPoints = 32) {
  return rows
    .slice(0, maxPoints)
    .reverse()
    .map((r) => ({
      label: fmtTime(r.receivedAt),
      value: metricValue(r.snapshot, metric),
      at: r.receivedAt,
    }))
    .filter((p) => Number.isFinite(p.value));
}

function Pill({ children, tone = "ok" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function TopStat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "cyan",
  spark = [],
}) {
  return (
    <div className={`top-stat tone-${tone}`}>
      <div className="stat-head">
        <Icon size={20} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <div className="stat-bottom">
        <small>{hint || "Atualizado pela API Central"}</small>
        {spark.length > 1 && <Sparkline points={spark} />}
      </div>
    </div>
  );
}

function ProgressBar({ value, max = 100, warn = 80, danger = 90 }) {
  const pct = Math.max(0, Math.min(100, (n(value) / max) * 100));
  return (
    <div className={`progress ${pctClass(pct, warn, danger)}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function GaugeRing({ value, label, sublabel, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (n(value) / max) * 100));
  const r = 48;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className={`gauge-card ${pctClass(pct)}`}>
      <svg viewBox="0 0 120 120">
        <circle className="gauge-bg" cx="60" cy="60" r={r} />
        <circle
          className="gauge-value"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="gauge-center">
        <strong>{compact(pct, 0)}%</strong>
        <span>{label}</span>
      </div>
      {sublabel && <small>{sublabel}</small>}
    </div>
  );
}

function Sparkline({ points }) {
  const data = points.map((p) => n(typeof p === "object" ? p.value : p));
  const w = 90,
    h = 28,
    pad = 2;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const d = data
    .map((v, i) => {
      const x =
        data.length <= 1 ? pad : pad + (i * (w - pad * 2)) / (data.length - 1);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      <polyline points={d} />
    </svg>
  );
}

function AreaChart({
  title,
  description,
  rows,
  metric,
  suffix = "",
  maxHint = 0,
}) {
  const points = metricSeries(rows, metric, 40);
  const w = 860,
    h = 250,
    padX = 42,
    padY = 28;
  const max = Math.max(maxHint, ...points.map((p) => p.value), 1);
  const coords = points.map((p, i) => {
    const x =
      points.length <= 1
        ? padX
        : padX + (i * (w - padX * 2)) / (points.length - 1);
    const y = h - padY - (p.value / max) * (h - padY * 2);
    return { ...p, x, y };
  });
  const line = coords.map((p) => `${p.x},${p.y}`).join(" ");
  const area = coords.length
    ? `${padX},${h - padY} ${line} ${w - padX},${h - padY}`
    : "";
  const last = coords.at(-1)?.value || 0;
  return (
    <div className="panel chart-panel">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <strong>
          {compact(last)}
          {suffix}
        </strong>
      </div>
      <svg className="area-chart" viewBox={`0 0 ${w} ${h}`} role="img">
        <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} />
        <line x1={padX} y1={padY} x2={padX} y2={h - padY} />
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            className="gridline"
            x1={padX}
            y1={padY + (h - padY * 2) * g}
            x2={w - padX}
            y2={padY + (h - padY * 2) * g}
          />
        ))}
        {area && <polygon points={area} />} {line && <polyline points={line} />}
        {coords.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3">
            <title>
              {p.label}: {compact(p.value)}
              {suffix}
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-footer">
        <span>{points[0]?.label || "-"}</span>
        <span>
          Máx: {compact(max)}
          {suffix}
        </span>
        <span>{points.at(-1)?.label || "-"}</span>
      </div>
    </div>
  );
}

function BarsPanel({ clients }) {
  const rows = clients
    .slice()
    .sort((a, b) => n(b.maxTablespacePct) - n(a.maxTablespacePct))
    .slice(0, 8);
  return (
    <div className="panel bars-panel">
      <div className="section-title">
        <h2>
          <HardDrive size={20} /> Tablespaces críticas
        </h2>
        <span>Top 8 por uso máximo</span>
      </div>
      {rows.length ? (
        rows.map((c) => (
          <div className="bar-row" key={c.agentId}>
            <div>
              <strong>{c.customerName || c.agentId}</strong>
              <small>{c.host || c.agentId}</small>
            </div>
            <div>
              <span>{compact(c.maxTablespacePct, 0)}%</span>
              <ProgressBar value={c.maxTablespacePct} />
            </div>
          </div>
        ))
      ) : (
        <p className="empty">Sem dados de tablespace.</p>
      )}
    </div>
  );
}

function DonutPanel({ active, inactive, blocked }) {
  const total = Math.max(n(active) + n(inactive) + n(blocked), 1);
  const parts = [
    { label: "Ativas", value: n(active), cls: "active" },
    { label: "Inativas", value: n(inactive), cls: "inactive" },
    { label: "Bloqueadas", value: n(blocked), cls: "blocked" },
  ];
  let offset = 25;
  return (
    <div className="panel donut-panel">
      <div className="section-title">
        <h2>
          <Activity size={20} /> Sessões Oracle
        </h2>
        <span>Distribuição atual</span>
      </div>
      <div className="donut-wrap">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="44" className="donut-base" />
          {parts.map((p) => {
            const len = (p.value / total) * 276.46;
            const el = (
              <circle
                key={p.label}
                cx="60"
                cy="60"
                r="44"
                className={`donut-slice ${p.cls}`}
                strokeDasharray={`${len} ${276.46 - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-center">
          <strong>{compact(total, 0)}</strong>
          <span>sessões</span>
        </div>
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.label} className={p.cls}>
            <i /> {p.label}: {compact(p.value, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ c, selected, onSelect, onDelete }) {
  const online = ageOk(c.lastSeenAt);
  const health =
    n(c.maxTablespacePct) >= 90 ||
    n(c.blockedSessions) > 0 ||
    n(c.locksWaiting) > 0
      ? "danger"
      : n(c.maxTablespacePct) >= 80
        ? "warn"
        : "ok";
  return (
    <div
      className={`agent-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <button
        className="delete-client-button"
        title="Excluir cliente"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(c);
        }}
      >
        <Trash2 size={16} />
      </button>
      <div className="agent-card-top">
        <span className={`dot ${online ? "ok" : "off"}`} />
        <strong>{c.customerName || c.agentId}</strong>
        <Pill tone={online ? "ok" : "warn"}>
          {online ? "Online" : "Offline"}
        </Pill>
      </div>
      <small>{c.host || c.agentId}</small>
      <div className="agent-metrics">
        <span>
          Sessões <b>{compact(c.activeSessions, 0)}</b>
        </span>
        <span>
          Locks <b>{compact(c.locksWaiting, 0)}</b>
        </span>
        <span>
          TS <b className={health}>{compact(c.maxTablespacePct, 0)}%</b>
        </span>
        <span>
          Backup <b className={backupTone(c)}>{backupLabel(c)}</b>
        </span>
      </div>
    </div>
  );
}

function ClientListView({
  clients,
  selectedAgent,
  onSelect,
  onDelete,
  filterText,
  statusFilter,
  density,
}) {
  const rows = clients
    .filter((c) => {
      const sev = clientSeverity(c);
      if (statusFilter !== "all" && sev !== statusFilter) return false;
      const q = filterText.trim().toLowerCase();
      if (!q) return true;
      return [c.customerName, c.agentId, c.host, c.environment]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, offline: 2, healthy: 3 };
      const ra = rank[clientSeverity(a)] ?? 9;
      const rb = rank[clientSeverity(b)] ?? 9;
      if (ra !== rb) return ra - rb;
      return n(b.maxTablespacePct) - n(a.maxTablespacePct);
    });

  return (
    <section className={`panel client-list-panel density-${density}`}>
      <div className="list-header-row">
        <div>
          <h2>
            <List size={20} /> Modo lista — clientes
          </h2>
          <p>
            Visão compacta de todos os clientes - Ordena críticos primeiro.  
          </p>
        </div>
        <div className="list-count">
          <strong>{rows.length}</strong>
          <span>visíveis</span>
        </div>
      </div>

      <div className="client-list-table">
        <div className="client-list-head">
          <span>Status</span>
          <span>Cliente / Agent</span>
          <span>Ambiente</span>
          <span>Último heartbeat</span>
          <span>Sessões</span>
          <span>Locks</span>
          <span>TS máx.</span>
          <span>Backup</span>
          <span>PGA</span>
          <span>DB Time/s</span>
          <span>Ação</span>
        </div>
        {rows.length ? (
          rows.map((c) => {
            const sev = clientSeverity(c);
            const pgaPct = Math.min(
              100,
              (n(c.pgaAllocMb) /
                Math.max(n(c.pgaLimitMb || c.pgaTargetMb || 2048), 1)) *
                100,
            );
            return (
              <div
                key={c.agentId}
                className={`client-list-row ${selectedAgent === c.agentId ? "selected" : ""} sev-${sev}`}
                onClick={() => onSelect(c.agentId)}
                role="button"
                tabIndex={0}
              >
                <span className="status-cell">
                  <i className={`beacon ${sev}`} />
                  <Pill tone={severityTone(sev)}>{severityLabel(sev)}</Pill>
                </span>
                <span className="client-cell">
                  <strong>{c.customerName || c.agentId}</strong>
                  <small>{c.agentId}</small>
                </span>
                <span>{c.environment || "-"}</span>
                <span>
                  {fmtTime(c.lastSeenAt)}
                  <small>{fmtDate(c.lastSeenAt)}</small>
                </span>
                <span className="num">
                  {compact(c.activeSessions, 0)}
                  <small>ativas</small>
                </span>
                <span
                  className={`num ${n(c.locksWaiting) > 0 ? "danger-text" : ""}`}
                >
                  {compact(c.locksWaiting, 0)}
                  <small>{compact(c.blockedSessions, 0)} bloqueadas</small>
                </span>
                <span className="metric-with-bar">
                  <b>{compact(c.maxTablespacePct, 0)}%</b>
                  <ProgressBar value={c.maxTablespacePct} />
                </span>
                <span className="backup-cell">
                  <Pill tone={backupTone(c)}>{backupLabel(c)}</Pill>
                  <small>
                    {fmtBackupAge(c)} • {c.backupStatus?.latestFile || "-"}
                  </small>
                </span>
                <span className="metric-with-bar">
                  <b>{compact(pgaPct, 0)}%</b>
                  <ProgressBar value={pgaPct} />
                </span>
                <span className="num">
                  {compact(c.dbTimePerSec)}
                  <small>redo {compact(c.redoMbPerMin)} MB/min</small>
                </span>
                <span className="action-cell">
                  <button
                    className="delete-client-button inline"
                    title="Excluir cliente"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty-list">
            Nenhum cliente encontrado com os filtros atuais.
          </div>
        )}
      </div>
    </section>
  );
}

function LoginScreen({ apiUrl, setApiUrl, onLogin, message, loading }) {
  const [username, setUsername] = useState(localStorage.getItem("dashboardUser") || "admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function submitLogin() {
    if (!loading) onLogin(username.trim(), password);
  }

  return (
    <main className="login-page">
      <section className="login-shell glass">
        <aside className="login-info">
          <div className="login-info-icon">
            <ShieldCheck size={52} />
          </div>
          <p className="eyebrow">Oracle DBA Platform</p>
          <h1>Dashboard de Monitoramento</h1>
          <p>
            Acesse o painel web para acompanhar clientes, métricas Oracle,
            backups e comandos remotos com segurança.
          </p>
          <div className="login-oracle-art" aria-hidden="true">
            <span className="db-cylinder" />
            <span className="server-box left" />
            <span className="server-box right" />
            <span className="pulse-line" />
          </div>
        </aside>

        <section className="login-card">
          <div className="login-brand">
            <ShieldCheck size={32} />
            <div>
              <h2>Login do Dashboard</h2>
              <p>Informe suas credenciais para acessar o painel.</p>
            </div>
          </div>

          <div className="login-form">
            <label className="login-field">
              <span>URL da API Central</span>
              <div className="input-wrap">
                <Link2 size={18} />
                <input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://central-api-production.up.railway.app"
                  autoComplete="url"
                />
              </div>
            </label>

            <label className="login-field">
              <span>Usuário</span>
              <div className="input-wrap">
                <UserRound size={18} />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="login-field">
              <span>Senha</span>
              <div className="input-wrap">
                <Lock size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitLogin();
                  }}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <button className="login-submit" disabled={loading} onClick={submitLogin}>
              <Lock size={18} /> {loading ? "Entrando..." : "Entrar"}
            </button>
          </div>

          <div className="login-status">
            <CheckCircle2 size={18} />
            <span><strong>Status:</strong> {message}</span>
          </div>

          <small className="login-help">
            Configure no Railway/Central API: DASHBOARD_ADMIN_USER e DASHBOARD_ADMIN_PASSWORD.
          </small>
        </section>
      </section>
    </main>
  );
}

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [authUser, setAuthUser] = useState(() => {
    const raw = localStorage.getItem("dashboardAuthUser");
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [commands, setCommands] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [sql, setSql] = useState(
    "SELECT instance_name, status, database_status FROM v$instance;",
  );
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [message, setMessage] = useState(`Dashboard Web v${VERSION} pronto.`);
  const [loading, setLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [viewMode, setViewMode] = useState(
    localStorage.getItem("dashboardWebViewMode") || "cards",
  );
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [density, setDensity] = useState(
    localStorage.getItem("dashboardWebDensity") || "compact",
  );
  const [pendingDelete, setPendingDelete] = useState(null);

  const onlineCount = useMemo(
    () => clients.filter((c) => ageOk(c.lastSeenAt)).length,
    [clients],
  );
  const critical = useMemo(
    () => alerts.filter((a) => a.level === "critical").length,
    [alerts],
  );
  const effectiveAgentId = useMemo(
    () => selectedAgent || clients[0]?.agentId || "",
    [clients, selectedAgent],
  );
  const selected = useMemo(
    () =>
      clients.find((c) => c.agentId === effectiveAgentId) || clients[0] || null,
    [clients, effectiveAgentId],
  );
  const selectedMetrics = useMemo(
    () =>
      metrics.filter(
        (m) => !selected?.agentId || m.agentId === selected.agentId,
      ),
    [metrics, selected],
  );
  const allActiveSessions = useMemo(
    () => clients.reduce((sum, c) => sum + n(c.activeSessions), 0),
    [clients],
  );
  const allInactiveSessions = useMemo(
    () => clients.reduce((sum, c) => sum + n(c.inactiveSessions), 0),
    [clients],
  );
  const allBlockedSessions = useMemo(
    () => clients.reduce((sum, c) => sum + n(c.blockedSessions), 0),
    [clients],
  );
  const maxTablespace = useMemo(
    () => Math.max(0, ...clients.map((c) => n(c.maxTablespacePct))),
    [clients],
  );
  const totalLocks = useMemo(
    () => clients.reduce((sum, c) => sum + n(c.locksWaiting), 0),
    [clients],
  );
  const backupProblems = useMemo(
    () =>
      clients.filter((c) => ["critical", "warning"].includes(backupSeverity(c)))
        .length,
    [clients],
  );
  const severityCounts = useMemo(
    () =>
      clients.reduce((acc, c) => {
        const sev = clientSeverity(c);
        acc[sev] = (acc[sev] || 0) + 1;
        return acc;
      }, {}),
    [clients],
  );
  const cpuSpark = useMemo(
    () => metricSeries(selectedMetrics, "DB_CPU_SECONDS", 16),
    [selectedMetrics],
  );
  const sessionSpark = useMemo(
    () => metricSeries(selectedMetrics, "ACTIVE_SESSIONS", 16),
    [selectedMetrics],
  );
  const tsSpark = useMemo(
    () => metricSeries(selectedMetrics, "TABLESPACE_MAX_USED_PCT", 16),
    [selectedMetrics],
  );

  async function login(username, password) {
    const cleanApiUrl = apiUrl.trim().replace(/\/$/, "");
    if (!username || !password) return setMessage("Informe usuário e senha.");
    setLoading(true);
    try {
      localStorage.setItem("centralApiUrl", cleanApiUrl);
      const res = await fetch(`${cleanApiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.message || `HTTP ${res.status}`);
      setToken(body.token);
      setAuthUser(body.user);
      localStorage.setItem("dashboardAuthToken", body.token);
      localStorage.setItem("dashboardAuthUser", JSON.stringify(body.user));
      localStorage.setItem("dashboardUser", username);
      setMessage("Login realizado com sucesso.");
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      if (token) await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setToken("");
    setAuthUser(null);
    localStorage.removeItem("dashboardAuthToken");
    localStorage.removeItem("dashboardAuthUser");
    setRealtime(false);
    setMessage("Sessão encerrada.");
  }

  async function apiFetch(path, options = {}) {
    const cleanApiUrl = apiUrl.trim().replace(/\/$/, "");
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    if (options.body && !headers["Content-Type"])
      headers["Content-Type"] = "application/json";
    return fetch(`${cleanApiUrl}${path}`, { ...options, headers });
  }

  async function load() {
    setLoading(true);
    try {
      const cleanApiUrl = apiUrl.trim().replace(/\/$/, "");
      localStorage.setItem("centralApiUrl", cleanApiUrl);
      const [h, c, a, ah, m, s] = await Promise.all([
        fetch(`${cleanApiUrl}/health`),
        apiFetch("/api/clients"),
        apiFetch("/api/alerts"),
        apiFetch("/api/alerts/history"),
        apiFetch("/api/metrics?limit=300"),
        apiFetch("/api/scripts"),
      ]);
      if (!h.ok) throw new Error(`Health HTTP ${h.status}`);
      if (!c.ok) throw new Error(`Clientes HTTP ${c.status}`);
      if (!a.ok) throw new Error(`Alertas HTTP ${a.status}`);
      if (!ah.ok) throw new Error(`Histórico HTTP ${ah.status}`);
      if (!m.ok) throw new Error(`Métricas HTTP ${m.status}`);
      if (!s.ok) throw new Error(`Scripts HTTP ${s.status}`);
      const clientsRows = (await c.json()).rows || [];
      setHealth(await h.json());
      setClients(clientsRows);
      setAlerts((await a.json()).rows || []);
      setAlertHistory((await ah.json()).rows || []);
      setMetrics((await m.json()).rows || []);
      setCommands((await s.json()).rows || []);
      setSelectedAgent((prev) => {
        if (prev && clientsRows.some((c) => c.agentId === prev)) return prev;
        return clientsRows[0]?.agentId || "";
      });
      setMessage("Dados atualizados com sucesso.");
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function clearCommandHistory() {
    const scope = selectedAgent
      ? `do Agent ${selectedAgent}`
      : "de todos os Agents";
    const ok = window.confirm(
      `Limpar o histórico de comandos ${scope}? Comandos em fila ou em execução serão mantidos.`,
    );
    if (!ok) return;
    setLoading(true);
    try {
      const query = selectedAgent
        ? `?agentId=${encodeURIComponent(selectedAgent)}`
        : "";
      const res = await apiFetch(`/api/scripts/history${query}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setMessage(body.message || "Histórico de comandos limpo.");
      await load();
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeleteClient() {
    if (!pendingDelete?.agentId) return;
    setLoading(true);
    try {
      const agentId = pendingDelete.agentId;
      const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.message || `HTTP ${res.status}`);
      setPendingDelete(null);
      if (selectedAgent === agentId) setSelectedAgent("");
      setMessage(body.message || "Cliente excluído.");
      await load();
    } catch (err) {
      setMessage(`Erro ao excluir cliente: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function queueScript() {
    const agentIdToQueue = effectiveAgentId;
    if (!agentIdToQueue)
      return setMessage("Selecione um Agent antes de enfileirar script.");
    if (!sql.trim()) return setMessage("Informe um SQL/script.");
    setScriptLoading(true);
    try {
      const res = await apiFetch("/api/scripts/queue", {
        method: "POST",
        body: JSON.stringify({
          agentId: agentIdToQueue,
          sql,
          allowDangerous,
          type: "SQL_SCRIPT",
          note: `Criado pelo Dashboard Web v${VERSION}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setMessage(
        body.blocked
          ? body.message
          : "Script enfileirado. O Agent executará na próxima coleta.",
      );
      await load();
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setScriptLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [token]);
  useEffect(() => {
    localStorage.setItem("dashboardWebViewMode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    localStorage.setItem("dashboardWebDensity", density);
  }, [density]);
  useEffect(() => {
    if (!token) return;
    const cleanApiUrl = apiUrl.trim().replace(/\/$/, "");
    const url = `${cleanApiUrl}/api/realtime?token=${encodeURIComponent(token)}`;
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
      if (payload.commands) setCommands(payload.commands);
    };
    es.addEventListener("connected", (e) => updateState(JSON.parse(e.data)));
    es.addEventListener("state", (e) => updateState(JSON.parse(e.data)));
    es.addEventListener("heartbeat", (e) =>
      updateState(JSON.parse(e.data).state || {}),
    );
    es.addEventListener("metrics", (e) => {
      const payload = JSON.parse(e.data);
      updateState(payload.state || {});
      setMetrics((prev) =>
        [payload.record, ...prev.filter(Boolean)].slice(0, 300),
      );
      setMessage("Métrica recebida em tempo real.");
    });
    es.addEventListener("command", (e) => {
      const cmd = JSON.parse(e.data);
      setCommands((prev) =>
        [cmd, ...prev.filter((x) => x.id !== cmd.id)].slice(0, 120),
      );
      setMessage(`Comando atualizado: ${cmd.status}`);
    });
    return () => es.close();
  }, [apiUrl, token]);

  if (!token || !authUser) {
    return (
      <LoginScreen
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
        onLogin={login}
        message={message}
        loading={loading}
      />
    );
  }

  return (
    <main className={viewMode === "list" ? "list-mode" : ""}>
      <header className="hero noc-hero">
        <div>
          <p className="eyebrow">Oracle DBA - Estatísticas </p>
          <h1>Dashboard Web v{VERSION}</h1>
          <p>Projeto em desenvolvimento</p>
        </div>
        <div className="hero-actions">
          <Pill tone={health?.ok ? "ok" : "danger"}>
            {health?.ok ? "API online" : "API offline"}
          </Pill>
          <Pill tone={realtime ? "ok" : "warn"}>
            {realtime ? "Realtime ON" : "Realtime OFF"}
          </Pill>
          <button onClick={load} disabled={loading}>
            <RefreshCcw size={18} className={loading ? "spin" : ""} /> Atualizar
          </button>
        </div>
      </header>

      <section className="panel settings glass">
        <label>
          URL da API Central
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        </label>
        <label>
          Usuário logado
          <input value={authUser?.username || ""} readOnly />
        </label>
        <div className="status">
          <strong>Status:</strong> {message}
          <button className="secondary-button" onClick={logout}>Sair</button>
        </div>
      </section>

      <section className="panel view-toolbar glass">
        <div className="view-mode-buttons">
          <button
            className={viewMode === "cards" ? "active" : ""}
            onClick={() => setViewMode("cards")}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
          >
            <List size={18} /> Lista monitor
          </button>
        </div>
        <div className="list-summary">
          <span className="summary-ok">OK {severityCounts.healthy || 0}</span>
          <span className="summary-warn">
            Atenção {severityCounts.warning || 0}
          </span>
          <span className="summary-danger">
            Crítico {severityCounts.critical || 0}
          </span>
          <span className="summary-off">
            Offline {severityCounts.offline || 0}
          </span>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Filtrar cliente, agent, host..."
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          />
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="critical">Críticos</option>
            <option value="warning">Atenção</option>
            <option value="offline">Offline</option>
            <option value="healthy">OK</option>
          </select>
        </label>
        <label>
          Densidade
          <select value={density} onChange={(e) => setDensity(e.target.value)}>
            <option value="compact">Compacta</option>
            <option value="comfortable">Confortável</option>
          </select>
        </label>
      </section>

      <section className="kpi-grid">
        <TopStat
          icon={Server}
          label="Agents online"
          value={`${onlineCount}/${clients.length}`}
          hint="Heartbeat < 2 minutos"
          tone={onlineCount ? "green" : "red"}
        />
        <TopStat
          icon={AlertTriangle}
          label="Alertas críticos"
          value={critical}
          hint="Eventos ativos"
          tone={critical ? "red" : "green"}
        />
        <TopStat
          icon={Activity}
          label="Sessões ativas"
          value={compact(allActiveSessions, 0)}
          hint="Total dos clientes"
          tone="cyan"
          spark={sessionSpark}
        />
        <TopStat
          icon={Lock}
          label="Locks em espera"
          value={compact(totalLocks, 0)}
          hint="Quanto menor melhor"
          tone={totalLocks ? "red" : "green"}
        />
        <TopStat
          icon={HardDrive}
          label="Backup diário"
          value={backupProblems}
          hint="Falhas/atenções ativas"
          tone={backupProblems ? "red" : "green"}
        />
        <TopStat
          icon={HardDrive}
          label="Tablespace máx."
          value={`${compact(maxTablespace, 0)}%`}
          hint="Maior uso encontrado"
          tone={
            pctClass(maxTablespace) === "danger"
              ? "red"
              : pctClass(maxTablespace) === "warn"
                ? "yellow"
                : "green"
          }
          spark={tsSpark}
        />
        <TopStat
          icon={Cpu}
          label="DB CPU"
          value={`${compact(getLatestMetric(metrics, selected?.agentId, "DB_CPU_SECONDS") || selected?.dbCpuSeconds, 1)}s`}
          hint={selected?.customerName || "Agent selecionado"}
          tone="purple"
          spark={cpuSpark}
        />
      </section>

      {viewMode === "list" ? (
        <ClientListView
          clients={clients}
          selectedAgent={selectedAgent}
          onSelect={setSelectedAgent}
          onDelete={setPendingDelete}
          filterText={clientFilter}
          statusFilter={statusFilter}
          density={density}
        />
      ) : (
        <section className="agent-strip">
          {clients.length ? (
            clients.map((c) => (
              <AgentCard
                key={c.agentId}
                c={c}
                selected={selected?.agentId === c.agentId}
                onSelect={() => setSelectedAgent(c.agentId)}
                onDelete={setPendingDelete}
              />
            ))
          ) : (
            <div className="panel empty">
              Nenhum Agent enviou métricas ainda.
            </div>
          )}
        </section>
      )}

      <section className="overview-grid">
        <div className="panel selected-panel">
          <div className="section-title">
            <h2>
              <Database size={20} /> Agent selecionado
            </h2>
            <span>{selected?.agentId || "-"}</span>
          </div>
          {selected ? (
            <div className="selected-content">
              <div>
                <h3>{selected.customerName || selected.agentId}</h3>
                <p>
                  {selected.host || "Host não informado"} •{" "}
                  {selected.environment || "Ambiente"}
                </p>
                <Pill tone={ageOk(selected.lastSeenAt) ? "ok" : "warn"}>
                  {ageOk(selected.lastSeenAt) ? "Online" : "Offline"}
                </Pill>
                <Pill tone={backupTone(selected)}>
                  Backup {backupLabel(selected)}
                </Pill>
                <small>Último envio: {fmtDate(selected.lastSeenAt)}</small>
                <small>
                  Último backup:{" "}
                  {selected.backupStatus?.latestModifiedAt
                    ? fmtDate(selected.backupStatus.latestModifiedAt)
                    : "-"}
                </small>
                <small>{selected.backupStatus?.message || ""}</small>
              </div>
              <div className="gauge-row">
                <GaugeRing
                  value={selected.maxTablespacePct}
                  label="Tablespace"
                  sublabel="uso máximo"
                />
                <GaugeRing
                  value={Math.min(
                    100,
                    (n(selected.pgaAllocMb) /
                      Math.max(
                        n(selected.pgaLimitMb || selected.pgaTargetMb || 2048),
                        1,
                      )) *
                      100,
                  )}
                  label="PGA"
                  sublabel={`${compact(selected.pgaAllocMb)} MB`}
                />
                <GaugeRing
                  value={Math.min(
                    100,
                    (n(selected.activeSessions) /
                      Math.max(n(selected.sessionsLimit || 300), 1)) *
                      100,
                  )}
                  label="Sessões"
                  sublabel={`${compact(selected.activeSessions, 0)} ativas`}
                />
              </div>
            </div>
          ) : (
            <p className="empty">Selecione um Agent.</p>
          )}
        </div>
        <DonutPanel
          active={allActiveSessions}
          inactive={allInactiveSessions}
          blocked={allBlockedSessions}
        />
        <BarsPanel clients={clients} />
      </section>

      <section className="charts-grid">
        <AreaChart
          rows={selectedMetrics}
          metric="ACTIVE_SESSIONS"
          title="Sessões ativas"
          description="Tendência do Agent selecionado nas últimas amostras."
        />
        <AreaChart
          rows={selectedMetrics}
          metric="TABLESPACE_MAX_USED_PCT"
          title="Uso máximo de tablespace"
          description="Acompanhamento visual para risco de crescimento."
          suffix="%"
          maxHint={100}
        />
        <AreaChart
          rows={selectedMetrics}
          metric="LOCKS_WAITING"
          title="Locks em espera"
          description="Picos indicam contenção ou transações presas."
        />
        <AreaChart
          rows={selectedMetrics}
          metric="DB_TIME_SECONDS"
          title="DB Time acumulado"
          description="Tempo de banco acumulado reportado pelo Agent."
          suffix="s"
        />
      </section>

      <section className="two-cols">
        <div className="panel">
          <h2>
            <TerminalSquare size={20} /> Executar script via Agent
          </h2>
          <p className="muted left">
            A API enfileira a tarefa e o Agent executa localmente no servidor do
            cliente.
          </p>
          <label className="field">
            Agent
            <select
              value={effectiveAgentId}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.agentId} value={c.agentId}>
                  {c.customerName || c.agentId}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            SQL / Script
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={9}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={allowDangerous}
              onChange={(e) => setAllowDangerous(e.target.checked)}
            />{" "}
            Liberar comandos críticos nesta execução
          </label>
          <button onClick={queueScript} disabled={scriptLoading || !effectiveAgentId || !sql.trim()}>
            <Play size={18} /> {scriptLoading ? "Enfileirando..." : "Enfileirar execução"}
          </button>
        </div>
        <div className="panel">
          <div className="panel-title-row">
            <h2>
              <Code2 size={20} /> Histórico de comandos
            </h2>
            <button
              className="danger-button"
              onClick={clearCommandHistory}
              disabled={
                loading ||
                !commands.some(
                  (cmd) => !["QUEUED", "IN_PROGRESS"].includes(cmd.status),
                )
              }
            >
              <Trash2 size={18} /> Limpar histórico
            </button>
          </div>
          <div className="commands">
            {commands.length ? (
              commands.map((cmd) => (
                <details key={cmd.id} className="command">
                  <summary>
                    <span className={`pill ${statusClass(cmd.status)}`}>
                      {cmd.status}
                    </span>
                    <strong>{cmd.agentId || "Todos agents"}</strong>
                    <small>{fmtDate(cmd.createdAt)}</small>
                  </summary>
                  <div className="command-body">
                    <p>{cmd.note}</p>
                    <pre>{cmd.sql || "-"}</pre>
                    {cmd.output && (
                      <>
                        <b>Output</b>
                        <pre>{cmd.output}</pre>
                      </>
                    )}
                    {cmd.error && (
                      <>
                        <b>Erro</b>
                        <pre className="error-pre">{cmd.error}</pre>
                      </>
                    )}
                  </div>
                </details>
              ))
            ) : (
              <p className="muted">Nenhum comando criado.</p>
            )}
          </div>
        </div>
      </section>

      <section className="two-cols">
        <div className="panel">
          <h2>
            <Gauge size={20} /> Métricas enterprise
          </h2>
          <div className="enterprise-grid">
            {clients.slice(0, 6).map((c) => (
              <div className="mini" key={c.agentId}>
                <strong>{c.customerName || c.agentId}</strong>
                <span>DB Time/s: {compact(c.dbTimePerSec)}</span>
                <span>Logical Reads: {compact(c.logicalReads)}</span>
                <span>Physical Reads: {compact(c.physicalReads)}</span>
                <span>Execuções: {compact(c.executions)}</span>
                <span>Parse Count: {compact(c.parseCountTotal)}</span>
                <span>Redo: {compact(c.redoMbPerMin)} MB/min</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2>
            <BellRing size={20} /> Alertas
          </h2>
          {alerts.length ? (
            alerts.map((a, i) => (
              <div className={`alert ${a.level}`} key={i}>
                {a.message}
              </div>
            ))
          ) : (
            <p className="muted">
              <CheckCircle2 size={16} /> Nenhum alerta ativo.
            </p>
          )}
          <h3>Histórico</h3>
          {alertHistory.slice(0, 8).map((a) => (
            <div className={`alert ${a.level}`} key={a.id}>
              {fmtDate(a.at)} — {a.message}
            </div>
          ))}
        </div>
      </section>

      <section className="panel raw-panel">
        <h2>
          <ShieldCheck size={20} /> Últimas métricas recebidas
        </h2>
        <pre>
          {metrics.length
            ? JSON.stringify(metrics.slice(0, 3), null, 2)
            : "Sem métricas."}
        </pre>
      </section>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              <Trash2 size={20} /> Excluir Cliente
            </h2>
            <p>Tem certeza que deseja excluir este cliente?</p>
            <strong>
              {pendingDelete.customerName || pendingDelete.agentId}
            </strong>
            <small>{pendingDelete.agentId}</small>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setPendingDelete(null)}
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                className="danger-button"
                onClick={confirmDeleteClient}
                disabled={loading}
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
