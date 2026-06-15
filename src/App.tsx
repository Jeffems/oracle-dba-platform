import { useState } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { Dashboard } from "./pages/Dashboard";
import { ModulePage } from "./pages/ModulePage";
import { PerformanceMonitor } from "./pages/PerformanceMonitor";
import { MaintenanceAssistant } from "./pages/MaintenanceAssistant";
import { AgentService } from "./pages/AgentService";
import { CentralApi } from "./pages/CentralApi";
import { CentralCloudDashboard } from "./pages/CentralCloudDashboard";
import { PatchTemporary } from "./pages/PatchTemporary";
import { SqlWorksheet } from "./pages/SqlWorksheet";
import { RemoteDiag } from "./pages/RemoteDiag";

export function App() {
  const [page, setPage] = useState("dashboard");

  return (
    <AppLayout currentPage={page} onPageChange={setPage}>
      {page === "dashboard" && <Dashboard />}
      {page === "performance" && <PerformanceMonitor />}
      {page === "agent" && <AgentService />}
      {page === "centralCloud" && <CentralCloudDashboard />}
      {page === "centralApi" && <CentralApi />}
      {page === "maintenance" && <MaintenanceAssistant />}
      {page === "memory" && <ModulePage moduleKey="memory" />}
      {page === "users" && <ModulePage moduleKey="users" />}
      {page === "tablespaces" && <ModulePage moduleKey="tablespaces" />}
      {page === "datafiles" && <ModulePage moduleKey="datafiles" />}
      {page === "importExport" && <ModulePage moduleKey="importExport" />}
      {page === "sessions" && <ModulePage moduleKey="sessions" />}
      {page === "diagnostic" && <ModulePage moduleKey="diagnostic" />}
      {page === "erp" && <ModulePage moduleKey="erp" />}
      {page === "patch" && <PatchTemporary />}
      {page === "sql" && <SqlWorksheet />}
      {page === "remoteDiag" && <RemoteDiag />}
    </AppLayout>
  );
}
