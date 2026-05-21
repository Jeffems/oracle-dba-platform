import { esc } from "./helpers.js";

export function showTab(name, el) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
}

function normalizeValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function renderResults(rows) {
  const area = document.getElementById("resultArea");
  if (!area) return;

  if (!rows || !rows.length) {
    area.innerHTML = '<div class="small">Nenhum resultado.</div>';
    return;
  }

  const columns = Object.keys(rows[0]);

  const thead = columns.map((col) => `<th>${esc(col)}</th>`).join("");
  const tbody = rows
    .map((row) => {
      return `<tr>${columns.map((col) => `<td>${esc(normalizeValue(row[col]))}</td>`).join("")}</tr>`;
    })
    .join("");

  area.innerHTML = `
    <div class="small" style="margin-bottom:10px;">${rows.length} linha(s) retornada(s)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

export function clearResults(
  message = "Comando executado sem retorno tabular.",
) {
  const area = document.getElementById("resultArea");
  if (!area) return;
  area.innerHTML = `<div class="small">${esc(message)}</div>`;
}

function formatLogMeta(log) {
  const parts = [];
  if (typeof log.durationMs === "number") parts.push(`${log.durationMs} ms`);
  if (log.rowsAffected) parts.push(`${log.rowsAffected} linha(s) afetada(s)`);
  if (log.rowCount) parts.push(`${log.rowCount} linha(s) retornada(s)`);
  return parts.join(" · ");
}

export function clearExecutionLog(
  message = "Nenhuma execução registrada ainda.",
) {
  const area = document.getElementById("executionLogArea");
  if (!area) return;
  area.innerHTML = `<div class="small">${esc(message)}</div>`;
}

export function renderExecutionLog(logs = []) {
  const area = document.getElementById("executionLogArea");
  if (!area) return;

  if (!logs.length) {
    clearExecutionLog();
    return;
  }

  area.innerHTML = logs
    .map((log) => {
      const statusClass =
        log.status === "success"
          ? "log-success"
          : log.status === "warning"
            ? "log-warning"
            : "log-error";
      const statusLabel =
        log.status === "success"
          ? "SUCESSO"
          : log.status === "warning"
            ? "AVISO"
            : "ERRO";
      const meta = formatLogMeta(log);
      return `
      <div class="log-entry ${statusClass}">
        <div class="log-entry-head">
          <span class="log-badge">${statusLabel}</span>
          <span class="small">Comando ${log.index || "-"}${meta ? ` · ${esc(meta)}` : ""}</span>
        </div>
        <div class="small" style="margin:6px 0 10px 0;">${esc(log.message || "")}</div>
        <pre class="log-sql">${esc(log.statement || "")}</pre>
      </div>
    `;
    })
    .join("");
}
