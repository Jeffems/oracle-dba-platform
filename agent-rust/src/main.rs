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
set heading off feedback off verify off echo off pagesize 0 linesize 400 trimspool on serveroutput off
SELECT 'ACTIVE_SESSIONS=' || COUNT(*) FROM v$session WHERE status = 'ACTIVE' AND type = 'USER';
SELECT 'BLOCKED_SESSIONS=' || COUNT(*) FROM v$session WHERE blocking_session IS NOT NULL;
SELECT 'LOCKS_WAITING=' || COUNT(*) FROM v$lock WHERE request > 0;
SELECT 'INVALID_OBJECTS=' || COUNT(*) FROM dba_objects WHERE status = 'INVALID';
SELECT 'TABLESPACE_MAX_USED_PCT=' || NVL(ROUND(MAX(used_percent),2),0) FROM dba_tablespace_usage_metrics;
SELECT 'LONG_OPS=' || COUNT(*) FROM v$session_longops WHERE totalwork > 0 AND sofar < totalwork;
exit
"#;

    let output = Command::new(&config.oracle.sqlplus_path)
        .arg("-S")
        .arg(sqlplus_connect_string(&config.oracle))
        .arg("@-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(stdin) = child.stdin.as_mut() {
                stdin.write_all(script.as_bytes())?;
            }
            child.wait_with_output()
        })
        .context("Falha ao executar sqlplus. Verifique Oracle Client/SQLPlus no PATH")?;

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
        "version": "2.8.0-rust",
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

async fn collect_once(config: &Config) -> Value {
    let collected_at = Utc::now().to_rfc3339();
    match run_sqlplus_metrics(config) {
        Ok(overview) => json!({
            "agentId": config.agent_id,
            "customerName": config.customer_name,
            "environment": config.environment,
            "version": "2.8.0-rust",
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
            "version": "2.8.0-rust",
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
    info!(agent_id = %config.agent_id, version = "2.8.0-rust", "Oracle DBA Agent Rust iniciado");
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
