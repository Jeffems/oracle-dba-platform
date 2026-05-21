import { ConnectionPanel } from '../components/ConnectionPanel';

export function Dashboard() {
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
  ];

  return (
    <div className="space-y-6">
      <ConnectionPanel />
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-xl font-bold">Central Oracle DBA</h2>
        <p className="mt-2 text-slate-400">Módulos organizados para administração Oracle, geração de scripts, aplicação no banco, cópia e download.</p>
      </section>
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
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
