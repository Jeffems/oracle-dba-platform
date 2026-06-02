import { ConnectionPanel } from '../components/ConnectionPanel';
import { useConnectionStore } from '../stores/useConnectionStore';

export function Dashboard() {
  const { mode, remote, config, connected } = useConnectionStore();
  const cards = [
    'Memória',
    'Usuários',
    'Tablespaces',
    'Expandir Datafiles',
    'Importação / Exportação',
    'Sessões e Locks',
    'Diagnóstico',
    'ERP Presets',
    'Patch Temporário',
    'SQL Worksheet',
  ];

  return (
    <div className="space-y-6">
      <ConnectionPanel />
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-xl font-bold">Central Oracle DBA</h2>
        <p className="mt-2 text-slate-400">Escolha conexão local ou remota. Os módulos usam automaticamente o modo ativo.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-950/60 p-3 text-sm"><span className="text-slate-500">Modo ativo:</span> <strong className="text-cyan-200">{mode === 'local' ? 'Local' : 'Remoto via Agent'}</strong></div>
          <div className="rounded-xl bg-slate-950/60 p-3 text-sm"><span className="text-slate-500">Status:</span> <strong className={connected ? 'text-emerald-300' : 'text-rose-300'}>{connected ? 'Conectado' : 'Desconectado'}</strong></div>
          <div className="rounded-xl bg-slate-950/60 p-3 text-sm"><span className="text-slate-500">Destino:</span> {mode === 'local' ? (config.connectString || '-') : (remote.selectedAgentId || '-')}</div>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {cards.map((card, index) => (
          <div key={card} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-cyan-300">{String(index + 1).padStart(2, '0')}</p>
            <p className="mt-2 font-semibold text-slate-200">{card}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
