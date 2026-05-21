const { contextBridge } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let oracledb = null;
let preloadError = null;

try {
  oracledb = require("oracledb");
} catch (err) {
  preloadError = err && err.message ? err.message : String(err);
}

function splitSqlStatements(script) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const next = script[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += ch;
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
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}

function normalizeStatement(stmt) {
  return stmt.trim().replace(/\s+/g, " ").toLowerCase();
}

function isUnsupportedCommand(stmt) {
  const s = normalizeStatement(stmt);
  return (
    s.startsWith("impdp ") ||
    s.startsWith("expdp ") ||
    s.startsWith("rman ")
  );
}

function isSqlPlusAdminCommand(stmt) {
  const s = normalizeStatement(stmt);
  return s === "shutdown immediate" || s === "startup";
}

function sqlplusEscape(value) {
  return String(value || "").replace(/"/g, '""');
}

function runSqlPlusAdminCommand(stmt, config) {
  return new Promise((resolve) => {
    const user = String(config.user || "").trim();
    if (user.toUpperCase() !== "SYS") {
      resolve({
        ok: false,
        message: "Para executar SHUTDOWN/STARTUP pelo sistema, conecte como SYS AS SYSDBA.",
      });
      return;
    }

    const sqlplus = spawn("sqlplus", ["-S", "/nolog"], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    sqlplus.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    sqlplus.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    sqlplus.on("error", (err) => {
      resolve({
        ok: false,
        message: "Não foi possível executar o sqlplus. Verifique se ele está instalado e no PATH. Detalhe: " + (err.message || err),
      });
    });

    sqlplus.on("close", (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      if (code !== 0) {
        resolve({
          ok: false,
          message: output || `sqlplus retornou código ${code}.`,
        });
        return;
      }

      if (/ORA-\d{5}/i.test(output) || /SP2-\d{4}/i.test(output)) {
        resolve({
          ok: false,
          message: output,
        });
        return;
      }

      resolve({ ok: true, message: output || "Comando administrativo executado com sucesso." });
    });

    const connectCmd = `connect ${sqlplusEscape(config.user)}/"${sqlplusEscape(config.password)}"@${config.connectString} as sysdba\n`;
    sqlplus.stdin.write(connectCmd);
    sqlplus.stdin.write(`${stmt.trim()};\n`);
    sqlplus.stdin.write("exit\n");
    sqlplus.stdin.end();
  });
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

call :log "Parando qualquer servico Oracle restante"
for /f "tokens=2 delims=: " %%S in ('sc query state^= all ^| findstr /i "SERVICE_NAME: Oracle"') do (
  echo Tentando parar %%S>> "%MAIN_LOG%"
  net stop "%%S" >> "%MAIN_LOG%" 2>&1
)

call :log "Parando MSDTC"
net stop msdtc >> "%MAIN_LOG%" 2>&1

call :log "Encerrando processos Oracle remanescentes"
taskkill /f /im tnslsnr.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im oracle.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im sqlplus.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im oravssw.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im omtsreco.exe >> "%MAIN_LOG%" 2>&1
taskkill /f /im msdtc.exe >> "%MAIN_LOG%" 2>&1

call :log "Aguardando liberacao de arquivos"
timeout /t 5 /nobreak >nul 2>&1

call :log "Servicos Oracle ainda existentes"
sc query state= all | findstr /i Oracle >> "%MAIN_LOG%" 2>&1

call :log "Processos Oracle ainda existentes"
tasklist | findstr /i "oracle tnslsnr ora_ oravssw omtsreco" >> "%MAIN_LOG%" 2>&1

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

  call :log "Executando datapatch -sanity_checks"
  pushd "%ORACLE_HOME%\\OPatch" || goto fail
  datapatch -sanity_checks >> "%MAIN_LOG%" 2>&1

  call :log "Executando datapatch -verbose"
  datapatch -verbose >> "%MAIN_LOG%" 2>&1
  if errorlevel 1 (
    popd
    goto fail
  )
  popd

  call :log "Consultando DBA_REGISTRY_SQLPATCH"
  (
    echo set lines 220
    echo col action format a12
    echo col status format a12
    echo col description format a70
    echo select patch_id, action, status, description from dba_registry_sqlpatch order by action_time desc;
    echo exit
  ) > "%TMP_DIR%\\sqlpatch_check.sql"

  sqlplus -s / as sysdba @"%TMP_DIR%\\sqlpatch_check.sql" >> "%MAIN_LOG%" 2>&1

  call :log "Validando patches binarios"
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
      if (!config || !String(config.oracleHome || "").trim()) missing.push("Oracle Home");
      if (!config || !String(config.oracleSid || "").trim()) missing.push("Oracle SID");
      if (!config || !String(config.patchDir || "").trim()) missing.push("Diretório do patch");
      if (missing.length) {
        resolve({ ok: false, message: "Preencha: " + missing.join(", ") + "." });
        return;
      }

      const tempBat = path.join(os.tmpdir(), `oracle_patch_${Date.now()}.bat`);
      fs.writeFileSync(tempBat, buildPatchBat(config), "utf8");

      const child = spawn("cmd.exe", ["/c", tempBat], {
        windowsHide: true,
        cwd: String(config.workRoot || config.patchDir || os.tmpdir())
      });

      let output = "";
      let logPath = "";

      const appendChunk = (chunk) => {
        const text = chunk.toString();
        output += text;
        const match = text.match(/LOG_PATH=([^\r\n]+)/);
        if (match) logPath = match[1].trim();
      };

      child.stdout.on("data", appendChunk);
      child.stderr.on("data", appendChunk);

      child.on("error", (err) => {
        const message = err && err.message ? err.message : String(err);
        resolve({
          ok: false,
          code: -1,
          message,
          output,
          logPath,
          logs: [{
            index: 1,
            status: "error",
            statement: "Aplicação de patch Oracle",
            message,
            durationMs: 0
          }]
        });
      });

      child.on("close", (code) => {
        const ok = code === 0;
        resolve({
          ok,
          code,
          message: ok ? "Patch aplicado com sucesso." : `Falha ao aplicar patch. Código ${code}.`,
          output: output.trim(),
          logPath,
          logs: [{
            index: 1,
            status: ok ? "success" : "error",
            statement: "Aplicação de patch Oracle",
            message: output.trim() || (ok ? "Patch aplicado com sucesso." : `Falha ao aplicar patch. Código ${code}.`),
            durationMs: 0
          }]
        });
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      resolve({
        ok: false,
        code: -1,
        message,
        output: "",
        logPath: "",
        logs: [{
          index: 1,
          status: "error",
          statement: "Aplicação de patch Oracle",
          message,
          durationMs: 0
        }]
      });
    }
  });
}

function getOracleErrorCode(err) {
  const msg = err && err.message ? String(err.message) : String(err || "");
  const match = msg.match(/ORA-(\d{5})/i);
  return match ? match[1] : null;
}

function isIgnorableOracleError(stmt, err) {
  const normalized = normalizeStatement(stmt);
  const code = getOracleErrorCode(err);

  if (normalized.startsWith("drop user ") && code === "01918") {
    return true;
  }

  if (normalized.startsWith("drop tablespace ") && code === "00959") {
    return true;
  }

  if (normalized.startsWith("drop role ") && code === "01919") {
    return true;
  }

  if (normalized.startsWith("drop profile ") && code === "02380") {
    return true;
  }

  return false;
}

async function getAiDbContext(config) {
  if (preloadError) {
    return { connected: false, error: "Falha ao carregar oracledb: " + preloadError };
  }

  if (!config || !config.user || !config.password || !config.connectString) {
    return { connected: false };
  }

  let conn;
  try {
    const connConfig = {
      user: config.user,
      password: config.password,
      connectString: config.connectString,
    };

    if ((config.user || "").trim().toUpperCase() === "SYS") {
      connConfig.privilege = oracledb.SYSDBA;
    }

    conn = await oracledb.getConnection(connConfig);

    const versionResult = await conn.execute(`SELECT banner FROM v$version WHERE rownum = 1`, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const instanceResult = await conn.execute(`SELECT instance_name, host_name, version, status FROM v$instance`, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const tsMetricsResult = await conn.execute(`SELECT tablespace_name, used_percent FROM dba_tablespace_usage_metrics ORDER BY used_percent DESC FETCH FIRST 10 ROWS ONLY`, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const datafilesResult = await conn.execute(`SELECT tablespace_name, file_name, autoextensible FROM dba_data_files ORDER BY tablespace_name, file_name FETCH FIRST 20 ROWS ONLY`, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return {
      connected: true,
      versionBanner: versionResult.rows || [],
      instance: instanceResult.rows || [],
      tablespaces: tsMetricsResult.rows || [],
      datafiles: datafilesResult.rows || [],
    };
  } catch (err) {
    return {
      connected: true,
      contextError: err && err.message ? err.message : String(err),
    };
  } finally {
    if (conn) {
      try { await conn.close(); } catch {}
    }
  }
}

function buildAiPrompt(userRequest, dbContext) {
  return `Você é um assistente Oracle DBA especializado em Oracle 19c/21c/23ai/26ai.

Tarefa do usuário:
${userRequest}

Contexto do banco:
${JSON.stringify(dbContext, null, 2)}

Regras obrigatórias:
- Gere SQL Oracle válido e objetivo.
- Se o usuário pedir comando de terminal como impdp/expdp/rman, devolva no array sql exatamente como texto de terminal.
- Não invente nomes de objetos fora do contexto do banco, a menos que o pedido peça explicitamente.
- Nunca use markdown.
- Responda somente em JSON válido.
- O campo risk deve ser: low, medium, high ou critical.
- O campo sql deve ser um array de comandos.
- O campo requires_review deve ser true para qualquer comando que altere usuários, tablespaces, memória, datafiles, parâmetros ou sessões.
- O campo warnings deve conter alertas objetivos quando houver risco ou falta de contexto.

Formato obrigatório:
{
  "title": "string",
  "description": "string",
  "category": "string",
  "risk": "low|medium|high|critical",
  "requires_review": true,
  "warnings": ["string"],
  "sql": ["string"]
}`;
}

function extractTextFromAiResponse(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      if (!Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (typeof content.text === "string") parts.push(content.text);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

function parseAiJsonText(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    throw new Error("A IA não retornou conteúdo.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("A IA não retornou JSON válido.");
  }
}

function validateAiPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Resposta da IA inválida.");
  }
  if (!parsed.title || !parsed.description) {
    throw new Error("Resposta da IA incompleta.");
  }
  if (!Array.isArray(parsed.sql) || !parsed.sql.length) {
    throw new Error("A IA não retornou comandos.");
  }
  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  parsed.requires_review = Boolean(parsed.requires_review);
  return parsed;
}

function analyzeAiRisk(sqlList = []) {
  const joined = sqlList.join("\n").toUpperCase();
  if (/SHUTDOWN|STARTUP|DROP DATABASE/.test(joined)) {
    return { level: "critical", blocked: true, reason: "Comando crítico bloqueado." };
  }
  if (/DELETE\s+FROM/.test(joined) && !/WHERE/.test(joined)) {
    return { level: "critical", blocked: true, reason: "DELETE sem WHERE foi bloqueado." };
  }
  if (/ALTER SYSTEM|DROP USER|DROP TABLESPACE|TRUNCATE/.test(joined)) {
    return { level: "critical", blocked: false, reason: "Exige revisão antes de aplicar." };
  }
  if (/CREATE USER|ALTER USER|GRANT|REVOKE|ALTER TABLESPACE|ALTER DATABASE|KILL SESSION/.test(joined)) {
    return { level: "high", blocked: false, reason: "Mudança estrutural/administrativa." };
  }
  if (/INSERT|UPDATE|DELETE/.test(joined)) {
    return { level: "high", blocked: false, reason: "Altera dados." };
  }
  if (/SELECT|SHOW PARAMETER/.test(joined)) {
    return { level: "low", blocked: false, reason: "Consulta/diagnóstico." };
  }
  return { level: "medium", blocked: false, reason: "Revisão recomendada." };
}

async function generateAiScript(payload) {
  const apiKey = String(payload?.apiKey || "").trim();
  const model = String(payload?.model || "gpt-5.4").trim();
  const userRequest = String(payload?.userRequest || "").trim();
  const apiBaseUrl = String(payload?.apiBaseUrl || "https://api.openai.com/v1/responses").trim();

  if (!apiKey) throw new Error("Informe a chave da API no módulo Assistente IA.");
  if (!userRequest) throw new Error("Descreva o que você quer fazer.");

  const dbContext = await getAiDbContext(payload?.connection || null);
  const prompt = buildAiPrompt(userRequest, dbContext);

  const response = await fetch(apiBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("Erro ao chamar a IA: " + text);
  }

  const data = await response.json();
  const rawText = extractTextFromAiResponse(data);
  const parsed = validateAiPayload(parseAiJsonText(rawText));
  const risk = analyzeAiRisk(parsed.sql);

  return {
    ...parsed,
    riskAnalysis: risk,
    dbContextSummary: {
      connected: Boolean(dbContext.connected),
      instance: Array.isArray(dbContext.instance) ? dbContext.instance[0] || null : null,
      contextError: dbContext.contextError || null,
    },
    generatedAt: new Date().toISOString(),
  };
}

contextBridge.exposeInMainWorld("db", {
  ping: async () => {
    if (preloadError) {
      return { ok: false, message: "Falha ao carregar oracledb: " + preloadError };
    }
    return { ok: true, message: "preload carregado" };
  },

  testConnection: async (config) => {
    if (preloadError) {
      return { ok: false, message: "Falha ao carregar oracledb: " + preloadError };
    }

    let conn;
    try {
      const connConfig = {
        user: config.user,
        password: config.password,
        connectString: config.connectString
      };

      if ((config.user || "").trim().toUpperCase() === "SYS") {
        connConfig.privilege = oracledb.SYSDBA;
      }

      conn = await oracledb.getConnection(connConfig);
      return { ok: true, message: "Conectado com sucesso!" };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : String(err) };
    } finally {
      if (conn) {
        try { await conn.close(); } catch {}
      }
    }
  },

  execute: async (sql, config) => {
    if (preloadError) {
      return { ok: false, message: "Falha ao carregar oracledb: " + preloadError };
    }

    let conn;
    try {
      const connConfig = {
        user: config.user,
        password: config.password,
        connectString: config.connectString
      };

      if ((config.user || "").trim().toUpperCase() === "SYS") {
        connConfig.privilege = oracledb.SYSDBA;
      }

      conn = await oracledb.getConnection(connConfig);

      const startedAt = Date.now();
      const result = await conn.execute(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true
      });

      return {
        ok: true,
        rows: result.rows || [],
        rowsAffected: result.rowsAffected || 0,
        metaData: result.metaData || [],
        logs: [{
          index: 1,
          status: "success",
          statement: sql,
          message: "Comando executado com sucesso.",
          durationMs: Date.now() - startedAt,
          rowsAffected: result.rowsAffected || 0,
          rowCount: (result.rows || []).length
        }]
      };
    } catch (err) {
      return {
        ok: false,
        message: err && err.message ? err.message : String(err),
        logs: [{
          index: 1,
          status: "error",
          statement: sql,
          message: err && err.message ? err.message : String(err),
          durationMs: 0
        }]
      };
    } finally {
      if (conn) {
        try { await conn.close(); } catch {}
      }
    }
  },

  generateAiScript: async (payload) => {
    try {
      return { ok: true, data: await generateAiScript(payload) };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : String(err) };
    }
  },

  runPatch: async (config) => {
    return await runPatchProcess(config);
  },

  executeScript: async (script, config) => {
    if (preloadError) {
      return { ok: false, message: "Falha ao carregar oracledb: " + preloadError };
    }

    let conn;
    try {
      const connConfig = {
        user: config.user,
        password: config.password,
        connectString: config.connectString
      };

      if ((config.user || "").trim().toUpperCase() === "SYS") {
        connConfig.privilege = oracledb.SYSDBA;
      }

      const statements = splitSqlStatements(script).filter(Boolean);

      if (!statements.length) {
        return { ok: false, message: "Nenhum comando SQL encontrado." };
      }

      for (const stmt of statements) {
        if (isUnsupportedCommand(stmt)) {
          return {
            ok: false,
            message: "Comando não suportado nessa execução direta: " + stmt
          };
        }
      }

      let lastResult = null;
      let executedCount = 0;
      const warnings = [];
      const logs = [];

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const startedAt = Date.now();
        try {
          if (isSqlPlusAdminCommand(stmt)) {
            if (conn) {
              try { await conn.close(); } catch {}
              conn = null;
            }

            const adminResult = await runSqlPlusAdminCommand(stmt, config);
            if (!adminResult.ok) {
              logs.push({
                index: i + 1,
                status: "error",
                statement: stmt,
                message: adminResult.message,
                durationMs: Date.now() - startedAt
              });
              return {
                ok: false,
                message: adminResult.message,
                failedStatement: stmt,
                executedCount,
                warningCount: warnings.length,
                warnings,
                logs
              };
            }

            executedCount++;
            logs.push({
              index: i + 1,
              status: "success",
              statement: stmt,
              message: adminResult.message,
              durationMs: Date.now() - startedAt,
              rowsAffected: 0,
              rowCount: 0
            });
            continue;
          }

          if (!conn) {
            conn = await oracledb.getConnection(connConfig);
          }

          lastResult = await conn.execute(stmt, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: false
          });
          executedCount++;
          logs.push({
            index: i + 1,
            status: "success",
            statement: stmt,
            message: "Comando executado com sucesso.",
            durationMs: Date.now() - startedAt,
            rowsAffected: lastResult.rowsAffected || 0,
            rowCount: (lastResult.rows || []).length
          });
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          if (isIgnorableOracleError(stmt, err)) {
            warnings.push({
              statement: stmt,
              message
            });
            logs.push({
              index: i + 1,
              status: "warning",
              statement: stmt,
              message,
              durationMs: Date.now() - startedAt
            });
            continue;
          }

          logs.push({
            index: i + 1,
            status: "error",
            statement: stmt,
            message,
            durationMs: Date.now() - startedAt
          });

          try { await conn.rollback(); } catch {}
          return {
            ok: false,
            message,
            failedStatement: stmt,
            executedCount,
            warningCount: warnings.length,
            warnings,
            logs
          };
        }
      }

      await conn.commit();

      return {
        ok: true,
        executedCount,
        warningCount: warnings.length,
        warnings,
        logs,
        lastResult: {
          rows: (lastResult && lastResult.rows) || [],
          rowsAffected: (lastResult && lastResult.rowsAffected) || 0,
          metaData: (lastResult && lastResult.metaData) || []
        }
      };
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch {}
      }
      return { ok: false, message: err && err.message ? err.message : String(err) };
    } finally {
      if (conn) {
        try { await conn.close(); } catch {}
      }
    }
  }
});
