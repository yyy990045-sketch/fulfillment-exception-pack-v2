import { Boxes, Building2, ChartNoAxesCombined, ChevronDown, Menu, ShieldAlert, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { cn } from "../lib/utils.js";
import { DEMO_ACTORS, useDemoSettings } from "./demo-settings.js";

const navItems = [
  { to: "/manufacturing/ctx-so-mfg-001", label: "履约风险", icon: ShieldAlert },
  { to: "/operations", label: "运营视图", icon: ChartNoAxesCombined, external: true },
  { to: "/workspace?context=ctx-so-mfg-001", label: "方案包", icon: Boxes, external: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { actorId, setActorId } = useDemoSettings();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hasToken = Boolean(window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken"));
  const actor = DEMO_ACTORS.find((item) => item.id === actorId) ?? DEMO_ACTORS[0];
  const account = hasToken
    ? { organization: "当前企业", user: "已认证用户", role: "由后端权限决定" }
    : { organization: "示例制造企业", user: actor.label, role: actor.label };
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-surface">
        <div className="mx-auto flex h-full w-full max-w-[1720px] items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-interactive text-sm font-semibold text-white">履</span>
              <strong className="truncate text-sm font-semibold">履约风险</strong>
            </div>
            <nav aria-label="主导航" className="hidden items-center gap-1 lg:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  reloadDocument={item.external}
                  className={({ isActive }) => cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary",
                    isActive && !item.external && "bg-interactive/5 text-interactive",
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
                  <span className="block truncate text-xs font-medium text-text-secondary">{account.organization}</span>
                  <span className="block truncate text-[11px] text-text-muted">{account.user}</span>
                </span>
                <ChevronDown className="size-3.5 text-text-muted" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 top-11 z-50 w-72 border border-border bg-surface p-3">
                <div className="flex items-start gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted text-text-muted">
                    <UserRound className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-secondary">{account.organization}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{account.user} · {account.role}</div>
                  </div>
                </div>
                {!hasToken && (
                  <>
                    <div className="my-3 border-t border-border" />
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
                    <p className="mt-2 text-[11px] text-text-muted">示例组织，仅供本地试点演示。</p>
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
              reloadDocument={item.external}
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
