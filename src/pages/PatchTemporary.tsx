import { useEffect, useRef } from 'react';
import { usePatchStore } from '../stores/usePatchStore';
import { runPatchStream } from '../services/oracleClient';
import type { QueryResult } from '../types/oracle';
import { ResultTable } from '../components/ResultTable';

function formatSeconds(ms: number) {
  return `${Math.floor(ms / 1000)}s`;
}

export function PatchTemporary() {
  const { values, setValue, result, setResult, busy, setBusy, elapsedMs, setElapsedMs, patchLog, addLog, clearLogs, logPath, setLogPath, startedAt, setStartedAt } = usePatchStore();
  const startedAtRef = useRef<number | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const set = (key: keyof typeof values, value: string | boolean) => setValue(key, value);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      if (startedAt || startedAtRef.current) setElapsedMs(Date.now() - (startedAt || startedAtRef.current || Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [patchLog]);

  async function run() {
    setBusy(true);
    setResult(undefined);
    clearLogs();
    setLogPath('');
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    setStartedAt(startedAtRef.current);

    try {
      const finalResult = await runPatchStream(values, (event) => {
        if (event.type === 'start') {
          setLogPath(event.logPath ?? '');
          addLog('[INÍCIO] Aplicando patch Oracle...');
          return;
        }

        if (event.type === 'log') {
          setElapsedMs(event.elapsedMs);
          addLog(event.line);
          return;
        }

        if (event.type === 'done') {
          setElapsedMs(event.durationMs);
          setResult(event.result);
          addLog(event.result.ok ? '[FIM] Patch finalizado com sucesso.' : `[FIM] ${event.result.message ?? 'Patch finalizado com erro.'}`);
          return;
        }

        if (event.type === 'fatal') {
          setElapsedMs(event.durationMs);
          setResult({ ok: false, message: event.message });
          addLog(`[ERRO] ${event.message}`);
        }
      });
      setResult(finalResult);
    } catch {
      setResult({ ok: false, message: 'Bridge Oracle offline. Rode: npm run oracle:bridge' });
      addLog('[ERRO] Bridge Oracle offline. Rode: npm run oracle:bridge');
    } finally {
      setBusy(false);
      startedAtRef.current = null;
      setStartedAt(undefined);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Patch Oracle 19c</h2>
        <p className="text-slate-400 mt-1">Aplica OPatch, para serviços Oracle, executa datapatch e grava log em tempo real.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1"><span className="text-sm text-slate-400">Oracle Home</span><input className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2" value={values.oracleHome} onChange={(e)=>set('oracleHome', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm text-slate-400">Oracle SID</span><input className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2" value={values.oracleSid} onChange={(e)=>set('oracleSid', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm text-slate-400">Diretório do patch</span><input className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2" value={values.patchDir} onChange={(e)=>set('patchDir', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm text-slate-400">Pasta de trabalho/logs</span><input className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2" value={values.workRoot} onChange={(e)=>set('workRoot', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm text-slate-400">Listener</span><input className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2" value={values.listenerName} onChange={(e)=>set('listenerName', e.target.value)} /></label>
        <div className="flex flex-col gap-3 justify-end">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={values.autoStartDb} onChange={(e)=>set('autoStartDb', e.target.checked)} /> Subir banco e executar datapatch depois do OPatch</label>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={values.openAllPdbs} onChange={(e)=>set('openAllPdbs', e.target.checked)} /> Abrir todos os PDBs após startup</label>
        </div>
      </section>

      <div className="rounded-2xl border border-yellow-700/40 bg-yellow-950/30 p-4 text-sm text-yellow-100">
        Execute o app/terminal como Administrador. Esse módulo para listener, serviços Oracle, processos Oracle, aplica OPatch e pode reiniciar o banco.
      </div>

      <div className="space-y-3">
        <button onClick={run} disabled={busy} className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60">
          {busy ? 'Aplicando patch...' : 'Aplicar Patch Oracle'}
        </button>

        {(busy || patchLog.length > 0) && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Execução do patch</p>
                <div className="mt-1 flex items-center gap-3">
                  <span className="font-mono text-2xl font-bold text-cyan-300">{formatSeconds(elapsedMs)}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${busy ? 'bg-cyan-500/15 text-cyan-200' : 'bg-slate-800 text-slate-300'}`}>
                    {busy ? 'Executando em tempo real' : 'Finalizado'}
                  </span>
                </div>
              </div>
              {logPath && <div className="max-w-xl truncate rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300">{logPath}</div>}
            </div>

            <div ref={logBoxRef} className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-800 bg-black p-3 font-mono text-xs leading-relaxed text-slate-200">
              {patchLog.map((line, index) => (
                <div key={`${index}-${line}`} className={line.includes('[ERRO]') || line.includes('ERRO') ? 'text-rose-300' : line.includes('[FIM]') ? 'text-emerald-300' : 'text-slate-200'}>
                  {line || ' '}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <ResultTable result={result} />
    </div>
  );
}
