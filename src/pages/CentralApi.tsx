import { useEffect, useMemo, useState } from 'react';
import { Activity, Cloud, Database, KeyRound, RefreshCcw, Server, ShieldCheck, Wifi } from 'lucide-react';

type Instance = {
  agentId: string;
  customerName?: string;
  host?: string;
  dbName?: string;
  version?: string;
  lastSeenAt?: string;
  samples?: number;
  latest?: Record<string, any>;
};

type ApiHealth = { ok: boolean; name: string; version: string; uptimeSeconds: number; now: string };

const DEFAULT_API_URL = 'http://127.0.0.1:4090';

function fmtDate(value?: string) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function getOverviewValue(snapshot: Record<string, any> | undefined, metric: string) {
  const overview = (snapshot?.overview || snapshot?.OVERVIEW || []) as Record<string, any>[];
  const found = overview.find((row) => String(row.METRIC ?? row.metric ?? '').toUpperCase() === metric);
  return found ? Number(found.VALUE ?? found.value ?? 0) : 0;
}

export function CentralApi() {
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('centralApiUrl') || DEFAULT_API_URL);
  const [token, setToken] = useState(localStorage.getItem('centralApiToken') || 'dev-token-change-me');
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [message, setMessage] = useState('API Central v2.4.0 pronta para receber métricas dos Agents e alimentar o Dashboard Web.');
  const [loading, setLoading] = useState(false);

  const onlineAgents = useMemo(() => {
    const now = Date.now();
    return instances.filter((item) => item.lastSeenAt && now - new Date(item.lastSeenAt).getTime() < 120000).length;
  }, [instances]);

  async function load() {
    setLoading(true);
    try {
      localStorage.setItem('centralApiUrl', apiUrl);
      localStorage.setItem('centralApiToken', token);
      const [healthResponse, instancesResponse] = await Promise.all([
        fetch(`${apiUrl}/health`),
        fetch(`${apiUrl}/api/instances`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (!healthResponse.ok) throw new Error(`Health HTTP ${healthResponse.status}`);
      if (!instancesResponse.ok) throw new Error(`Instances HTTP ${instancesResponse.status}`);
      setHealth(await healthResponse.json());
      const data = await instancesResponse.json();
      setInstances(data.rows || []);
      setMessage('Conexão com API Central realizada com sucesso.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-300"><Cloud size={18} /><span className="text-sm font-semibold">v2.4.0</span></div>
            <h2 className="mt-2 text-2xl font-bold">API Central</h2>
            <p className="mt-1 text-slate-400">Base para receber métricas dos Agents instalados nos clientes e consultar os bancos pelo app ou navegador no futuro.</p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">
            <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm text-slate-300">URL da API
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Token
            <input value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300 xl:min-w-64">
            <span className="text-slate-500">Status:</span> {message}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Wifi className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">API</p><p className="mt-2 text-2xl font-bold">{health?.ok ? 'Online' : 'Offline'}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Server className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Agents cadastrados</p><p className="mt-2 text-3xl font-bold">{instances.length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Activity className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Agents online</p><p className="mt-2 text-3xl font-bold">{onlineAgents}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><KeyRound className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Autenticação</p><p className="mt-2 text-2xl font-bold">Bearer Token</p></div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="flex items-center gap-2 text-xl font-bold"><Database size={18} /> Bancos/Agents conectados</h3>
        <div className="mt-4 overflow-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-950/70 text-slate-400"><tr><th className="px-4 py-3 text-left">Cliente</th><th className="px-4 py-3 text-left">Agent</th><th className="px-4 py-3 text-left">Host</th><th className="px-4 py-3 text-left">Banco</th><th className="px-4 py-3 text-left">Último envio</th><th className="px-4 py-3 text-right">Sessões</th><th className="px-4 py-3 text-right">Locks</th><th className="px-4 py-3 text-right">Tablespace máx.</th></tr></thead>
            <tbody>
              {instances.map((item) => (
                <tr key={item.agentId} className="border-t border-slate-800">
                  <td className="px-4 py-3">{item.customerName || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{item.agentId}</td>
                  <td className="px-4 py-3">{item.host || '-'}</td>
                  <td className="px-4 py-3">{item.dbName || '-'}</td>
                  <td className="px-4 py-3">{fmtDate(item.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-right">{getOverviewValue(item.latest, 'ACTIVE_SESSIONS')}</td>
                  <td className="px-4 py-3 text-right">{getOverviewValue(item.latest, 'BLOCKED_SESSIONS')}</td>
                  <td className="px-4 py-3 text-right">{getOverviewValue(item.latest, 'TABLESPACE_MAX_USED_PCT')}%</td>
                </tr>
              ))}
              {!instances.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Nenhum Agent enviou métricas ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={18} /> Próximas proteções antes de produção</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-300 xl:grid-cols-3">
          <div className="rounded-xl bg-slate-950/50 p-3">Usar HTTPS obrigatório na API publicada.</div>
          <div className="rounded-xl bg-slate-950/50 p-3">Gerar token individual por cliente/Agent.</div>
          <div className="rounded-xl bg-slate-950/50 p-3">Registrar auditoria antes de permitir execução remota de scripts.</div>
        </div>
      </section>
    </div>
  );
}
