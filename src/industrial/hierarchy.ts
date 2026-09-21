/**
 * ISA-95 风格工业层级。
 *
 * 目标不是实现完整 ISA-95 标准（不做 B2MML、不做 Equipment 能力模型），
 * 而是给所有工业业务对象一个明确的工业空间上下文：
 *
 *   Enterprise demo-manufacturing
 *   └── Site factory-shanghai-01
 *       └── Area assembly-workshop
 *           └── Line line-a
 *               ├── Equipment machine-a01        （MES：加工/装配）
 *               ├── Equipment quality-station-a  （QMS：质检工位）
 *               └── Equipment packing-station-a  （WMS：包装/发货工位）
 *
 * 关键纪律：UNS 空间 ≠ Business Context。
 * 空间回答「在哪里发生」，Context 回答「哪一条业务履约链」。
 * 同一个空间可以同时承载多条 Context（SO-IND-001 / SO-IND-002 …）。
 */
import {
  IndustrialSemanticError,
  INDUSTRIAL_LEVELS,
  type IndustrialDomain,
  type IndustrialHierarchy,
  type IndustrialLevel,
  type IndustrialNode,
  type IndustrialSpace,
} from "./types.js";

const PARENT_LEVEL: Record<IndustrialLevel, IndustrialLevel | null> = {
  enterprise: null,
  site: "enterprise",
  area: "site",
  line: "area",
  equipment: "line",
};

function node(input: {
  id: string;
  level: IndustrialLevel;
  parentId: string | null;
  name: string;
  metadata?: Record<string, unknown>;
}): IndustrialNode {
  return {
    id: input.id,
    level: input.level,
    parentId: input.parentId,
    name: input.name,
    metadata: input.metadata ?? {},
  };
}

/** 演示用工业层级：唯一一份，被 Simulator / UNS Topic / Context Summary 共同引用。 */
export const DEMO_MANUFACTURING_HIERARCHY: IndustrialHierarchy = {
  hierarchyId: "demo-manufacturing-isa95",
  tenantId: "demo-manufacturing",
  nodes: [
    node({ id: "demo-manufacturing", level: "enterprise", parentId: null, name: "Demo Manufacturing Group", metadata: { timezone: "Asia/Shanghai" } }),
    node({ id: "factory-shanghai-01", level: "site", parentId: "demo-manufacturing", name: "上海总装工厂", metadata: { country: "CN", city: "Shanghai" } }),
    node({ id: "assembly-workshop", level: "area", parentId: "factory-shanghai-01", name: "总装车间", metadata: { shiftPattern: "two_shift" } }),
    node({ id: "line-a", level: "line", parentId: "assembly-workshop", name: "A 线", metadata: { designCapacityPerShift: 120 } }),
    node({ id: "machine-a01", level: "equipment", parentId: "line-a", name: "加工中心 A01", metadata: { assetClass: "machining_center", domain: "production" } }),
    node({ id: "quality-station-a", level: "equipment", parentId: "line-a", name: "质检工位 A", metadata: { assetClass: "inspection_station", domain: "quality" } }),
    node({ id: "packing-station-a", level: "equipment", parentId: "line-a", name: "包装工位 A", metadata: { assetClass: "packing_station", domain: "shipment" } }),
  ],
};

/** 演示工业空间坐标（Simulator 默认写入的那一个 Line）。 */
export const DEMO_MANUFACTURING_SPACE: IndustrialSpace = {
  enterpriseId: "demo-manufacturing",
  siteId: "factory-shanghai-01",
  areaId: "assembly-workshop",
  lineId: "line-a",
};

export function industrialNodeById(hierarchy: IndustrialHierarchy, nodeId: string) {
  return hierarchy.nodes.find((item) => item.id === nodeId);
}

export function industrialChildrenOf(hierarchy: IndustrialHierarchy, nodeId: string) {
  return hierarchy.nodes.filter((item) => item.parentId === nodeId);
}

export function industrialAncestorPath(hierarchy: IndustrialHierarchy, nodeId: string): IndustrialNode[] {
  const path: IndustrialNode[] = [];
  let current = industrialNodeById(hierarchy, nodeId);
  const guard = new Set<string>();
  while (current) {
    if (guard.has(current.id)) throw new IndustrialSemanticError("INDUSTRIAL_HIERARCHY_CYCLE", current.id);
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? industrialNodeById(hierarchy, current.parentId) : undefined;
  }
  if (!path.length) throw new IndustrialSemanticError("INDUSTRIAL_NODE_NOT_FOUND", nodeId);
  return path;
}

/** 空间坐标 → 从 Enterprise 到该层级的分层节点（用于 Context Summary 与 UNS 根路径）。 */
export function resolveIndustrialSpace(hierarchy: IndustrialHierarchy, space: IndustrialSpace) {
  const chain: Array<{ level: IndustrialLevel; node: IndustrialNode }> = [];
  const expected: Array<[IndustrialLevel, string]> = [
    ["enterprise", space.enterpriseId],
    ["site", space.siteId],
    ["area", space.areaId],
    ["line", space.lineId],
  ];
  if (space.equipmentId) expected.push(["equipment", space.equipmentId]);
  for (const [level, id] of expected) {
    const found = industrialNodeById(hierarchy, id);
    if (!found) throw new IndustrialSemanticError("INDUSTRIAL_NODE_NOT_FOUND", `${level}:${id}`);
    if (found.level !== level) throw new IndustrialSemanticError("INDUSTRIAL_LEVEL_MISMATCH", `${id}:expected=${level}:actual=${found.level}`);
    const previous = chain.at(-1);
    if (previous && found.parentId !== previous.node.id) {
      throw new IndustrialSemanticError("INDUSTRIAL_HIERARCHY_BROKEN", `${id}:parent=${found.parentId ?? "null"}:expected=${previous.node.id}`);
    }
    chain.push({ level, node: found });
  }
  return chain;
}

export function assertIndustrialHierarchy(hierarchy: IndustrialHierarchy) {
  const byId = new Map<string, IndustrialNode>();
  for (const item of hierarchy.nodes) {
    if (byId.has(item.id)) throw new IndustrialSemanticError("INDUSTRIAL_NODE_DUPLICATE", item.id);
    if (!INDUSTRIAL_LEVELS.includes(item.level)) throw new IndustrialSemanticError("INDUSTRIAL_LEVEL_UNKNOWN", item.level);
    byId.set(item.id, item);
  }
  for (const item of hierarchy.nodes) {
    const expectedParent = PARENT_LEVEL[item.level];
    if (expectedParent === null) {
      if (item.parentId !== null) throw new IndustrialSemanticError("INDUSTRIAL_ROOT_HAS_PARENT", item.id);
      continue;
    }
    if (!item.parentId) throw new IndustrialSemanticError("INDUSTRIAL_PARENT_REQUIRED", item.id);
    const parent = byId.get(item.parentId);
    if (!parent) throw new IndustrialSemanticError("INDUSTRIAL_PARENT_NOT_FOUND", `${item.id}->${item.parentId}`);
    if (parent.level !== expectedParent) throw new IndustrialSemanticError("INDUSTRIAL_PARENT_LEVEL_MISMATCH", `${item.id}:parent=${parent.level}:expected=${expectedParent}`);
  }
  // 环路检测
  for (const item of hierarchy.nodes) {
    const seen = new Set<string>([item.id]);
    let cursor = item.parentId;
    while (cursor) {
      if (seen.has(cursor)) throw new IndustrialSemanticError("INDUSTRIAL_HIERARCHY_CYCLE", item.id);
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  return hierarchy;
}

/** 业务域默认落在哪个设备上：让每条事件都能定位到具体机台，而不是停在 Line。 */
export function industrialEquipmentForDomain(hierarchy: IndustrialHierarchy, space: IndustrialSpace, domain: IndustrialDomain) {
  const lineChildren = industrialChildrenOf(hierarchy, space.lineId);
  return lineChildren.find((item) => item.metadata.domain === domain)?.id
    ?? lineChildren.find((item) => item.level === "equipment")?.id
    ?? null;
}

/** 工业空间 → `enterprise/x/site/x/area/x/line/x` 根路径（作为 Context 的 UNS 归属）。 */
export function industrialSpaceRootPath(space: IndustrialSpace) {
  const segments = ["enterprise", space.enterpriseId, "site", space.siteId, "area", space.areaId, "line", space.lineId];
  if (space.equipmentId) segments.push("equipment", space.equipmentId);
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function isIndustrialSpace(value: unknown): value is IndustrialSpace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.enterpriseId === "string" && candidate.enterpriseId.trim().length > 0 &&
    typeof candidate.siteId === "string" && candidate.siteId.trim().length > 0 &&
    typeof candidate.areaId === "string" && candidate.areaId.trim().length > 0 &&
    typeof candidate.lineId === "string" && candidate.lineId.trim().length > 0 &&
    (candidate.equipmentId === undefined || typeof candidate.equipmentId === "string")
  );
}

export function parseIndustrialSpace(value: unknown): IndustrialSpace | null {
  if (!isIndustrialSpace(value)) return null;
  return {
    enterpriseId: value.enterpriseId,
    siteId: value.siteId,
    areaId: value.areaId,
    lineId: value.lineId,
    ...(value.equipmentId ? { equipmentId: value.equipmentId } : {}),
  };
}
