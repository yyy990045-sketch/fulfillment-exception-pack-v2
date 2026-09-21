import { describe, expect, it } from "vitest";
import {
  DEMO_MANUFACTURING_HIERARCHY,
  DEMO_MANUFACTURING_SPACE,
  assertIndustrialHierarchy,
  industrialAncestorPath,
  industrialChildrenOf,
  industrialEquipmentForDomain,
  industrialSpaceRootPath,
  isIndustrialSpace,
  parseIndustrialSpace,
  resolveIndustrialSpace,
} from "../src/industrial/hierarchy.js";
import { IndustrialSemanticError, type IndustrialHierarchy } from "../src/industrial/types.js";

describe("ISA-95 风格工业层级", () => {
  it("演示层级是合法的 Enterprise→Site→Area→Line→Equipment 链", () => {
    expect(() => assertIndustrialHierarchy(DEMO_MANUFACTURING_HIERARCHY)).not.toThrow();
    const levels = DEMO_MANUFACTURING_HIERARCHY.nodes.map((item) => item.level);
    expect(levels.filter((item) => item === "enterprise")).toHaveLength(1);
    expect(levels.filter((item) => item === "equipment")).toHaveLength(3);
  });

  it("解析工业空间时逐级校验父子关系", () => {
    const chain = resolveIndustrialSpace(DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE);
    expect(chain.map((item) => item.level)).toEqual(["enterprise", "site", "area", "line"]);
    expect(chain.at(-1)!.node.id).toBe("line-a");
    expect(() => resolveIndustrialSpace(DEMO_MANUFACTURING_HIERARCHY, {
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "line-a",
      lineId: "line-a",
    })).toThrow(/INDUSTRIAL_LEVEL_MISMATCH/);
    expect(() => resolveIndustrialSpace(DEMO_MANUFACTURING_HIERARCHY, {
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "no-such-line",
    })).toThrow(/INDUSTRIAL_NODE_NOT_FOUND/);
  });

  it("按业务域把事件挂到具体设备，而不是停在 Line", () => {
    expect(industrialEquipmentForDomain(DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE, "production")).toBe("machine-a01");
    expect(industrialEquipmentForDomain(DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE, "quality")).toBe("quality-station-a");
    expect(industrialEquipmentForDomain(DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE, "shipment")).toBe("packing-station-a");
    // 财务/服务不属于产线设备，回退到 line 下第一个设备（不发明新节点）
    expect(industrialEquipmentForDomain(DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE, "finance")).toBe("machine-a01");
    expect(industrialChildrenOf(DEMO_MANUFACTURING_HIERARCHY, "line-a")).toHaveLength(3);
  });

  it("拒绝带环、缺父级与层级错位的层级定义", () => {
    const broken: IndustrialHierarchy = {
      hierarchyId: "broken",
      tenantId: "t",
      nodes: [
        { id: "a", level: "line", parentId: "b", name: "a", metadata: {} },
        { id: "b", level: "area", parentId: "a", name: "b", metadata: {} },
      ],
    };
    expect(() => assertIndustrialHierarchy(broken)).toThrow(IndustrialSemanticError);
    const missingParent: IndustrialHierarchy = {
      hierarchyId: "missing",
      tenantId: "t",
      nodes: [{ id: "s", level: "site", parentId: null, name: "s", metadata: {} }],
    };
    expect(() => assertIndustrialHierarchy(missingParent)).toThrow(/INDUSTRIAL_PARENT_REQUIRED/);
  });

  it("祖先路径与 UNS 根路径都可查询（供 Context 页面消费）", () => {
    expect(industrialAncestorPath(DEMO_MANUFACTURING_HIERARCHY, "machine-a01").map((item) => item.id)).toEqual([
      "demo-manufacturing",
      "factory-shanghai-01",
      "assembly-workshop",
      "line-a",
      "machine-a01",
    ]);
    expect(industrialSpaceRootPath(DEMO_MANUFACTURING_SPACE))
      .toBe("enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a");
  });

  it("空间绑定解析对非法输入是安全的（返回 null 而不是抛出）", () => {
    expect(isIndustrialSpace({ enterpriseId: "e", siteId: "s", areaId: "a", lineId: "l" })).toBe(true);
    expect(parseIndustrialSpace({ enterpriseId: "e", siteId: "s", areaId: "a" })).toBeNull();
    expect(parseIndustrialSpace("enterprise/demo")).toBeNull();
    expect(parseIndustrialSpace(null)).toBeNull();
  });
});
