use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, process::Command, time::Duration};
use tokio::time::sleep;
use tracing::{error, info};

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

#[derive(Debug, Clone, Serialize)]
struct SqlExecutionResult {
    message: String,
    output: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

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
    arg_value("--config").map(PathBuf::from).unwrap_or_else(|| exe_dir().join("config.json"))
}

fn load_config() -> Result<Config> {
    let path = config_path();
    let raw = fs::read_to_string(&path).with_context(|| format!("Não foi possível ler config: {}", path.display()))?;
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

fn sqlplus_connect_string(oracle: &OracleConfig) -> String {
    let base = format!("{}/{}@{}", oracle.user, oracle.password, oracle.connect_string);
    if oracle.as_sysdba { format!("{} as sysdba", base) } else { base }
}

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
        "oracle_dba_agent_metrics_{}.sql",
        Utc::now().timestamp_millis()
    ));

    fs::write(&sql_file, script)
        .with_context(|| format!("Falha ao criar arquivo SQL temporário: {}", sql_file.display()))?;

    let output = Command::new(&config.oracle.sqlplus_path)
        .arg("-S")
        .arg(sqlplus_connect_string(&config.oracle))
        .arg(format!("@{}", sql_file.display()))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .context("Falha ao executar sqlplus. Verifique Oracle Client/SQLPlus no PATH")?;

    let _ = fs::remove_file(&sql_file);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}\n{}", stdout, stderr);

    if combined.contains("ORA-") || combined.contains("SP2-") || !output.status.success() {
        anyhow::bail!("SQLPlus retornou erro: {}", combined.trim());
    }

    let mut rows = Vec::new();
    for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some((key, value)) = line.split_once('=') {
            let label = match key {
                "ACTIVE_SESSIONS" => "Sessões ativas",
                "BLOCKED_SESSIONS" => "Sessões bloqueadas",
                "LOCKS_WAITING" => "Locks em espera",
                "INVALID_OBJECTS" => "Objetos inválidos",
                "TABLESPACE_MAX_USED_PCT" => "Maior uso de tablespace (%)",
                "LONG_OPS" => "Operações longas ativas",
                "DB_CPU_SECONDS" => "DB CPU acumulado (s)",
                "DB_TIME_SECONDS" => "DB Time acumulado (s)",
                "LOGICAL_READS" => "Leituras lógicas acumuladas",
                "PHYSICAL_READS" => "Leituras físicas acumuladas",
                "EXECUTIONS" => "Execuções acumuladas",
                "PARSE_COUNT_TOTAL" => "Parses acumulados",
                "REDO_SIZE_MB" => "Redo gerado acumulado (MB)",
                "PGA_ALLOC_MB" => "PGA alocada (MB)",
                "SGA_MB" => "SGA total (MB)",
                _ => key,
            };
            rows.push(OverviewRow {
                metric: key.to_string(),
                value: value.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0),
                label: label.to_string(),
            });
        }
    }
    Ok(rows)
}

fn is_query_sql(sql: &str) -> bool {
    let mut cleaned = String::new();
    for line in sql.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("--") || trimmed.is_empty() {
            continue;
        }
        cleaned.push_str(trimmed);
        cleaned.push(' ');
    }
    let lower = cleaned.trim_start().to_lowercase();
    lower.starts_with("select ") || lower.starts_with("with ")
}

fn clean_sqlplus_output(output: &str) -> String {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| {
            let trimmed = line.trim();
            let normalized = trimmed
                .replace('�', "ã")
                .to_lowercase();

            !trimmed.is_empty()
                && !normalized.contains("session altered")
                && !normalized.contains("sessão alterada")
                && !normalized.contains("sessao alterada")
                && !normalized.contains("commit complete")
                && !normalized.contains("confirmação concluída")
                && !normalized.contains("confirmacao concluida")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                values.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    values.push(current.trim().to_string());
    values
}

fn parse_sqlplus_csv(output: &str) -> (Vec<String>, Vec<Vec<String>>) {
    let cleaned = clean_sqlplus_output(output);
    let mut lines = cleaned
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("SQL>"))
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let header = parse_csv_line(lines[0])
        .into_iter()
        .map(|c| c.trim_matches('"').to_string())
        .collect::<Vec<_>>();

    let rows = lines
        .drain(1..)
        .map(parse_csv_line)
        .map(|cols| cols.into_iter().map(|v| v.trim_matches('"').to_string()).collect::<Vec<_>>())
        .filter(|cols| !cols.is_empty())
        .collect::<Vec<_>>();

    (header, rows)
}

fn execute_sqlplus_script(config: &Config, sql: &str) -> Result<SqlExecutionResult> {
    let is_query = is_query_sql(sql);
  let script = if is_query {
    format!(
        "set echo off verify off feedback off pagesize 50000 linesize 32767 trimspool on tab off termout on\nset markup csv on delimiter , quote on\nwhenever sqlerror exit sql.sqlcode\n{}\nexit\n",
        sql
    )
} else {
    format!(
        "set echo off verify off feedback off heading off pagesize 0 linesize 400 trimspool on serveroutput on termout on\nwhenever sqlerror exit sql.sqlcode\n{}\ncommit;\nexit\n",
        sql
    )
};

    let sql_file = env::temp_dir().join(format!(
        "oracle_dba_agent_script_{}.sql",
        Utc::now().timestamp_millis()
    ));

    fs::write(&sql_file, script)
        .with_context(|| format!("Falha ao criar script SQL temporário: {}", sql_file.display()))?;

    let output = Command::new(&config.oracle.sqlplus_path)
        .arg("-S")
        .arg(sqlplus_connect_string(&config.oracle))
        .arg(format!("@{}", sql_file.display()))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .context("Falha ao executar sqlplus para script remoto. Verifique Oracle Client/SQLPlus no PATH")?;

    let _ = fs::remove_file(&sql_file);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}\n{}", stdout, stderr).trim().to_string();

    if combined.contains("ORA-") || combined.contains("SP2-") || !output.status.success() {
        anyhow::bail!("{}", clean_sqlplus_output(&combined));
    }

    if is_query {
        let (columns, rows) = parse_sqlplus_csv(&stdout);
        if rows.is_empty() {
            Ok(SqlExecutionResult {
                message: "Consulta executada sem linhas retornadas.".to_string(),
                output: clean_sqlplus_output(&stdout),
                columns,
                rows,
            })
        } else {
            Ok(SqlExecutionResult {
                message: "Consulta executada com sucesso.".to_string(),
                output: clean_sqlplus_output(&stdout),
                columns,
                rows,
            })
        }
    } else {
        Ok(SqlExecutionResult {
            message: "Comando executado com sucesso.".to_string(),
            output: "Comando executado com sucesso.".to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
        })
    }
}

fn hostname() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

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
    let Ok(entries) = fs::read_dir(&dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
            Some(snapshot) => match send_metrics(config, snapshot).await {
                Ok(_) => { let _ = fs::remove_file(&path); info!(file = %path.display(), "Métrica offline reenviada"); }
                Err(err) => { error!(error = %err, file = %path.display(), "Falha ao reenviar fila offline"); break; }
            },
            None => { let _ = fs::remove_file(&path); }
        }
    }
}

async fn send_heartbeat(config: &Config) -> Result<()> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
    let url = format!("{}/api/heartbeat", config.api_url.trim_end_matches('/'));
    let payload = json!({
        "agentId": config.agent_id,
        "customerName": config.customer_name,
        "environment": config.environment,
        "version": "3.2.2-rust",
        "host": hostname(),
        "lastSeenAt": Utc::now().to_rfc3339()
    });
    let res = client
        .post(url)
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
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let url = format!("{}/api/metrics", config.api_url.trim_end_matches('/'));
    let res = client
        .post(url)
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
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build()?;
    let url = format!("{}/api/commands/claim", config.api_url.trim_end_matches('/'));
    let payload = json!({ "agentId": config.agent_id, "host": hostname(), "version": "3.2.2-rust" });
    let res = client
        .post(url)
        .bearer_auth(&config.api_token)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("Claim command respondeu HTTP {}: {}", res.status(), res.text().await.unwrap_or_default());
    }
    let body: ClaimResponse = res.json().await?;
    if !body.ok {
        anyhow::bail!("API retornou ok=false ao reivindicar comando");
    }
    Ok(body.command)
}

async fn send_command_result(config: &Config, command_id: &str, ok: bool, result: Option<SqlExecutionResult>, error_message: Option<String>) -> Result<()> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let url = format!("{}/api/commands/result", config.api_url.trim_end_matches('/'));

    let output = result.as_ref().map(|r| r.output.clone());
    let message = result.as_ref().map(|r| r.message.clone());
    let columns = result.as_ref().map(|r| r.columns.clone()).unwrap_or_default();
    let rows = result.as_ref().map(|r| r.rows.clone()).unwrap_or_default();

    let payload = json!({
        "id": command_id,
        "agentId": config.agent_id,
        "host": hostname(),
        "ok": ok,
        "message": message,
        "output": output,
        "columns": columns,
        "rows": rows,
        "error": error_message,
        "finishedAt": Utc::now().to_rfc3339()
    });
    let res = client
        .post(url)
        .bearer_auth(&config.api_token)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("Resultado do comando respondeu HTTP {}: {}", res.status(), res.text().await.unwrap_or_default());
    }
    Ok(())
}

async fn poll_and_execute_commands(config: &Config) {
    let command = match claim_command(config).await {
        Ok(command) => command,
        Err(err) => {
            error!(error = %err, "Falha ao consultar comandos pendentes");
            return;
        }
    };

    let Some(command) = command else { return; };
    let sql = command.sql.clone().unwrap_or_default();
    if sql.trim().is_empty() {
        let _ = send_command_result(config, &command.id, false, None, Some("Comando sem SQL/script.".to_string())).await;
        return;
    }

    info!(command_id = %command.id, "Executando comando remoto aprovado");
    match execute_sqlplus_script(config, &sql) {
        Ok(result) => {
            if let Err(err) = send_command_result(config, &command.id, true, Some(result), None).await {
                error!(error = %err, command_id = %command.id, "Falha ao enviar resultado do comando");
            }
        }
        Err(err) => {
            let error_message = err.to_string();
            error!(error = %error_message, command_id = %command.id, "Comando remoto falhou");
            let _ = send_command_result(config, &command.id, false, None, Some(error_message)).await;
        }
    }
}

async fn collect_once(config: &Config) -> Value {
    let collected_at = Utc::now().to_rfc3339();
    match run_sqlplus_metrics(config) {
        Ok(overview) => json!({
            "agentId": config.agent_id,
            "customerName": config.customer_name,
            "environment": config.environment,
            "version": "3.2.2-rust",
            "host": hostname(),
            "snapshot": {
                "ok": true,
                "collectedAt": collected_at,
                "host": hostname(),
                "overview": overview,
                "collector": "rust-sqlplus"
            }
        }),
        Err(err) => json!({
            "agentId": config.agent_id,
            "customerName": config.customer_name,
            "environment": config.environment,
            "version": "3.2.2-rust",
            "host": hostname(),
            "snapshot": {
                "ok": false,
                "collectedAt": collected_at,
                "host": hostname(),
                "message": err.to_string(),
                "collector": "rust-sqlplus"
            }
        })
    }
}

async fn run_loop() -> Result<()> {
    let config = load_config()?;
    info!(agent_id = %config.agent_id, version = "3.2.2-rust", "Oracle DBA Agent Rust iniciado");
    loop {
        if let Err(err) = send_heartbeat(&config).await {
            error!(error = %err, "Falha ao enviar heartbeat");
        }
        flush_offline_queue(&config).await;
        let snapshot = collect_once(&config).await;
        match send_metrics(&config, snapshot.clone()).await {
            Ok(_) => info!("Métricas enviadas para API Central"),
            Err(err) => {
                error!(error = %err, "Falha ao enviar métricas; salvando em fila offline");
                if let Err(queue_err) = persist_offline_metric(&config, &snapshot) {
                    error!(error = %queue_err, "Falha ao gravar métrica offline");
                }
            }
        }
        poll_and_execute_commands(&config).await;
        sleep(Duration::from_secs(config.interval_seconds.max(10))).await;
    }
}

#[cfg(windows)]
mod service {
    use super::*;
    use std::ffi::OsString;
    use std::sync::mpsc;
    use std::time::Duration as StdDuration;
    use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    const SERVICE_NAME: &str = "OracleDBAAgentRust";

    define_windows_service!(ffi_service_main, service_main);

    pub fn run_service() -> Result<()> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
        Ok(())
    }

    fn service_main(_arguments: Vec<OsString>) {
        if let Err(err) = run_service_main() {
            error!(error = %err, "Serviço finalizado com erro");
        }
    }

    fn run_service_main() -> Result<()> {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let status_handle = service_control_handler::register(SERVICE_NAME, move |control_event| {
            match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    let _ = shutdown_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        })?;

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: StdDuration::default(),
            process_id: None,
        })?;

        let runtime = tokio::runtime::Runtime::new()?;
        let handle = runtime.spawn(async { super::run_loop().await });
        let _ = shutdown_rx.recv();
        handle.abort();

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: StdDuration::default(),
            process_id: None,
        })?;
        Ok(())
    }
}

fn is_service_mode() -> bool {
    env::args().any(|a| a == "--service")
}

fn main() -> Result<()> {
    let cfg = load_config().ok();
    init_logs(cfg.as_ref());
    if is_service_mode() {
        #[cfg(windows)]
        {
            return service::run_service();
        }
        #[cfg(not(windows))]
        {
            anyhow::bail!("Modo serviço disponível apenas no Windows");
        }
    }

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run_loop())
}
