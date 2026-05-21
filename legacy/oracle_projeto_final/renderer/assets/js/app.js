import { copyPre, downloadPre } from "./helpers.js";
import { showTab } from "./ui.js";
import {
  connectDatabase,
  disconnectDatabase,
  executeOutput,
  executePatchApply,
  pingDesktop,
  testCurrentConnection,
  updateConnectionStatus,
} from "./connection.js";
import {
  computeMemory,
  initGenerators,
  renderDiagnostic,
  renderErp,
  renderExpandDatafiles,
  renderImportExport,
  renderSessions,
  renderTablespaces,
  renderUsers,
} from "./modules/generators.js";
import { initPathInputs } from "./path-input.js";

window.copyPre = copyPre;
window.downloadPre = downloadPre;
window.showTab = showTab;
window.connectDatabase = connectDatabase;
window.disconnectDatabase = disconnectDatabase;
window.testCurrentConnection = testCurrentConnection;
window.executeOutput = executeOutput;
window.executePatchApply = executePatchApply;
window.computeMemory = computeMemory;
window.renderUsers = renderUsers;
window.renderTablespaces = renderTablespaces;
window.renderExpandDatafiles = renderExpandDatafiles;
window.renderImportExport = renderImportExport;
window.renderSessions = renderSessions;
window.renderDiagnostic = renderDiagnostic;
window.renderErp = renderErp;

window.addEventListener("DOMContentLoaded", async () => {
  initGenerators();
  updateConnectionStatus();
  initPathInputs();
  await pingDesktop();
});
