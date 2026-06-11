use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, process::Command, sync::Arc, time::Duration};
use tokio::time::sleep;
use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct OracleConfig {
    #[serde(rename = "sqlplusPath")]
    sqlplus_path: String,
    user: String,
    password: String,
    #[serde(rename = "connectString")]
    connect_string: String,
    #[serde(rename = "asSysdba", default)]
    as_sysdba: bool,
    /// Quando true, comandos de STARTUP/SHUTDOWN são executados localmente como:
    /// sqlplus / as sysdba
    /// Isso é necessário porque após SHUTDOWN o listener não conhece mais o serviço.
    #[serde(rename = "localSysdba", default)]
    local_sysdba: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct Config {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "customerName")]
    customer_name: Option<String>,
    environment: Option<String>,
    #[serde(rename = "apiUrl")]
    api_url: String,
    #[serde(rename = "apiToken")]
    api_token: String,
    #[serde(rename = "intervalSeconds")]
    interval_seconds: u64,
    oracle: OracleConfig,
    #[serde(rename = "logDir")]
    log_dir: Option<String>,
}

// ---------------------------------------------------------------------------
// Structs de API
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct OverviewRow {
    #[serde(rename = "METRIC")]
    metric: String,
    #[serde(rename = "VALUE")]
    value: f64,
    #[serde(rename = "LABEL")]
    label: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CommandJob {
    id: String,
    #[serde(rename = "agentId")]
    agent_id: Option<String>,
    #[serde(default)]
    sql: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(rename = "allowDangerous", default)]
    allow_dangerous: bool,
}

#[derive(Debug, Deserialize)]
struct ClaimResponse {
    ok: bool,
    command: Option<CommandJob>,
}

// ---------------------------------------------------------------------------
// Helpers de ambiente
// ---------------------------------------------------------------------------

fn exe_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn arg_value(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    args.windows(2).find(|w| w[0] == name).map(|w| w[1].clone())
}

fn config_path() -> PathBuf {
    arg_value("--config")
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir().join("config.json"))
}

fn load_config() -> Result<Config> {
    let path = config_path();
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("Não foi possível ler config: {}", path.display()))?;
    serde_json::from_str(&raw).context("config.json inválido")
}

fn init_logs(config: Option<&Config>) {
    let dir = config
        .and_then(|c| c.log_dir.clone())
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir().join("logs"));
    let _ = fs::create_dir_all(&dir);
    let file_appender = tracing_appender::rolling::daily(dir, "oracle-dba-agent-rust.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    std::mem::forget(guard);
    let subscriber = tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_target(false)
        .with_ansi(false)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);
}

fn hostname() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

fn sqlplus_connect_string(oracle: &OracleConfig) -> String {
    let base = format!("{}/{}@{}", oracle.user, oracle.password, oracle.connect_string);
    if oracle.as_sysdba {
        format!("{} as sysdba", base)
    } else {
        base
    }
}

// ---------------------------------------------------------------------------
// SQLPlus — execução de scripts/consultas remotos
// ---------------------------------------------------------------------------

fn strip_sql_comments_for_detection(sql: &str) -> String {
    let mut cleaned = String::new();
    let mut chars = sql.chars().peekable();
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }

        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            in_block_comment = true;
            cleaned.push(' ');
            continue;
        }

        if ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            while let Some(next_ch) = chars.next() {
                if next_ch == '\n' || next_ch == '\r' {
                    cleaned.push(' ');
                    break;
                }
            }
            continue;
        }

        cleaned.push(ch);
    }

    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_query_sql(sql: &str) -> bool {
    let lower = strip_sql_comments_for_detection(sql).trim_start().to_lowercase();
    lower.starts_with("select ") || lower.starts_with("with ")
}

fn is_instance_control_sql(sql: &str) -> bool {
    let lower = strip_sql_comments_for_detection(sql).trim_start().to_lowercase();
    lower.starts_with("startup")
        || lower.starts_with("shutdown")
        || lower.contains(" startup")
        || lower.contains(" shutdown")
}

fn sqlplus_args_for_sql(config: &Config, sql: &str) -> Vec<String> {
    if config.oracle.local_sysdba && is_instance_control_sql(sql) {
        vec!["-S".to_string(), "/".to_string(), "as".to_string(), "sysdba".to_string()]
    } else {
        vec!["-S".to_string(), sqlplus_connect_string(&config.oracle)]
    }
}

/// Filtra ruídos do SQLPlus apenas para uso em mensagens de erro.
/// NUNCA usar no conteúdo CSV — destrói os dados.
fn strip_sqlplus_noise(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let t = line.trim();
            !t.is_empty()
                && !t.eq_ignore_ascii_case("session altered.")
                && !t.eq_ignore_ascii_case("commit complete.")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}


/// Garante que o comando enviado ao SQLPlus tenha terminador.
/// O desktop separa o script por `;` e envia cada comando sem o ponto-e-vírgula.
/// O driver node-oracledb aceita isso, mas o SQLPlus precisa de `;` ou `/`;
/// sem terminador ele pode sair sem executar e retornar STDOUT/STDERR vazios.
fn sqlplus_ready_sql(sql: &str) -> String {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // STARTUP/SHUTDOWN são comandos do SQLPlus, não SQL comum.
    // Não adicionar ; porque pode gerar SP2-0306/SP2-0734 dependendo da versão.
    if is_instance_control_sql(trimmed) {
        return trimmed.to_string();
    }

    let last_line = trimmed
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if trimmed.ends_with(';') || last_line == "/" {
        trimmed.to_string()
    } else {
        format!("{};", trimmed)
    }
}

fn execute_sqlplus_script(config: &Config, sql: &str) -> Result<String> {
    let is_query = is_query_sql(sql);
    let sql_for_sqlplus = sqlplus_ready_sql(sql);

    // Envia o script via stdin em vez de arquivo @script.sql.
    // Isso elimina qualquer problema com caminhos de spool no Windows
    // (espaços, barras, TEMP com caracteres especiais, permissões).
    //
    // Para queries: usa markup csv on — o SQLPlus escreve o CSV no stdout.
    //   termout ON (padrão) + sem spool = tudo vai para stdout capturado pelo pipe.
    //
    // Para DDL/DML: serveroutput on, resultado também no stdout.
    let script = if is_query {
        format!(
            "set echo off verify off feedback off tab off\n\
             set pagesize 50000 linesize 32767 trimspool on\n\
             set markup csv on delimiter , quote on\n\
             whenever sqlerror exit sql.sqlcode\n\
             {sql}\n\
             exit\n",
            sql = sql_for_sqlplus,
        )
    } else {
        format!(
            "set echo off verify off feedback off heading off\n\
             set pagesize 0 linesize 400 trimspool on serveroutput on\n\
             whenever sqlerror exit sql.sqlcode\n\
             {sql}\n\
             commit;\n\
             exit\n",
            sql = sql_for_sqlplus,
        )
    };

    use std::io::Write;
    use std::process::Stdio;

    let sqlplus_args = sqlplus_args_for_sql(config, sql);
    info!(args = ?sqlplus_args, local_sysdba = config.oracle.local_sysdba, "Iniciando SQLPlus");

    let mut child = Command::new(&config.oracle.sqlplus_path)
        .args(&sqlplus_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "Falha ao iniciar sqlplus. Verifique Oracle Client/SQLPlus no PATH")?;

    // Escreve o script no stdin e fecha para o SQLPlus saber que terminou
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(script.as_bytes())
            .context("Falha ao escrever script no stdin do sqlplus")?;
        // drop explícito fecha o pipe — SQLPlus recebe EOF e executa
    }

    let proc = child.wait_with_output()
        .context("Falha ao aguardar sqlplus finalizar")?;

    let stdout = String::from_utf8_lossy(&proc.stdout).to_string();
    let stderr = String::from_utf8_lossy(&proc.stderr).to_string();
    let all_output = format!("{}\n{}", stdout, stderr);

    // Detecta erros Oracle
    if all_output.contains("ORA-") || all_output.contains("SP2-") || !proc.status.success() {
        let msg = strip_sqlplus_noise(&all_output);
        anyhow::bail!("{}", msg);
    }

    if is_query {
        // stdout contém o CSV diretamente — sem depender de arquivo de spool
        let result = stdout.trim().to_string();
        if result.is_empty() {
            Ok("__EMPTY_RESULT__".to_string())
        } else {
            Ok(result)
        }
    } else {
        Ok("Comando executado com sucesso.".to_string())
    }
}

// ---------------------------------------------------------------------------
// SQLPlus — coleta de métricas
// ---------------------------------------------------------------------------

fn run_sqlplus_metrics(config: &Config) -> Result<Vec<OverviewRow>> {
    let script = r#"
ALTER SESSION SET NLS_NUMERIC_CHARACTERS = '.,';
set heading off feedback off verify off echo off pagesize 0 linesize 400 trimspool on serveroutput off
SELECT 'ACTIVE_SESSIONS=' || COUNT(*) FROM v$session WHERE status = 'ACTIVE' AND type = 'USER';
SELECT 'BLOCKED_SESSIONS=' || COUNT(*) FROM v$session WHERE blocking_session IS NOT NULL;
SELECT 'LOCKS_WAITING=' || COUNT(*) FROM v$lock WHERE request > 0;
SELECT 'INVALID_OBJECTS=' || COUNT(*) FROM dba_objects WHERE status = 'INVALID';
SELECT 'TABLESPACE_MAX_USED_PCT=' || NVL(ROUND(MAX(used_percent),2),0) FROM dba_tablespace_usage_metrics;
SELECT 'LONG_OPS=' || COUNT(*) FROM v$session_longops WHERE totalwork > 0 AND sofar < totalwork;
SELECT 'DB_CPU_SECONDS=' || NVL(ROUND(MAX(CASE WHEN stat_name = 'DB CPU' THEN value END)/1000000,2),0) FROM v$sys_time_model;
SELECT 'DB_TIME_SECONDS=' || NVL(ROUND(MAX(CASE WHEN stat_name = 'DB time' THEN value END)/1000000,2),0) FROM v$sys_time_model;
SELECT 'LOGICAL_READS=' || NVL(MAX(CASE WHEN name = 'session logical reads' THEN value END),0) FROM v$sysstat;
SELECT 'PHYSICAL_READS=' || NVL(MAX(CASE WHEN name = 'physical reads' THEN value END),0) FROM v$sysstat;
SELECT 'EXECUTIONS=' || NVL(MAX(CASE WHEN name = 'execute count' THEN value END),0) FROM v$sysstat;
SELECT 'PARSE_COUNT_TOTAL=' || NVL(MAX(CASE WHEN name = 'parse count (total)' THEN value END),0) FROM v$sysstat;
SELECT 'REDO_SIZE_MB=' || NVL(ROUND(MAX(CASE WHEN name = 'redo size' THEN value END)/1024/1024,2),0) FROM v$sysstat;
SELECT 'PGA_ALLOC_MB=' || NVL(ROUND(value/1024/1024,2),0) FROM v$pgastat WHERE name = 'total PGA allocated';
SELECT 'SGA_MB=' || NVL(ROUND(SUM(value)/1024/1024,2),0) FROM v$sga;
exit
"#;

    let sql_file = env::temp_dir().join(format!(
        "odba_metrics_{}.sql",
        Utc::now().timestamp_millis()
    ));

    fs::write(&sql_file, script)
        .with_context(|| format!("Falha ao criar arquivo SQL de métricas: {}", sql_file.display()))?;

    let output = Command::new(&config.oracle.sqlplus_path)
        .arg("-S")
        .arg(sqlplus_connect_string(&config.oracle))
        .arg(format!("@{}", sql_file.display()))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .context("Falha ao executar sqlplus para métricas")?;

    let _ = fs::remove_file(&sql_file);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}\n{}", stdout, stderr);

    if combined.contains("ORA-") || combined.contains("SP2-") || !output.status.success() {
        anyhow::bail!("SQLPlus retornou erro nas métricas: {}", combined.trim());
    }

    let mut rows = Vec::new();
    for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some((key, value)) = line.split_once('=') {
            let label = match key {
                "ACTIVE_SESSIONS"        => "Sessões ativas",
                "BLOCKED_SESSIONS"       => "Sessões bloqueadas",
                "LOCKS_WAITING"          => "Locks em espera",
                "INVALID_OBJECTS"        => "Objetos inválidos",
                "TABLESPACE_MAX_USED_PCT"=> "Maior uso de tablespace (%)",
                "LONG_OPS"               => "Operações longas ativas",
                "DB_CPU_SECONDS"         => "DB CPU acumulado (s)",
                "DB_TIME_SECONDS"        => "DB Time acumulado (s)",
                "LOGICAL_READS"          => "Leituras lógicas acumuladas",
                "PHYSICAL_READS"         => "Leituras físicas acumuladas",
                "EXECUTIONS"             => "Execuções acumuladas",
                "PARSE_COUNT_TOTAL"      => "Parses acumulados",
                "REDO_SIZE_MB"           => "Redo gerado acumulado (MB)",
                "PGA_ALLOC_MB"           => "PGA alocada (MB)",
                "SGA_MB"                 => "SGA total (MB)",
                _                        => key,
            };
            rows.push(OverviewRow {
                metric: key.to_string(),
                value:  value.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0),
                label:  label.to_string(),
            });
        }
    }
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Fila offline de métricas
// ---------------------------------------------------------------------------

fn queue_dir(config: &Config) -> PathBuf {
    let base = config
        .log_dir
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir().join("logs"));
    let dir = base.join("queue");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn persist_offline_metric(config: &Config, snapshot: &Value) -> Result<()> {
    let filename = format!("metric_{}.json", Utc::now().timestamp_millis());
    let path = queue_dir(config).join(filename);
    fs::write(path, serde_json::to_vec_pretty(snapshot)?)?;
    Ok(())
}

async fn flush_offline_queue(config: &Config) {
    let dir = queue_dir(config);
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        {
            Some(snapshot) => match send_metrics(config, snapshot).await {
                Ok(_) => {
                    let _ = fs::remove_file(&path);
                    info!(file = %path.display(), "Métrica offline reenviada");
                }
                Err(err) => {
                    error!(error = %err, file = %path.display(), "Falha ao reenviar fila offline");
                    break;
                }
            },
            None => {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// HTTP — API Central
// ---------------------------------------------------------------------------

fn http_client(timeout_secs: u64) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .context("Falha ao criar HTTP client")
}

async fn send_heartbeat(config: &Config) -> Result<()> {
    let client = http_client(10)?;
    let url = format!("{}/api/heartbeat", config.api_url.trim_end_matches('/'));
    let payload = json!({
        "agentId":      config.agent_id,
        "customerName": config.customer_name,
        "environment":  config.environment,
        "version":      "3.2.4-rust",
        "host":         hostname(),
        "lastSeenAt":   Utc::now().to_rfc3339()
    });
    let res = client
        .post(&url)
        .bearer_auth(&config.api_token)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("Heartbeat respondeu HTTP {}: {}", res.status(), res.text().await.unwrap_or_default());
    }
    Ok(())
}

async fn send_metrics(config: &Config, snapshot: Value) -> Result<()> {
    let client = http_client(20)?;
    let url = format!("{}/api/metrics", config.api_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .bearer_auth(&config.api_token)
        .json(&snapshot)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("API Central respondeu HTTP {}: {}", res.status(), res.text().await.unwrap_or_default());
    }
    Ok(())
}

async fn claim_command(config: &Config) -> Result<Option<CommandJob>> {
    let client = http_client(15)?;
    let url = format!("{}/api/commands/claim", config.api_url.trim_end_matches('/'));
    let payload = json!({
        "agentId": config.agent_id,
        "host":    hostname(),
        "version": "3.2.4-rust"
    });
    let res = client
        .post(&url)
        .bearer_auth(&config.api_token)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!(
            "Claim command respondeu HTTP {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        );
    }
    let body: ClaimResponse = res.json().await?;
    if !body.ok {
        anyhow::bail!("API retornou ok=false ao reivindicar comando");
    }
    Ok(body.command)
}

async fn send_command_result(
    config: &Config,
    command_id: &str,
    ok: bool,
    output: Option<String>,
    error_message: Option<String>,
) -> Result<()> {
    let client = http_client(20)?;
    let url = format!("{}/api/commands/result", config.api_url.trim_end_matches('/'));
    let payload = json!({
        "id":         command_id,
        "agentId":    config.agent_id,
        "host":       hostname(),
        "ok":         ok,
        "output":     output,
        "error":      error_message,
        "finishedAt": Utc::now().to_rfc3339()
    });
    let res = client
        .post(&url)
        .bearer_auth(&config.api_token)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!(
            "Resultado do comando respondeu HTTP {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Loop de comandos — separado e independente do loop de métricas
// Loop de métricas roda a cada interval_seconds (mín. 10s)
// Loop de comandos roda a cada 3s para resposta rápida
// ---------------------------------------------------------------------------

async fn run_command_loop(config: Arc<Config>) {
    info!("Loop de comandos iniciado (polling a cada 3s)");
    loop {
        match claim_command(&config).await {
            Err(err) => {
                error!(error = %err, "Falha ao consultar comandos pendentes");
            }
            Ok(None) => {
                // Sem comandos pendentes — aguarda e tenta novamente
            }
            Ok(Some(command)) => {
                let sql = command.sql.clone().unwrap_or_default();
                if sql.trim().is_empty() {
                    let _ = send_command_result(
                        &config,
                        &command.id,
                        false,
                        None,
                        Some("Comando sem SQL/script.".to_string()),
                    )
                    .await;
                } else {
                    info!(command_id = %command.id, "Executando comando remoto");
                    // executa_sqlplus_script é bloqueante — usa spawn_blocking para não
                    // travar o runtime Tokio durante a execução do SQLPlus
                    let cfg_clone = Arc::clone(&config);
                    let sql_clone = sql.clone();
                    let exec_result =
                        tokio::task::spawn_blocking(move || execute_sqlplus_script(&cfg_clone, &sql_clone))
                            .await;

                    match exec_result {
                        Err(join_err) => {
                            error!(error = %join_err, command_id = %command.id, "spawn_blocking falhou");
                            let _ = send_command_result(
                                &config,
                                &command.id,
                                false,
                                None,
                                Some(format!("Erro interno ao executar comando: {}", join_err)),
                            )
                            .await;
                        }
                        Ok(Err(exec_err)) => {
                            let msg = exec_err.to_string();
                            error!(error = %msg, command_id = %command.id, "Comando remoto falhou");
                            let _ = send_command_result(&config, &command.id, false, None, Some(msg)).await;
                        }
                        Ok(Ok(output)) => {
                            info!(command_id = %command.id, bytes = output.len(), "Comando executado com sucesso");
                            if let Err(err) =
                                send_command_result(&config, &command.id, true, Some(output), None).await
                            {
                                error!(error = %err, command_id = %command.id, "Falha ao enviar resultado");
                            }
                        }
                    }
                }
            }
        }
        sleep(Duration::from_secs(3)).await;
    }
}

async fn run_metrics_loop(config: Arc<Config>) {
    info!("Loop de métricas iniciado");
    loop {
        // Heartbeat
        if let Err(err) = send_heartbeat(&config).await {
            error!(error = %err, "Falha ao enviar heartbeat");
        }

        // Fila offline
        flush_offline_queue(&config).await;

        // Métricas
        let collected_at = Utc::now().to_rfc3339();
        let cfg_clone = Arc::clone(&config);
        let snapshot = tokio::task::spawn_blocking(move || {
            match run_sqlplus_metrics(&cfg_clone) {
                Ok(overview) => json!({
                    "agentId":      cfg_clone.agent_id,
                    "customerName": cfg_clone.customer_name,
                    "environment":  cfg_clone.environment,
                    "version":      "3.2.4-rust",
                    "host":         hostname(),
                    "snapshot": {
                        "ok":          true,
                        "collectedAt": collected_at,
                        "host":        hostname(),
                        "overview":    overview,
                        "collector":   "rust-sqlplus"
                    }
                }),
                Err(err) => json!({
                    "agentId":      cfg_clone.agent_id,
                    "customerName": cfg_clone.customer_name,
                    "environment":  cfg_clone.environment,
                    "version":      "3.2.4-rust",
                    "host":         hostname(),
                    "snapshot": {
                        "ok":          false,
                        "collectedAt": collected_at,
                        "host":        hostname(),
                        "message":     err.to_string(),
                        "collector":   "rust-sqlplus"
                    }
                }),
            }
        })
        .await
        .unwrap_or_else(|e| json!({ "error": e.to_string() }));

        match send_metrics(&config, snapshot.clone()).await {
            Ok(_) => info!("Métricas enviadas para API Central"),
            Err(err) => {
                error!(error = %err, "Falha ao enviar métricas; salvando em fila offline");
                if let Err(queue_err) = persist_offline_metric(&config, &snapshot) {
                    error!(error = %queue_err, "Falha ao gravar métrica offline");
                }
            }
        }

        let interval = config.interval_seconds.max(10);
        sleep(Duration::from_secs(interval)).await;
    }
}

async fn run_loop() -> Result<()> {
    let config = Arc::new(load_config()?);
    info!(agent_id = %config.agent_id, version = "3.2.4-rust", "Oracle DBA Agent Rust iniciado");

    // Dois loops independentes em paralelo:
    //  - comandos: polling a cada 3s
    //  - métricas:  coleta a cada interval_seconds
    tokio::join!(
        run_command_loop(Arc::clone(&config)),
        run_metrics_loop(Arc::clone(&config)),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Windows Service
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod service {
    use super::*;
    use std::ffi::OsString;
    use std::sync::mpsc;
    use std::time::Duration as StdDuration;
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    const DEFAULT_SERVICE_NAME: &str = "OracleDBAAgent";

    fn configured_service_name() -> String {
        super::arg_value("--service-name")
            .unwrap_or_else(|| DEFAULT_SERVICE_NAME.to_string())
    }

    define_windows_service!(ffi_service_main, service_main);

    pub fn run_service() -> Result<()> {
        let service_name = configured_service_name();
        info!(service_name = %service_name, "Iniciando dispatcher do Windows Service");
        service_dispatcher::start(service_name, ffi_service_main)?;
        Ok(())
    }

    fn service_main(_arguments: Vec<OsString>) {
        if let Err(err) = run_service_main() {
            error!(error = %err, "Serviço finalizado com erro");
        }
    }

    fn run_service_main() -> Result<()> {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let status_handle =
            service_control_handler::register(configured_service_name(), move |control_event| {
                match control_event {
                    ServiceControl::Stop | ServiceControl::Shutdown => {
                        let _ = shutdown_tx.send(());
                        ServiceControlHandlerResult::NoError
                    }
                    _ => ServiceControlHandlerResult::NotImplemented,
                }
            })?;

        status_handle.set_service_status(ServiceStatus {
            service_type:     ServiceType::OWN_PROCESS,
            current_state:    ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code:        ServiceExitCode::Win32(0),
            checkpoint:       0,
            wait_hint:        StdDuration::default(),
            process_id:       None,
        })?;

        let runtime = tokio::runtime::Runtime::new()?;
        let handle = runtime.spawn(async { super::run_loop().await });

        // Mantém o serviço vivo até receber Stop/Shutdown.
        // Se o loop principal falhar, registra no log para evitar que o serviço pare "sem explicar".
        loop {
            if shutdown_rx.try_recv().is_ok() {
                handle.abort();
                break;
            }
            if handle.is_finished() {
                match runtime.block_on(handle) {
                    Ok(Ok(_)) => info!("Loop principal do Agent finalizado"),
                    Ok(Err(err)) => error!(error = %err, "Loop principal do Agent falhou"),
                    Err(err) => error!(error = %err, "Task principal do Agent abortada/falhou"),
                }
                break;
            }
            std::thread::sleep(StdDuration::from_secs(1));
        }

        status_handle.set_service_status(ServiceStatus {
            service_type:     ServiceType::OWN_PROCESS,
            current_state:    ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code:        ServiceExitCode::Win32(0),
            checkpoint:       0,
            wait_hint:        StdDuration::default(),
            process_id:       None,
        })?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

fn is_service_mode() -> bool {
    env::args().any(|a| a == "--service")
}

fn is_console_mode() -> bool {
    env::args().any(|a| a == "--console" || a == "-console")
}

fn main() -> Result<()> {
    let cfg = load_config().ok();
    init_logs(cfg.as_ref());

    if is_console_mode() {
        let cfg_path = config_path();
        println!("Oracle DBA Agent iniciando em modo console...");
        println!("Config: {}", cfg_path.display());
        if let Some(cfg) = cfg.as_ref() {
            println!("Agent ID: {}", cfg.agent_id);
            println!("API Central: {}", cfg.api_url);
            println!("Intervalo: {}s", cfg.interval_seconds);
            println!("Log dir: {}", cfg.log_dir.clone().unwrap_or_else(|| exe_dir().join("logs").display().to_string()));
        } else {
            println!("ATENÇÃO: config.json não foi carregado. O erro detalhado aparecerá abaixo.");
        }
    }

    if is_service_mode() {
        #[cfg(windows)]
        {
            if let Err(err) = service::run_service() {
                error!(error = %err, "Falha ao iniciar modo serviço");
                eprintln!("Falha ao iniciar modo serviço: {err}");
                return Err(err);
            }
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            anyhow::bail!("Modo serviço disponível apenas no Windows");
        }
    }

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run_loop())
}
