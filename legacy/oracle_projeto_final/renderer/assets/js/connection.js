import {
  clearExecutionLog,
  clearResults,
  renderExecutionLog,
  renderResults,
} from "./ui.js";

export let currentConnection = {
  connected: false,
  user: "",
  connectString: "",
};

let executionBusy = false;
let executionTimerId = null;
let executionStartAt = null;

function getActionMessageEl() {
  return document.getElementById("actionMessage");
}

function showActionMessage(message, type = "success") {
  const el = getActionMessageEl();
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "success", "error", "warning");
  el.classList.add(type);
}

function hideActionMessage() {
  const el = getActionMessageEl();
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("success", "error", "warning");
}

function getExecutionTimerEl() {
  return document.getElementById("executionTimer");
}

function formatElapsedSeconds() {
  if (!executionStartAt) return 0;
  return Math.floor((Date.now() - executionStartAt) / 1000);
}

function updateExecutionTimerText() {
  const el = getExecutionTimerEl();
  if (!el) return;
  const seconds = formatElapsedSeconds();
  el.textContent = `Execução em andamento: ${seconds}s`;
}

function setExecutionUiBusy(isBusy) {
  executionBusy = isBusy;

  document
    .querySelectorAll(
      ".sidebar .nav-btn, main .tab button, main .tab input, main .tab select, main .tab textarea",
    )
    .forEach((el) => {
      el.disabled = isBusy;
      el.classList.toggle("is-disabled", isBusy);
    });

  const timerEl = getExecutionTimerEl();
  if (timerEl) {
    timerEl.classList.toggle("hidden", !isBusy);
  }

  if (isBusy) {
    executionStartAt = Date.now();
    updateExecutionTimerText();
    executionTimerId = window.setInterval(updateExecutionTimerText, 1000);
    return;
  }

  if (executionTimerId) {
    window.clearInterval(executionTimerId);
    executionTimerId = null;
  }
  executionStartAt = null;
  if (timerEl) {
    timerEl.textContent = "";
  }
}

export function setConnectionState(state, message) {
  const dot = document.getElementById("dbStatusDot");
  const text = document.getElementById("dbStatusText");
  if (!dot || !text) return;

  if (state === "connecting") dot.style.background = "var(--yellow)";
  if (state === "connected") dot.style.background = "var(--green)";
  if (state === "disconnected") dot.style.background = "var(--oracle)";

  text.textContent = message;
}

export function updateConnectionStatus() {
  if (currentConnection.connected) {
    setConnectionState(
      "connected",
      `Status: conectado | usuário: ${currentConnection.user} | banco: ${currentConnection.connectString}`,
    );
  } else {
    setConnectionState("disconnected", "Status: desconectado");
  }
}

export async function testCurrentConnection() {
  const config = {
    user: document.getElementById("db_user").value.trim(),
    password: document.getElementById("db_pass").value,
    connectString: document.getElementById("db_connect").value.trim(),
  };

  if (!config.user || !config.password || !config.connectString) {
    showActionMessage("Preencha usuário, senha e connect string.", "warning");
    return;
  }

  hideActionMessage();
  setConnectionState("connecting", "Status: testando conexão...");
  const result = await window.db.testConnection(config);

  if (!result.ok) {
    currentConnection = {
      connected: false,
      user: "",
      connectString: "",
    };
    setConnectionState("disconnected", "Status: erro na conexão");
    showActionMessage("Erro ao conectar: " + result.message, "error");
    return;
  }

  currentConnection = {
    connected: true,
    user: config.user,
    connectString: config.connectString,
  };

  updateConnectionStatus();
  showActionMessage("Conexão realizada com sucesso.", "success");
}

export async function connectDatabase() {
  if (!window.db) {
    showActionMessage("Integração desktop não carregada.", "error");
    return;
  }
  await testCurrentConnection();
}

export function disconnectDatabase() {
  currentConnection = {
    connected: false,
    user: "",
    connectString: "",
  };
  clearResults();
  clearExecutionLog("Desconectado. O log da última execução foi limpo.");
  updateConnectionStatus();
  showActionMessage("Conexão encerrada.", "warning");
}


export async function executePatchApply() {
  try {
    if (executionBusy) {
      showActionMessage(
        "Já existe uma execução em andamento. Aguarde a finalização.",
        "warning",
      );
      return;
    }

    if (!window.db || !window.db.runPatch) {
      showActionMessage("Integração de patch não carregada.", "error");
      return;
    }

    const config = {
      oracleHome: document.getElementById("patch_oracle_home")?.value.trim(),
      oracleSid: document.getElementById("patch_oracle_sid")?.value.trim(),
      patchDir: document.getElementById("patch_dir")?.value.trim(),
      workRoot: document.getElementById("patch_work_root")?.value.trim(),
      listenerName: document.getElementById("patch_listener")?.value.trim(),
      autoStartDb: document.getElementById("patch_auto_start")?.checked !== false,
      openAllPdbs: document.getElementById("patch_open_pdbs")?.checked === true,
    };

    hideActionMessage();
    setExecutionUiBusy(true);
    setConnectionState("connecting", "Status: aplicando patch...");
    clearExecutionLog("Executando patch Oracle...");
    clearResults("A execução do patch pode levar alguns minutos. Acompanhe o log.");

    const result = await window.db.runPatch(config);
    const elapsedSeconds = formatElapsedSeconds();

    renderExecutionLog(result.logs || []);

    if (!result.ok) {
      updateConnectionStatus();
      const suffix = result.logPath ? ` | Log: ${result.logPath}` : "";
      clearResults("Patch não aplicado.");
      showActionMessage(
        `Falha ao aplicar patch após ${elapsedSeconds}s: ${result.message}${suffix}`,
        "error",
      );
      return;
    }

    updateConnectionStatus();
    clearResults(
      result.logPath
        ? `Patch aplicado com sucesso. Log salvo em: ${result.logPath}`
        : "Patch aplicado com sucesso.",
    );
    showActionMessage(
      result.logPath
        ? `Patch aplicado com sucesso em ${elapsedSeconds}s. Log: ${result.logPath}`
        : `Patch aplicado com sucesso em ${elapsedSeconds}s.`,
      "success",
    );
  } catch (err) {
    updateConnectionStatus();
    showActionMessage("Erro ao aplicar patch: " + (err.message || err), "error");
  } finally {
    setExecutionUiBusy(false);
  }
}

export async function executeOutput(outputId) {
  try {
    if (executionBusy) {
      showActionMessage(
        "Já existe um script em execução. Aguarde a finalização.",
        "warning",
      );
      return;
    }

    if (!window.db) {
      showActionMessage("Integração desktop não carregada.", "error");
      return;
    }

    if (!currentConnection.connected) {
      showActionMessage(
        "Conecte no banco antes de aplicar o script.",
        "warning",
      );
      return;
    }

    const sql = document.getElementById(outputId).textContent.trim();

    if (!sql) {
      showActionMessage("Nenhum SQL encontrado.", "warning");
      return;
    }

    const lowered = sql.trim().toLowerCase();
    if (lowered.startsWith("impdp ") || lowered.startsWith("expdp ")) {
      showActionMessage(
        "Esse bloco gera comando de terminal, não SQL executável dentro do banco.",
        "warning",
      );
      return;
    }

    hideActionMessage();
    setExecutionUiBusy(true);
    setConnectionState("connecting", "Status: executando script...");
    clearExecutionLog("Executando script...");

    const config = {
      user: currentConnection.user,
      password: document.getElementById("db_pass").value,
      connectString: currentConnection.connectString,
    };

    const result = await window.db.executeScript(sql, config);
    const elapsedSeconds = formatElapsedSeconds();

    if (!result.ok) {
      setConnectionState(
        "connected",
        `Status: conectado | usuário: ${currentConnection.user} | banco: ${currentConnection.connectString}`,
      );
      const failedInfo = result.failedStatement
        ? ` | Comando com falha: ${result.failedStatement}`
        : "";
      renderExecutionLog(result.logs || []);
      clearResults("Execução interrompida por erro.");
      showActionMessage(
        `Erro ao executar após ${elapsedSeconds}s: ` +
          result.message +
          failedInfo,
        "error",
      );
      return;
    }

    updateConnectionStatus();

    renderExecutionLog(result.logs || []);

    const warningText = result.warningCount
      ? ` Avisos ignorados: ${result.warningCount}.`
      : "";

    if (
      result.lastResult &&
      result.lastResult.rows &&
      result.lastResult.rows.length > 0
    ) {
      renderResults(result.lastResult.rows);
    } else {
      clearResults(
        `Script executado com sucesso em ${elapsedSeconds}s. ${result.executedCount || 0} comando(s) executado(s).${warningText}`,
      );
    }

    let finalMessage = `Script aplicado com sucesso em ${elapsedSeconds}s. ${result.executedCount || 0} comando(s) executado(s).${warningText}`;
    if (
      result.warningCount &&
      Array.isArray(result.warnings) &&
      result.warnings.length
    ) {
      const details = result.warnings
        .map((w, idx) => `${idx + 1}. ${w.message}`)
        .join(" | ");
      finalMessage += ` Detalhes: ${details}`;
      showActionMessage(finalMessage, "warning");
      return;
    }

    showActionMessage(finalMessage, "success");
  } catch (err) {
    updateConnectionStatus();
    showActionMessage("Erro de execução: " + (err.message || err), "error");
  } finally {
    setExecutionUiBusy(false);
  }
}

export async function pingDesktop() {
  if (window.db && window.db.ping) {
    const ping = await window.db.ping();
    if (!ping.ok) {
      setConnectionState("disconnected", ping.message);
      showActionMessage(ping.message, "error");
    }
  } else {
    setConnectionState("disconnected", "Integração desktop não carregada");
    showActionMessage("Integração desktop não carregada.", "error");
  }
}
