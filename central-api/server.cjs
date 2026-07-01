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
const PORT = Number(
  process.env.PORT ||
    process.env.RAILWAY_PORT ||
    process.env.CENTRAL_API_PORT ||
    4090,
);
const TOKEN = process.env.CENTRAL_API_TOKEN || "dev-token-change-me";
const DASHBOARD_SESSION_SECRET =
  process.env.DASHBOARD_SESSION_SECRET || TOKEN || "dev-dashboard-secret";
const DASHBOARD_SESSION_TTL_MS = Math.max(
  60_000,
  Number(process.env.DASHBOARD_SESSION_TTL_MS || 8 * 60 * 60 * 1000),
);
const dashboardSessions = new Map();
const VERSION = "3.3.20";
const startedAt = Date.now();
const sseClients = new Set();
const LOG_DIR = path.join(process.cwd(), "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "central-api.log");

function log(level, message, meta = {}) {
  const row = { at: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(row);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
  if (level === "error") console.error(line);
  else console.log(line);
}

function setCors(req, res) {
  const origin = req?.headers?.origin || "*";
  // Dashboard Web e App Tauri usam esta API de origens diferentes.
  // Para evitar bloqueio CORS em respostas de erro/health/SSE, aplicamos os headers logo no início da requisição.
  res.setHeader(
    "Access-Control-Allow-Origin",
    origin === "null" ? "*" : origin,
  );
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cache-Control",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}
function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  if (status === 204) return res.end();
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
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function signSessionPayload(payload) {
  return crypto
    .createHmac("sha256", DASHBOARD_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}
function createDashboardSession(user) {
  const now = Date.now();
  const session = {
    sid: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: now,
    expiresAt: now + DASHBOARD_SESSION_TTL_MS,
  };
  dashboardSessions.set(session.sid, session);
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signSessionPayload(payload)}`;
}
function verifyDashboardSession(token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    if (!safeEqual(signature, signSessionPayload(payload))) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session?.sid || !session?.username || !session?.expiresAt) return null;
    if (Date.now() > Number(session.expiresAt)) {
      dashboardSessions.delete(session.sid);
      return null;
    }
    const active = dashboardSessions.get(session.sid);
    if (active && Number(active.expiresAt) !== Number(session.expiresAt)) return null;
    return session;
  } catch {
    return null;
  }
}
function auth(req) {
  const bearer = getBearer(req);
  if (safeEqual(bearer, TOKEN)) return { type: "api-token", username: "agent-or-api", role: "SYSTEM" };
  const session = verifyDashboardSession(bearer);
  if (session) return { type: "dashboard", userId: session.userId || null, username: session.username, role: session.role || "ADMIN" };
  return null;
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
function positiveDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  const d = c - p;
  // Contadores Oracle zeram no restart. Se o atual for menor que o anterior, não mostra delta negativo.
  return d >= 0 ? d : 0;
}
function secondsBetween(a, b) {
  const ta = new Date(a || 0).getTime();
  const tb = new Date(b || 0).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, (ta - tb) / 1000);
}
function round2(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const PASSWORD_ALGO = "scrypt";
const PASSWORD_KEYLEN = 64;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_COST = 16384;

function hashPassword(password) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("base64url");
  const hash = crypto
    .scryptSync(String(password || ""), salt, PASSWORD_KEYLEN, { N: PASSWORD_COST })
    .toString("base64url");
  return `${PASSWORD_ALGO}$${PASSWORD_COST}$${salt}$${hash}`;
}
function verifyPassword(password, storedHash) {
  try {
    const [algo, cost, salt, hash] = String(storedHash || "").split("$");
    if (algo !== PASSWORD_ALGO || !cost || !salt || !hash) return false;
    const candidate = crypto
      .scryptSync(String(password || ""), salt, PASSWORD_KEYLEN, { N: Number(cost) })
      .toString("base64url");
    return safeEqual(candidate, hash);
  } catch {
    return false;
  }
}
function normalizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name || "",
    username: user.username,
    email: user.email || "",
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}
function normalizeRole(role) {
  const value = String(role || "DBA").trim().toUpperCase();
  return ["ADMIN", "DBA", "OPERATOR", "READONLY"].includes(value) ? value : "DBA";
}
function canManageUsers(authUser) {
  return isAdmin(authUser);
}
function isAdmin(authUser) {
  return String(authUser?.role || "").toUpperCase() === "ADMIN";
}
async function bootstrapDashboardAdmin() {
  const count = await prisma.dashboardUser.count();
  if (count > 0) return;
  const username = String(process.env.DASHBOARD_ADMIN_USER || "admin").trim();
  const password = String(process.env.DASHBOARD_ADMIN_PASSWORD || "");
  if (!password) {
    log("warn", "dashboard.bootstrap.skipped", {
      message: "Nenhum usuário do dashboard existe. Configure DASHBOARD_ADMIN_PASSWORD uma vez para criar o primeiro admin.",
    });
    return;
  }
  const user = await prisma.dashboardUser.create({
    data: {
      name: "Administrador",
      username,
      passwordHash: hashPassword(password),
      role: "ADMIN",
      active: true,
    },
  });
  await audit("dashboard.user.bootstrap", { user: normalizeUser(user) });
  log("info", "dashboard.bootstrap.created", { username });
}

function normalizeBackupStatus(snapshot) {
  const b = snapshot?.backupStatus || snapshot?.backup || null;
  if (!b || typeof b !== "object")
    return { enabled: false, status: "UNKNOWN", label: "Sem dados" };
  return {
    enabled: Boolean(b.enabled),
    status: String(b.status || "UNKNOWN").toUpperCase(),
    label: b.label || b.status || "Sem dados",
    message: b.message || null,
    latestFile: b.latestFile || null,
    latestFilePath: b.latestFilePath || null,
    latestModifiedAt: b.latestModifiedAt || null,
    ageHours: Number(b.ageHours ?? 0),
    sizeMb: Number(b.sizeMb ?? 0),
    checkedAt: b.checkedAt || null,
    path: b.path || null,
    logPath: b.logPath || null,
  };
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
function normalizeCommand(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agentId,
    type: row.type,
    sql: row.sql,
    status: row.status,
    note: row.note,
    allowDangerous: row.allowDangerous,
    output: row.output,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
async function audit(action, details) {
  try {
    await prisma.auditLog.create({ data: { action, details } });
  } catch (err) {
    log("error", "audit.failed", { action, error: err.message });
  }
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
    const recentMetrics = await prisma.metric.findMany({
      where: { agentId: agent.agentId },
      orderBy: { receivedAt: "desc" },
      take: 2,
    });
    const latest = recentMetrics[0] || null;
    const previous = recentMetrics[1] || null;
    const samples = await prisma.metric.count({
      where: { agentId: agent.agentId },
    });
    const pendingCommands = await prisma.command.count({
      where: {
        agentId: agent.agentId,
        status: { in: ["QUEUED", "IN_PROGRESS"] },
      },
    });
    const snapshot = latest?.snapshot || null;
    const previousSnapshot = previous?.snapshot || null;
    const elapsedSeconds = secondsBetween(
      latest?.receivedAt,
      previous?.receivedAt,
    );

    // Estas métricas do Oracle são contadores acumulados desde o STARTUP do banco.
    // Para dashboard/NOC, o correto é mostrar o delta entre a última coleta e a anterior.
    const dbTimeTotalSeconds = metricValue(snapshot, "DB_TIME_SECONDS");
    const previousDbTimeTotalSeconds = metricValue(
      previousSnapshot,
      "DB_TIME_SECONDS",
    );
    const dbCpuTotalSeconds = metricValue(snapshot, "DB_CPU_SECONDS");
    const previousDbCpuTotalSeconds = metricValue(
      previousSnapshot,
      "DB_CPU_SECONDS",
    );
    const redoTotalMb = metricValue(snapshot, "REDO_SIZE_MB");
    const previousRedoTotalMb = metricValue(previousSnapshot, "REDO_SIZE_MB");

    const dbTimeDeltaSeconds = previous
      ? positiveDelta(dbTimeTotalSeconds, previousDbTimeTotalSeconds)
      : 0;
    const dbCpuDeltaSeconds = previous
      ? positiveDelta(dbCpuTotalSeconds, previousDbCpuTotalSeconds)
      : 0;
    const redoDeltaMb = previous
      ? positiveDelta(redoTotalMb, previousRedoTotalMb)
      : 0;

    rows.push({
      agentId: agent.agentId,
      customerName: agent.customerName,
      environment: agent.environment,
      host: latest?.host || agent.host,
      dbName: latest?.dbName || agent.dbName,
      version: latest?.version || agent.version,
      lastSeenAt: latest?.receivedAt || agent.lastSeenAt,
      samples,
      pendingCommands,
      registered: true,
      latest: snapshot,
      backupStatus: normalizeBackupStatus(snapshot),
      activeSessions: metricValue(snapshot, "ACTIVE_SESSIONS"),
      blockedSessions: metricValue(snapshot, "BLOCKED_SESSIONS"),
      locksWaiting: metricValue(snapshot, "LOCKS_WAITING"),
      invalidObjects: metricValue(snapshot, "INVALID_OBJECTS"),
      longOps: metricValue(snapshot, "LONG_OPS"),
      maxTablespacePct: metricValue(snapshot, "TABLESPACE_MAX_USED_PCT"),
      // Totais brutos acumulados desde o startup do Oracle. Mantidos para diagnóstico.
      dbCpuTotalSeconds,
      dbTimeTotalSeconds,
      redoTotalMb,
      // Métricas corretas para visualização: delta da última coleta.
      metricsElapsedSeconds: round2(elapsedSeconds),
      dbCpuSeconds: round2(dbCpuDeltaSeconds),
      dbTimeSeconds: round2(dbTimeDeltaSeconds),
      dbTimePerSec:
        elapsedSeconds > 0 ? round2(dbTimeDeltaSeconds / elapsedSeconds) : 0,
      redoSizeMb: round2(redoDeltaMb),
      redoMbPerMin:
        elapsedSeconds > 0 ? round2((redoDeltaMb / elapsedSeconds) * 60) : 0,
      logicalReads: metricValue(snapshot, "LOGICAL_READS"),
      physicalReads: metricValue(snapshot, "PHYSICAL_READS"),
      executions: metricValue(snapshot, "EXECUTIONS"),
      parseCountTotal: metricValue(snapshot, "PARSE_COUNT_TOTAL"),
      pgaAllocMb: metricValue(snapshot, "PGA_ALLOC_MB"),
      sgaMb: metricValue(snapshot, "SGA_MB"),
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
    if (Number(item.locksWaiting || 0) > 0)
      alerts.push({
        level: "critical",
        agentId: item.agentId,
        message: `${prefix}: ${item.locksWaiting} locks em espera.`,
      });
    if (Number(item.invalidObjects || 0) > 0)
      alerts.push({
        level: "warning",
        agentId: item.agentId,
        message: `${prefix}: ${item.invalidObjects} objetos inválidos.`,
      });
    if (Number(item.longOps || 0) > 0)
      alerts.push({
        level: "warning",
        agentId: item.agentId,
        message: `${prefix}: ${item.longOps} operações longas em execução.`,
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
    const backup = item.backupStatus || {};
    if (backup.enabled && backup.status === "FAILED")
      alerts.push({
        level: "critical",
        agentId: item.agentId,
        message: `${prefix}: backup com falha. ${backup.message || ""}`.trim(),
      });
    else if (backup.enabled && backup.status === "WARNING")
      alerts.push({
        level: "warning",
        agentId: item.agentId,
        message: `${prefix}: backup em atenção. ${backup.message || ""}`.trim(),
      });
  }
  return alerts;
}
async function persistActiveAlerts(alerts) {
  for (const alert of alerts) {
    const recent = await prisma.alert.findFirst({
      where: {
        agentId: alert.agentId || null,
        message: alert.message,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (!recent)
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
  const commands = await prisma.command.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    ok: true,
    version: VERSION,
    persistence: "postgresql/prisma",
    clients,
    alerts,
    commands: commands.map(normalizeCommand),
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
function isDangerousSql(sql) {
  const s = String(sql || "").toLowerCase();
  return /\b(drop|truncate|shutdown|startup|alter\s+system|alter\s+database|delete\s+from|update\s+\w+\s+set)\b/.test(
    s,
  );
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  setCors(req, res);
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    const parsedUrl = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = parsedUrl.pathname.replace(/\/$/, "") || "/";
    if (req.method === "GET" && pathname === "/health") {
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
    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!username || !password)
        return send(res, 400, { ok: false, message: "Informe usuário e senha." });

      const user = await prisma.dashboardUser.findUnique({ where: { username } });
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        await audit("auth.login.failed", { username, ip: req.socket?.remoteAddress || null });
        return send(res, 401, { ok: false, message: "Usuário ou senha inválidos." });
      }

      const updatedUser = await prisma.dashboardUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      const token = createDashboardSession(updatedUser);
      await audit("auth.login.success", {
        userId: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
        ip: req.socket?.remoteAddress || null,
      });
      return send(res, 200, {
        ok: true,
        token,
        user: normalizeUser(updatedUser),
        expiresInMs: DASHBOARD_SESSION_TTL_MS,
      });
    }
    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const session = verifyDashboardSession(getBearer(req));
      if (session?.sid) dashboardSessions.delete(session.sid);
      return send(res, 200, { ok: true, message: "Sessão encerrada." });
    }
    const authUser = pathname.startsWith("/api/") ? auth(req) : null;
    if (pathname.startsWith("/api/") && !authUser)
      return send(res, 401, {
        ok: false,
        message: "Login necessário ou sessão expirada.",
      });
    if (req.method === "GET" && pathname === "/api/auth/me") {
      return send(res, 200, {
        ok: true,
        user: {
          id: authUser.userId || null,
          username: authUser.username,
          role: authUser.role,
          type: authUser.type,
        },
      });
    }
    if (req.method === "GET" && pathname === "/api/users") {
      if (!canManageUsers(authUser))
        return send(res, 403, { ok: false, message: "Apenas ADMIN pode listar usuários." });
      const rows = await prisma.dashboardUser.findMany({
        orderBy: [{ active: "desc" }, { username: "asc" }],
      });
      return send(res, 200, { ok: true, rows: rows.map(normalizeUser) });
    }
    if (req.method === "POST" && pathname === "/api/users") {
      if (!canManageUsers(authUser))
        return send(res, 403, { ok: false, message: "Apenas ADMIN pode criar usuários." });
      const body = await readJson(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = normalizeRole(body.role);
      if (!username || !password)
        return send(res, 400, { ok: false, message: "Informe usuário e senha." });
      if (!/^[a-z0-9._-]{3,40}$/.test(username))
        return send(res, 400, { ok: false, message: "Usuário deve ter 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou underline." });
      if (password.length < 8)
        return send(res, 400, { ok: false, message: "A senha deve ter no mínimo 8 caracteres." });
      const user = await prisma.dashboardUser.create({
        data: {
          name: String(body.name || username).trim(),
          username,
          email: body.email ? String(body.email).trim().toLowerCase() : null,
          passwordHash: hashPassword(password),
          role,
          active: body.active === undefined ? true : Boolean(body.active),
        },
      });
      await audit("dashboard.user.create", {
        by: authUser.username,
        user: normalizeUser(user),
      });
      return send(res, 201, { ok: true, user: normalizeUser(user) });
    }
    if (req.method === "PATCH" && req.url?.startsWith("/api/users/")) {
      if (!canManageUsers(authUser))
        return send(res, 403, { ok: false, message: "Apenas ADMIN pode alterar usuários." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = decodeURIComponent(url.pathname.replace("/api/users/", "")).trim();
      const body = await readJson(req);
      const data = {};
      if (body.password) {
        const password = String(body.password);
        if (password.length < 8)
          return send(res, 400, { ok: false, message: "A senha deve ter no mínimo 8 caracteres." });
        data.passwordHash = hashPassword(password);
      }
      if (body.name !== undefined) data.name = String(body.name || "").trim();
      if (body.email !== undefined) data.email = body.email ? String(body.email).trim().toLowerCase() : null;
      if (body.role !== undefined) data.role = normalizeRole(body.role);
      if (body.active !== undefined) data.active = Boolean(body.active);
      if (!Object.keys(data).length)
        return send(res, 400, { ok: false, message: "Nenhuma alteração informada." });
      const user = await prisma.dashboardUser.update({ where: { id: userId }, data });
      await audit("dashboard.user.update", {
        by: authUser.username,
        user: normalizeUser(user),
      });
      return send(res, 200, { ok: true, user: normalizeUser(user) });
    }
    if (req.method === "DELETE" && req.url?.startsWith("/api/users/")) {
      if (!canManageUsers(authUser))
        return send(res, 403, { ok: false, message: "Apenas ADMIN pode excluir usuários." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = decodeURIComponent(url.pathname.replace("/api/users/", "")).trim();
      if (authUser.userId === userId)
        return send(res, 400, { ok: false, message: "Você não pode excluir o próprio usuário logado." });
      const user = await prisma.dashboardUser.delete({ where: { id: userId } });
      await audit("dashboard.user.delete", { by: authUser.username, user: normalizeUser(user) });
      return send(res, 200, { ok: true, user: normalizeUser(user), message: "Usuário excluído." });
    }
    if (req.method === "GET" && pathname === "/api/realtime") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
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
    if (req.method === "DELETE" && req.url?.startsWith("/api/agents/")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = decodeURIComponent(
        url.pathname.replace("/api/agents/", ""),
      ).trim();
      if (!agentId)
        return send(res, 400, { ok: false, message: "agentId obrigatório." });
      await prisma.alert.deleteMany({ where: { agentId } });
      const result = await prisma.agent.deleteMany({ where: { agentId } });
      if (!result.count)
        return send(res, 404, {
          ok: false,
          message: "Cliente não encontrado.",
        });
      await audit("agent.delete", { agentId, deleted: result.count });
      broadcast("state", await currentState());
      return send(res, 200, {
        ok: true,
        deleted: result.count,
        message: "Cliente excluído com sucesso.",
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/metrics")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = Math.max(
        1,
        Math.min(1000, Number(url.searchParams.get("limit") || 200)),
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
      const agentId = String(body.agentId || "").trim();
      const sql = String(body.sql || "").trim();
      const allowDangerous = Boolean(body.allowDangerous);
      if (!agentId)
        return send(res, 400, { ok: false, message: "Informe o Agent." });
      if (!sql)
        return send(res, 400, { ok: false, message: "Informe o SQL/script." });
      const dangerous = isDangerousSql(sql);
      const status =
        dangerous && !allowDangerous ? "BLOCKED_REVIEW_REQUIRED" : "QUEUED";
      const note =
        dangerous && !allowDangerous
          ? "Script bloqueado por conter comando sensível. Marque liberação de comandos críticos para enfileirar."
          : body.note || "Script enfileirado para execução pelo Agent.";
      const command = await prisma.command.create({
        data: {
          agentId,
          type: body.type || "SQL_SCRIPT",
          sql,
          status,
          allowDangerous,
          note,
        },
      });
      await audit("script.queue", normalizeCommand(command));
      broadcast("command", normalizeCommand(command));
      return send(res, 201, {
        ok: status === "QUEUED",
        command: normalizeCommand(command),
        blocked: status !== "QUEUED",
        message: note,
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/scripts")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = url.searchParams.get("agentId") || undefined;
      const where = agentId ? { agentId } : {};
      const rows = await prisma.command.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return send(res, 200, { ok: true, rows: rows.map(normalizeCommand) });
    }
    if (
      req.method === "DELETE" &&
      req.url?.startsWith("/api/scripts/history")
    ) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = url.searchParams.get("agentId") || undefined;
      const where = {
        status: { notIn: ["QUEUED", "IN_PROGRESS"] },
        ...(agentId ? { agentId } : {}),
      };
      const result = await prisma.command.deleteMany({ where });
      await audit("script.history.clear", {
        agentId: agentId || null,
        deleted: result.count,
      });
      broadcast("state", await currentState());
      return send(res, 200, {
        ok: true,
        deleted: result.count,
        message: `${result.count} comando(s) removido(s) do histórico.`,
      });
    }
    if (req.method === "POST" && req.url === "/api/commands/claim") {
      const body = await readJson(req);
      const agentId = String(body.agentId || "").trim();
      if (!agentId)
        return send(res, 400, { ok: false, message: "agentId obrigatório." });
      const found = await prisma.command.findFirst({
        where: { status: "QUEUED", OR: [{ agentId }, { agentId: null }] },
        orderBy: { createdAt: "asc" },
      });
      if (!found) return send(res, 200, { ok: true, command: null });
      const claimed = await prisma.command.update({
        where: { id: found.id },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          note: found.note || `Reivindicado por ${agentId}`,
        },
      });
      await audit("command.claim", { id: claimed.id, agentId });
      broadcast("command", normalizeCommand(claimed));
      return send(res, 200, { ok: true, command: normalizeCommand(claimed) });
    }
    if (req.method === "POST" && req.url === "/api/commands/result") {
      const body = await readJson(req);
      const id = String(body.id || "").trim();
      if (!id)
        return send(res, 400, {
          ok: false,
          message: "id do comando obrigatório.",
        });
      const ok = Boolean(body.ok);
      const updated = await prisma.command.update({
        where: { id },
        data: {
          status: ok ? "SUCCESS" : "FAILED",
          output: body.output ? String(body.output).slice(0, 200000) : null,
          error: body.error ? String(body.error).slice(0, 200000) : null,
          finishedAt: new Date(),
        },
      });
      await audit("command.result", { id, ok, agentId: body.agentId || null });
      broadcast("command", normalizeCommand(updated));
      broadcast("state", await currentState());
      return send(res, 200, { ok: true, command: normalizeCommand(updated) });
    }
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
bootstrapDashboardAdmin()
  .catch((err) => log("error", "dashboard.bootstrap.failed", { error: err.message }))
  .finally(() => {
    server.listen(PORT, "0.0.0.0", () => {
      log("info", `Oracle DBA Central API v${VERSION} rodando`, {
        url: `http://0.0.0.0:${PORT}`,
        port: PORT,
        logFile: LOG_FILE,
      });
    });
  });
