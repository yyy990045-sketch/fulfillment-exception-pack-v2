import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app-shell.js";
import { AppProviders } from "./providers.js";

function ManufacturingFoundationPlaceholder() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6">
      <h1 className="text-xl font-semibold">制造履约工作台</h1>
      <p className="mt-1 text-sm text-text-muted">React frontend foundation</p>
    </main>
  );
}

export function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/manufacturing/ctx-so-mfg-001" replace />} />
        <Route path="/manufacturing/:contextId" element={<ManufacturingFoundationPlaceholder />} />
        <Route path="/manufacturing/:contextId/exceptions/:exceptionId" element={<ManufacturingFoundationPlaceholder />} />
        <Route path="/manufacturing/:contextId/exceptions/:exceptionId/evidence" element={<ManufacturingFoundationPlaceholder />} />
        <Route path="*" element={<Navigate to="/manufacturing/ctx-so-mfg-001" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
