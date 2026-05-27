import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BellRing, Cpu, Database, Gauge, HardDrive, RefreshCcw, Server, ShieldCheck, Wifi, Zap } from 'lucide-react';
import './styles.css';

const DEFAULT_API_URL = localStorage.getItem('centralApiUrl') || import.meta.env.VITE_API_URL || 'http://127.0.0.1:4090';
const DEFAULT_TOKEN = localStorage.getItem('centralApiToken') || import.meta.env.VITE_API_TOKEN || 'dev-token-change-me';

function fmtDate(value) { if (!value) return '-'; try { return new Date(value).toLocaleString(); } catch { return value; } }
function ageOk(value) { if (!value) return false; return Date.now() - new Date(value).getTime() < 120000; }
function n(value) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function compact(value) { return new Intl.NumberFormat('pt-BR', { notation: Math.abs(n(value)) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(n(value)); }
function Card({ icon: Icon, label, value, hint }) { return <div className="card"><Icon size={22}/><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>; }
function Bar({ value, max = 100 }) { const pct = Math.max(0, Math.min(100, (n(value) / max) * 100)); return <div className="bar"><span style={{ width: `${pct}%` }} /></div>; }

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [message, setMessage] = useState('Dashboard Web v2.9.0 pronto.');
  const [loading, setLoading] = useState(false);
  const [realtime, setRealtime] = useState(false);

  const online = useMemo(() => clients.filter(c => ageOk(c.lastSeenAt)).length, [clients]);
  const critical = useMemo(() => alerts.filter(a => a.level === 'critical').length, [alerts]);
  const latestClient = clients[0] || null;
  const maxTablespace = useMemo(() => Math.max(0, ...clients.map(c => n(c.maxTablespacePct))), [clients]);
  const totalBlocked = useMemo(() => clients.reduce((sum, c) => sum + n(c.blockedSessions), 0), [clients]);
  const totalLocks = useMemo(() => clients.reduce((sum, c) => sum + n(c.locksWaiting), 0), [clients]);

  async function load() {
    setLoading(true);
    try {
      const cleanApiUrl = apiUrl.trim().replace(/\/$/, '');
      localStorage.setItem('centralApiUrl', cleanApiUrl);
      localStorage.setItem('centralApiToken', token);
      const headers = { Authorization: `Bearer ${token}` };
      const [h, c, a, ah, m] = await Promise.all([
        fetch(`${cleanApiUrl}/health`),
        fetch(`${cleanApiUrl}/api/clients`, { headers }),
        fetch(`${cleanApiUrl}/api/alerts`, { headers }),
        fetch(`${cleanApiUrl}/api/alerts/history`, { headers }),
        fetch(`${cleanApiUrl}/api/metrics?limit=50`, { headers })
      ]);
      if (!h.ok) throw new Error(`Health HTTP ${h.status}`);
      if (!c.ok) throw new Error(`Clientes HTTP ${c.status}`);
      if (!a.ok) throw new Error(`Alertas HTTP ${a.status}`);
      if (!ah.ok) throw new Error(`Histórico HTTP ${ah.status}`);
      if (!m.ok) throw new Error(`Métricas HTTP ${m.status}`);
      setHealth(await h.json());
      setClients((await c.json()).rows || []);
      setAlerts((await a.json()).rows || []);
      setAlertHistory((await ah.json()).rows || []);
      setMetrics((await m.json()).rows || []);
      setMessage('Dados atualizados com sucesso.');
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const cleanApiUrl = apiUrl.trim().replace(/\/$/, '');
    const url = `${cleanApiUrl}/api/realtime?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onopen = () => { setRealtime(true); setMessage('Tempo real conectado.'); };
    es.onerror = () => { setRealtime(false); };
    const updateState = (payload) => { if (payload.clients) setClients(payload.clients); if (payload.alerts) setAlerts(payload.alerts); };
    es.addEventListener('connected', e => updateState(JSON.parse(e.data)));
    es.addEventListener('state', e => updateState(JSON.parse(e.data)));
    es.addEventListener('heartbeat', e => updateState(JSON.parse(e.data).state || {}));
    es.addEventListener('metrics', e => { const payload = JSON.parse(e.data); updateState(payload.state || {}); setMetrics(prev => [payload.record, ...prev].slice(0, 50)); setMessage('Métrica recebida em tempo real.'); });
    es.addEventListener('command', e => setMessage(`Comando auditado: ${JSON.parse(e.data).id}`));
    return () => es.close();
  }, [apiUrl, token]);

  return <main>
    <header className="hero"><div><p className="eyebrow">Oracle DBA Platform</p><h1>Dashboard Web v2.9.0</h1><p>Oracle Monitoring Enterprise com métricas avançadas, persistência PostgreSQL e tempo real via SSE.</p></div><button onClick={load} disabled={loading}><RefreshCcw size={18} className={loading ? 'spin' : ''}/> Atualizar</button></header>

    <section className="panel settings"><label>URL da API Central<input value={apiUrl} onChange={e => setApiUrl(e.target.value)} /></label><label>Token<input value={token} onChange={e => setToken(e.target.value)} /></label><div className="status"><strong>Status:</strong> {message}</div></section>

    <section className="grid cards"><Card icon={Wifi} label="API" value={health?.ok ? 'Online' : 'Offline'} /><Card icon={Zap} label="Tempo real" value={realtime ? 'Conectado' : 'Offline'} /><Card icon={Server} label="Agents" value={clients.length} /><Card icon={Activity} label="Online agora" value={online} /><Card icon={BellRing} label="Alertas críticos" value={critical} /><Card icon={HardDrive} label="Tablespace máx." value={`${compact(maxTablespace)}%`} /><Card icon={AlertTriangle} label="Bloqueios/Locks" value={`${compact(totalBlocked)} / ${compact(totalLocks)}`} /><Card icon={Cpu} label="DB CPU" value={compact(latestClient?.dbCpuSeconds)} hint="segundos acumulados" /></section>

    <section className="panel"><h2><Database size={20}/> Clientes monitorados</h2><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Agent</th><th>Host</th><th>Status</th><th>Último envio</th><th>Sessões</th><th>Bloqueios</th><th>Locks</th><th>Tablespace</th><th>CPU DB</th><th>PGA</th><th>SGA</th></tr></thead><tbody>{clients.map(c => <tr key={c.agentId}><td>{c.customerName || '-'}</td><td className="mono">{c.agentId}</td><td>{c.host || '-'}</td><td><span className={ageOk(c.lastSeenAt) ? 'pill ok' : 'pill warn'}>{ageOk(c.lastSeenAt) ? 'Online' : 'Offline'}</span></td><td>{fmtDate(c.lastSeenAt)}</td><td>{compact(c.activeSessions)}</td><td>{compact(c.blockedSessions)}</td><td>{compact(c.locksWaiting)}</td><td><div className="metric-cell"><span>{compact(c.maxTablespacePct)}%</span><Bar value={c.maxTablespacePct}/></div></td><td>{compact(c.dbCpuSeconds)}s</td><td>{compact(c.pgaAllocMb)} MB</td><td>{compact(c.sgaMb)} MB</td></tr>)}{!clients.length && <tr><td colSpan="12" className="empty">Nenhum Agent enviou métricas ainda.</td></tr>}</tbody></table></div></section>

    <section className="two-cols"><div className="panel"><h2><Gauge size={20}/> Métricas enterprise</h2><div className="enterprise-grid">{clients.slice(0, 6).map(c => <div className="mini" key={c.agentId}><strong>{c.customerName || c.agentId}</strong><span>DB Time: {compact(c.dbTimeSeconds)}s</span><span>Logical Reads: {compact(c.logicalReads)}</span><span>Physical Reads: {compact(c.physicalReads)}</span><span>Execuções: {compact(c.executions)}</span><span>Parse Count: {compact(c.parseCountTotal)}</span><span>Redo: {compact(c.redoSizeMb)} MB</span></div>)}</div></div><div className="panel"><h2><AlertTriangle size={20}/> Alertas</h2>{alerts.length ? alerts.map((a, i) => <div className={`alert ${a.level}`} key={i}>{a.message}</div>) : <p className="muted">Nenhum alerta ativo.</p>}<h3>Histórico</h3>{alertHistory.slice(0,8).map(a => <div className={`alert ${a.level}`} key={a.id}>{fmtDate(a.at)} — {a.message}</div>)}</div></section>

    <section className="panel"><h2><ShieldCheck size={20}/> Últimas métricas recebidas</h2><pre>{metrics.length ? JSON.stringify(metrics.slice(0, 5), null, 2) : 'Sem métricas.'}</pre></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
