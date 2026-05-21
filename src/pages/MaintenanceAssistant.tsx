import { useState } from 'react';
import { AlertTriangle, ClipboardCopy, PlayCircle, ShieldAlert, Wrench } from 'lucide-react';
import { maintenanceScripts } from '../services/maintenanceScripts';
import { executeSql } from '../services/oracleClient';
import { useConnectionStore } from '../stores/useConnectionStore';
import { ResultTable } from '../components/ResultTable';
import type { QueryResult } from '../types/oracle';

export function MaintenanceAssistant() {
  const { config, connected } = useConnectionStore();
  const [selected, setSelected] = useState(maintenanceScripts[0]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [message, setMessage] = useState('Selecione um diagnóstico ou script assistido.');

  async function runSelected() {
    setRunning(true);
    setMessage(`Executando: ${selected.title}`);
    try {
      const response = await executeSql(config, selected.sql);
      setResult(response);
      setMessage(response.ok ? 'Execução concluída. Revise o resultado antes de qualquer ação em produção.' : response.message || 'Falha ao executar.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function copySql() {
    await navigator.clipboard.writeText(selected.sql);
    setMessage('SQL copiado para a área de transferência.');
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center gap-2 text-cyan-300"><Wrench size={18} /><span className="text-sm font-semibold">Manutenção assistida</span></div>
        <h2 className="mt-2 text-2xl font-bold">Scripts de diagnóstico e manutenção</h2>
        <p className="mt-1 text-slate-400">Ações críticas foram deixadas como geração de comando para exigir revisão manual antes da execução.</p>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          {maintenanceScripts.map((script) => (
            <button
              key={script.id}
              onClick={() => { setSelected(script); setResult(null); }}
              className={`w-full rounded-2xl border p-4 text-left transition ${selected.id === script.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900 hover:bg-slate-800'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-100">{script.title}</p>
                <span className={`rounded-full px-2 py-1 text-xs ${script.risk === 'Alto' ? 'bg-red-500/10 text-red-300' : script.risk === 'Médio' ? 'bg-amber-500/10 text-amber-300' : 'bg-cyan-500/10 text-cyan-300'}`}>{script.risk}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{script.description}</p>
            </button>
          ))}
        </aside>

        <main className="space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-xl font-bold">{selected.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{selected.description}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={copySql} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"><ClipboardCopy size={16} /> Copiar</button>
                <button disabled={running || !connected} onClick={runSelected} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"><PlayCircle size={16} /> Executar</button>
              </div>
            </div>
            <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">{selected.sql}</pre>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200"><ShieldAlert size={18} /> Em produção, execute scripts de alto risco somente após validar sessão, usuário, impacto e janela de manutenção.</div>
            {!connected && <div className="mt-3 flex items-center gap-2 text-sm text-amber-300"><AlertTriangle size={16} /> Conecte no banco antes de executar.</div>}
            <p className="mt-3 text-sm text-slate-400">{message}</p>
          </section>

          {result && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="mb-4 font-bold">Resultado</h3>
              <ResultTable result={result} />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
