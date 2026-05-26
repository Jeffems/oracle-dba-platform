const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv() {
  const files = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, ".env"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnv();

let PrismaClient;
try {
  ({ PrismaClient } = require("@prisma/client"));
} catch (err) {
  console.error(
    "[ERRO] @prisma/client não encontrado. Rode: npm install && npm run db:generate",
  );
  throw err;
}

const prisma = new PrismaClient();
const PORT = Number(process.env.CENTRAL_API_PORT || 4090);
const TOKEN = process.env.CENTRAL_API_TOKEN || "dev-token-change-me";
const VERSION = "2.8.0";
const startedAt = Date.now();
const sseClients = new Set();
const LOG_DIR = path.join(process.cwd(), "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "central-api.log");

function log(level, message, meta = {}) {
  const row = { at: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(row);
  fs.appendFileSync(LOG_FILE, line + "\n");
  if (level === "error") console.error(line);
  else console.log(line);
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}
function getBearer(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  try {
    return (
      new URL(req.url, `http://${req.headers.host}`).searchParams.get(
        "token",
      ) || ""
    );
  } catch {
    return "";
  }
}
function auth(req) {
  return getBearer(req) === TOKEN;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
function metricValue(snapshot, metric) {
  const overview = snapshot?.overview || snapshot?.OVERVIEW || [];
  const found = overview.find(
    (row) => String(row.METRIC ?? row.metric ?? "").toUpperCase() === metric,
  );
  return Number(found?.VALUE ?? found?.value ?? 0);
}
function normalizeMetricRecord(row) {
  const snapshot = row.snapshot || {};
  return {
    id: row.id,
    receivedAt: row.receivedAt,
    agentId: row.agentId,
    customerName: row.customerName,
    environment: row.environment,
    host: row.host || snapshot.host || null,
    dbName: row.dbName,
    version: row.version,
    snapshot,
  };
}
async function audit(action, details) {
  await prisma.auditLog.create({ data: { action, details } });
}
async function upsertAgent(body, agentId) {
  return prisma.agent.upsert({
    where: { agentId },
    update: {
      customerName: body.customerName || undefined,
      environment: body.environment || undefined,
      host: body.host || body.hostname || body.snapshot?.host || undefined,
      dbName: body.dbName || body.database || undefined,
      version: body.version || undefined,
      lastSeenAt: body.lastSeenAt ? new Date(body.lastSeenAt) : undefined,
    },
    create: {
      agentId,
      customerName: body.customerName || null,
      environment: body.environment || "PRODUCAO",
      host: body.host || body.hostname || body.snapshot?.host || null,
      dbName: body.dbName || body.database || null,
      version: body.version || null,
      lastSeenAt: body.lastSeenAt ? new Date(body.lastSeenAt) : null,
    },
  });
}
async function summarizeInstances() {
  const agents = await prisma.agent.findMany({
    orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
  });
  const rows = [];
  for (const agent of agents) {
    const latest = await prisma.metric.findFirst({
      where: { agentId: agent.agentId },
      orderBy: { receivedAt: "desc" },
    });
    const samples = await prisma.metric.count({
      where: { agentId: agent.agentId },
    });
    const snapshot = latest?.snapshot || null;
    rows.push({
      agentId: agent.agentId,
      customerName: agent.customerName,
      environment: agent.environment,
      host: latest?.host || agent.host,
      dbName: latest?.dbName || agent.dbName,
      version: latest?.version || agent.version,
      lastSeenAt: latest?.receivedAt || agent.lastSeenAt,
      samples,
      registered: true,
      latest: snapshot,
      activeSessions: metricValue(snapshot, "ACTIVE_SESSIONS"),
      blockedSessions: metricValue(snapshot, "BLOCKED_SESSIONS"),
      maxTablespacePct: metricValue(snapshot, "TABLESPACE_MAX_USED_PCT"),
    });
  }
  return rows;
}
function calcAlerts(instances) {
  const now = Date.now();
  const alerts = [];
  for (const item of instances) {
    const prefix = item.customerName || item.agentId;
    if (!item.lastSeenAt) {
      alerts.push({
        level: "warning",
        agentId: item.agentId,
        message: `${prefix}: Agent cadastrado sem métricas recebidas.`,
      });
      continue;
    }
    const ageMinutes = (now - new Date(item.lastSeenAt).getTime()) / 60000;
    if (ageMinutes > 5)
      alerts.push({
        level: "critical",
        agentId: item.agentId,
        message: `${prefix}: sem comunicação há ${Math.round(ageMinutes)} min.`,
      });
    if (Number(item.blockedSessions || 0) > 0)
      alerts.push({
        level: "critical",
        agentId: item.agentId,
        message: `${prefix}: ${item.blockedSessions} sessões bloqueadas.`,
      });
    if (Number(item.maxTablespacePct || 0) >= 90)
      alerts.push({
        level: "critical",
        agentId: item.agentId,
        message: `${prefix}: tablespace acima de 90%.`,
      });
    else if (Number(item.maxTablespacePct || 0) >= 80)
      alerts.push({
        level: "warning",
        agentId: item.agentId,
        message: `${prefix}: tablespace acima de 80%.`,
      });
  }
  return alerts;
}
async function persistActiveAlerts(alerts) {
  for (const alert of alerts) {
    await prisma.alert.create({
      data: {
        agentId: alert.agentId || null,
        level: alert.level,
        message: alert.message,
      },
    });
  }
}
async function currentState() {
  const clients = await summarizeInstances();
  const alerts = calcAlerts(clients);
  return {
    ok: true,
    version: VERSION,
    persistence: "postgresql/prisma",
    clients,
    alerts,
    now: new Date().toISOString(),
  };
}
function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of Array.from(sseClients)) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}
async function dbHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/health") {
      const database = await dbHealth();
      return send(res, database.ok ? 200 : 503, {
        ok: database.ok,
        name: "Oracle DBA Central API",
        version: VERSION,
        persistence: "postgresql/prisma",
        database,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        now: new Date().toISOString(),
      });
    }
    if (req.url?.startsWith("/api/") && !auth(req))
      return send(res, 401, {
        ok: false,
        message: "Token inválido ou ausente.",
      });
    if (req.method === "GET" && req.url?.startsWith("/api/realtime")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      sseClients.add(res);
      res.write(
        `event: connected\ndata: ${JSON.stringify(await currentState())}\n\n`,
      );
      const keepAlive = setInterval(() => {
        try {
          res.write(
            `event: ping\ndata: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`,
          );
        } catch {}
      }, 25000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/agents/register") {
      const body = await readJson(req);
      const agentId = String(body.agentId || "").trim() || crypto.randomUUID();
      const agent = await upsertAgent(body, agentId);
      await audit("agent.register", { agentId, body });
      broadcast("state", await currentState());
      return send(res, 201, { ok: true, agent });
    }

    if (req.method === "POST" && req.url === "/api/heartbeat") {
      const body = await readJson(req);
      const agentId = String(body.agentId || body.agent || "unknown-agent");
      const agent = await upsertAgent(
        { ...body, lastSeenAt: new Date().toISOString() },
        agentId,
      );
      await audit("agent.heartbeat", {
        agentId,
        host: body.host || body.hostname || null,
        version: body.version || null,
      });
      broadcast("heartbeat", { agent, state: await currentState() });
      return send(res, 200, {
        ok: true,
        agentId,
        receivedAt: new Date().toISOString(),
      });
    }
    if (req.method === "POST" && req.url === "/api/metrics") {
      const body = await readJson(req);
      const agentId = String(body.agentId || body.agent || "unknown-agent");
      await upsertAgent(
        { ...body, lastSeenAt: new Date().toISOString() },
        agentId,
      );
      const record = await prisma.metric.create({
        data: {
          agentId,
          customerName: body.customerName || null,
          environment: body.environment || null,
          host: body.host || body.hostname || body.snapshot?.host || null,
          dbName: body.dbName || body.database || null,
          version: body.version || null,
          snapshot: body.snapshot || body.metrics || body,
        },
      });
      const state = await currentState();
      await persistActiveAlerts(state.alerts);
      broadcast("metrics", { record: normalizeMetricRecord(record), state });
      return send(res, 201, {
        ok: true,
        id: record.id,
        receivedAt: record.receivedAt,
      });
    }
    if (
      req.method === "GET" &&
      (req.url === "/api/clients" || req.url?.startsWith("/api/instances"))
    )
      return send(res, 200, { ok: true, rows: await summarizeInstances() });
    if (req.method === "GET" && req.url?.startsWith("/api/metrics")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = Math.max(
        1,
        Math.min(500, Number(url.searchParams.get("limit") || 100)),
      );
      const agentId = url.searchParams.get("agentId") || undefined;
      const rows = await prisma.metric.findMany({
        where: agentId ? { agentId } : {},
        orderBy: { receivedAt: "desc" },
        take: limit,
      });
      return send(res, 200, {
        ok: true,
        rows: rows.map(normalizeMetricRecord),
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/alerts/history")) {
      const rows = await prisma.alert.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return send(res, 200, {
        ok: true,
        rows: rows.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          level: a.level,
          message: a.message,
          at: a.createdAt,
        })),
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/alerts"))
      return send(res, 200, {
        ok: true,
        rows: calcAlerts(await summarizeInstances()),
      });
    if (req.method === "GET" && req.url?.startsWith("/api/state"))
      return send(res, 200, await currentState());
    if (req.method === "POST" && req.url === "/api/scripts/queue") {
      const body = await readJson(req);
      const command = await prisma.command.create({
        data: {
          agentId: body.agentId || null,
          type: body.type || "SQL_REVIEW_REQUIRED",
          sql: body.sql || "",
          status: "PENDING_APPROVAL",
          note:
            body.note ||
            "Comando criado para auditoria. Execução remota automática ainda bloqueada por segurança.",
        },
      });
      await audit("script.queue", command);
      broadcast("command", command);
      return send(res, 201, { ok: true, command });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/scripts"))
      return send(res, 200, {
        ok: true,
        rows: await prisma.command.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    return send(res, 404, { ok: false, message: "Rota não encontrada." });
  } catch (err) {
    log("error", "request.failed", {
      requestId,
      method: req.method,
      url: req.url,
      error: err.message,
    });
    return send(res, 500, { ok: false, message: err.message, requestId });
  }
});

process.on("SIGINT", async () => {
  log("info", "shutdown.sigint");
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  log("info", "shutdown.sigterm");
  await prisma.$disconnect();
  process.exit(0);
});
server.listen(PORT, () => {
  log("info", `Oracle DBA Central API v${VERSION} rodando`, {
    url: `http://127.0.0.1:${PORT}`,
    logFile: LOG_FILE,
  });
});
