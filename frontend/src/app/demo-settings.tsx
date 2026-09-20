import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ApiIdentity } from "../api/client.js";

export const DEMO_ACTORS = [
  { id: "quality-owner", label: "品质负责人" },
  { id: "sales-director", label: "销售总监" },
  { id: "engineer", label: "工程师" },
  { id: "finance", label: "财务" },
  { id: "general-manager", label: "总经理" },
  { id: "admin", label: "管理员" },
  { id: "viewer", label: "演示查看者" },
] as const;

type DemoSettingsValue = {
  identity: ApiIdentity;
  tenantId: string;
  actorId: string;
  setTenantId: (tenantId: string) => void;
  setActorId: (actorId: string) => void;
};

const DemoSettingsContext = createContext<DemoSettingsValue | null>(null);

export function DemoSettingsProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState(() =>
    window.localStorage.getItem("demoTenantId") || "demo-manufacturing",
  );
  const [actorId, setActorIdState] = useState(() => {
    const saved = window.localStorage.getItem("demoActorId");
    return saved && DEMO_ACTORS.some((actor) => actor.id === saved) ? saved : "quality-owner";
  });
  const value = useMemo<DemoSettingsValue>(() => ({
    identity: { tenantId, actorId },
    tenantId,
    actorId,
    setTenantId: (nextTenantId) => {
      window.localStorage.setItem("demoTenantId", nextTenantId);
      setTenantIdState(nextTenantId);
    },
    setActorId: (nextActorId) => {
      window.localStorage.setItem("demoActorId", nextActorId);
      setActorIdState(nextActorId);
    },
  }), [actorId, tenantId]);
  return <DemoSettingsContext.Provider value={value}>{children}</DemoSettingsContext.Provider>;
}

export function useDemoSettings() {
  const value = useContext(DemoSettingsContext);
  if (!value) throw new Error("demo_settings_provider_required");
  return value;
}
