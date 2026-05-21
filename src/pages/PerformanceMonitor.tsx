import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Clock, DatabaseZap, RefreshCcw, Server } from 'lucide-react';
import { executeSql } from '../services/oracleClient';
import { PERFORMANCE_OVERVIEW_SQL, TABLESPACE_USAGE_SQL, TOP_SQL_SQL, TOP_WAIT_EVENTS_SQL } from '../services/performanceQueries';
import { useConnectionStore } from '../stores/useConnectionStore';

type AnyRow = Record<string, any>;

type MetricCard = {
  metric: string;
  value: number;
  label: string;
};

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function get(row: AnyRow, key: string) {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
}

function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const width = Math.max(2, Math.min(100, (value / Math.max(max, 1)) * 100));
  return (
    <div className="h-2 w-full rounded-full bg-slate-800">
      <div className="h-2 rounded-full bg-cyan-400" style={{ width: `${width}%` }} />
    </div>
  );
}

export function PerformanceMonitor() {
  const { config, connected } = useConnectionStore();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Pronto para coletar métricas do Oracle 19.');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [overview, setOverview] = useState<MetricCard[]>([]);
  const [waits, setWaits] = useState<AnyRow[]>([]);
  const [topSql, setTopSql] = useState<AnyRow[]>([]);
  const [tablespaces, setTablespaces] = useState<AnyRow[]>([]);

  const maxWait = useMemo(() => Math.max(1, ...waits.map((row) => asNumber(get(row, 'SECONDS_WAITED')))), [waits]);

  async function loadMetrics() {
    setLoading(true);
    setMessage('Coletando métricas em tempo real...');
    try {
      const [overviewResult, waitsResult, topSqlResult, tablespaceResult] = await Promise.all([
        executeSql(config, PERFORMANCE_OVERVIEW_SQL),
        executeSql(config, TOP_WAIT_EVENTS_SQL),
        executeSql(config, TOP_SQL_SQL),
        executeSql(config, TABLESPACE_USAGE_SQL),
      ]);

      if (!overviewResult.ok) throw new Error(overviewResult.message || 'Falha ao coletar visão geral.');
      setOverview((overviewResult.rows || []).map((row: any) => ({
        metric: String(get(row, 'METRIC')),
        value: asNumber(get(row, 'VALUE')),
        label: String(get(row, 'LABEL') || get(row, 'METRIC')),
      })));
      setWaits((waitsResult.rows || []) as AnyRow[]);
      setTopSql((topSqlResult.rows || []) as AnyRow[]);
      setTablespaces((tablespaceResult.rows || []) as AnyRow[]);
      setLastUpdate(new Date().toLocaleString());
      setMessage('Métricas atualizadas com sucesso.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-300"><Activity size={18} /><span className="text-sm font-semibold">v2.1.0</span></div>
            <h2 className="mt-2 text-2xl font-bold">Monitor de Performance Oracle 19</h2>
            <p className="mt-1 text-slate-400">Dashboard inicial para sessões, locks, tablespaces, waits e top SQL.</p>
          </div>
          <button
            onClick={loadMetrics}
            disabled={loading || !connected}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} /> Atualizar métricas
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">
          {!connected && <span className="text-amber-300">Conecte no banco pelo painel principal antes de coletar métricas.</span>}
          {connected && message}
          {lastUpdate && <span className="ml-2 text-slate-500">Última atualização: {lastUpdate}</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {overview.map((card) => (
          <div key={card.metric} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{card.label}</p>
              {card.value > 0 ? <AlertTriangle size={18} className="text-amber-300" /> : <Server size={18} className="text-cyan-300" />}
            </div>
            <p className="mt-3 text-3xl font-bold text-slate-100">{card.value}</p>
          </div>
        ))}
        {!overview.length && (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-5 text-slate-400">
            Clique em atualizar para carregar os indicadores do ambiente conectado.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="flex items-center gap-2 font-bold"><BarChart3 size={18} /> Principais wait events</h3>
          <div className="mt-4 space-y-3">
            {waits.map((row, idx) => {
              const seconds = asNumber(get(row, 'SECONDS_WAITED'));
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between gap-3 text-sm"><span className="truncate text-slate-300">{String(get(row, 'EVENT'))}</span><span className="text-slate-400">{seconds}s</span></div>
                  <Bar value={seconds} max={maxWait} />
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="flex items-center gap-2 font-bold"><DatabaseZap size={18} /> Tablespaces por uso</h3>
          <div className="mt-4 space-y-3">
            {tablespaces.slice(0, 8).map((row, idx) => {
              const used = asNumber(get(row, 'USED_PERCENT'));
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between gap-3 text-sm"><span className="truncate text-slate-300">{String(get(row, 'TABLESPACE_NAME'))}</span><span className="text-slate-400">{used}%</span></div>
                  <Bar value={used} />
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="flex items-center gap-2 font-bold"><Clock size={18} /> Top SQL por tempo decorrido</h3>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-400"><tr><th className="p-2">SQL ID</th><th className="p-2">Execuções</th><th className="p-2">Elapsed</th><th className="p-2">CPU</th><th className="p-2">SQL</th></tr></thead>
            <tbody>
              {topSql.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-800 text-slate-300">
                  <td className="p-2 font-mono text-cyan-300">{String(get(row, 'SQL_ID'))}</td>
                  <td className="p-2">{String(get(row, 'EXECUTIONS'))}</td>
                  <td className="p-2">{String(get(row, 'ELAPSED_SECONDS'))}s</td>
                  <td className="p-2">{String(get(row, 'CPU_SECONDS'))}s</td>
                  <td className="max-w-xl truncate p-2 font-mono text-xs">{String(get(row, 'SQL_TEXT'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
