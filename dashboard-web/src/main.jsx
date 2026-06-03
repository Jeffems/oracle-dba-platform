import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BellRing, Code2, Cpu, Database, Gauge, HardDrive, Play, RefreshCcw, Server, ShieldCheck, TerminalSquare, Trash2, Wifi, Zap } from 'lucide-react';
import './styles.css';

const DEFAULT_API_URL = localStorage.getItem('centralApiUrl') || import.meta.env.VITE_API_URL || 'http://127.0.0.1:4090';
const DEFAULT_TOKEN = localStorage.getItem('centralApiToken') || import.meta.env.VITE_API_TOKEN || 'dev-token-change-me';

function fmtDate(value) { if (!value) return '-'; try { return new Date(value).toLocaleString(); } catch { return value; } }
function ageOk(value) { if (!value) return false; return Date.now() - new Date(value).getTime() < 120000; }
function n(value) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function compact(value) { return new Intl.NumberFormat('pt-BR', { notation: Math.abs(n(value)) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(n(value)); }
function Card({ icon: Icon, label, value, hint }) { return <div className="card"><Icon size={22}/><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>; }
function Bar({ value, max = 100 }) { const pct = Math.max(0, Math.min(100, (n(value) / max) * 100)); return <div className="bar"><span style={{ width: `${pct}%` }} /></div>; }
function metricValue(snapshot, key) { const rows = snapshot?.overview || snapshot?.OVERVIEW || []; const found = rows.find(r => String(r.METRIC || r.metric || '').toUpperCase() === key); return n(found?.VALUE ?? found?.value); }
function statusClass(status) { if (status === 'SUCCESS') return 'ok'; if (status === 'FAILED' || status === 'BLOCKED_REVIEW_REQUIRED') return 'danger'; if (status === 'IN_PROGRESS') return 'info'; return 'warn'; }

function MiniLineChart({ rows, metric, label, maxHint }) {
  const points = rows.slice().reverse().map(r => ({ x: new Date(r.receivedAt).getTime(), y: metricValue(r.snapshot, metric), at: r.receivedAt })).filter(p => Number.isFinite(p.y));
  const max = Math.max(maxHint || 0, ...points.map(p => p.y), 1);
  const w = 680, h = 190, pad = 22;
  const coords = points.map((p, i) => {
    const x = points.length <= 1 ? pad : pad + (i * (w - pad * 2)) / (points.length - 1);
    const y = h - pad - (p.y / max) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return <div className="chart-card"><div className="chart-head"><strong>{label}</strong><span>{points.length} amostras</span></div><svg viewBox={`0 0 ${w} ${h}`} role="img"><line x1={pad} y1={h-pad} x2={w-pad} y2={h-pad}/><line x1={pad} y1={pad} x2={pad} y2={h-pad}/>{coords && <polyline points={coords}/>} {points.map((p,i)=>{const [x,y]=coords.split(' ')[i]?.split(',')||[0,0]; return <circle key={i} cx={x} cy={y} r="3"><title>{fmtDate(p.at)}: {compact(p.y)}</title></circle>})}</svg><div className="chart-foot"><span>Atual: {compact(points.at(-1)?.y || 0)}</span><span>Máx: {compact(max)}</span></div></div>;
}

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [commands, setCommands] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [sql, setSql] = useState("SELECT instance_name, status, database_status FROM v$instance;");
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [message, setMessage] = useState('Dashboard Web v3.0.0 pronto.');
  const [loading, setLoading] = useState(false);
  const [realtime, setRealtime] = useState(false);

  const online = useMemo(() => clients.filter(c => ageOk(c.lastSeenAt)).length, [clients]);
  const critical = useMemo(() => alerts.filter(a => a.level === 'critical').length, [alerts]);
  const latestClient = clients[0] || null;
  const maxTablespace = useMemo(() => Math.max(0, ...clients.map(c => n(c.maxTablespacePct))), [clients]);
  const totalBlocked = useMemo(() => clients.reduce((sum, c) => sum + n(c.blockedSessions), 0), [clients]);
  const totalLocks = useMemo(() => clients.reduce((sum, c) => sum + n(c.locksWaiting), 0), [clients]);
  const selectedMetrics = useMemo(() => metrics.filter(m => !selectedAgent || m.agentId === selectedAgent), [metrics, selectedAgent]);

  async function apiFetch(path, options = {}) {
    const cleanApiUrl = apiUrl.trim().replace(/\/$/, '');
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(`${cleanApiUrl}${path}`, { ...options, headers });
  }

  async function load() {
    setLoading(true);
    try {
      const cleanApiUrl = apiUrl.trim().replace(/\/$/, '');
      localStorage.setItem('centralApiUrl', cleanApiUrl);
      localStorage.setItem('centralApiToken', token);
      const [h, c, a, ah, m, s] = await Promise.all([
        fetch(`${cleanApiUrl}/health`),
        apiFetch('/api/clients'),
        apiFetch('/api/alerts'),
        apiFetch('/api/alerts/history'),
        apiFetch('/api/metrics?limit=200'),
        apiFetch('/api/scripts')
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
      if (!selectedAgent && clientsRows[0]?.agentId) setSelectedAgent(clientsRows[0].agentId);
      setMessage('Dados atualizados com sucesso.');
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }


  async function clearCommandHistory() {
    const scope = selectedAgent ? `do Agent ${selectedAgent}` : 'de todos os Agents';
    const ok = window.confirm(`Limpar o histórico de comandos ${scope}? Comandos em fila ou em execução serão mantidos.`);
    if (!ok) return;
    setLoading(true);
    try {
      const query = selectedAgent ? `?agentId=${encodeURIComponent(selectedAgent)}` : '';
      const res = await apiFetch(`/api/scripts/history${query}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setCommands(prev => prev.filter(cmd => ['QUEUED', 'IN_PROGRESS'].includes(cmd.status)));
      setMessage(body.message || 'Histórico de comandos limpo.');
      await load();
    } catch (err) {
      setMessage(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function queueScript() {
    if (!selectedAgent) return setMessage('Selecione um Agent antes de enfileirar script.');
    if (!sql.trim()) return setMessage('Informe um SQL/script.');
    setLoading(true);
    try {
      const res = await apiFetch('/api/scripts/queue', { method: 'POST', body: JSON.stringify({ agentId: selectedAgent, sql, allowDangerous, type: 'SQL_SCRIPT', note: 'Criado pelo Dashboard Web v3.0.0' }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setMessage(body.blocked ? body.message : 'Script enfileirado. O Agent executará na próxima coleta.');
      await load();
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
    const updateState = (payload) => { if (payload.clients) setClients(payload.clients); if (payload.alerts) setAlerts(payload.alerts); if (payload.commands) setCommands(payload.commands); };
    es.addEventListener('connected', e => updateState(JSON.parse(e.data)));
    es.addEventListener('state', e => updateState(JSON.parse(e.data)));
    es.addEventListener('heartbeat', e => updateState(JSON.parse(e.data).state || {}));
    es.addEventListener('metrics', e => { const payload = JSON.parse(e.data); updateState(payload.state || {}); setMetrics(prev => [payload.record, ...prev].filter(Boolean).slice(0, 200)); setMessage('Métrica recebida em tempo real.'); });
    es.addEventListener('command', e => { const cmd = JSON.parse(e.data); setCommands(prev => [cmd, ...prev.filter(x => x.id !== cmd.id)].slice(0, 100)); setMessage(`Comando atualizado: ${cmd.status}`); });
    return () => es.close();
  }, [apiUrl, token]);

  return <main>
    <header className="hero"><div><p className="eyebrow">Oracle DBA Platform</p><h1>Dashboard Web v3.0.0</h1><p>Gráficos históricos, monitoramento enterprise e execução remota controlada via Agent Rust.</p></div><button onClick={load} disabled={loading}><RefreshCcw size={18} className={loading ? 'spin' : ''}/> Atualizar</button></header>

    <section className="panel settings"><label>URL da API Central<input value={apiUrl} onChange={e => setApiUrl(e.target.value)} /></label><label>Token<input value={token} onChange={e => setToken(e.target.value)} /></label><div className="status"><strong>Status:</strong> {message}</div></section>

    <section className="grid cards"><Card icon={Wifi} label="API" value={health?.ok ? 'Online' : 'Offline'} /><Card icon={Zap} label="Tempo real" value={realtime ? 'Conectado' : 'Offline'} /><Card icon={Server} label="Agents" value={clients.length} /><Card icon={Activity} label="Online agora" value={online} /><Card icon={BellRing} label="Alertas críticos" value={critical} /><Card icon={HardDrive} label="Tablespace máx." value={`${compact(maxTablespace)}%`} /><Card icon={AlertTriangle} label="Bloqueios/Locks" value={`${compact(totalBlocked)} / ${compact(totalLocks)}`} /><Card icon={Cpu} label="DB CPU" value={compact(latestClient?.dbCpuSeconds)} hint="segundos acumulados" /></section>

    <section className="panel"><h2><Database size={20}/> Clientes monitorados</h2><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Agent</th><th>Host</th><th>Status</th><th>Último envio</th><th>Sessões</th><th>Bloqueios</th><th>Locks</th><th>Tablespace</th><th>CPU DB</th><th>PGA</th><th>SGA</th><th>Comandos</th></tr></thead><tbody>{clients.map(c => <tr key={c.agentId}><td>{c.customerName || '-'}</td><td className="mono">{c.agentId}</td><td>{c.host || '-'}</td><td><span className={ageOk(c.lastSeenAt) ? 'pill ok' : 'pill warn'}>{ageOk(c.lastSeenAt) ? 'Online' : 'Offline'}</span></td><td>{fmtDate(c.lastSeenAt)}</td><td>{compact(c.activeSessions)}</td><td>{compact(c.blockedSessions)}</td><td>{compact(c.locksWaiting)}</td><td><div className="metric-cell"><span>{compact(c.maxTablespacePct)}%</span><Bar value={c.maxTablespacePct}/></div></td><td>{compact(c.dbCpuSeconds)}s</td><td>{compact(c.pgaAllocMb)} MB</td><td>{compact(c.sgaMb)} MB</td><td>{compact(c.pendingCommands)}</td></tr>)}{!clients.length && <tr><td colSpan="13" className="empty">Nenhum Agent enviou métricas ainda.</td></tr>}</tbody></table></div></section>

    <section className="panel"><h2><Gauge size={20}/> Gráficos históricos</h2><div className="chart-toolbar"><label>Agent<select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}><option value="">Todos</option>{clients.map(c => <option key={c.agentId} value={c.agentId}>{c.customerName || c.agentId}</option>)}</select></label><span>{selectedMetrics.length} amostras carregadas</span></div><div className="charts"><MiniLineChart rows={selectedMetrics} metric="ACTIVE_SESSIONS" label="Sessões ativas"/><MiniLineChart rows={selectedMetrics} metric="TABLESPACE_MAX_USED_PCT" label="Uso máximo de tablespace (%)" maxHint={100}/><MiniLineChart rows={selectedMetrics} metric="LOCKS_WAITING" label="Locks em espera"/><MiniLineChart rows={selectedMetrics} metric="DB_TIME_SECONDS" label="DB Time acumulado (s)"/></div></section>

    <section className="two-cols"><div className="panel"><h2><TerminalSquare size={20}/> Executar script via Agent</h2><p className="muted left">O navegador não conecta direto no Oracle. A API enfileira a tarefa e o Agent executa localmente no servidor do cliente.</p><label className="field">Agent<select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>{clients.map(c => <option key={c.agentId} value={c.agentId}>{c.customerName || c.agentId}</option>)}</select></label><label className="field">SQL / Script<textarea value={sql} onChange={e => setSql(e.target.value)} rows={9}/></label><label className="check"><input type="checkbox" checked={allowDangerous} onChange={e => setAllowDangerous(e.target.checked)} /> Liberar comandos críticos nesta execução</label><button onClick={queueScript} disabled={loading || !selectedAgent}><Play size={18}/> Enfileirar execução</button></div><div className="panel"><div className="panel-title-row"><h2><Code2 size={20}/> Histórico de comandos</h2><button className="danger-button" onClick={clearCommandHistory} disabled={loading || !commands.some(cmd => !['QUEUED', 'IN_PROGRESS'].includes(cmd.status))}><Trash2 size={18}/> Limpar histórico</button></div><p className="muted left">Remove somente comandos finalizados, com erro ou bloqueados. Comandos em fila ou execução são mantidos.</p><div className="commands">{commands.length ? commands.map(cmd => <details key={cmd.id} className="command"><summary><span className={`pill ${statusClass(cmd.status)}`}>{cmd.status}</span><strong>{cmd.agentId || 'Todos agents'}</strong><small>{fmtDate(cmd.createdAt)}</small></summary><div className="command-body"><p>{cmd.note}</p><pre>{cmd.sql || '-'}</pre>{cmd.output && <><b>Output</b><pre>{cmd.output}</pre></>}{cmd.error && <><b>Erro</b><pre className="error-pre">{cmd.error}</pre></>}</div></details>) : <p className="muted">Nenhum comando criado.</p>}</div></div></section>

    <section className="two-cols"><div className="panel"><h2><Gauge size={20}/> Métricas enterprise</h2><div className="enterprise-grid">{clients.slice(0, 6).map(c => <div className="mini" key={c.agentId}><strong>{c.customerName || c.agentId}</strong><span>DB Time: {compact(c.dbTimeSeconds)}s</span><span>Logical Reads: {compact(c.logicalReads)}</span><span>Physical Reads: {compact(c.physicalReads)}</span><span>Execuções: {compact(c.executions)}</span><span>Parse Count: {compact(c.parseCountTotal)}</span><span>Redo: {compact(c.redoSizeMb)} MB</span></div>)}</div></div><div className="panel"><h2><AlertTriangle size={20}/> Alertas</h2>{alerts.length ? alerts.map((a, i) => <div className={`alert ${a.level}`} key={i}>{a.message}</div>) : <p className="muted">Nenhum alerta ativo.</p>}<h3>Histórico</h3>{alertHistory.slice(0,8).map(a => <div className={`alert ${a.level}`} key={a.id}>{fmtDate(a.at)} — {a.message}</div>)}</div></section>

    <section className="panel"><h2><ShieldCheck size={20}/> Últimas métricas recebidas</h2><pre>{metrics.length ? JSON.stringify(metrics.slice(0, 5), null, 2) : 'Sem métricas.'}</pre></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
