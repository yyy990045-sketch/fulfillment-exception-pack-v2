import type { GoldCase, GoldMaterial } from "../types.js";

const TENANT = "demo-tenant-a";
const SCOPE = "it-alert:ops";

function alert(id: string, title: string, fields: { alertId: string; host: string; severity: string; status: string; note: string }): GoldCase {
  const material: GoldMaterial = {
    sourceId: `${id}-alert`,
    fileName: `${id}-alert.md`,
    kind: "alert",
    version: "v1",
    tenantId: TENANT,
    scope: SCOPE,
    markdown: `告警编号: ${fields.alertId}\n主机: ${fields.host}\n级别: ${fields.severity}\n状态: ${fields.status}\n说明: ${fields.note}\n`,
  };
  return {
    id,
    title,
    tenantId: TENANT,
    scope: SCOPE,
    ownerRole: "工程师",
    pack: "it-alert",
    materials: [material],
    expectedFacts: [
      { field: "alertId", value: fields.alertId, sourceId: material.sourceId },
      { field: "host", value: fields.host, sourceId: material.sourceId },
    ],
    expectedConflicts: [],
    expectedGaps: [],
    expectedActionTypes: ["create_task"],
    negatives: [],
    closeWhen: "沙箱任务回执后关闭",
  };
}

export function buildItOpsGoldSet(): GoldCase[] {
  return [
    alert("IT-001", "磁盘将满需扩容", { alertId: "ALT-001", host: "edge-01", severity: "critical", status: "firing", note: "磁盘将满需扩容" }),
    alert("IT-002", "主机失联", { alertId: "ALT-002", host: "edge-02", severity: "critical", status: "firing", note: "心跳丢失" }),
    alert("IT-003", "内存持续高压", { alertId: "ALT-003", host: "api-01", severity: "high", status: "firing", note: "内存使用超过 90%" }),
    alert("IT-004", "接口延迟升高", { alertId: "ALT-004", host: "api-02", severity: "high", status: "firing", note: "p95 超过 800ms" }),
    alert("IT-005", "证书即将过期", { alertId: "ALT-005", host: "lb-01", severity: "medium", status: "firing", note: "TLS 证书 7 日内过期" }),
    alert("IT-006", "备份失败", { alertId: "ALT-006", host: "bak-01", severity: "high", status: "firing", note: "夜间备份失败" }),
    alert("IT-007", "副本延迟", { alertId: "ALT-007", host: "db-02", severity: "high", status: "firing", note: "复制延迟 120s" }),
    alert("IT-008", "登录失败激增", { alertId: "ALT-008", host: "auth-01", severity: "critical", status: "firing", note: "5 分钟失败登录超阈值" }),
    alert("IT-009", "队列堆积", { alertId: "ALT-009", host: "mq-01", severity: "high", status: "firing", note: "待处理消息超过 1 万" }),
    alert("IT-010", "inode 耗尽", { alertId: "ALT-010", host: "edge-03", severity: "critical", status: "firing", note: "inode 使用率 98%" }),
  ];
}
