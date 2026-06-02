"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const oracledb_1 = __importDefault(require("oracledb"));
const PORT = 3789;
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}
function send(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    res.end(JSON.stringify(data));
}
async function getConnection(config) {
    return oracledb_1.default.getConnection({
        user: config.user,
        password: config.password,
        connectString: config.connectString,
        privilege: config.sysdba ||
            String(config.user || "")
                .trim()
                .toUpperCase() === "SYS"
            ? oracledb_1.default.SYSDBA
            : undefined,
    });
}
async function testConnection(config) {
    let conn;
    try {
        conn = await getConnection(config);
        await conn.execute("SELECT 1 FROM dual");
        return { ok: true, message: "Conectado com sucesso." };
    }
    catch (err) {
        return { ok: false, message: err?.message ?? String(err) };
    }
    finally {
        if (conn)
            await conn.close();
    }
}
function splitSqlStatements(script) {
    const statements = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;
    let inLineComment = false;
    let inBlockComment = false;
    let line = 1;
    let statementStartLine = 1;
    function pushStatement(endLine) {
        const text = current.trim();
        if (text)
            statements.push({
                index: statements.length + 1,
                statement: text,
                startLine: statementStartLine,
                endLine,
            });
        current = "";
        statementStartLine = line;
    }
    for (let i = 0; i < script.length; i++) {
        const ch = script[i], next = script[i + 1];
        if (!current.trim() && ch.trim())
            statementStartLine = line;
        if (inLineComment) {
            current += ch;
            if (ch === "\n") {
                inLineComment = false;
                line++;
            }
            continue;
        }
        if (inBlockComment) {
            current += ch;
            if (ch === "\n")
                line++;
            if (ch === "*" && next === "/") {
                current += next;
                i++;
                inBlockComment = false;
            }
            continue;
        }
        if (!inSingle && !inDouble) {
            if (ch === "-" && next === "-") {
                current += ch + next;
                i++;
                inLineComment = true;
                continue;
            }
            if (ch === "/" && next === "*") {
                current += ch + next;
                i++;
                inBlockComment = true;
                continue;
            }
        }
        if (ch === "'" && !inDouble) {
            current += ch;
            if (inSingle && next === "'") {
                current += next;
                i++;
            }
            else
                inSingle = !inSingle;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }
        if (ch === ";" && !inSingle && !inDouble) {
            pushStatement(line);
            continue;
        }
        current += ch;
        if (ch === "\n")
            line++;
    }
    pushStatement(line);
    return statements.map((item, index) => ({ ...item, index: index + 1 }));
}
function normalizeStatement(stmt) {
    return stmt.trim().replace(/\s+/g, " ").toLowerCase();
}
function isUnsupportedCommand(stmt) {
    const s = normalizeStatement(stmt);
    return (s.startsWith("impdp ") || s.startsWith("expdp ") || s.startsWith("rman "));
}
function isSqlPlusAdminCommand(stmt) {
    const s = normalizeStatement(stmt);
    return s === "shutdown immediate" || s === "startup";
}
function sqlplusEscape(value) {
    return String(value || "").replace(/"/g, '""');
}
function getOracleErrorCode(err) {
    const msg = err?.message ? String(err.message) : String(err || "");
    const match = msg.match(/ORA-(\d{5})/i);
    return match ? match[1] : null;
}
function isIgnorableOracleError(stmt, err) {
    const normalized = normalizeStatement(stmt);
    const code = getOracleErrorCode(err);
    return ((normalized.startsWith("drop user ") && code === "01918") ||
        (normalized.startsWith("drop tablespace ") && code === "00959") ||
        (normalized.startsWith("drop role ") && code === "01919") ||
        (normalized.startsWith("drop profile ") && code === "02380"));
}
function convertSqlPlusCommand(stmt) {
    const s = normalizeStatement(stmt);
    if (s.startsWith("show parameter ")) {
        const term = stmt
            .trim()
            .replace(/^show\s+parameter\s+/i, "")
            .replace(/;$/, "")
            .trim();
        return `SELECT name, value, display_value FROM v$parameter WHERE LOWER(name) LIKE LOWER('%${term.replace(/'/g, "''")}%') ORDER BY name`;
    }
    if (s.startsWith("exec "))
        return `BEGIN ${stmt
            .trim()
            .replace(/^exec\s+/i, "")
            .replace(/;$/, "")}; END;`;
    return stmt;
}
function runSqlPlusAdminCommand(stmt, config) {
    return new Promise((resolve) => {
        const user = String(config.user || "").trim();
        if (user.toUpperCase() !== "SYS" && !config.sysdba) {
            resolve({
                ok: false,
                message: "Para executar SHUTDOWN/STARTUP, conecte como SYS AS SYSDBA.",
            });
            return;
        }
        const sqlplus = (0, node_child_process_1.spawn)("sqlplus", ["-S", "/nolog"], { windowsHide: true });
        let stdout = "", stderr = "";
        sqlplus.stdout.on("data", (d) => (stdout += d.toString()));
        sqlplus.stderr.on("data", (d) => (stderr += d.toString()));
        sqlplus.on("error", (err) => resolve({
            ok: false,
            message: "Não foi possível executar o sqlplus. Verifique se ele está instalado e no PATH. Detalhe: " +
                (err.message || err),
        }));
        sqlplus.on("close", (code) => {
            const output = `${stdout}\n${stderr}`.trim();
            if (code !== 0)
                return resolve({
                    ok: false,
                    message: output || `sqlplus retornou código ${code}.`,
                });
            if (/ORA-\d{5}/i.test(output) || /SP2-\d{4}/i.test(output))
                return resolve({ ok: false, message: output });
            resolve({
                ok: true,
                message: output || "Comando administrativo executado com sucesso.",
            });
        });
        const connectCmd = `connect ${sqlplusEscape(config.user)}/"${sqlplusEscape(config.password)}"@${config.connectString} as sysdba\n`;
        sqlplus.stdin.write(connectCmd);
        sqlplus.stdin.write(`${stmt.trim()};\n`);
        sqlplus.stdin.write("exit\n");
        sqlplus.stdin.end();
    });
}
async function executeScript(config, sql) {
    let conn;
    try {
        const statements = splitSqlStatements(sql).filter((item) => item.statement.trim());
        if (!statements.length)
            return { ok: false, message: "Nenhum comando SQL encontrado." };
        for (const item of statements)
            if (isUnsupportedCommand(item.statement))
                return {
                    ok: false,
                    message: "Comando de terminal gerado, não executável diretamente no banco: " +
                        item.statement,
                };
        let lastResult = null;
        let executedCount = 0;
        const warnings = [];
        const logs = [];
        for (let i = 0; i < statements.length; i++) {
            const item = statements[i];
            const rawStmt = item.statement;
            const startedAt = Date.now();
            try {
                if (isSqlPlusAdminCommand(rawStmt)) {
                    if (conn) {
                        try {
                            await conn.close();
                        }
                        catch { }
                        conn = null;
                    }
                    const adminResult = await runSqlPlusAdminCommand(rawStmt, config);
                    if (!adminResult.ok) {
                        logs.push({
                            index: i + 1,
                            line: item.startLine,
                            endLine: item.endLine,
                            status: "error",
                            statement: rawStmt,
                            message: adminResult.message,
                            durationMs: Date.now() - startedAt,
                        });
                        return {
                            ok: false,
                            message: adminResult.message,
                            failedStatement: rawStmt,
                            executedCount,
                            warningCount: warnings.length,
                            warnings,
                            logs,
                        };
                    }
                    executedCount++;
                    logs.push({
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        status: "success",
                        statement: rawStmt,
                        message: adminResult.message,
                        durationMs: Date.now() - startedAt,
                        rowsAffected: 0,
                        rowCount: 0,
                    });
                    continue;
                }
                if (!conn)
                    conn = await getConnection(config);
                const stmt = convertSqlPlusCommand(rawStmt);
                lastResult = await conn.execute(stmt, [], {
                    outFormat: oracledb_1.default.OUT_FORMAT_OBJECT,
                    autoCommit: false,
                });
                executedCount++;
                logs.push({
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    status: "success",
                    statement: rawStmt,
                    message: "Comando executado com sucesso.",
                    durationMs: Date.now() - startedAt,
                    rowsAffected: lastResult.rowsAffected || 0,
                    rowCount: (lastResult.rows || []).length,
                });
            }
            catch (err) {
                const message = err?.message ?? String(err);
                if (isIgnorableOracleError(rawStmt, err)) {
                    warnings.push({ statement: rawStmt, message });
                    logs.push({
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        status: "warning",
                        statement: rawStmt,
                        message,
                        durationMs: Date.now() - startedAt,
                    });
                    continue;
                }
                logs.push({
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    status: "error",
                    statement: rawStmt,
                    message,
                    durationMs: Date.now() - startedAt,
                });
                try {
                    if (conn)
                        await conn.rollback();
                }
                catch { }
                return {
                    ok: false,
                    message,
                    failedStatement: rawStmt,
                    executedCount,
                    warningCount: warnings.length,
                    warnings,
                    logs,
                };
            }
        }
        if (conn)
            await conn.commit();
        return {
            ok: true,
            executedCount,
            warningCount: warnings.length,
            warnings,
            logs,
            rows: lastResult?.rows ?? [],
            rowsAffected: lastResult?.rowsAffected ?? 0,
            metaData: lastResult?.metaData ?? [],
            lastResult: {
                rows: lastResult?.rows ?? [],
                rowsAffected: lastResult?.rowsAffected ?? 0,
                metaData: lastResult?.metaData ?? [],
            },
        };
    }
    catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            }
            catch { }
        }
        return { ok: false, message: err?.message ?? String(err) };
    }
    finally {
        if (conn)
            await conn.close();
    }
}
function sendStreamEvent(res, event) {
    res.write(JSON.stringify(event) + "\n");
    // Em alguns WebViews/proxies o chunk pode ficar em buffer; este flush ajuda
    // quando o consumidor usa o endpoint /execute-script-stream.
    if (typeof res.flush === "function")
        res.flush();
}
async function executeScriptStream(config, sql, res) {
    const globalStartedAt = Date.now();
    let conn;
    res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function")
        res.flushHeaders();
    res.write(": stream-open\n");
    try {
        const statements = splitSqlStatements(sql).filter((item) => item.statement.trim());
        if (!statements.length) {
            sendStreamEvent(res, {
                type: "fatal",
                message: "Nenhum comando SQL encontrado.",
                durationMs: Date.now() - globalStartedAt,
            });
            res.end();
            return;
        }
        for (const item of statements) {
            if (isUnsupportedCommand(item.statement)) {
                sendStreamEvent(res, {
                    type: "fatal",
                    message: "Comando de terminal gerado, não executável diretamente no banco: " +
                        item.statement,
                    durationMs: Date.now() - globalStartedAt,
                });
                res.end();
                return;
            }
        }
        sendStreamEvent(res, {
            type: "start",
            total: statements.length,
            startedAt: new Date(globalStartedAt).toISOString(),
        });
        let lastResult = null;
        let executedCount = 0;
        const warnings = [];
        const logs = [];
        for (let i = 0; i < statements.length; i++) {
            const item = statements[i];
            const rawStmt = item.statement;
            const startedAt = Date.now();
            sendStreamEvent(res, {
                type: "statement-start",
                index: i + 1,
                total: statements.length,
                line: item.startLine,
                endLine: item.endLine,
                statement: rawStmt,
                startedAt: new Date(startedAt).toISOString(),
            });
            try {
                if (isSqlPlusAdminCommand(rawStmt)) {
                    if (conn) {
                        try {
                            await conn.close();
                        }
                        catch { }
                        conn = null;
                    }
                    const adminResult = await runSqlPlusAdminCommand(rawStmt, config);
                    const durationMs = Date.now() - startedAt;
                    if (!adminResult.ok) {
                        logs.push({
                            index: i + 1,
                            line: item.startLine,
                            endLine: item.endLine,
                            status: "error",
                            statement: rawStmt,
                            message: adminResult.message,
                            durationMs,
                        });
                        sendStreamEvent(res, {
                            type: "statement-error",
                            index: i + 1,
                            line: item.startLine,
                            endLine: item.endLine,
                            statement: rawStmt,
                            durationMs,
                            message: adminResult.message,
                        });
                        sendStreamEvent(res, {
                            type: "done",
                            durationMs: Date.now() - globalStartedAt,
                            result: {
                                ok: false,
                                message: adminResult.message,
                                failedStatement: rawStmt,
                                executedCount,
                                warningCount: warnings.length,
                                warnings,
                                logs,
                            },
                        });
                        res.end();
                        return;
                    }
                    executedCount++;
                    logs.push({
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        status: "success",
                        statement: rawStmt,
                        message: adminResult.message,
                        durationMs,
                        rowsAffected: 0,
                        rowCount: 0,
                    });
                    sendStreamEvent(res, {
                        type: "statement-success",
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        statement: rawStmt,
                        durationMs,
                        rowsAffected: 0,
                        rowCount: 0,
                        message: adminResult.message,
                    });
                    continue;
                }
                if (!conn)
                    conn = await getConnection(config);
                const stmt = convertSqlPlusCommand(rawStmt);
                lastResult = await conn.execute(stmt, [], {
                    outFormat: oracledb_1.default.OUT_FORMAT_OBJECT,
                    autoCommit: false,
                });
                executedCount++;
                const durationMs = Date.now() - startedAt;
                const rowCount = (lastResult.rows || []).length;
                const rowsAffected = lastResult.rowsAffected || 0;
                logs.push({
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    status: "success",
                    statement: rawStmt,
                    message: "Comando executado com sucesso.",
                    durationMs,
                    rowsAffected,
                    rowCount,
                });
                sendStreamEvent(res, {
                    type: "statement-success",
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    statement: rawStmt,
                    durationMs,
                    rowsAffected,
                    rowCount,
                    message: "Comando executado com sucesso.",
                });
            }
            catch (err) {
                const message = err?.message ?? String(err);
                const durationMs = Date.now() - startedAt;
                if (isIgnorableOracleError(rawStmt, err)) {
                    warnings.push({ statement: rawStmt, message });
                    logs.push({
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        status: "warning",
                        statement: rawStmt,
                        message,
                        durationMs,
                    });
                    sendStreamEvent(res, {
                        type: "statement-warning",
                        index: i + 1,
                        line: item.startLine,
                        endLine: item.endLine,
                        statement: rawStmt,
                        durationMs,
                        message,
                    });
                    continue;
                }
                logs.push({
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    status: "error",
                    statement: rawStmt,
                    message,
                    durationMs,
                });
                sendStreamEvent(res, {
                    type: "statement-error",
                    index: i + 1,
                    line: item.startLine,
                    endLine: item.endLine,
                    statement: rawStmt,
                    durationMs,
                    message,
                });
                try {
                    if (conn)
                        await conn.rollback();
                }
                catch { }
                sendStreamEvent(res, {
                    type: "done",
                    durationMs: Date.now() - globalStartedAt,
                    result: {
                        ok: false,
                        message,
                        failedStatement: rawStmt,
                        executedCount,
                        warningCount: warnings.length,
                        warnings,
                        logs,
                    },
                });
                res.end();
                return;
            }
        }
        if (conn)
            await conn.commit();
        sendStreamEvent(res, {
            type: "done",
            durationMs: Date.now() - globalStartedAt,
            result: {
                ok: true,
                executedCount,
                warningCount: warnings.length,
                warnings,
                logs,
                rows: lastResult?.rows ?? [],
                rowsAffected: lastResult?.rowsAffected ?? 0,
                metaData: lastResult?.metaData ?? [],
                lastResult: {
                    rows: lastResult?.rows ?? [],
                    rowsAffected: lastResult?.rowsAffected ?? 0,
                    metaData: lastResult?.metaData ?? [],
                },
            },
        });
        res.end();
    }
    catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            }
            catch { }
        }
        sendStreamEvent(res, {
            type: "fatal",
            message: err?.message ?? String(err),
            durationMs: Date.now() - globalStartedAt,
        });
        res.end();
    }
    finally {
        if (conn)
            await conn.close();
    }
}
function batEscape(value) {
    return String(value || "")
        .replace(/\r?\n/g, " ")
        .replace(/"/g, '""');
}
function buildPatchBat(config) {
    const oracleHome = batEscape(config.oracleHome);
    const oracleSid = batEscape(config.oracleSid);
    const patchDir = batEscape(config.patchDir);
    const workRoot = batEscape(config.workRoot || config.patchDir);
    const listenerName = batEscape(config.listenerName || "LISTENER");
    const autoStartDb = config.autoStartDb === false ? "no" : "yes";
    const openAllPdbs = config.openAllPdbs === true ? "yes" : "no";
    return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Oracle 19c Patch Apply
net session >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Execute este processo como Administrador.
  exit /b 1
)
set "ORACLE_HOME=${oracleHome}"
set "ORACLE_SID=${oracleSid}"
set "PATCH_DIR=${patchDir}"
set "WORK_ROOT=${workRoot}"
set "LISTENER_NAME=${listenerName}"
set "AUTO_START_DB=${autoStartDb}"
set "OPEN_ALL_PDBS=${openAllPdbs}"
set "LOG_DIR=%WORK_ROOT%\\logs"
set "TMP_DIR=%WORK_ROOT%\\tmp"
set "MAIN_LOG=%LOG_DIR%\\run_patch.log"
set "OPATCH_BAT=%ORACLE_HOME%\\OPatch\\opatch.bat"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"
> "%MAIN_LOG%" echo ==== INICIO %date% %time% ====
call :log "ORACLE_HOME=%ORACLE_HOME%"
call :log "ORACLE_SID=%ORACLE_SID%"
call :log "PATCH_DIR=%PATCH_DIR%"
if not exist "%OPATCH_BAT%" goto fail_opatch
if not exist "%PATCH_DIR%" goto fail_patchdir
set "PATH=%ORACLE_HOME%\\perl\\bin;%ORACLE_HOME%\\OPatch;%ORACLE_HOME%\\bin;%PATH%"
set "PERL5LIB="
call :log "Validando versao do OPatch"
call :runbat "%OPATCH_BAT%" version || goto fail
call :log "Gerando inventario antes do patch"
call :runbat "%OPATCH_BAT%" lsinventory || goto fail
call :log "Validando conflitos"
call :runbat "%OPATCH_BAT%" prereq CheckConflictAgainstOHWithDetail -ph "%PATCH_DIR%" || goto fail
call :log "Tentando shutdown immediate via SQLPlus"
(
  echo whenever sqlerror exit sql.sqlcode
  echo connect / as sysdba
  echo shutdown immediate;
  echo exit
) > "%TMP_DIR%\\shutdown.sql"
sqlplus -s /nolog @"%TMP_DIR%\\shutdown.sql" >> "%MAIN_LOG%" 2>&1
call :log "Parando listener %LISTENER_NAME%"
lsnrctl stop %LISTENER_NAME% >> "%MAIN_LOG%" 2>&1
call :log "Parando servicos Oracle conhecidos"
net stop OracleService%ORACLE_SID% >> "%MAIN_LOG%" 2>&1
net stop OracleVssWriter%ORACLE_SID% >> "%MAIN_LOG%" 2>&1
net stop OracleRemExecService >> "%MAIN_LOG%" 2>&1
net stop OracleOraDB19Home1TNSListener >> "%MAIN_LOG%" 2>&1
net stop OracleOraDB19Home1MTSRecoveryService >> "%MAIN_LOG%" 2>&1
for /f "tokens=2 delims=: " %%S in ('sc query state^= all ^| findstr /i "SERVICE_NAME: Oracle"') do net stop "%%S" >> "%MAIN_LOG%" 2>&1
net stop msdtc >> "%MAIN_LOG%" 2>&1
taskkill /f /im tnslsnr.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im oracle.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im sqlplus.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im oravssw.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im omtsreco.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im msdtc.exe >> "%MAIN_LOG%" 2>&1
timeout /t 5 /nobreak >nul 2>&1
call :log "Aplicando patch com OPatch"
call :runbat "%OPATCH_BAT%" apply -silent "%PATCH_DIR%" || goto fail
if /I "%AUTO_START_DB%"=="yes" (
  call :log "Subindo banco"
  (
    echo whenever sqlerror exit sql.sqlcode
    echo connect / as sysdba
    echo startup;
    if /I "%OPEN_ALL_PDBS%"=="yes" echo alter pluggable database all open;
    echo exit
  ) > "%TMP_DIR%\\startup.sql"
  sqlplus -s /nolog @"%TMP_DIR%\\startup.sql" >> "%MAIN_LOG%" 2>&1
  if errorlevel 1 goto fail
  pushd "%ORACLE_HOME%\\OPatch" || goto fail
  datapatch -sanity_checks >> "%MAIN_LOG%" 2>&1
  datapatch -verbose >> "%MAIN_LOG%" 2>&1
  if errorlevel 1 ( popd & goto fail )
  popd
  call :runbat "%OPATCH_BAT%" lspatches || goto fail
)
call :log "PATCH APLICADO COM SUCESSO"
echo LOG_PATH=%MAIN_LOG%
exit /b 0
:runbat
call :log "Executando BAT: %~1 %~2 %~3 %~4 %~5 %~6 %~7 %~8 %~9"
call "%~1" %~2 %~3 %~4 %~5 %~6 %~7 %~8 %~9 >> "%MAIN_LOG%" 2>&1
exit /b %errorlevel%
:log
echo [%date% %time%] %~1
>> "%MAIN_LOG%" echo [%date% %time%] %~1
exit /b 0
:fail_opatch
call :log "ERRO: OPatch nao encontrado em %OPATCH_BAT%"
goto fail_end
:fail_patchdir
call :log "ERRO: Pasta do patch nao encontrada: %PATCH_DIR%"
goto fail_end
:fail
call :log "ERRO na execucao. Consulte o log."
goto fail_end
:fail_end
echo LOG_PATH=%MAIN_LOG%
exit /b 1
`;
}
function runPatchProcess(config) {
    return new Promise((resolve) => {
        try {
            const missing = [];
            if (!String(config?.oracleHome || "").trim())
                missing.push("Oracle Home");
            if (!String(config?.oracleSid || "").trim())
                missing.push("Oracle SID");
            if (!String(config?.patchDir || "").trim())
                missing.push("Diretório do patch");
            if (missing.length)
                return resolve({
                    ok: false,
                    message: "Preencha: " + missing.join(", ") + ".",
                });
            const tempBat = node_path_1.default.join(node_os_1.default.tmpdir(), `oracle_patch_${Date.now()}.bat`);
            node_fs_1.default.writeFileSync(tempBat, buildPatchBat(config), "utf8");
            const child = (0, node_child_process_1.spawn)("cmd.exe", ["/c", tempBat], {
                windowsHide: true,
                cwd: String(config.workRoot || config.patchDir || node_os_1.default.tmpdir()),
            });
            let output = "", logPath = "";
            const appendChunk = (chunk) => {
                const t = chunk.toString();
                output += t;
                const m = t.match(/LOG_PATH=([^\r\n]+)/);
                if (m)
                    logPath = m[1].trim();
            };
            child.stdout.on("data", appendChunk);
            child.stderr.on("data", appendChunk);
            child.on("error", (err) => resolve({
                ok: false,
                code: -1,
                message: err.message || String(err),
                output,
                logPath,
                logs: [
                    {
                        index: 1,
                        status: "error",
                        statement: "Aplicação de patch Oracle",
                        message: err.message || String(err),
                        durationMs: 0,
                    },
                ],
            }));
            child.on("close", (code) => {
                const ok = code === 0;
                resolve({
                    ok,
                    code,
                    message: ok
                        ? "Patch aplicado com sucesso."
                        : `Falha ao aplicar patch. Código ${code}.`,
                    output: output.trim(),
                    logPath,
                    logs: [
                        {
                            index: 1,
                            status: ok ? "success" : "error",
                            statement: "Aplicação de patch Oracle",
                            message: output.trim() ||
                                (ok
                                    ? "Patch aplicado com sucesso."
                                    : `Falha ao aplicar patch. Código ${code}.`),
                            durationMs: 0,
                        },
                    ],
                });
            });
        }
        catch (err) {
            resolve({
                ok: false,
                code: -1,
                message: err?.message ?? String(err),
                output: "",
                logPath: "",
                logs: [
                    {
                        index: 1,
                        status: "error",
                        statement: "Aplicação de patch Oracle",
                        message: err?.message ?? String(err),
                        durationMs: 0,
                    },
                ],
            });
        }
    });
}
function getPatchLogPath(config) {
    const workRoot = String(config?.workRoot || config?.patchDir || node_os_1.default.tmpdir());
    return node_path_1.default.join(workRoot, "logs", "run_patch.log");
}
function writeJsonLine(res, event) {
    res.write(`${JSON.stringify(event)}\n`);
}
function sendPatchLogLines(res, text, startedAt) {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const line of normalized.split("\n")) {
        if (line.trim())
            writeJsonLine(res, {
                type: "log",
                line,
                elapsedMs: Date.now() - startedAt,
            });
    }
}
async function runPatchProcessStream(config, res) {
    const startedAt = Date.now();
    res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "X-Accel-Buffering": "no",
    });
    try {
        const missing = [];
        if (!String(config?.oracleHome || "").trim())
            missing.push("Oracle Home");
        if (!String(config?.oracleSid || "").trim())
            missing.push("Oracle SID");
        if (!String(config?.patchDir || "").trim())
            missing.push("Diretório do patch");
        if (missing.length) {
            writeJsonLine(res, {
                type: "fatal",
                message: "Preencha: " + missing.join(", ") + ".",
                durationMs: Date.now() - startedAt,
            });
            return res.end();
        }
        const logPath = getPatchLogPath(config);
        writeJsonLine(res, {
            type: "start",
            startedAt: new Date(startedAt).toISOString(),
            logPath,
        });
        const tempBat = node_path_1.default.join(node_os_1.default.tmpdir(), `oracle_patch_${Date.now()}.bat`);
        node_fs_1.default.writeFileSync(tempBat, buildPatchBat(config), "utf8");
        let output = "";
        let fileOffset = 0;
        let poller;
        const flushLogFile = () => {
            try {
                if (!node_fs_1.default.existsSync(logPath))
                    return;
                const stat = node_fs_1.default.statSync(logPath);
                if (stat.size < fileOffset)
                    fileOffset = 0;
                if (stat.size === fileOffset)
                    return;
                const fd = node_fs_1.default.openSync(logPath, "r");
                const buffer = Buffer.alloc(stat.size - fileOffset);
                node_fs_1.default.readSync(fd, buffer, 0, buffer.length, fileOffset);
                node_fs_1.default.closeSync(fd);
                fileOffset = stat.size;
                sendPatchLogLines(res, buffer.toString("utf8"), startedAt);
            }
            catch (err) {
                writeJsonLine(res, {
                    type: "log",
                    line: `[AVISO] Não foi possível ler o log em tempo real: ${err?.message ?? String(err)}`,
                    elapsedMs: Date.now() - startedAt,
                });
            }
        };
        const child = (0, node_child_process_1.spawn)("cmd.exe", ["/c", tempBat], {
            windowsHide: true,
            cwd: String(config.workRoot || config.patchDir || node_os_1.default.tmpdir()),
        });
        poller = setInterval(flushLogFile, 500);
        const appendChunk = (chunk) => {
            const text = chunk.toString();
            output += text;
            sendPatchLogLines(res, text, startedAt);
        };
        child.stdout.on("data", appendChunk);
        child.stderr.on("data", appendChunk);
        child.on("error", (err) => {
            if (poller)
                clearInterval(poller);
            flushLogFile();
            const message = err.message || String(err);
            writeJsonLine(res, {
                type: "fatal",
                message,
                durationMs: Date.now() - startedAt,
            });
            res.end();
        });
        child.on("close", (code) => {
            if (poller)
                clearInterval(poller);
            flushLogFile();
            const ok = code === 0;
            const durationMs = Date.now() - startedAt;
            const result = {
                ok,
                code,
                message: ok
                    ? "Patch aplicado com sucesso."
                    : `Falha ao aplicar patch. Código ${code}.`,
                output: output.trim(),
                logPath,
                logs: [
                    {
                        index: 1,
                        status: ok ? "success" : "error",
                        statement: "Aplicação de patch Oracle",
                        message: output.trim() ||
                            (ok
                                ? "Patch aplicado com sucesso."
                                : `Falha ao aplicar patch. Código ${code}.`),
                        durationMs,
                    },
                ],
            };
            writeJsonLine(res, { type: "done", result, durationMs });
            res.end();
        });
    }
    catch (err) {
        writeJsonLine(res, {
            type: "fatal",
            message: err?.message ?? String(err),
            durationMs: Date.now() - startedAt,
        });
        res.end();
    }
}
const agentState = {
    running: false,
    intervalSeconds: 30,
    samplesCollected: 0,
};
const AGENT_OVERVIEW_SQL = `
SELECT 'ACTIVE_SESSIONS' AS metric, COUNT(*) AS value, 'Sessões ativas' AS label
FROM v$session
WHERE status = 'ACTIVE' AND type = 'USER'
UNION ALL
SELECT 'BLOCKED_SESSIONS' AS metric, COUNT(*) AS value, 'Sessões bloqueadas' AS label
FROM v$session
WHERE blocking_session IS NOT NULL
UNION ALL
SELECT 'LOCKS_WAITING' AS metric, COUNT(*) AS value, 'Locks em espera' AS label
FROM v$lock
WHERE request > 0
UNION ALL
SELECT 'INVALID_OBJECTS' AS metric, COUNT(*) AS value, 'Objetos inválidos' AS label
FROM dba_objects
WHERE status = 'INVALID'
UNION ALL
SELECT 'TABLESPACE_MAX_USED_PCT' AS metric, ROUND(MAX(used_percent), 2) AS value, 'Maior uso de tablespace (%)' AS label
FROM dba_tablespace_usage_metrics
UNION ALL
SELECT 'LONG_OPS' AS metric, COUNT(*) AS value, 'Operações longas ativas' AS label
FROM v$session_longops
WHERE totalwork > 0 AND sofar < totalwork
`;
const AGENT_TABLESPACE_SQL = `
SELECT * FROM (
  SELECT tablespace_name,
         ROUND(used_percent, 2) AS used_percent,
         tablespace_size,
         used_space
  FROM dba_tablespace_usage_metrics
  ORDER BY used_percent DESC
) WHERE ROWNUM <= 10
`;
const AGENT_WAITS_SQL = `
SELECT * FROM (
  SELECT event, total_waits, ROUND(time_waited / 100, 2) AS seconds_waited
  FROM v$system_event
  WHERE wait_class <> 'Idle'
  ORDER BY time_waited DESC
) WHERE ROWNUM <= 10
`;
const AGENT_TOP_SQL = `
SELECT * FROM (
  SELECT sql_id,
         executions,
         ROUND(elapsed_time / 1000000, 2) AS elapsed_seconds,
         ROUND(cpu_time / 1000000, 2) AS cpu_seconds,
         SUBSTR(sql_text, 1, 160) AS sql_text
  FROM v$sql
  WHERE sql_text IS NOT NULL
  ORDER BY elapsed_time DESC
) WHERE ROWNUM <= 10
`;
function agentDataDir() {
    const dir = node_path_1.default.join(process.cwd(), "agent-data");
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function agentMetricsFile() {
    return node_path_1.default.join(agentDataDir(), "metrics.jsonl");
}
async function runAgentSql(conn, sql) {
    const result = await conn.execute(sql, [], {
        outFormat: oracledb_1.default.OUT_FORMAT_OBJECT,
    });
    return result.rows || [];
}
async function collectAgentSnapshot(config) {
    let conn;
    const collectedAt = new Date().toISOString();
    try {
        conn = await getConnection(config);
        const overview = await runAgentSql(conn, AGENT_OVERVIEW_SQL);
        const tablespaces = await runAgentSql(conn, AGENT_TABLESPACE_SQL);
        const waits = await runAgentSql(conn, AGENT_WAITS_SQL);
        const topSql = await runAgentSql(conn, AGENT_TOP_SQL);
        return {
            ok: true,
            collectedAt,
            host: node_os_1.default.hostname(),
            overview,
            tablespaces,
            waits,
            topSql,
        };
    }
    catch (err) {
        return {
            ok: false,
            collectedAt,
            host: node_os_1.default.hostname(),
            message: err?.message ?? String(err),
        };
    }
    finally {
        if (conn)
            await conn.close();
    }
}
function persistAgentSnapshot(snapshot) {
    node_fs_1.default.appendFileSync(agentMetricsFile(), `${JSON.stringify(snapshot)}\n`, "utf8");
}
async function collectAndPersistAgentSnapshot() {
    if (!agentState.config)
        return;
    const snapshot = await collectAgentSnapshot(agentState.config);
    agentState.lastRunAt = snapshot.collectedAt;
    agentState.samplesCollected += snapshot.ok ? 1 : 0;
    agentState.lastError = snapshot.ok ? undefined : snapshot.message;
    persistAgentSnapshot(snapshot);
}
async function startAgentCollector(body) {
    const config = body?.config;
    const intervalSeconds = Math.max(10, Number(body?.intervalSeconds || 30));
    if (!config?.user || !config?.connectString)
        return {
            ok: false,
            message: "Informe uma conexão Oracle válida antes de iniciar o Agent.",
        };
    if (agentState.timer)
        clearInterval(agentState.timer);
    agentState.running = true;
    agentState.intervalSeconds = intervalSeconds;
    agentState.startedAt = new Date().toISOString();
    agentState.lastError = undefined;
    agentState.samplesCollected = 0;
    agentState.config = config;
    await collectAndPersistAgentSnapshot();
    agentState.timer = setInterval(() => {
        collectAndPersistAgentSnapshot().catch((err) => {
            agentState.lastError = err?.message ?? String(err);
        });
    }, intervalSeconds * 1000);
    return {
        ok: true,
        message: `Agent coletor iniciado. Intervalo: ${intervalSeconds}s.`,
        status: getAgentStatus(),
    };
}
function stopAgentCollector() {
    if (agentState.timer)
        clearInterval(agentState.timer);
    agentState.timer = undefined;
    agentState.running = false;
    return {
        ok: true,
        message: "Agent coletor parado.",
        status: getAgentStatus(),
    };
}
function getAgentStatus() {
    return {
        running: agentState.running,
        intervalSeconds: agentState.intervalSeconds,
        startedAt: agentState.startedAt,
        lastRunAt: agentState.lastRunAt,
        lastError: agentState.lastError,
        samplesCollected: agentState.samplesCollected,
        metricsFile: agentMetricsFile(),
        host: node_os_1.default.hostname(),
    };
}
function readRecentAgentMetrics(limit = 20) {
    const file = agentMetricsFile();
    if (!node_fs_1.default.existsSync(file))
        return [];
    const lines = node_fs_1.default.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(200, limit))).map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return {
                ok: false,
                message: "Linha inválida no arquivo de métricas.",
                raw: line,
            };
        }
    });
}
const server = node_http_1.default.createServer(async (req, res) => {
    if (req.method === "OPTIONS")
        return send(res, 200, {});
    try {
        if (req.method === "GET" && req.url === "/health")
            return send(res, 200, { ok: true, message: "Oracle Bridge ativo." });
        if (req.method === "GET" && req.url === "/agent/status")
            return send(res, 200, { ok: true, status: getAgentStatus() });
        if (req.method === "GET" && req.url?.startsWith("/agent/metrics")) {
            const url = new URL(req.url, "http://127.0.0.1");
            return send(res, 200, {
                ok: true,
                rows: readRecentAgentMetrics(Number(url.searchParams.get("limit") || 20)),
            });
        }
        if (req.method === "POST" && req.url === "/agent/start")
            return send(res, 200, await startAgentCollector(await readBody(req)));
        if (req.method === "POST" && req.url === "/agent/stop")
            return send(res, 200, stopAgentCollector());
        if (req.method === "POST" && req.url === "/agent/collect-once") {
            const body = await readBody(req);
            const snapshot = await collectAgentSnapshot(body.config);
            persistAgentSnapshot(snapshot);
            return send(res, 200, {
                ok: snapshot.ok,
                snapshot,
                status: getAgentStatus(),
            });
        }
        if (req.method === "POST" && req.url === "/test-connection")
            return send(res, 200, await testConnection(await readBody(req)));
        if (req.method === "POST" && req.url === "/execute") {
            const payload = (await readBody(req));
            return send(res, 200, await executeScript(payload.config, payload.sql ?? ""));
        }
        if (req.method === "POST" && req.url === "/execute-script") {
            const payload = (await readBody(req));
            return send(res, 200, await executeScript(payload.config, payload.sql ?? ""));
        }
        if (req.method === "POST" && req.url === "/execute-script-stream") {
            const payload = (await readBody(req));
            return executeScriptStream(payload.config, payload.sql ?? "", res);
        }
        if (req.method === "POST" && req.url === "/run-patch")
            return send(res, 200, await runPatchProcess(await readBody(req)));
        if (req.method === "POST" && req.url === "/run-patch-stream")
            return runPatchProcessStream(await readBody(req), res);
        return send(res, 404, { ok: false, message: "Rota não encontrada." });
    }
    catch (err) {
        return send(res, 500, { ok: false, message: err?.message ?? String(err) });
    }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Oracle bridge ativo em http://127.0.0.1:${PORT}`));
