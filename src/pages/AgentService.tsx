import { useEffect, useMemo, useState } from 'react';
import { Activity, CloudUpload, Database, FileText, HardDriveDownload, Play, RefreshCcw, RadioTower, ServerCog, Square } from 'lucide-react';
import { collectAgentOnce, getAgentMetrics, getAgentStatus, startAgentCollector, stopAgentCollector, type AgentStatus } from '../services/oracleClient';
import { useConnectionStore } from '../stores/useConnectionStore';

type AnyRow = Record<string, any>;

function get(row: AnyRow, key: string) {
  return row?.[key] ?? row?.[key.toUpperCase()] ?? row?.[key.toLowerCase()];
}

function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getOverviewValue(snapshot: AnyRow | null, metric: string) {
  const overview = (snapshot?.overview || snapshot?.OVERVIEW || []) as AnyRow[];
  const found = overview.find((row) => String(get(row, 'METRIC')).toUpperCase() === metric);
  return found ? asNumber(get(found, 'VALUE')) : 0;
}

function StatusBadge({ running }: { running: boolean }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${running ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>{running ? 'Rodando' : 'Parado'}</span>;
}

export function AgentService() {
  const { config, connected } = useConnectionStore();
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [metrics, setMetrics] = useState<AnyRow[]>([]);
  const [message, setMessage] = useState('Agent local pronto para iniciar a coleta.');
  const [loading, setLoading] = useState(false);

  const latest = metrics.length ? metrics[metrics.length - 1] : null;
  const maxTablespace = useMemo(() => getOverviewValue(latest, 'TABLESPACE_MAX_USED_PCT'), [latest]);

  async function refresh() {
    try {
      const [statusResult, metricsResult] = await Promise.all([getAgentStatus(), getAgentMetrics(30)]);
      setStatus(statusResult.status);
      setMetrics((metricsResult.rows || []) as AnyRow[]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  async function start() {
    setLoading(true);
    try {
      const result = await startAgentCollector(config, intervalSeconds);
      setStatus(result.status);
      setMessage(result.message);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function stop() {
    setLoading(true);
    try {
      const result = await stopAgentCollector();
      setStatus(result.status);
      setMessage(result.message);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function collectOnce() {
    setLoading(true);
    try {
      const result = await collectAgentOnce(config);
      setStatus(result.status);
      setMessage(result.ok ? 'Coleta manual executada com sucesso.' : 'A coleta manual retornou erro. Verifique a última amostra.');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const running = Boolean(status?.running);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-300"><ServerCog size={18} /><span className="text-sm font-semibold">v2.3.0</span></div>
            <h2 className="mt-2 text-2xl font-bold">Agent Coletor Local</h2>
            <p className="mt-1 text-slate-400">Coleta sessões, locks, tablespaces, waits e top SQL em intervalos programados, salvando histórico local em JSONL.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge running={running} />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Intervalo
              <input value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} min={10} type="number" className="w-24 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" />
              seg
            </label>
            <button onClick={start} disabled={loading || !connected} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"><Play size={18} /> Iniciar</button>
            <button onClick={stop} disabled={loading || !running} className="inline-flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"><Square size={18} /> Parar</button>
            <button onClick={collectOnce} disabled={loading || !connected} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCcw size={18} className={loading ? 'animate-spin' : ''} /> Coletar agora</button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">
          {!connected ? <span className="text-amber-300">Conecte no banco antes de iniciar o Agent.</span> : message}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Activity className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Amostras coletadas</p><p className="mt-2 text-3xl font-bold">{status?.samplesCollected ?? 0}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><Database className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Sessões ativas</p><p className="mt-2 text-3xl font-bold">{getOverviewValue(latest, 'ACTIVE_SESSIONS')}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><RadioTower className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Sessões bloqueadas</p><p className="mt-2 text-3xl font-bold">{getOverviewValue(latest, 'BLOCKED_SESSIONS')}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><HardDriveDownload className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Maior tablespace</p><p className="mt-2 text-3xl font-bold">{maxTablespace}%</p></div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="flex items-center gap-2 text-xl font-bold"><FileText size={18} /> Status e armazenamento local</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-300 xl:grid-cols-2">
          <div className="rounded-xl bg-slate-950/50 p-3"><span className="text-slate-500">Host:</span> {status?.host || '-'}</div>
          <div className="rounded-xl bg-slate-950/50 p-3"><span className="text-slate-500">Última coleta:</span> {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : '-'}</div>
          <div className="rounded-xl bg-slate-950/50 p-3"><span className="text-slate-500">Iniciado em:</span> {status?.startedAt ? new Date(status.startedAt).toLocaleString() : '-'}</div>
          <div className="rounded-xl bg-slate-950/50 p-3"><span className="text-slate-500">Arquivo:</span> <span className="font-mono text-xs">{status?.metricsFile || '-'}</span></div>
        </div>
        {status?.lastError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">Último erro: {status.lastError}</div>}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="flex items-center gap-2 text-xl font-bold"><CloudUpload size={18} /> Próximo passo</h3>
        <p className="mt-2 text-sm text-slate-400">Esta v2.3.0 grava histórico local. Na v2.3.0, o Agent pode enviar essas amostras para uma API central com token, HTTPS e identificação do servidor.</p>
        <div className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-300">
          {metrics.length ? metrics.slice(-8).reverse().map((item, idx) => <pre key={idx} className="mb-3 whitespace-pre-wrap border-b border-slate-800 pb-3 last:border-0">{JSON.stringify(item, null, 2)}</pre>) : 'Nenhuma métrica coletada ainda.'}
        </div>
      </section>
    </div>
  );
}
