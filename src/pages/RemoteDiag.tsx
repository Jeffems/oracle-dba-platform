import { useState, useRef } from 'react';
import { useConnectionStore } from '../stores/useConnectionStore';

// ---------------------------------------------------------------------------
// Página de diagnóstico remoto — v3.2.3
// Testa cada etapa do fluxo App → API Central → Agent → Oracle
// e mostra o resultado bruto de cada passo.
// ---------------------------------------------------------------------------

type LogEntry = {
  ts: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  msg: string;
  detail?: string;
};

function ts() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

export function RemoteDiag() {
  const { remote } = useConnectionStore();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [sql, setSql] = useState('SELECT 1 AS TESTE FROM dual');
  const abortRef = useRef(false);

  const apiUrl   = remote.config.apiUrl.trim().replace(/\/$/, '');
  const apiToken = remote.config.apiToken.trim();
  const agentId  = remote.selectedAgentId.trim();

  function addLog(level: LogEntry['level'], msg: string, detail?: string) {
    setLogs((prev) => [...prev, { ts: ts(), level, msg, detail }]);
  }

  function clearLogs() {
    setLogs([]);
  }

  async function apiFetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers ?? {});
    if (apiToken) headers.set('Authorization', `Bearer ${apiToken}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, ok: res.ok, text, json };
  }

  async function runDiag() {
    if (!apiUrl) { addLog('error', 'URL da API Central não configurada.'); return; }
    if (!agentId) { addLog('error', 'Nenhum Agent selecionado no painel de conexão.'); return; }

    setRunning(true);
    abortRef.current = false;
    clearLogs();

    try {
      // ── Passo 1: Health da API ──────────────────────────────────────────
      addLog('info', `[1/6] Verificando health da API: ${apiUrl}/health`);
      try {
        const r = await apiFetch('/health');
        if (r.ok) {
          addLog('ok', `API respondeu OK — versão: ${r.json?.version ?? '?'}, uptime: ${r.json?.uptimeSeconds ?? '?'}s`);
        } else {
          addLog('error', `Health retornou HTTP ${r.status}`, r.text);
          return;
        }
      } catch (e: any) {
        addLog('error', `Falha ao conectar na API: ${e.message}`);
        return;
      }

      // ── Passo 2: Verificar se o Agent está registrado ───────────────────
      addLog('info', `[2/6] Verificando se o Agent "${agentId}" está registrado na API`);
      try {
        const r = await apiFetch('/api/clients');
        const clients: any[] = r.json?.rows ?? [];
        const agent = clients.find((c: any) => c.agentId === agentId);
        if (!agent) {
          addLog('warn', `Agent "${agentId}" NÃO encontrado na lista de clientes. Agents registrados: ${clients.map((c: any) => c.agentId).join(', ') || '(nenhum)'}`);
        } else {
          const lastSeen = agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString() : 'nunca';
          const online   = agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 120_000;
          addLog(online ? 'ok' : 'warn',
            `Agent encontrado — último heartbeat: ${lastSeen} — status: ${online ? 'ONLINE' : 'OFFLINE (>2min sem heartbeat)'}`
          );
          if (!online) addLog('warn', 'Agent pode estar offline. Verifique se o serviço está rodando no servidor do cliente.');
        }
      } catch (e: any) {
        addLog('warn', `Erro ao listar clients: ${e.message}`);
      }

      // ── Passo 3: Enfileirar script ──────────────────────────────────────
      addLog('info', `[3/6] Enfileirando script na API: ${sql}`);
      let commandId: string;
      try {
        const r = await apiFetch('/api/scripts/queue', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            sql: sql.trim(),
            allowDangerous: true,
            type: 'SQL_SCRIPT',
            note: 'DIAGNÓSTICO v3.2.3',
          }),
        });
        addLog('info', `→ HTTP ${r.status} — resposta bruta:`, r.text);
        if (!r.ok || !r.json?.ok) {
          addLog('error', `Erro ao enfileirar: ${r.json?.message ?? r.text}`);
          if (r.json?.blocked) addLog('warn', 'Script BLOQUEADO pela API (allowDangerous não funcionou). Verifique isDangerousSql no server.cjs');
          return;
        }
        commandId = r.json.command?.id;
        if (!commandId) {
          addLog('error', 'API retornou ok=true mas sem command.id', r.text);
          return;
        }
        addLog('ok', `Script enfileirado com ID: ${commandId} — status inicial: ${r.json.command?.status}`);
      } catch (e: any) {
        addLog('error', `Exceção ao enfileirar: ${e.message}`);
        return;
      }

      // ── Passo 4: Polling do resultado ───────────────────────────────────
      addLog('info', `[4/6] Aguardando Agent executar (polling a cada 2s, timeout 120s)`);
      const started = Date.now();
      let lastStatus = '';
      let pollCount  = 0;

      while (Date.now() - started < 120_000) {
        if (abortRef.current) { addLog('warn', 'Diagnóstico cancelado pelo usuário.'); return; }

        await new Promise((r) => setTimeout(r, pollCount === 0 ? 1000 : 2000));
        pollCount++;

        let rows: any[] = [];
        try {
          const r = await apiFetch(`/api/scripts?agentId=${encodeURIComponent(agentId)}`);
          rows = r.json?.rows ?? [];
        } catch (e: any) {
          addLog('warn', `Erro no polling #${pollCount}: ${e.message}`);
          continue;
        }

        const cmd = rows.find((r: any) => r.id === commandId);
        if (!cmd) {
          addLog('warn', `Polling #${pollCount}: comando ${commandId} não encontrado na lista de scripts`);
          continue;
        }

        if (cmd.status !== lastStatus) {
          addLog('info', `Polling #${pollCount}: status mudou para "${cmd.status}"`);
          lastStatus = cmd.status;
        } else {
          addLog('info', `Polling #${pollCount}: status ainda "${cmd.status}" (${Math.round((Date.now() - started) / 1000)}s)`);
        }

        if (cmd.status === 'SUCCESS') {
          // ── Passo 5: Mostrar output bruto ─────────────────────────────
          addLog('ok', `[5/6] Comando concluído com SUCCESS`);
          addLog('info', `Output bruto recebido (${(cmd.output ?? '').length} chars):`, cmd.output ?? '(vazio)');

          // ── Passo 6: Parsear CSV ──────────────────────────────────────
          addLog('info', '[6/6] Tentando parsear output como CSV');
          const output = cmd.output ?? '';
          if (!output.trim() || output.trim() === '__EMPTY_RESULT__') {
            addLog('warn', 'Output vazio ou __EMPTY_RESULT__ — consulta retornou zero linhas.');
            return;
          }
          const lines = output.split(/\r?\n/).filter((l: string) => l.trim() && !/^session altered/i.test(l.trim()));
          addLog('info', `Linhas após filtro: ${lines.length}`, lines.slice(0, 5).join('\n'));
          if (!lines[0]?.trim().startsWith('"')) {
            addLog('warn', 'Primeira linha não começa com aspas — NÃO é CSV. O SQLPlus pode não estar gerando markup csv. Verifique se a versão do SQLPlus suporta "set markup csv on".');
            addLog('info', 'Primeiros 500 chars do output:', output.slice(0, 500));
          } else {
            addLog('ok', `CSV detectado — ${lines.length} linhas (incluindo cabeçalho)`);
            addLog('ok', `Cabeçalho: ${lines[0]}`);
            if (lines.length > 1) addLog('ok', `Primeira linha de dados: ${lines[1]}`);
          }
          return;
        }

        if (cmd.status === 'FAILED') {
          addLog('error', `[5/6] Comando FALHOU`, cmd.error ?? cmd.output ?? '(sem mensagem)');
          return;
        }

        if (cmd.status === 'BLOCKED_REVIEW_REQUIRED') {
          addLog('error', `Script BLOQUEADO pela API mesmo com allowDangerous=true. Verifique isDangerousSql em server.cjs.`);
          return;
        }
      }

      addLog('error', `Timeout: Agent não respondeu em 120s. Verifique se o serviço Agent está rodando no servidor do cliente e se consegue alcançar a API (${apiUrl}).`);

    } finally {
      setRunning(false);
    }
  }

  const levelColors: Record<LogEntry['level'], string> = {
    info:  'text-slate-300',
    ok:    'text-emerald-300',
    warn:  'text-yellow-300',
    error: 'text-rose-300',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Diagnóstico Remoto</h2>
          <p className="text-sm text-slate-400 mt-1">Testa cada etapa do fluxo App → API Central → Agent → Oracle</p>
        </div>
        <div className="flex gap-2">
          {running && (
            <button onClick={() => { abortRef.current = true; }} className="rounded-xl border border-rose-500/40 px-4 py-2 font-semibold text-rose-200 hover:bg-rose-500/10">
              Cancelar
            </button>
          )}
          <button onClick={runDiag} disabled={running} className="rounded-xl bg-cyan-500 px-5 py-2 font-semibold text-slate-950 disabled:opacity-60">
            {running ? 'Diagnosticando...' : 'Iniciar Diagnóstico'}
          </button>
        </div>
      </div>

      {/* Configuração atual */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm space-y-1">
        <p className="font-semibold text-slate-300 mb-2">Configuração atual (painel de conexão)</p>
        <p><span className="text-slate-500">API URL:</span> <span className={apiUrl ? 'text-cyan-300' : 'text-rose-400'}>{apiUrl || '(não configurado)'}</span></p>
        <p><span className="text-slate-500">Token:</span> <span className={apiToken ? 'text-cyan-300' : 'text-rose-400'}>{apiToken ? `${apiToken.slice(0, 6)}...` : '(não configurado)'}</span></p>
        <p><span className="text-slate-500">Agent ID:</span> <span className={agentId ? 'text-cyan-300' : 'text-rose-400'}>{agentId || '(nenhum selecionado)'}</span></p>
      </div>

      {/* SQL de teste */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
        <label className="text-sm font-semibold text-slate-300">SQL de teste</label>
        <input
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
          disabled={running}
        />
      </div>

      {/* Log */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 min-h-[300px] font-mono text-xs space-y-1 overflow-auto max-h-[500px]">
        {logs.length === 0 ? (
          <p className="text-slate-600">Clique em "Iniciar Diagnóstico" para testar o fluxo completo.</p>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={levelColors[entry.level]}>
              <span className="text-slate-600 mr-2">{entry.ts}</span>
              <span>{entry.msg}</span>
              {entry.detail && (
                <pre className="mt-1 ml-6 text-slate-400 whitespace-pre-wrap break-all border-l-2 border-slate-700 pl-2">
                  {entry.detail.slice(0, 2000)}{entry.detail.length > 2000 ? '\n… (truncado)' : ''}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
