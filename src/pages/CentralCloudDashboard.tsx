import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cloud, Database, HardDrive, Play, RefreshCcw, Save, Server, TerminalSquare, Trash2, Wifi, Zap } from 'lucide-react';
import {
  clearCentralCommandHistory,
  getCentralClients,
  getCentralCommands,
  getCentralHealth,
  getCentralMetrics,
  loadCentralApiConfig,
  queueCentralScript,
  saveCentralApiConfig,
  type CentralApiConfig,
  type CentralClient,
  type CentralCommand,
  type CentralMetric
} from '../services/centralApiClient';

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(value?: string | null) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function isOnline(value?: string | null) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 180000;
}

function metricValue(snapshot: any, metric: string) {
  const rows = snapshot?.overview || snapshot?.OVERVIEW || [];
  const found = rows.find((row: any) => String(row.METRIC || row.metric || '').toUpperCase() === metric);
  return num(found?.VALUE ?? found?.value);
}

function compact(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(num(value));
}

function StatusPill({ online }: { online: boolean }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{online ? 'Online' : 'Offline'}</span>;
}

function Card({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Icon className="text-cyan-300" size={22} /><p className="mt-4 text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

function MiniChart({ rows, metric, label }: { rows: CentralMetric[]; metric: string; label: string }) {
  const points = rows.slice().reverse().map((row) => ({ at: row.receivedAt, y: metricValue(row.snapshot, metric) })).filter((p) => Number.isFinite(p.y));
  const max = Math.max(1, ...points.map((p) => p.y));
  const width = 720;
  const height = 180;
  const pad = 20;
  const coords = points.map((p, index) => {
    const x = points.length <= 1 ? pad : pad + (index * (width - pad * 2)) / (points.length - 1);
    const y = height - pad - (p.y / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center justify-between"><h3 className="font-bold">{label}</h3><span className="text-xs text-slate-500">{points.length} amostras</span></div><svg className="mt-3 h-44 w-full" viewBox={`0 0 ${width} ${height}`}><line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="currentColor" className="text-slate-700"/><line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="currentColor" className="text-slate-700"/>{coords && <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-300"/>}{points.map((p, i) => { const [x, y] = coords.split(' ')[i]?.split(',') || ['0','0']; return <circle key={`${p.at}-${i}`} cx={x} cy={y} r="3" fill="currentColor" className="text-cyan-300"><title>{fmtDate(p.at)}: {compact(p.y)}</title></circle>; })}</svg><div className="flex justify-between text-xs text-slate-500"><span>Atual: {compact(points.at(-1)?.y || 0)}</span><span>Máx: {compact(max)}</span></div></div>;
}

export function CentralCloudDashboard() {
  const [config, setConfig] = useState<CentralApiConfig>(() => loadCentralApiConfig());
  const [health, setHealth] = useState<any>(null);
  const [clients, setClients] = useState<CentralClient[]>([]);
  const [metrics, setMetrics] = useState<CentralMetric[]>([]);
  const [commands, setCommands] = useState<CentralCommand[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [sql, setSql] = useState('SELECT instance_name, status, database_status FROM v$instance;');
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [message, setMessage] = useState('Configure a API Central para conectar o app desktop ao ambiente cloud.');
  const [loading, setLoading] = useState(false);

  const onlineCount = useMemo(() => clients.filter((client) => isOnline(client.lastSeenAt)).length, [clients]);
  const selected = useMemo(() => clients.find((client) => client.agentId === selectedAgent) || clients[0], [clients, selectedAgent]);
  const selectedMetrics = useMemo(() => metrics.filter((row) => !selected?.agentId || row.agentId === selected.agentId), [metrics, selected?.agentId]);
  const maxTablespace = Math.max(0, ...clients.map((client) => num(client.maxTablespacePct)));
  const blocked = clients.reduce((sum, client) => sum + num(client.blockedSessions), 0);

  async function load() {
    setLoading(true);
    try {
      saveCentralApiConfig(config);
      const [h, c, m, s] = await Promise.all([
        getCentralHealth(config),
        getCentralClients(config),
        getCentralMetrics(config, selectedAgent || undefined, 200),
        getCentralCommands(config, selectedAgent || undefined)
      ]);
      const clientRows = c.rows || [];
      setHealth(h);
      setClients(clientRows);
      setMetrics(m.rows || []);
      setCommands(s.rows || []);
      if (!selectedAgent && clientRows[0]?.agentId) setSelectedAgent(clientRows[0].agentId);
      setMessage('App conectado à API Central.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function queueScript() {
    const agentId = selected?.agentId || selectedAgent;
    if (!agentId) return setMessage('Selecione um Agent antes de enfileirar script.');
    if (!sql.trim()) return setMessage('Informe um SQL/script.');
    setLoading(true);
    try {
      const result = await queueCentralScript(config, { agentId, sql, allowDangerous, note: 'Criado pelo App Desktop v3.2.0' });
      setMessage(result.blocked ? (result.message || 'Script bloqueado para revisão.') : 'Script enfileirado. O Agent executará na próxima verificação.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }


  async function clearHistory() {
    const agentId = selected?.agentId || selectedAgent;
    const scope = agentId ? 'deste Agent selecionado' : 'de todos os Agents';
    const ok = window.confirm(`Limpar histórico de comandos ${scope}? Comandos QUEUED e IN_PROGRESS não serão removidos.`);
    if (!ok) return;
    setLoading(true);
    try {
      const result = await clearCentralCommandHistory(config, agentId || undefined);
      setMessage(result.message || `${result.deleted || 0} comando(s) removido(s) do histórico.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    getCentralMetrics(config, selectedAgent, 200).then((res) => setMetrics(res.rows || [])).catch(() => undefined);
    getCentralCommands(config, selectedAgent).then((res) => setCommands(res.rows || [])).catch(() => undefined);
  }, [selectedAgent]);

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div><div className="flex items-center gap-2 text-cyan-300"><Cloud size={18}/><span className="text-sm font-semibold">v3.2.0</span></div><h2 className="mt-2 text-2xl font-bold">App Desktop conectado à API Central</h2><p className="mt-1 text-slate-400">Use o aplicativo instalado para acompanhar Agents, métricas, gráficos e enfileirar scripts remotos via Agent Rust.</p></div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"><RefreshCcw size={18} className={loading ? 'animate-spin' : ''}/> Atualizar</button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto]">
        <input className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3" value={config.apiUrl} onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })} placeholder="https://sua-api.up.railway.app" />
        <input className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3" value={config.apiToken} onChange={(e) => setConfig({ ...config, apiToken: e.target.value })} placeholder="Token da API" />
        <button onClick={() => { saveCentralApiConfig(config); setMessage('Configuração salva localmente.'); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 font-semibold text-slate-200"><Save size={18}/> Salvar</button>
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">Status: {message}</div>
    </section>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5"><Card icon={Wifi} label="API Central" value={health?.ok ? 'Online' : 'Offline'} /><Card icon={Server} label="Agents" value={clients.length} /><Card icon={Zap} label="Online" value={onlineCount} /><Card icon={HardDrive} label="Tablespace máx." value={`${compact(maxTablespace)}%`} /><Card icon={AlertTriangle} label="Bloqueios" value={blocked} /></div>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h3 className="flex items-center gap-2 text-xl font-bold"><Database size={18}/> Agents monitorados</h3><div className="mt-4 overflow-auto rounded-xl border border-slate-800"><table className="min-w-full text-sm"><thead className="bg-slate-950 text-slate-300"><tr><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">Cliente</th><th className="px-3 py-2 text-left">Ambiente</th><th className="px-3 py-2 text-left">Host</th><th className="px-3 py-2 text-left">Última coleta</th><th className="px-3 py-2 text-left">Tablespace</th><th className="px-3 py-2 text-left">Sessões</th></tr></thead><tbody>{clients.map((client) => <tr key={client.agentId} onClick={() => setSelectedAgent(client.agentId)} className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/60 ${selected?.agentId === client.agentId ? 'bg-cyan-500/10' : ''}`}><td className="px-3 py-2"><StatusPill online={isOnline(client.lastSeenAt)} /></td><td className="px-3 py-2 font-mono text-xs">{client.agentId}</td><td className="px-3 py-2">{client.customerName || '-'}</td><td className="px-3 py-2">{client.environment || '-'}</td><td className="px-3 py-2">{client.host || '-'}</td><td className="px-3 py-2">{fmtDate(client.lastSeenAt)}</td><td className="px-3 py-2">{compact(client.maxTablespacePct)}%</td><td className="px-3 py-2">{compact(client.activeSessions)}</td></tr>)}</tbody></table>{!clients.length && <div className="p-4 text-slate-400">Nenhum Agent recebido ainda.</div>}</div></section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><MiniChart rows={selectedMetrics} metric="ACTIVE_SESSIONS" label="Sessões ativas"/><MiniChart rows={selectedMetrics} metric="TABLESPACE_MAX_USED_PCT" label="Uso máximo de tablespace (%)"/><MiniChart rows={selectedMetrics} metric="DB_CPU_SECONDS" label="DB CPU acumulado"/><MiniChart rows={selectedMetrics} metric="LOCKS_WAITING" label="Locks em espera"/></div>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h3 className="flex items-center gap-2 text-xl font-bold"><TerminalSquare size={18}/> Remote Script Runner</h3><p className="mt-1 text-sm text-slate-400">O app não conecta direto no Oracle do cliente. Ele enfileira a tarefa na API Central, e o Agent Rust executa localmente no servidor Oracle.</p><div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto]"><select className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3" value={selected?.agentId || selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>{clients.map((client) => <option key={client.agentId} value={client.agentId}>{client.customerName || client.agentId} — {client.environment || 'ambiente'}</option>)}</select><label className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-200"><input type="checkbox" checked={allowDangerous} onChange={(e) => setAllowDangerous(e.target.checked)} /> liberar comandos críticos</label></div><textarea className="mt-3 min-h-44 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm" value={sql} onChange={(e) => setSql(e.target.value)} /><button onClick={queueScript} disabled={loading || !selected?.agentId} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"><Play size={18}/> Enfileirar script</button></section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><h3 className="flex items-center gap-2 text-xl font-bold"><Activity size={18}/> Histórico de comandos</h3><button onClick={clearHistory} disabled={loading || !commands.length} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={16}/> Limpar histórico</button></div><div className="mt-4 max-h-96 overflow-auto rounded-xl border border-slate-800"><table className="min-w-full text-sm"><thead className="bg-slate-950 text-slate-300"><tr><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">Criado</th><th className="px-3 py-2 text-left">Finalizado</th><th className="px-3 py-2 text-left">Retorno</th></tr></thead><tbody>{commands.map((cmd) => <tr key={cmd.id} className="border-t border-slate-800"><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs ${cmd.status === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-300' : cmd.status === 'FAILED' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{cmd.status}</span></td><td className="px-3 py-2 font-mono text-xs">{cmd.agentId}</td><td className="px-3 py-2">{fmtDate(cmd.createdAt)}</td><td className="px-3 py-2">{fmtDate(cmd.finishedAt)}</td><td className="px-3 py-2 max-w-xl"><pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{cmd.error || cmd.output || cmd.note || '-'}</pre></td></tr>)}</tbody></table>{!commands.length && <div className="p-4 text-slate-400">Nenhum comando encontrado.</div>}</div></section>
  </div>;
}
