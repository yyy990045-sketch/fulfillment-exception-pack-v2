import { createBrowserRouter, Navigate, Outlet, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./app-shell.js";
import { AppProviders } from "./providers.js";
import { AnalyticsPage } from "../features/analytics/pages/analytics-page.js";
import { ExceptionRecordPage } from "../features/manufacturing/pages/exception-record-page.js";
import { ManufacturingContextPage } from "../features/manufacturing/pages/manufacturing-context-page.js";
import { OperationsPage } from "../features/operations/pages/operations-page.js";
import { JudgePage } from "../features/judge/pages/judge-page.js";
import { GenericContextWorkspacePage } from "../features/workspace/pages/generic-context-workspace-page.js";
import { SolutionPackPage } from "../features/workspace/pages/solution-pack-page.js";

export const appRoutes: RouteObject[] = [{
  element: <AppShell><Outlet /></AppShell>,
  children: [
    { path: "/", element: <Navigate to="/manufacturing/ctx-so-mfg-001" replace /> },
    { path: "/manufacturing/:contextId", element: <ManufacturingContextPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId", element: <ExceptionRecordPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/overview", element: <ExceptionRecordPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/evidence", element: <ExceptionRecordPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/analysis", element: <ExceptionRecordPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/decision", element: <ExceptionRecordPage /> },
    { path: "/manufacturing/:contextId/exceptions/:exceptionId/governance", element: <ExceptionRecordPage /> },
    // 运营 / 方案包声明为静态路由（静态段优先级高于 :contextId），同时保留无前缀路径兼容生产旧入口
    // 评委视图：现有数据的只读聚合；静态段优先级高于 :contextId
    { path: "/demo/judge", element: <JudgePage /> },
    { path: "/manufacturing/demo/judge", element: <JudgePage /> },
    { path: "/operations", element: <OperationsPage /> },
    { path: "/manufacturing/operations", element: <OperationsPage /> },
    { path: "/analytics", element: <AnalyticsPage /> },
    { path: "/manufacturing/analytics", element: <AnalyticsPage /> },
    { path: "/workspace", element: <SolutionPackPage /> },
    { path: "/workspace/:contextId", element: <GenericContextWorkspacePage /> },
    { path: "/manufacturing/workspace", element: <SolutionPackPage /> },
    { path: "/manufacturing/workspace/:contextId", element: <GenericContextWorkspacePage /> },
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
