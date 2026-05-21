use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize)]
struct PingResponse {
    ok: bool,
    message: String,
}

struct OracleBridgeState {
    child: Mutex<Option<Child>>,
}

#[tauri::command]
fn ping_desktop() -> PingResponse {
    PingResponse {
        ok: true,
        message: "Tauri carregado".to_string(),
    }
}

fn node_runtime_name() -> &'static str {
    #[cfg(target_os = "windows")]
    { "node-runtime.exe" }

    #[cfg(not(target_os = "windows"))]
    { "node-runtime" }
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()))
}

fn resolve_bridge_dir(app: &tauri::App) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = exe_dir() {
        // Portable montado pelo script assemble-portable.cjs
        candidates.push(dir.join("oracle-bridge"));
        // Execução direta em target/release quando o Tauri copia resources
        candidates.push(dir.join("resources").join("oracle-bridge"));
        // Fallback para builds executados direto dentro do projeto
        candidates.push(dir.join("..").join("..").join("resources").join("oracle-bridge"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("oracle-bridge"));
        candidates.push(resource_dir.join("resources").join("oracle-bridge"));
    }

    candidates
        .into_iter()
        .find(|dir| dir.join("oracle-bridge.cjs").exists() && dir.join(node_runtime_name()).exists())
}

fn logs_dir() -> PathBuf {
    exe_dir().unwrap_or_else(|| std::env::temp_dir()).join("logs")
}

fn append_launcher_log(message: &str) {
    let dir = logs_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("oracle-bridge-launcher.log");
    let line = format!("{}\r\n", message);
    let _ = fs::write(path, line);
}

fn start_oracle_bridge(app: &tauri::App) -> Result<Child, String> {
    let bridge_dir = resolve_bridge_dir(app).ok_or_else(|| {
        "Diretório do Oracle Bridge não encontrado. Verifique se a pasta oracle-bridge está ao lado do executável ou nos resources do Tauri.".to_string()
    })?;

    let node_runtime = bridge_dir.join(node_runtime_name());
    let bridge_script = bridge_dir.join("oracle-bridge.cjs");
    let log_dir = logs_dir();
    fs::create_dir_all(&log_dir).map_err(|err| format!("Falha ao criar pasta de logs: {err}"))?;
    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("oracle-bridge.log"))
        .map_err(|err| format!("Falha ao abrir log do bridge: {err}"))?;
    let stderr_log = stdout_log.try_clone().map_err(|err| format!("Falha ao preparar stderr do bridge: {err}"))?;

    append_launcher_log(&format!(
        "Iniciando Oracle Bridge. Node: {} | Script: {} | CWD: {}",
        node_runtime.display(),
        bridge_script.display(),
        bridge_dir.display()
    ));

    let mut command = Command::new(&node_runtime);
    command
        .arg(&bridge_script)
        .current_dir(&bridge_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    // CREATE_NO_WINDOW: impede abrir terminal do Node no Windows.
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    command
        .spawn()
        .map_err(|err| format!("Falha ao iniciar Oracle Bridge automaticamente: {err}"))
}

pub fn run() {
    tauri::Builder::default()
        .manage(OracleBridgeState { child: Mutex::new(None) })
        .setup(|app| {
            match start_oracle_bridge(app) {
                Ok(child) => {
                    let state = app.state::<OracleBridgeState>();
                    *state.child.lock().expect("falha ao registrar processo Oracle Bridge") = Some(child);
                    append_launcher_log("Oracle Bridge processado pelo Tauri. Verifique logs/oracle-bridge.log para detalhes.");
                }
                Err(err) => {
                    append_launcher_log(&err);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping_desktop])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar aplicação Tauri");
}
