import { executeSingleStatement } from './oracleClient';
import { getCentralCommands, queueCentralScript, type CentralApiConfig } from './centralApiClient';
import type { OracleConnectionConfig, QueryResult } from '../types/oracle';
import type { ConnectionMode } from '../stores/useConnectionStore';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type UnifiedExecutionInput = {
  mode: ConnectionMode;
  localConfig: OracleConnectionConfig;
  remoteConfig: CentralApiConfig;
  agentId: string;
  sql: string;
  allowDangerous?: boolean;
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Retorna true se o SQL é uma consulta (SELECT / WITH) */
function isSelectQuery(sql: string): boolean {
  const first = sql
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('--'));
  if (!first) return false;
  const lower = first.toLowerCase();
  return lower.startsWith('select ') || lower.startsWith('with ');
}

// ---------------------------------------------------------------------------
// Parser CSV robusto
// Suporta aspas duplas, escapes "" e campos com vírgulas/quebras de linha.
// Funciona com output do SQLPlus: set markup csv on delimiter , quote on
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Recebe o texto CSV bruto do spool do SQLPlus e converte para QueryResult.
 *
 * O SQLPlus com "markup csv on" gera sempre:
 *   "COL1","COL2",...
 *   "val1","val2",...
 *
 * Retorna null se o texto não parecer CSV válido.
 */
function parseCsvToResult(raw: string): QueryResult | null {
  // Filtra apenas ruídos do SQLPlus — não mexe em linhas CSV
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      // Descarta linhas de ruído do SQLPlus e linhas completamente vazias
      if (!t) return false;
      if (/^session altered\.?$/i.test(t)) return false;
      if (/^commit complete\.?$/i.test(t)) return false;
      return true;
    });

  if (lines.length === 0) return null;

  // A primeira linha não-vazia deve começar com aspas para ser CSV válido
  const header = lines[0].trim();
  if (!header.startsWith('"')) return null;

  const columns = parseCsvLine(header).map((c, i) => c || `COL_${i + 1}`);

  const rows = lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = vals[i] ?? '';
    });
    return row;
  });

  return {
    ok: true,
    message: rows.length > 0 ? 'Consulta executada com sucesso.' : 'Consulta executada sem linhas retornadas.',
    rows,
    metaData: columns.map((name) => ({ name })),
  };
}

// ---------------------------------------------------------------------------
// Interpreta o campo output que vem da API Central
// ---------------------------------------------------------------------------

function outputToResult(sql: string, output: string | null | undefined): QueryResult {
  const text = (output ?? '').trim();

  // DDL/DML — não precisa de tabela
  if (!isSelectQuery(sql)) {
    return {
      ok: true,
      message: text || 'Comando executado com sucesso.',
      rows: [],
      rowsAffected: 0,
    };
  }

  // Sentinel que o Agent envia quando o spool ficou vazio
  if (!text || text === '__EMPTY_RESULT__') {
    return {
      ok: true,
      message: 'Consulta executada sem linhas retornadas.',
      rows: [],
      metaData: [{ name: 'RESULTADO' }],
    };
  }

  // Tenta parsear como CSV (formato principal)
  const csvResult = parseCsvToResult(text);
  if (csvResult) return csvResult;

  // Fallback: texto simples linha a linha (SQLPlus sem markup csv)
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      return t && !/^session altered\.?$/i.test(t) && !/^commit complete\.?$/i.test(t);
    })
    .map((l) => ({ RESULTADO: l }));

  return {
    ok: true,
    rows,
    metaData: [{ name: 'RESULTADO' }],
    message: rows.length > 0 ? 'Consulta executada com sucesso.' : 'Consulta executada sem linhas retornadas.',
  };
}

// ---------------------------------------------------------------------------
// Executor principal
// ---------------------------------------------------------------------------

export async function executeWithCurrentConnection(
  input: UnifiedExecutionInput,
): Promise<QueryResult> {
  // --- Modo local ---
  if (input.mode === 'local') {
    return executeSingleStatement(input.localConfig, input.sql);
  }

  // --- Modo remoto via Agent ---
  if (!input.remoteConfig.apiUrl.trim()) {
    return { ok: false, message: 'Configure a URL da API Central antes de executar remotamente.' };
  }
  if (!input.agentId.trim()) {
    return { ok: false, message: 'Selecione um Agent remoto antes de executar.' };
  }

  // Enfileira o script na API Central
  let queued: Awaited<ReturnType<typeof queueCentralScript>>;
  try {
    queued = await queueCentralScript(input.remoteConfig, {
      agentId: input.agentId,
      sql: input.sql,
      allowDangerous: Boolean(input.allowDangerous),
      note: 'Criado pelo App Desktop v3.2.3',
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Erro ao conectar na API Central.',
    };
  }

  if (!queued.ok || queued.blocked || !queued.command?.id) {
    return {
      ok: false,
      message: queued.message || 'Script não foi enfileirado pela API Central.',
    };
  }

  const commandId = queued.command.id;
  const started   = Date.now();
  const timeoutMs = input.timeoutMs ?? 120_000;

  // Polling: aguarda o Agent executar e reportar o resultado
  // Começa rápido (1s) e estabiliza em 2s para não sobrecarregar a API
  let pollInterval = 1000;

  while (Date.now() - started < timeoutMs) {
    await sleep(pollInterval);
    pollInterval = 2000; // após a primeira tentativa, vai de 2s em 2s

    let commands: Awaited<ReturnType<typeof getCentralCommands>>;
    try {
      commands = await getCentralCommands(input.remoteConfig, input.agentId);
    } catch {
      // Falha de rede temporária — continua tentando
      continue;
    }

    const command = (commands.rows ?? []).find((r) => r.id === commandId);
    if (!command) continue;

    if (command.status === 'SUCCESS') {
      return outputToResult(input.sql, command.output);
    }

    if (command.status === 'FAILED') {
      return {
        ok: false,
        message: command.error || command.output || 'Comando remoto falhou sem mensagem de erro.',
      };
    }

    // QUEUED ou IN_PROGRESS — aguarda próxima iteração
  }

  return {
    ok: false,
    message:
      'Tempo limite aguardando retorno do Agent remoto. ' +
      'Verifique se o Agent está online e se a URL/token da API estão corretos.',
  };
}
