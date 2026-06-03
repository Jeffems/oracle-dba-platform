export type CentralApiConfig = {
  apiUrl: string;
  apiToken: string;
};

export type CentralClient = {
  agentId: string;
  customerName?: string | null;
  environment?: string | null;
  host?: string | null;
  dbName?: string | null;
  version?: string | null;
  lastSeenAt?: string | null;
  samples?: number;
  pendingCommands?: number;
  latest?: any;
  activeSessions?: number;
  blockedSessions?: number;
  locksWaiting?: number;
  invalidObjects?: number;
  longOps?: number;
  maxTablespacePct?: number;
  dbCpuSeconds?: number;
  dbTimeSeconds?: number;
  logicalReads?: number;
  physicalReads?: number;
  executions?: number;
  parseCountTotal?: number;
  redoSizeMb?: number;
  pgaAllocMb?: number;
  sgaMb?: number;
};

export type CentralMetric = {
  id?: string;
  receivedAt: string;
  agentId: string;
  customerName?: string | null;
  environment?: string | null;
  host?: string | null;
  dbName?: string | null;
  version?: string | null;
  snapshot?: any;
};

export type CentralCommand = {
  id: string;
  agentId: string;
  type: string;
  sql: string;
  status: string;
  note?: string | null;
  allowDangerous?: boolean;
  output?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

const DEFAULT_CONFIG: CentralApiConfig = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://127.0.0.1:4090',
  apiToken: import.meta.env.VITE_API_TOKEN || 'dev-token-change-me'
};

export function loadCentralApiConfig(): CentralApiConfig {
  return {
    apiUrl: localStorage.getItem('desktopCentralApiUrl') || DEFAULT_CONFIG.apiUrl,
    apiToken: localStorage.getItem('desktopCentralApiToken') || DEFAULT_CONFIG.apiToken
  };
}

export function saveCentralApiConfig(config: CentralApiConfig) {
  localStorage.setItem('desktopCentralApiUrl', config.apiUrl.trim().replace(/\/$/, ''));
  localStorage.setItem('desktopCentralApiToken', config.apiToken.trim());
}

function cleanUrl(config: CentralApiConfig) {
  return config.apiUrl.trim().replace(/\/$/, '');
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const msg = body?.message || body?.error || text || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export async function centralFetch<T>(config: CentralApiConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (config.apiToken) headers.set('Authorization', `Bearer ${config.apiToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${cleanUrl(config)}${path}`, { ...init, headers });
  return parseResponse<T>(response);
}

export async function getCentralHealth(config: CentralApiConfig) {
  return centralFetch<any>(config, '/health');
}

export async function getCentralClients(config: CentralApiConfig) {
  return centralFetch<{ ok: boolean; rows: CentralClient[] }>(config, '/api/clients');
}

export async function getCentralMetrics(config: CentralApiConfig, agentId?: string, limit = 200) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (agentId) query.set('agentId', agentId);
  return centralFetch<{ ok: boolean; rows: CentralMetric[] }>(config, `/api/metrics?${query.toString()}`);
}

export async function getCentralCommands(config: CentralApiConfig, agentId?: string) {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  return centralFetch<{ ok: boolean; rows: CentralCommand[] }>(config, `/api/scripts${query}`);
}

export async function queueCentralScript(config: CentralApiConfig, payload: { agentId: string; sql: string; allowDangerous: boolean; note?: string }) {
  return centralFetch<{ ok: boolean; blocked?: boolean; message?: string; command?: CentralCommand }>(config, '/api/scripts/queue', {
    method: 'POST',
    body: JSON.stringify({ ...payload, type: 'SQL_SCRIPT' })
  });
}


export async function clearCentralCommandHistory(config: CentralApiConfig, agentId?: string) {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  return centralFetch<{ ok: boolean; deleted: number; message?: string }>(config, `/api/scripts/history${query}`, {
    method: 'DELETE'
  });
}
