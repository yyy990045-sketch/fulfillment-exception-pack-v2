import { Boxes, ChartNoAxesCombined, Menu, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { cn } from "../lib/utils.js";
import { DEMO_ACTORS, useDemoSettings } from "./demo-settings.js";

const navItems = [
  { to: "/manufacturing/ctx-so-mfg-001", label: "履约风险", icon: ShieldAlert },
  { to: "/operations", label: "运营视图", icon: ChartNoAxesCombined, external: true },
  { to: "/workspace?context=ctx-so-mfg-001", label: "Solution Packs", icon: Boxes, external: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { actorId, setActorId } = useDemoSettings();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:px-5">
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
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-text-secondary hover:bg-surface-muted",
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
          <label className="hidden items-center gap-2 text-xs text-text-muted md:flex">
            演示身份
            <select
              aria-label="选择演示身份"
              className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
            >
              {DEMO_ACTORS.map((actor) => <option key={actor.id} value={actor.id}>{actor.label}</option>)}
            </select>
          </label>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开导航">
            <Menu className="size-4" />
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
