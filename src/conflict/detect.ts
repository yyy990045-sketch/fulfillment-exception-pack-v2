import type { ConflictField, ConflictIssue, ConflictPair, EvidenceItem, Severity } from "../types.js";

function norm(value: string | number | null): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  return value.trim();
}

function severityFor(field: ConflictField): Severity {
  if (field === "amount" || field === "qty") return "high";
  if (field === "model" || field === "status") return "critical";
  return "medium";
}

function groupKey(item: EvidenceItem): string {
  return item.compareKey;
}

function fieldOf(item: EvidenceItem): ConflictField {
  if (item.field === "amount" || item.field === "qty" || item.field === "model" || item.field === "date" || item.field === "party" || item.field === "status" || item.field === "orderId") {
    return item.field;
  }
  return "status";
}

export function detectConflicts(evidence: EvidenceItem[]): ConflictPair[] {
  const supported = evidence.filter((e) => e.support === "supported" && e.locator.fileName);
  const groups = new Map<string, EvidenceItem[]>();
  for (const item of supported) {
    const key = groupKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const pairs: ConflictPair[] = [];
  for (const [key, items] of groups) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const left = items[i];
        const right = items[j];
        if (!left || !right) continue;
        if (left.sourceId === right.sourceId && left.sourceVersion === right.sourceVersion) continue;
        if (norm(left.value) === norm(right.value)) continue;
        const field = fieldOf(left);
        pairs.push({
          id: `c-${key}-${left.id}-${right.id}`,
          issueId: `issue-${key}`,
          field,
          leftEvidenceId: left.id,
          rightEvidenceId: right.id,
          leftValue: left.value,
          rightValue: right.value,
          severity: severityFor(field),
          resolution: "unresolved",
        });
      }
    }
  }
  const validUntil = supported.filter((e) => e.compareKey === "quoteValidUntil");
  const orderDates = supported.filter((e) => e.compareKey === "orderDate");
  for (const left of validUntil) {
    for (const right of orderDates) {
      if (String(left.value) < String(right.value)) {
        pairs.push({
          id: `c-date-${left.id}-${right.id}`,
          issueId: "issue-date",
          field: "date",
          leftEvidenceId: left.id,
          rightEvidenceId: right.id,
          leftValue: left.value,
          rightValue: right.value,
          severity: "medium",
          resolution: "unresolved",
        });
      }
    }
  }
  const quoteStatus = supported.filter((e) => e.compareKey === "quoteStatus");
  const orderStatus = supported.filter((e) => e.compareKey === "orderStatus");
  for (const left of quoteStatus) {
    for (const right of orderStatus) {
      const pending = String(left.value) === "待审批" || String(left.value) === "已失效";
      const progressed = String(right.value) !== "待确认" || String(left.value) === "已失效";
      if (pending && (String(right.value) === "生产中" || String(left.value) === "已失效")) {
        pairs.push({
          id: `c-status-${left.id}-${right.id}`,
          issueId: "issue-status",
          field: "status",
          leftEvidenceId: left.id,
          rightEvidenceId: right.id,
          leftValue: left.value,
          rightValue: right.value,
          severity: "critical",
          resolution: "unresolved",
        });
      }
      void progressed;
    }
  }
  return pairs;
}

const severityRank: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function buildConflictIssues(conflicts: ConflictPair[]): ConflictIssue[] {
  const grouped = new Map<string, ConflictIssue>();
  for (const conflict of conflicts) {
    const id = conflict.issueId ?? conflict.id;
    const current = grouped.get(id);
    const evidenceIds = [...new Set([...(current?.evidenceIds ?? []), conflict.leftEvidenceId, conflict.rightEvidenceId])];
    const values = [...new Set([...(current?.values ?? []), conflict.leftValue, conflict.rightValue])];
    if (current) {
      current.conflictIds.push(conflict.id);
      current.evidenceIds = evidenceIds;
      current.values = values;
      if (severityRank[conflict.severity] > severityRank[current.severity]) current.severity = conflict.severity;
    } else {
      grouped.set(id, { id, field: conflict.field, severity: conflict.severity, conflictIds: [conflict.id], evidenceIds, values, resolution: conflict.resolution });
    }
  }
  return [...grouped.values()];
}

export function gapsFrom(evidence: EvidenceItem[]): string[] {
  const gaps: string[] = [];
  const complaint = evidence.filter((e) => e.sourceKind === "complaint");
  if (!complaint.length) return gaps;
  const parties = complaint.filter((e) => e.field === "party");
  if (parties.length === 0 || parties.every((p) => !norm(p.value))) gaps.push("complaint.party");
  const orderIds = complaint.filter((e) => e.field === "orderId");
  if (orderIds.length === 0 || orderIds.every((o) => !norm(o.value))) gaps.push("complaint.orderId");
  return [...new Set(gaps)];
}
