import { invoke } from "@tauri-apps/api/core";
import type {
  OracleConnectionConfig,
  QueryResult,
  ScriptProgressEvent,
  PatchProgressEvent,
} from "../types/oracle";

const BRIDGE_URL = "http://127.0.0.1:3789";
const LOCAL_AGENT_URL = "http://127.0.0.1:3334";

export async function pingDesktop() {
  return invoke<{ ok: boolean; message: string }>("ping_desktop");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridge(timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BRIDGE_URL}/health`, { method: "GET" });
      if (response.ok) return;
    } catch (err) {
      lastError = err;
    }

    await sleep(300);
  }

  throw new Error(
    "Oracle Bridge não iniciou automaticamente. Reabra o aplicativo ou verifique se o executável oracle-bridge foi incluído no build portable." +
      (lastError instanceof Error ? ` Detalhe: ${lastError.message}` : ""),
  );
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  await waitForBridge();
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Falha de comunicação com Oracle Bridge. HTTP ${response.status}`,
    );
  }

  return response.json();
}

async function postStream(path: string, body: unknown): Promise<Response> {
  await waitForBridge();
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Falha de comunicação com Oracle Bridge. HTTP ${response.status}`,
    );
  }

  return response;
}

export async function testConnection(
  config: OracleConnectionConfig,
): Promise<QueryResult> {
  return postJson<QueryResult>("/test-connection", config);
}

export async function executeSql(
  config: OracleConnectionConfig,
  sql: string,
  executionId?: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  return postJson<QueryResult>(
    "/execute-script",
    { config, sql, executionId },
    signal,
  );
}

export async function executeSqlStream(
  config: OracleConnectionConfig,
  sql: string,
  onEvent: (event: ScriptProgressEvent) => void,
): Promise<QueryResult> {
  const response = await postStream("/execute-script-stream", { config, sql });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: QueryResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim() || line.startsWith(":")) continue;
      const event = JSON.parse(line) as ScriptProgressEvent;
      onEvent(event);

      if (event.type === "done") finalResult = event.result;
      if (event.type === "fatal")
        finalResult = { ok: false, message: event.message };
    }
  }

  if (buffer.trim() && !buffer.startsWith(":")) {
    const event = JSON.parse(buffer) as ScriptProgressEvent;
    onEvent(event);
    if (event.type === "done") finalResult = event.result;
    if (event.type === "fatal")
      finalResult = { ok: false, message: event.message };
  }

  return (
    finalResult ?? {
      ok: false,
      message: "Execução finalizada sem retorno do bridge.",
    }
  );
}

export async function executeSingleStatement(
  config: OracleConnectionConfig,
  sql: string,
  executionId?: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  return postJson<QueryResult>(
    "/execute-script",
    { config, sql, executionId },
    signal,
  );
}

export async function cancelSqlExecution(
  executionId: string,
): Promise<{ ok: boolean; message: string }> {
  return postJson<{ ok: boolean; message: string }>("/execute-script/cancel", {
    executionId,
  });
}

export async function runPatchStream(
  config: Record<string, unknown>,
  onEvent: (event: PatchProgressEvent) => void,
): Promise<QueryResult> {
  const response = await postStream("/run-patch-stream", config);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: QueryResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim() || line.startsWith(":")) continue;
      const event = JSON.parse(line) as PatchProgressEvent;
      onEvent(event);
      if (event.type === "done") finalResult = event.result;
      if (event.type === "fatal")
        finalResult = { ok: false, message: event.message };
    }
  }

  if (buffer.trim() && !buffer.startsWith(":")) {
    const event = JSON.parse(buffer) as PatchProgressEvent;
    onEvent(event);
    if (event.type === "done") finalResult = event.result;
    if (event.type === "fatal")
      finalResult = { ok: false, message: event.message };
  }

  return (
    finalResult ?? {
      ok: false,
      message: "Execução do patch finalizada sem retorno do bridge.",
    }
  );
}

export async function runPatch(
  config: Record<string, unknown>,
): Promise<QueryResult> {
  return postJson<QueryResult>("/run-patch", config);
}

export type AgentStatus = {
  running: boolean;
  intervalSeconds: number;
  startedAt?: string;
  lastRunAt?: string;
  lastError?: string;
  samplesCollected: number;
  metricsFile: string;
  host: string;
};

async function getExternalAgentStatus(): Promise<{
  ok: boolean;
  status: AgentStatus;
}> {
  const response = await fetch(`${LOCAL_AGENT_URL}/api/agent/status`);
  if (!response.ok)
    throw new Error(`Falha ao consultar Agent local. HTTP ${response.status}`);
  const data = await response.json();

  return {
    ok: true,
    status: {
      running: Boolean(data.online || data.status === "running"),
      intervalSeconds: Number(data.intervalSeconds || 60),
      startedAt: data.startedAt,
      lastRunAt: data.timestamp,
      lastError: data.lastError,
      samplesCollected: Number(data.samplesCollected || 0),
      metricsFile: data.metricsFile || "Agent externo em C:\\OracleDBAAgent",
      host: data.hostname || data.host || "-",
    },
  };
}

export async function getAgentStatus(): Promise<{
  ok: boolean;
  status: AgentStatus;
}> {
  try {
    await waitForBridge();
    const response = await fetch(`${BRIDGE_URL}/agent/status`);
    if (!response.ok)
      throw new Error(`Falha ao consultar Agent. HTTP ${response.status}`);
    return response.json();
  } catch (err) {
    // Fallback para o serviço Windows OracleDBAAgent rodando em C:\OracleDBAAgent.
    return getExternalAgentStatus();
  }
}

export async function getAgentMetrics(
  limit = 20,
): Promise<{ ok: boolean; rows: unknown[] }> {
  try {
    await waitForBridge();
    const response = await fetch(`${BRIDGE_URL}/agent/metrics?limit=${limit}`);
    if (!response.ok)
      throw new Error(
        `Falha ao ler métricas do Agent. HTTP ${response.status}`,
      );
    return response.json();
  } catch {
    // O Agent externo v2.3.0 ainda expõe apenas /api/agent/status.
    // Mantém a tela sem erro 404 enquanto não houver histórico remoto/local via API.
    return { ok: true, rows: [] };
  }
}

export async function startAgentCollector(
  config: OracleConnectionConfig,
  intervalSeconds: number,
): Promise<{ ok: boolean; message: string; status: AgentStatus }> {
  return postJson("/agent/start", { config, intervalSeconds });
}

export async function stopAgentCollector(): Promise<{
  ok: boolean;
  message: string;
  status: AgentStatus;
}> {
  return postJson("/agent/stop", {});
}

export async function collectAgentOnce(
  config: OracleConnectionConfig,
): Promise<{ ok: boolean; snapshot: unknown; status: AgentStatus }> {
  return postJson("/agent/collect-once", { config });
}
