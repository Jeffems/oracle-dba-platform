import { executeSingleStatement } from "./oracleClient";
import {
  getCentralCommands,
  queueCentralScript,
  type CentralApiConfig,
} from "./centralApiClient";
import type { OracleConnectionConfig, QueryResult } from "../types/oracle";
import type { ConnectionMode } from "../stores/useConnectionStore";

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
  executionId?: string;
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Retorna true se o SQL é uma consulta (SELECT / WITH) */
function removeSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isSelectQuery(sql: string): boolean {
  const lower = removeSqlComments(sql).toLowerCase();
  return lower.startsWith("select ") || lower.startsWith("with ");
}
// ---------------------------------------------------------------------------
// Parser CSV robusto
// Suporta aspas duplas, escapes "" e campos com vírgulas/quebras de linha.
// Funciona com output do SQLPlus: set markup csv on delimiter , quote on
// ---------------------------------------------------------------------------

/**
 * Parser de CSV tolerante ao output do SQLPlus 19c:
 * - Cabeçalho sempre entre aspas: "COL1","COL2"
 * - Valores numéricos SEM aspas: 1,2.5
 * - Valores texto COM aspas: "abc","def"
 * - Aspas duplas como escape: "val""com""aspas"
 */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQ = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQ = !inQ;
      i++;
      continue;
    }
    if (ch === "," && !inQ) {
      cols.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Detecta se o texto é CSV do SQLPlus.
 * O cabeçalho SEMPRE tem aspas (mesmo no 19c), então basta checar a primeira linha.
 * Valores numéricos nas linhas de dados podem vir sem aspas — isso é normal.
 */
function looksLikeSqlplusCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim());
  // Cabeçalho do SQLPlus com markup csv sempre começa com aspas
  return Boolean(firstLine && firstLine.trim().startsWith('"'));
}

function parseCsvToResult(raw: string): QueryResult | null {
  const lines = raw.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^session altered\.?$/i.test(t)) return false;
    if (/^commit complete\.?$/i.test(t)) return false;
    return true;
  });

  if (lines.length === 0) return null;
  if (!looksLikeSqlplusCsv(lines.join("\n"))) return null;

  const columns = parseCsvLine(lines[0]).map((c, i) => c || `COL_${i + 1}`);

  const rows = lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = vals[i] ?? "";
    });
    return row;
  });

  return {
    ok: true,
    message:
      rows.length > 0
        ? "Consulta executada com sucesso."
        : "Consulta executada sem linhas retornadas.",
    rows,
    metaData: columns.map((name) => ({ name })),
  };
}

// ---------------------------------------------------------------------------
// Interpreta o campo output que vem da API Central
// ---------------------------------------------------------------------------

function outputToResult(
  sql: string,
  output: string | null | undefined,
): QueryResult {
  const text = (output ?? "").trim();

  // DDL/DML — não precisa de tabela
  if (!isSelectQuery(sql)) {
    return {
      ok: true,
      message: text || "Comando executado com sucesso.",
      rows: [],
      rowsAffected: 0,
    };
  }

  // Sentinel que o Agent envia quando o spool ficou vazio
  if (!text || text === "__EMPTY_RESULT__") {
    return {
      ok: true,
      message: "Consulta executada sem linhas retornadas.",
      rows: [],
      metaData: [{ name: "RESULTADO" }],
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
      return (
        t &&
        !/^session altered\.?$/i.test(t) &&
        !/^commit complete\.?$/i.test(t)
      );
    })
    .map((l) => ({ RESULTADO: l }));

  return {
    ok: true,
    rows,
    metaData: [{ name: "RESULTADO" }],
    message:
      rows.length > 0
        ? "Consulta executada com sucesso."
        : "Consulta executada sem linhas retornadas.",
  };
}

// ---------------------------------------------------------------------------
// Executor principal
// ---------------------------------------------------------------------------

export async function executeWithCurrentConnection(
  input: UnifiedExecutionInput,
): Promise<QueryResult> {
  // --- Modo local ---
  if (input.mode === "local") {
    return executeSingleStatement(
      input.localConfig,
      input.sql,
      input.executionId,
      input.signal,
    );
  }

  // --- Modo remoto via Agent ---
  if (!input.remoteConfig.apiUrl.trim()) {
    return {
      ok: false,
      message: "Configure a URL da API Central antes de executar remotamente.",
    };
  }
  if (!input.agentId.trim()) {
    return {
      ok: false,
      message: "Selecione um Agent remoto antes de executar.",
    };
  }

  // Enfileira o script na API Central
  let queued: Awaited<ReturnType<typeof queueCentralScript>>;
  try {
    queued = await queueCentralScript(input.remoteConfig, {
      agentId: input.agentId,
      sql: input.sql,
      allowDangerous: Boolean(input.allowDangerous),
      note: "Criado pelo App Desktop v3.2.4",
    });
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Erro ao conectar na API Central.",
    };
  }

  if (!queued.ok || queued.blocked || !queued.command?.id) {
    return {
      ok: false,
      message: queued.message || "Script não foi enfileirado pela API Central.",
    };
  }

  const commandId = queued.command.id;
  const started = Date.now();
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

    if (command.status === "SUCCESS") {
      return outputToResult(input.sql, command.output);
    }

    if (command.status === "FAILED") {
      return {
        ok: false,
        message:
          command.error ||
          command.output ||
          "Comando remoto falhou sem mensagem de erro.",
      };
    }

    // QUEUED ou IN_PROGRESS — aguarda próxima iteração
  }

  return {
    ok: false,
    message:
      "Tempo limite aguardando retorno do Agent remoto. " +
      "Verifique se o Agent está online e se a URL/token da API estão corretos.",
  };
}
