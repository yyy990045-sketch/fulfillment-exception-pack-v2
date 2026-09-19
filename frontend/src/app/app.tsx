import { createBrowserRouter, Navigate, Outlet, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./app-shell.js";
import { AppProviders } from "./providers.js";
import { ManufacturingWorkbenchPage } from "../features/manufacturing/pages/manufacturing-workbench-page.js";

export const appRoutes: RouteObject[] = [{
  element: <AppShell><Outlet /></AppShell>,
  children: [
    { path: "/", element: <Navigate to="/manufacturing/ctx-so-mfg-001" replace /> },
    { path: "/manufacturing/:contextId", element: <ManufacturingWorkbenchPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId", element: <ManufacturingWorkbenchPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/evidence", element: <ManufacturingWorkbenchPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/analysis", element: <ManufacturingWorkbenchPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/decision", element: <ManufacturingWorkbenchPage /> },
    { path: "*", element: <Navigate to="/manufacturing/ctx-so-mfg-001" replace /> },
  ],
}];

const browserRouter = createBrowserRouter(appRoutes);

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={browserRouter} />
    </AppProviders>
  );
}
