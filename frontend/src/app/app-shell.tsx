import { BarChart3, Boxes, Building2, ChartNoAxesCombined, ChevronDown, Menu, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { shellWidthClass } from "../components/product/page-layout.js";
import { Button } from "../components/ui/button.js";
import { useAccountContext } from "../hooks/use-manufacturing.js";
import { cn } from "../lib/utils.js";
import { DEMO_ACTORS, useDemoSettings } from "./demo-settings.js";
import { PRODUCT_NAME } from "./product.js";

const navItems = [
  { to: "/manufacturing/ctx-so-mfg-001", label: "履约风险", icon: ShieldAlert },
  { to: "/manufacturing/operations", label: "运营视图", icon: ChartNoAxesCombined },
  { to: "/manufacturing/analytics", label: "分析", icon: BarChart3 },
  { to: "/manufacturing/workspace", label: "方案包", icon: Boxes },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { actorId, setActorId, tenantId, setTenantId } = useDemoSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const accountContext = useAccountContext();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hasToken = Boolean(window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken"));
  const currentActor = accountContext.data?.currentActor;
  const organizationFallback = currentActor?.organizationSource === "tenant_fallback";
  const account = currentActor
    ? {
      organization: organizationFallback ? `租户：${currentActor.organization}` : currentActor.organization,
      organizationNote: organizationFallback ? "组织名称未配置" : null,
      user: currentActor.user,
      role: currentActor.roles.join("、") || "角色未记录",
    }
    : null;
  const accountSummary = account?.organization ?? (accountContext.isLoading ? "正在读取账户信息" : "账户信息暂不可用");
  const accountUser = account?.user ?? (accountContext.isLoading ? "正在读取当前用户" : "用户信息不可用");
  const demoOrganizations = accountContext.data?.demoWorkspace?.organizations ?? [];
  const selectedDemoOrganization = demoOrganizations.find((organization) => organization.tenantId === tenantId);
  const switchDemoOrganization = (nextTenantId: string) => {
    const next = demoOrganizations.find((organization) => organization.tenantId === nextTenantId);
    if (!next) return;
    setTenantId(nextTenantId);
    queryClient.clear();
    if (location.pathname !== next.defaultPath) navigate(next.defaultPath, { replace: true });
  };
  useEffect(() => {
    if (hasToken || !demoOrganizations.length) return;
    if (demoOrganizations.some((organization) => organization.tenantId === tenantId)) return;
    switchDemoOrganization(demoOrganizations[0]!.tenantId);
  }, [demoOrganizations, hasToken, tenantId]);
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className={`${shellWidthClass} flex h-full items-center justify-between`}>
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-b from-interactive to-interactive/85 text-xs font-bold text-white shadow-[0_1px_3px_rgba(28,27,24,0.3)]">履</span>
              <strong className="truncate text-[13.5px] font-semibold tracking-tight">{PRODUCT_NAME}</strong>
            </div>
            <nav aria-label="主导航" className="hidden items-center gap-1 lg:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-text-secondary transition-colors duration-150 hover:bg-surface-subtle hover:text-text-primary",
                    isActive && "bg-interactive/[0.08] font-medium text-interactive hover:bg-interactive/[0.08] hover:text-interactive",
                  )}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <details className="relative">
              <summary
                aria-label="账户与设置"
                className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-surface-muted text-text-muted">
                  <Building2 className="size-3.5" aria-hidden="true" />
                </span>
                <span className="hidden min-w-0 md:block">
                  <span className="block truncate text-xs font-medium text-text-secondary">{accountSummary}</span>
                  <span className="block truncate text-[11px] text-text-muted">{accountUser}</span>
                </span>
                <ChevronDown className="size-3.5 text-text-muted" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-border bg-surface p-3 shadow-popover">
                <div className="flex items-start gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted text-text-muted">
                    <UserRound className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-secondary">{accountSummary}</div>
                    {account?.organizationNote && (
                      <div className="mt-0.5 text-[11px] text-text-muted">{account.organizationNote}</div>
                    )}
                    <div className="mt-0.5 text-xs text-text-muted">
                      {account ? `${account.user} · ${account.role}` : accountUser}
                    </div>
                  </div>
                </div>
                {!hasToken && (
                  <>
                    <div className="my-3 border-t border-border" />
                    <label className="mb-3 block space-y-1 text-xs text-text-muted">
                      切换演示组织
                      <select
                        aria-label="切换演示组织"
                        className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
                        value={selectedDemoOrganization?.tenantId ?? tenantId}
                        disabled={!demoOrganizations.length}
                        onChange={(event) => switchDemoOrganization(event.target.value)}
                      >
                        {demoOrganizations.length
                          ? demoOrganizations.map((organization) => (
                            <option key={organization.tenantId} value={organization.tenantId}>
                              {organization.organization}
                            </option>
                          ))
                          : <option value={tenantId}>正在读取演示组织</option>}
                      </select>
                    </label>
                    <label className="block space-y-1 text-xs text-text-muted">
                      切换业务角色
                      <select
                        aria-label="切换业务角色"
                        className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
                        value={actorId}
                        onChange={(event) => setActorId(event.target.value)}
                      >
                        {DEMO_ACTORS.map((demoActor) => <option key={demoActor.id} value={demoActor.id}>{demoActor.label}</option>)}
                      </select>
                    </label>
                    <p className="mt-2 text-[11px] text-text-muted">演示环境 · 示例组织</p>
                  </>
                )}
              </div>
            </details>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="打开导航"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <Menu className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      {mobileNavOpen && (
        <nav aria-label="移动导航" className="border-b border-border bg-surface px-4 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex h-9 items-center gap-2 text-sm text-text-secondary"
              onClick={() => setMobileNavOpen(false)}
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
      {children}
    </div>
  );
}
