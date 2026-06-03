import { Activity, Cpu, Database, FileArchive, HardDrive, Home, Lock, ScrollText, Settings2, Shield, Users, Wrench, LineChart, ServerCog, ShieldCheck, Cloud, Globe2 } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = { currentPage: string; onPageChange: (page: string) => void; children: ReactNode };

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'performance', label: 'Performance Oracle', icon: LineChart },
  { id: 'agent', label: 'Agent Coletor', icon: ServerCog },
  { id: 'centralCloud', label: 'Cloud Dashboard', icon: Globe2 },
  { id: 'centralApi', label: 'API Central Local', icon: Cloud },
  { id: 'maintenance', label: 'Manutenção Assistida', icon: ShieldCheck },
  { id: 'memory', label: 'Memória', icon: Cpu },
  { id: 'users', label: 'Usuários', icon: Users },
  { id: 'tablespaces', label: 'Tablespaces', icon: HardDrive },
  { id: 'datafiles', label: 'Expandir Datafiles', icon: Database },
  { id: 'importExport', label: 'Importação / Exportação', icon: FileArchive },
  { id: 'sessions', label: 'Sessões e Locks', icon: Lock },
  { id: 'diagnostic', label: 'Diagnóstico', icon: Activity },
  { id: 'erp', label: 'ERP Presets', icon: Shield },
  { id: 'patch', label: 'Patch Temporário', icon: Wrench },
  { id: 'sql', label: 'SQL Worksheet', icon: ScrollText },
  { id: 'remoteDiag', label: '🔬 Diagnóstico Remoto', icon: Activity },
];

export function AppLayout({ currentPage, onPageChange, children }: Props) {
  return (
    <div className="min-h-screen grid grid-cols-[300px_1fr] bg-slate-950">
      <aside className="border-r border-slate-800 p-5 bg-slate-900/70 overflow-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-300"><Settings2 /></div>
          <div>
            <h1 className="font-bold text-xl">Oracle 19 DBA</h1>
            <p className="text-sm text-slate-400">Ferramenta DBA Desktop</p>
          </div>
        </div>
        <nav className="space-y-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button key={item.id} onClick={() => onPageChange(item.id)} className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${active ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-slate-800'}`}>
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="flex min-h-screen flex-col overflow-auto p-6">
        <div className="flex-1">{children}</div>
        <footer className="mt-6 border-t border-slate-800 pt-3 text-center text-[11px] text-slate-600">
          Criado por J S Moreira
        </footer>
      </main>
    </div>
  );
}
